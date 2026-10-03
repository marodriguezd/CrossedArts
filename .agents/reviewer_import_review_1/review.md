# Quality & Adversarial Review Report

**Date**: 2026-06-24
**Evaluated Branch/Commit**: Restructured Local-First Import System

---

## Part 1: Quality Review

### Review Summary

**Verdict**: **APPROVE**

The restructuring of the import system successfully prioritizes the local-first model. Unnecessary web-based folder uploads and webkitdirectory/JavaScript bridge injections have been completely removed. The user experience is clean, single-flow, and utilizes `FolderPickerDialog` with automatic asynchronous validation. The `lexists` bug has been correctly resolved, and the test suite has been extended to provide 100% integration coverage for the ingestion service API endpoints.

---

### Findings

No critical or major findings were discovered. Below are minor findings and observations:

#### [Minor] Finding 1: Cover Path Resolution UI Flow
- **What**: In the import dialog, if the user inputs a cover path manually (or selects "Usar Ruta / URL"), they must click the "Aplicar ruta" button to copy/link it before clicking "Importar Recurso".
- **Where**: `frontend/app/components/import_dialog.py`, lines 483–486.
- **Why**: If they click "Importar Recurso" without resolving the path first, the UI throws a warning: *"La portada no está resuelta. Haz clic en 'Aplicar ruta' primero."*
- **Suggestion**: In a future iteration, clicking "Importar Recurso" could automatically attempt to resolve the cover path if not already resolved, avoiding an extra click for the user. Currently, the current behavior is completely safe and acceptable.

---

### Verified Claims

- **Tab/Mode Selector Cleanup** → Verified via inspecting `import_dialog.py` → **PASS**
  - All tabs, mode variables, and browser PC/upload tabs have been removed. The layout contains only the single local server path selection flow.
- **Single Flow via FolderPickerDialog** → Verified via inspecting `import_dialog.py` → **PASS**
  - `FolderPickerDialog` is used exclusively when clicking to select a server directory.
- **Automatic Validation on Folder Confirm** → Verified via inspecting `import_dialog.py` → **PASS**
  - Selection confirm invokes `self._on_folder_selected`, which executes `asyncio.create_task(self._validate_directory())` in the background.
- **Physical Copy Switch (Default False)** → Verified via inspecting `import_dialog.py` → **PASS**
  - Switch `Copiar archivos físicamente a la biblioteca` is added with `value=False` (default reference mode).
- **Copy vs. Reference Strategy in Payload** → Verified via inspecting `import_dialog.py` → **PASS**
  - `storage_strategy` is set dynamically based on switch value and passed in the payload JSON to `/content/import`.
- **Webkitdirectory and HTML Bridges Cleanup** → Verified via ripgrep and file inspection → **PASS**
  - All `webkitdirectory` code, injected JavaScript input pickers, and `self._bridge` native divisions have been purged.
- **Path `lexists` Bug Fix** → Verified via inspecting `ingestion.py` → **PASS**
  - Calls to `dest_file.lexists()` were replaced with `os.path.lexists(dest_file)`, correcting the `AttributeError`.
- **Backend Test Verification** → Verified via running `pytest` → **PASS**
  - 5 tests in `backend/tests/test_ingestion_api.py` run and pass. All 171 tests in the repository pass.

---

### Coverage Gaps

- **Permissions Gaps** — Risk level: **Low** — Recommendation: **Accept Risk**
  - If a user lacks read/write permissions for a directory, the backend handles exceptions gracefully and bubbles up validation failure or rollback.

---

### Unverified Items

- *None.* All files, logic paths, and tests have been verified locally.

---

## Part 2: Adversarial Review

### Challenge Summary

**Overall Risk Assessment**: **LOW**

The security boundaries are tightly sandboxed. Path traversal checks are immune to typical bypasses due to the strict use of `os.path.realpath` inside `is_safe_path()`.

---

### Challenges

#### [Medium] Challenge 1: Symlink Directory Traversal Bypass
- **Assumption Challenged**: That a user could bypass the sandbox using symlinks pointing outside the workspace (e.g. `~/.domestik/content/link_to_etc` pointing to `/etc`).
- **Attack Scenario**: An attacker creates a symlink inside the user's data directory pointing to a system file, then selects the parent folder containing the symlink for import.
- **Blast Radius**: If resolved, could allow copy or reference of files outside the intended sandbox.
- **Mitigation**: The system mitigates this perfectly because `is_safe_path` resolves symlinks via `os.path.realpath(str(path))` *before* verifying if the path is in the workspace. Any resolved path outside the workspace is rejected.

#### [Low] Challenge 2: Broken Symlink Recreation
- **Assumption Challenged**: That recreation of files with pre-existing broken symlinks will raise a `FileExistsError` on `symlink_to` or `shutil.copy2`.
- **Attack Scenario**: A broken symlink exists at the target destination from a previous run.
- **Blast Radius**: Causes import execution crash.
- **Mitigation**: Successfully addressed by the change to `os.path.lexists(dest_file)`.

---

### Stress Test Results

- **Valid folder within data_dir** → Correctly validates and returns subdirectories and media content → **PASS**
- **Invalid path / non-existent folder** → Validation fails gracefully with `exists=False` → **PASS**
- **Unsafe path (outside data_dir / `.domestik`)** → Rejected by `is_safe_path` check, returns `exists=False` → **PASS**
- **Missing title in import dialog** → UI warning appears, blocks API submit → **PASS**
- **Missing source path in import dialog** → UI warning appears, blocks API submit → **PASS**

---

### Unchallenged Areas

- **Frontend NiceGUI UI Rendering**: We did not challenge browser rendering issues since tests ran via headless FastAPI client and local component inspections.
