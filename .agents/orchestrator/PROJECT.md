# Project: DomestiK Cover Image & Video Streaming Fixes

## Architecture
- **Frontend**: NiceGUI application.
  - Resource edit dialog in `frontend/app/components/edit_resource_dialog.py`.
  - Resource import dialog in `frontend/app/components/import_dialog.py`.
  - Course detail view in `frontend/app/course_detail.py`.
  - Media viewer component in `frontend/app/components/media_viewer.py`.
- **Backend API**:
  - Media streaming endpoint at `/api/v1/media/{media_id}/stream`.
  - Resource updating endpoints.
- **Database**: SQLite database with resource metadata (including `cover_path` which should be cleared when removing the cover).

## Code Layout
- `frontend/app/components/edit_resource_dialog.py` — The resource editing dialog, manages resource modifications and cover image removal.
- `frontend/app/components/import_dialog.py` — The unified ImportDialog UI, handles resource imports and cover path input/removal.
- `frontend/app/course_detail.py` — Course detail view, renders lección and triggers video viewing.
- `frontend/app/components/media_viewer.py` — Renders HTML5 player for video lecciones.
- `backend/app/api/media.py` (or similar streaming api) — FastAPI media streaming endpoints.
- `backend/tests/` — Test suite.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Verification | Locate specific file paths, verify baseline test suite passes. | None | DONE |
| 2 | Cover Image Removal UX Fix | Update edit/import dialogs to immediately clear input and preview, and verify backend database update. | M1 | DONE |
| 3 | Video Streaming & Playback Fix | Add native Range request support in FastAPI media streaming endpoint, integrate/render video player component. | M2 | DONE |
| 4 | Testing & Verification | Verify full test suite passes, run forensic audit checks. | M3 | DONE |

## Interface Contracts
- **Streaming endpoint**:
  - `GET /api/v1/media/{media_id}/stream`
  - Headers: `Range: bytes=start-end`
  - Response status: `206 Partial Content` (for valid ranges) or `200 OK` (when no Range header or complete content is served).
  - Headers in response: `Content-Range: bytes start-end/total`, `Content-Length`, `Accept-Ranges: bytes`.
