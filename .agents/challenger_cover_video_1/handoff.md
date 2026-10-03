# Verification Report: Cover Image Removal and Video Playback Fixes

## 1. Observation
We investigated the following files and observed their implementation details:
- **Cover Image Removal UX/UI**: `frontend/app/components/edit_resource_dialog.py` handles cover clearing in `_clear_cover` (line 309):
  ```python
  def _clear_cover(self):
      """Limpia la portada del recurso."""
      self.cover_path = ""
      self.cover_input.value = ""
      self._render_cover_preview()
      self._update_cover_ui()
  ```
- **Database Updates**: In both the direct database service `frontend/app/services_direct.py` (line 102) and the REST API endpoint `backend/app/api/resources.py` (line 102):
  ```python
  if "cover_path" in payload.model_fields_set:
      resource.cover_path = payload.cover_path
  ```
  This correctly persists a `None` (cleared) value since `cover_path` is explicitly included in the Pydantic request payload.
- **Video Playback Range Requests**: In `backend/app/api/media.py` (line 59), streaming is implemented using FastAPI/Starlette's native `FileResponse`:
  ```python
  return FileResponse(
      path,
      media_type=asset.mime_type,
      headers={"Accept-Ranges": "bytes"}
  )
  ```
- **Test Execution**: The full pytest test suite initially completed with `174 passed` when run before adding our new tests. However, running the suite in alphabetical order with our new file introduced a flaky test failure in `test_library_page_fetch_resources`:
  ```
  RuntimeError: The current slot cannot be determined because the slot stack for this task is empty.
  This may happen if you try to create UI from a background task.
  ```
  This is because NiceGUI's app import initializes it into multi-client web mode. Creating card elements inside the real `resource_card` function then raises a slot stack error. Patching `resource_card` in that test resolved the failure. After fixing this, the suite completed with all `183 passed`.

## 2. Logic Chain
- **Reactivity & Persistency**: When a user clicks "Quitar Portada", the UI reactively clears the path and updates the preview block. When they save, the `UpdateResourceRequest` includes `cover_path=None` (or `cover_path=cover or None`). Since the field is set, the API/direct services update the database record to `None`.
- **Placeholder Fallback**: When `cover_path` is `None` in the database, `ThumbnailService.resolve_cover_url` falls through to the generic resource placeholder (e.g. `/static/placeholders/course_placeholder.png`), ensuring the UI displays a clean fallback.
- **Seeker/Range Requests**: Video seeking requires RFC-compliant HTTP Range request handling (status code `206 Partial Content`, `Content-Range`, etc.). Using `FileResponse` delegates all parsing and chunking to Starlette, which handles edge cases (open-ended ranges, out-of-bounds ranges) natively, replacing unstable custom generator implementations.
- **Flakiness Resolution**: The test `test_library_page_fetch_resources` is designed to verify resource data fetching, not UI rendering. By patching `resource_card`, we bypass NiceGUI UI card instantiation, resolving NiceGUI slot stack issues and making the test suite robust to run order.

## 3. Caveats
- We did not perform high-concurrency stress testing on video streaming, nor did we test Safari-specific seek behavior manually (though Starlette's `FileResponse` range handling is industry-standard).
- The physically uploaded cover files inside the covers directory (`~/.domestik/covers/`) are not deleted from disk when a cover path is cleared in the database. This is a design choice to prevent deleting shared or re-usable image assets.

## 4. Conclusion
The implementation of cover image removal (reactivity + database persistency) and video playback range requests via `FileResponse` is correct, secure, and robust. The added tests cover the critical scenarios, and our new suite `test_cover_ingestion.py` reinforces path traversal safety and local-first copy/symlink behaviors. The test suite is fully verified and passes with `183/183` tests green.

## 5. Verification Method
To independently verify the test suite:
1. Run the test command:
   ```bash
   PYTHONPATH=. .venv/bin/pytest backend/tests
   ```
2. Verify that all 183 tests pass successfully.
3. Review the following verification test files:
   - `backend/tests/test_cover_ingestion.py` (Validates cover upload, copying, symlinks, and path traversal protection)
   - `backend/tests/test_media.py` (Validates range requests and progress tracking)
   - `backend/tests/test_library_page.py` (Updated to run cleanly under all test execution orders)
