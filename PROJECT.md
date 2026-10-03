# Project: Restructure Import System to prioritize local-first

## Architecture
- **Frontend**: The `ImportDialog` component (`frontend/app/components/import_dialog.py`) provides the UI.
- **Backend API**: The `/content/import` and `/content/validate-directory` endpoints in `backend/app/api/ingestion.py` process request schemas.
- **Services**: `IngestionService` in `backend/app/services/ingestion.py` does the actual database entry, directory traversal, and strategy execution (`reference` vs `copy`).

## Code Layout
- `frontend/app/components/import_dialog.py` — The unified ImportDialog UI without tabs or browser upload.
- `backend/app/api/ingestion.py` — Backend routing for content ingestion.
- `backend/app/services/ingestion.py` — Ingestion logic supporting storage strategies.
- `backend/tests/` — Test suite.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Baseline | Analyze existing files, verify test suite baseline, analyze API schemas | None | DONE |
| 2 | Redesign ImportDialog UI | Restructure `ImportDialog` to remove Server/PC tabs, eliminate webkitdirectory/upload JS code, add Copy Switch, and integrate `FolderPickerDialog` | M1 | DONE |
| 3 | Backend API Integration | Verify backend accepts `reference` and `copy` strategies properly and handles directory validation | M2 | DONE |
| 4 | Testing & Verification | Implement integration tests for the `/content/import` and `/content/validate-directory` endpoints and `IngestionService`, run the whole test suite | M3 | DONE |
| 5 | Integrity Audit | Run Forensic Auditor checks on modified files to verify no shortcuts or integrity issues | M4 | DONE |

## Interface Contracts
### ImportDialog ↔ Ingestion API
- `POST /content/validate-directory`
  - Payload: `{ "path": string }`
  - Response: `{ "subdirs_count": int, "files_count": int, "media_assets": [...] }`
- `POST /content/import`
  - Payload: `{ "title": string, "resource_type": string, "category": string, "description": string, "source_path": string, "storage_strategy": "reference" | "copy" | "symlink", "structure_strategy": string, ... }`
  - Response: `{ "status": "success", "resource_id": int }`
