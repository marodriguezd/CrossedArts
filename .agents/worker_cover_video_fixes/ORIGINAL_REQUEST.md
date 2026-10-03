## 2026-06-30T19:32:53Z

You are teamwork_preview_worker. Your working directory is /data/data/com.termux/files/home/DomestiK/.agents/worker_cover_video_fixes (create/initialize if needed).

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your objective is to implement the fixes for the cover image removal UI/UX bug and ensure video playback renders and streams correctly:

1. **Cover Image UI/UX Reactivity**:
   - In `frontend/app/components/edit_resource_dialog.py` inside `_render_cover_preview()`, call `self.cover_preview.update()` at the end of the method so that the preview container updates on the client immediately.
   - In `frontend/app/components/import_dialog.py` inside `_render_cover_preview()`, call `self.cover_preview.update()` at the end of the method.

2. **Cover Image Database Save / Update**:
   - In `frontend/app/services_direct.py` inside `update_resource_direct()`, replace:
     ```python
     if payload.cover_path is not None:
         resource.cover_path = payload.cover_path
     ```
     with:
     ```python
     if "cover_path" in payload.model_fields_set:
         resource.cover_path = payload.cover_path
     ```
   - In `backend/app/api/resources.py` inside `update_resource()`, replace:
     ```python
     if payload.cover_path is not None:
         resource.cover_path = payload.cover_path
     ```
     with:
     ```python
     if "cover_path" in payload.model_fields_set:
         resource.cover_path = payload.cover_path
     ```

3. **Video Playback Layout / JS selector match**:
   - In `frontend/app/components/media_viewer.py` inside the `VideoViewer.draw` HTML markup, add the class `video-player-container` to the outer div surrounding the `<video>` tag to ensure the JavaScript `MutationObserver` selector (`document.querySelector('.video-player-container')`) finds it correctly and behaves as intended.
   - Verify that `/api/v1/media/{media_id}/stream` handles Range requests correctly using Starlette's native FileResponse.

4. **Testing & Regression Verification**:
   - Add a test case in `backend/tests/test_services_direct.py` or `backend/tests/test_api.py` that verifies updating a resource's cover path to `None` (or clearing it) successfully updates it to `None`/`""` in the database.
   - Run the entire test suite: `PYTHONPATH=. .venv/bin/pytest backend/tests`
   - Document the test results, files modified, and verify that all 172+ tests pass successfully.

Write a detailed handoff.md in your working directory when finished.
