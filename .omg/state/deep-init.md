# Deep Init State

## Entry Points
* **FastAPI Backend (API):** `backend/app/main.py`
* **NiceGUI Frontend (UI):** `frontend/app/layout.py` (Main layouts/SPA wrapper), `frontend/app/pages/`
* **Platform Entrypoints:** `start.sh` (Linux), `start.bat`/`start.ps1` (Windows)

## Configuration Pathways
* **Settings Singleton:** `backend/app/core/settings.py` loads variables from environment and `~/.domestik/.env`.
* **Data Storage:** Centralized in `~/.domestik/` for database, media, covers, and config.

## Boundaries & High-Risk Zones
1. **NiceGUI-FastAPI loopback:** Handled directly in `services_direct.py` bypassing loopback.
2. **Joined Table Inheritance:** Querying parent and child tables together generates duplicate FROM clauses.
3. **Database migrations vs Testing:** Tests use `conftest.py` in-memory SQLite and mock models directly, bypassing migrations. Production relies on alembic files.
4. **File Import Strategies:** Uploading vs symlink/referencing files has strict validation boundary conditions.
5. **Path Traversal Sandboxing:** Explicit path checks run via `is_safe_path` in `security.py`.
