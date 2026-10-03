# Import Restructuring Review Report

## Review Summary

**Verdict**: APPROVE

This review covers the modifications to prioritize the local-first import model in DomestiK. The frontend user interface has been successfully cleaned of all browser-based upload components (JS bridge, webkitdirectory) and unifies the flow around a native server-side folder picker (`FolderPickerDialog`). The ingestion service was successfully patched to use `os.path.lexists` for robust handling of broken symlinks and duplicate imports, and a comprehensive test suite was added to verify these behaviors.

---

## Quality Review Report

### Findings

#### [Minor] Finding 1: Potential Filename Collision in Recursive Module Scan

- **What**: Files with identical names in nested folders under the same module directory collide during copy/symlink imports.
- **Where**: `backend/app/services/ingestion.py` (lines 268, 318, 403)
- **Why**: The ingestion service flattens recursive directories inside a module into a single flat folder structure. The destination file path uses `dest_dir / source_file.name`. If a module directory contains nested subfolders with duplicate filenames (e.g. `Modulo 1/Teoria/intro.mp4` and `Modulo 1/Practica/intro.mp4`), they resolve to the exact same destination path (`media_dir/course_id/Modulo 1/intro.mp4`). This results in one file shadowing/overwriting the other under the `copy` or `symlink` strategies.
- **Suggestion**: In a future update, preserve the internal subpath relative to the module root (e.g., `media_dir/course_id/Modulo 1/Teoria/intro.mp4` and `media_dir/course_id/Modulo 1/Practica/intro.mp4`) or append a unique hash to the destination filename to guarantee uniqueness.

### Verified Claims

- **Tabs or mode selectors removed from `ImportDialog`** → verified via code inspection of `frontend/app/components/import_dialog.py` (no `QTab` or mode logic left) → **PASS**
- **Single flow using `FolderPickerDialog`** → verified via code inspection of `_open_server_picker()` calling `FolderPickerDialog` → **PASS**
- **Confirming folder selection triggers automatic validation** → verified via code inspection of `_on_folder_selected` calling `_validate_directory` using `asyncio.create_task` → **PASS**
- **Switch for copying files physically exists (default False)** → verified via code inspection of `_render_storage_section` (`ui.switch` with `value=False`) → **PASS**
- **"Importar Recurso" uses strategy "copy" if switch is True, and "reference" if False** → verified via inspection of the change handler and payload creation in `_do_import` → **PASS**
- **All webkitdirectory and native uploads/bridges references are cleaned up** → verified via grep search across `frontend/` (0 occurrences of browser-based native upload logic/elements) → **PASS**
- **Ingestion service uses `os.path.lexists` for broken symlinks** → verified via code inspection of `backend/app/services/ingestion.py` → **PASS**
- **Test suite passes fully** → verified via execution of `PYTHONPATH=. .venv/bin/pytest backend/tests -x -q` (all 163 tests passed successfully) → **PASS**

### Coverage Gaps

- None. The new `backend/tests/test_ingestion_api.py` covers directory validation (valid, invalid, and unsafe/traversal paths), course reference imports, course copy imports, and book reference/copy imports.

### Unverified Items

- UI visual style/rendering (cannot be headlessly verified, but NiceGUI components conform to style conventions and API).

---

## Adversarial Challenge Report

**Overall risk assessment**: LOW

### Challenges

#### [Low] Challenge 1: Filename Collision under Copy/Symlink Strategies

- **Assumption challenged**: All files recursively scanned under a single module subdirectory have unique names.
- **Attack scenario**: A user imports a course with duplicate filenames in different nested subdirectories of a single module (e.g., `Modulo 1/Video/intro.mp4` and `Modulo 1/Material/intro.mp4`).
- **Blast radius**: The database records two distinct lessons, but both point to the same file (`intro.mp4` of the first-processed folder). One of the media files is never copied/linked or gets shadowed.
- **Mitigation**: Preserve the relative folder hierarchy under the module root when copying/linking files, or generate unique names.

### Stress Test Results

- **Broken symlink collision stress test** → The ingestion service correctly uses `os.path.lexists(dest_file)` instead of `dest_file.exists()`. If a broken symlink exists at the destination, the service detects it and returns the path instead of attempting to recreate the symlink (which would crash with `FileExistsError`) or copy over it → **PASS**
- **Path traversal / unauthorized access validation** → Inputs like `/etc` or paths containing `..` or forbidden hidden folders (e.g., `.ssh`) are successfully caught by `is_safe_path` and rejected during validation and import → **PASS**

### Unchallenged Areas

- Background tasks execution timing (under high-load scenarios, concurrent background extraction processes might compete for CPU/DB pool resources, but this is handled by FastAPI's BackgroundTasks).
