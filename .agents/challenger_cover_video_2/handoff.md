# Handoff Report — Challenger Cover & Video

## 1. Observation

### Test Suite Execution
* **Command:** `PYTHONPATH=. .venv/bin/pytest backend/tests`
* **Result:** All 174 tests passed.
* **Output snippet:**
  ```
  174 passed, 1258 warnings in 16.09s
  ```

### Cover Image Removal & Deletion
* **File paths and lines:**
  * `backend/app/api/resources.py` (lines 102-103):
    ```python
    if "cover_path" in payload.model_fields_set:
        resource.cover_path = payload.cover_path
    ```
  * `frontend/app/components/edit_resource_dialog.py` (lines 309-317, 388):
    ```python
    def _clear_cover(self):
        """Limpia la portada del recurso."""
        self.cover_path = ""
        self.cover_input.value = ""
        self._render_cover_preview()
        self._update_cover_ui()
    ```
    ```python
    payload = UpdateResourceRequest(
        ...
        cover_path=cover or None,
        ...
    )
    ```
* **Test coverage:**
  * `backend/tests/test_api.py` (lines 234-258): `test_api_cover_path_removal` verifies clearing cover path via PATCH.
  * `backend/tests/test_services_direct.py` (lines 434-458): `test_update_resource_direct_cover_path_removal` verifies direct model updates.

### Video Playback & Streaming Endpoints
* **File path and lines:**
  * `backend/app/api/media.py` (lines 38-63):
    ```python
    @router.get("/{media_id}/stream")
    def stream_media(media_id: uuid.UUID, db: Session = Depends(get_db)):
        ...
        return FileResponse(
            path,
            media_type=asset.mime_type,
            headers={"Accept-Ranges": "bytes"}
        )
    ```
* **Test coverage:**
  * `backend/tests/test_media.py` (lines 122-162): `test_media_api_streaming_range_requests` verifies Range header support (e.g. `Range: bytes=0-9` returns HTTP 206).

### UI/UX Regression: Cover Image Proxy Path Check
* **File path and lines:**
  * `frontend/app/components/edit_resource_dialog.py` (lines 254-266, 278-291):
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
    ```python
    is_local_path = path.startswith('/') and not path.startswith('/static/') and not path.startswith('http')
    ...
    if is_local_path:
        self.cover_strategy_row.classes(remove='hidden')
        if self._cover_file_exists():
            self.cover_status.text = '✅ Ruta local válida — elige método y pulsa "Aplicar ruta"'
            self.cover_status.style('color: #22c55e;')
        else:
            self.cover_status.text = '⚠️ Archivo no encontrado en la ruta indicada'
            self.cover_status.style('color: #f59e0b;')
    ```

### JS Leak: Video Progress Tracker
* **File path and lines:**
  * `frontend/app/components/media_viewer.py` (lines 95-110):
    ```javascript
    // Limpieza cuando el elemento se remueva del DOM
    function cleanup() {
        clearInterval(progressInterval);
        if (observer) observer.disconnect();
    }
    let observer = null;
    const videoContainer = document.querySelector('.video-player-container') || video.parentElement;
    if (videoContainer) {
        observer = new MutationObserver((mutations) => {
            if (!document.getElementById("video-{self.media_id}")) {
                cleanup();
            }
        });
        observer.observe(videoContainer, { childList: true, subtree: true });
    }
    video.addEventListener('remove', cleanup);
    ```

---

## 2. Logic Chain

### Verification of Test Fleet and DB Cover Removal
1. The test fleet passed entirely with `174 passed` on the actual codebase.
2. Direct inspection of `edit_resource_dialog.py` and backend routes confirms that clearing the cover resets `cover_path` to `""` which translates to `None` in the database, verifying correct removal behavior in SQLAlchemy.

### Verification of HTTP Range Streaming
1. `backend/app/api/media.py` delegates streaming to Starlette's native `FileResponse`.
2. Starlette's `FileResponse` natively parses `Range` headers, returns standard `206 Partial Content`, and streams specific byte slices.
3. Tests in `test_media.py` confirm this behavior is functional and correct.

### UI/UX Regression Logic
1. The backend saves cover URLs pointing to `/api/v1/content/cover-image/{filename}`.
2. In `edit_resource_dialog.py`, since this path begins with `/` and doesn't match `/static/` or `http`, `is_local_path` evaluates to `True`.
3. Consequently, `_cover_file_exists()` is invoked, calling `Path(path).is_file()`.
4. Since `/api/v1/content/cover-image/...` is a URL path and not a filesystem file, `is_file()` returns `False`.
5. This logic chain shows that resolved covers will always cause the UI to display a red "Archivo no encontrado" label and unhide the local path import fields.

### Video Tracker JS Leak Logic
1. Plain HTML `<video>` elements do not fire a `'remove'` event; `video.addEventListener('remove', cleanup)` is dead code.
2. A `MutationObserver` registered directly on `videoContainer` only fires when elements *inside* that container are modified.
3. If the entire page or layout containing `videoContainer` is destroyed during SPA navigation, `videoContainer` is detached from its parent. This does not trigger mutation events on `videoContainer` itself.
4. As a result, the periodic `progressInterval` remains active indefinitely, causing memory leaks and continuous background HTTP POST requests to `/progress` every 10 seconds.

---

## 3. Caveats
* Integration testing of the frontend SPA interface relies on manual execution or automated browser tools (e.g., Selenium/Playwright) which are not part of the backend test suite. Logic was verified by static analysis, code tracing, and unit-level script simulation.
* Cleanup of physical cover files from `settings.covers_dir` is not triggered when a resource is deleted (orphans remain).

---

## 4. Conclusion
1. The backend test suite and core API endpoints for cover image removal and video range requests are **fully operational and correct**.
2. **Critical UI Bug:** In `edit_resource_dialog.py`, proxy URLs (`/api/v1/content/cover-image/...`) are falsely identified as invalid local paths. The logic must be updated to treat `/api/v1/content/cover-image/` as a resolved path:
   ```python
   is_resolved = path.startswith('/static/') or path.startswith('/api/v1/content/cover-image/')
   ```
   And `_cover_file_exists()` must check the covers directory for proxy paths:
   ```python
   if path.startswith('/api/v1/content/cover-image/'):
       filename = path.split('/')[-1]
       return (settings.covers_dir / filename).is_file()
   ```
3. **JS Memory/Network Leak:** In `media_viewer.py`, the video player cleanup mechanism is broken. The `MutationObserver` should be registered on `document.body` or a parent layouts container to correctly observe the removal of `video-{self.media_id}`.

---

## 5. Verification Method
* Run backend tests: `PYTHONPATH=. .venv/bin/pytest backend/tests`
* Inspect files:
  * `frontend/app/components/edit_resource_dialog.py` (lines 254-302)
  * `frontend/app/components/media_viewer.py` (lines 95-112)
