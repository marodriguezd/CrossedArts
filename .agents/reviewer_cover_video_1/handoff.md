# Handoff Report — Review of Cover Image Removal & Video Playback Changes

## 1. Observation
- In `frontend/app/components/edit_resource_dialog.py`:
  - Line 254-266:
    ```python
    def _cover_file_exists(self) -> bool:
        """Comprueba si el archivo de portada referenciado existe realmente en disco."""
        path = self.cover_path.strip()
        if not path:
            return False
        if path.startswith('http'):
            return True
        if path.startswith('/static/'):
            relative = path[len('/static/'):]
            return (STATIC_DIR / relative).is_file()
        if path.startswith('/'):
            return Path(path).is_file()
        return False
    ```
  - Line 278-280:
    ```python
    is_local_path = path.startswith('/') and not path.startswith('/static/') and not path.startswith('http')
    is_external_url = path.startswith('http')
    is_resolved = path.startswith('/static/')
    ```
  - Line 372-378:
    ```python
    # Validar que la portada esté resuelta antes de guardar
    cover = self.cover_path.strip()
    if cover and not cover.startswith('/static/') and not cover.startswith('http'):
        ui.notify(
            'La ruta de portada no está resuelta. Haz clic en "Aplicar ruta" primero.',
            type='warning'
        )
        return
    ```
- In `frontend/app/components/import_dialog.py`:
  - Line 315-319:
    ```python
    def _update_cover_ui(self):
        p = self.cover_path.strip()
        if p and p.startswith('/') and not p.startswith('/static/') and not p.startswith('http'):
            self.cover_strategy_row.classes(remove='hidden')
    ```
  - Line 493-496:
    ```python
    cover_raw = self.cover_path.strip()
    if cover_raw and not cover_raw.startswith('/static/') and not cover_raw.startswith('http'):
        ui.notify('La portada no está resuelta. Haz clic en "Aplicar ruta" primero.', type='warning')
        return
    ```
- In `backend/app/api/ingestion.py`:
  - Line 179 and 218:
    ```python
    return {"cover_path": str(dest_path.resolve()), "url": f"/api/v1/content/cover-image/{filename}"}
    ```
- The backend tests command ran successfully:
  - Command: `PYTHONPATH=. .venv/bin/pytest backend/tests`
  - Output: `174 passed, 1258 warnings in 14.48s`
  - New test functions verified:
    - `test_update_resource_direct_cover_path_removal` (in `backend/tests/test_services_direct.py` line 434)
    - `test_api_cover_path_removal` (in `backend/tests/test_api.py` line 234)

## 2. Logic Chain
1. When a user uploads a new cover image (either directly or resolving a local path), the backend ingestion service saves it to the covers directory and returns a web endpoint URL of the form `/api/v1/content/cover-image/{filename}`.
2. The frontend dialog components (`edit_resource_dialog.py` and `import_dialog.py`) assign this URL to the resource's `cover_path` property.
3. Because the URL starts with `/api/v1/` (which starts with `/` but not `/static/` or `http`), `is_local_path` resolves to `True`.
4. As a result, the dialog displays the local storage strategy selector (symlink/copy dropdown) for a path that has already been resolved and uploaded to the server.
5. In `_cover_file_exists()`, since `/api/` is not recognized as a remote or special route, it defaults to checking if `/api/v1/content/cover-image/{filename}` is a physical file on the server's disk (`Path(path).is_file()`). This returns `False`, causing the cover preview container to display "Archivo no encontrado" (File not found).
6. During the save and import actions, the code blocks execution if the path is not recognized as resolved (`not cover.startswith('/static/') and not cover.startswith('http')`). Since `/api/...` does not match either prefix, the save or import operation fails with a warning notification, making cover image updates completely impossible via the UI.

## 3. Caveats
- Direct database and API updates (such as via Python scripts or API requests containing `{"cover_path": null}`) are fully functional and verified by tests.
- This UI bug affects only the NiceGUI browser frontend and is caused by an incomplete set of URL resolution checks.

## 4. Conclusion & Review Summary

**Verdict**: REQUEST_CHANGES

### Critical Finding: API Cover URLs break UI Preview and Block Save/Import
- **What**: Uploaded cover images are returned with an `/api/v1/...` URL prefix, which is treated by the frontend dialogs as an unresolved local path. This causes the preview card to display "Archivo no encontrado" and blocks the save and import operations with a validation warning.
- **Where**:
  - `frontend/app/components/edit_resource_dialog.py` (lines 258, 278, 373)
  - `frontend/app/components/import_dialog.py` (lines 316, 494)
- **Why**: The dialogs only treat `/static/` and `http` prefixes as resolved. Relative `/api/` routes are erroneously routed to the local filesystem check.
- **Suggestion**: Add `.startswith('/api/')` as a third resolved URL check wherever `.startswith('/static/')` or `.startswith('http')` is checked.

### Verified Claims
- Clear cover API patch updates db → verified via `test_api_cover_path_removal` → PASS
- Clear cover direct service updates db → verified via `test_update_resource_direct_cover_path_removal` → PASS
- Video playback cleanup selector → verified via `.video-player-container` class insertion in `media_viewer.py` and the DOM removal event handlers → PASS
- Range streaming header support → verified via `FileResponse` returning `Accept-Ranges: bytes` headers in `backend/app/api/media.py` → PASS

---

## 5. Adversarial Challenge Report

**Overall risk assessment**: HIGH

### Challenges

#### High Challenge: Unresolved URL Check Loop of Doom
- **Assumption challenged**: That `/static/` and `http` are the only valid web prefixes for resolved covers.
- **Attack scenario**: A user opens the edit resource dialog, selects a cover image from their files, and uploads it. The browser uploads the file, receives a valid `/api/v1/content/cover-image/...` URL, but the UI warns the user that the path is unresolved. The user is stuck in a loop and cannot save their resource until they delete the cover.
- **Blast radius**: Prevents any resource editing or folder importing if a cover image is uploaded.
- **Mitigation**: Update dialogs to consider `/api/` as a resolved url prefix.

### Stress Test Results
- Simulation of `/api/` path input in `verify_cover_bug.py` → Returns `cover_file_exists = False`, `is_local_path = True` → FAIL (triggers save validation block)

---

## 6. Verification Method
- Execute the verification script:
  ```bash
  python verify_cover_bug.py
  ```
  Expected output should show `is_local_path: True` and `cover_file_exists: False` for the `/api/` URL, proving the bug.
- To verify all unit tests pass:
  ```bash
  PYTHONPATH=. .venv/bin/pytest backend/tests
  ```
