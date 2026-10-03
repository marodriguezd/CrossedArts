# Plan — DomestiK Cover Image & Video Streaming Fixes

## Objective
Fulfill the requirements of the 2026-06-30T19:29:19Z user request:
1. Fix the cover image removal UI/UX bug in the edit dialog and import dialog.
2. Fix video playback/streaming failure by supporting Range requests in the FastAPI stream endpoint and rendering the video player component correctly.
3. Verify that all tests pass.

## Milestones
- **Milestone 1: Exploration & Verification**
  - Verify baseline tests.
  - Locate cover image edit/import dialog files, cover path settings, and the streaming API endpoint.
- **Milestone 2: Cover Image Removal UX Fix**
  - Implement reactive cover clearing in `frontend/app/components/edit_resource_dialog.py` and `frontend/app/components/import_dialog.py`.
  - Verify the cover image preview resets to "Sin portada" instantly upon clicking "Quitar Portada".
  - Ensure saving persists the cleared cover state (updating database `cover_path` to `""` or `None`).
- **Milestone 3: Video Playback & Range Streaming Fix**
  - Implement native HTTP Range support in `/api/v1/media/{media_id}/stream` using FastAPI's `FileResponse` (as per Rule 30) or robust range parsing.
  - Ensure the frontend NiceGUI video components (`course_detail.py`, `media_viewer.py`) render correctly and track progress.
- **Milestone 4: Verification & Forensic Audit**
  - Verify the entire test suite passes (`PYTHONPATH=. .venv/bin/pytest backend/tests`).
  - Run the `teamwork_preview_auditor` to check codebase integrity.

## Strategy
- The Project Orchestrator delegates all work to specialist subagents (e.g. `teamwork_preview_explorer` for investigation, `teamwork_preview_worker` for implementation, `teamwork_preview_reviewer` for reviews, `teamwork_preview_auditor` for integrity audit).
