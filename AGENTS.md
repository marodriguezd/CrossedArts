# DomestiK — Agent & Contributor Guide

## Project Overview
DomestiK is a personal learning management system built with:
- **Backend:** FastAPI + SQLAlchemy + SQLite
- **Frontend:** NiceGUI (Python-based UI framework)
- **AI:** LangChain + Pydantic schemas (mock/Ollama/OpenAI providers)
- **Data directory:** `~/.domestik/` (database, media, covers, `.env`)

All user-facing text is in **Spanish**.

## Setup
1. Create and activate the virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. Copy and configure the environment file:
   ```bash
   cp .env.example ~/.domestik/.env
   # Edit ~/.domestik/.env with your API keys and preferences
   ```
4. Apply database migrations:
   ```bash
   PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini upgrade head
   ```

## Running the Application
```bash
PYTHONPATH=. .venv/bin/python -m backend.app.main
```
The server binds to `127.0.0.1:8080` by default.

### Start Scripts (End Users)
Three platform-specific scripts handle venv creation, dependency installation, migrations, and auto-opening the browser:
- **`start.bat`** — Windows (double-click). Calls `start.ps1` via PowerShell with `-ExecutionPolicy Bypass`.
- **`start.ps1`** — Windows PowerShell. Detects/installs Python 3.11, creates venv, installs deps, runs migrations, starts server.
- **`start.sh`** — Linux/macOS. Same workflow as the PowerShell script.

**Browser auto-open:** All scripts prioritize Opera when installed (searching standard install paths), then fall back to the system default browser. This avoids issues where Windows updates reset HTTP protocol associations away from the user's preferred browser.

## Running Tests
```bash
PYTHONPATH=. .venv/bin/pytest backend/tests -x -q
```
All 172 tests must pass. The test suite creates an in-memory SQLite database via `conftest.py`.

## Architecture

### Backend (`backend/`)
- `app/core/` — Settings, database, security, utilities
- `app/api/` — FastAPI route handlers
- `app/services/` — Business logic (LLM, embedding, ingestion, semantic search, etc.)
- `app/schemas/` — Pydantic request/response models
- `app/models/` — SQLAlchemy ORM models
- `alembic/` — Database migration scripts

### Frontend (`frontend/`)
- `app/layout.py` — Main layout, CSS design system (editorial/magazine aesthetic)
- `app/components/` — Reusable UI components (resource cards, AI panel, media viewer, etc.)
- `app/pages/` — Page views (dashboard, library, notes, search, etc.)
- `app/services_direct.py` — Direct database calls bypassing HTTP loopback
- `app/api_client.py` — Singleton httpx.AsyncClient for HTTP endpoints

### Key Conventions
- **Design system:** Editorial/magazine aesthetic with Cormorant Garamond (display), Source Sans 3 (body), DM Mono (metadata). CSS custom properties for theming.
- **Dark mode:** Cookie-based toggle, no MutationObserver.
- **Schemas:** Use Pydantic `Literal` discriminators for polymorphic responses (`CourseBaseResponse`, `BookBaseResponse`).
- **Data directory:** All user data lives in `~/.domestik/`. Never use `os.getcwd()` for data paths.
- **Configuration:** Pydantic `BaseSettings` singleton in `backend/app/core/settings.py`. All config flows through `settings.*`.
- **Testing:** Tests use in-memory SQLite. Always run with `PYTHONPATH=.` from the project root.

## Important References
- `PLAN.md` — Master plan: Phase 1 (original audit), Phase 2 (import security), Phase 3 (performance budget)
- `SKILL.md` — Auto-improvement guidelines and learned lessons (29 rules)
- `.env.example` — Documented configuration template

## Performance Budget
DomestiK targets <300ms for all page loads and <50ms for button interactions.
- Dashboard: <300ms (consolidated queries, no N+1)
- Library: <300ms (paginated, debounced search)
- Text search: <200ms (FTS5 or indexed LIKE)
- Video first frame: <200ms (Range requests, preload=metadata)
- Save/PATCH: <100ms
See `PLAN.md` Phase 3 for full budget table and optimization plan.

## Common Pitfalls
- After modifying any SQLAlchemy model, generate an Alembic migration: `PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini revision --autogenerate -m "description"`
- SQLite has a 999 parameter limit. Use chunked `.in_()` queries (batch_size=500).
- Tests bypass Alembic (`Base.metadata.create_all`). Always run `alembic upgrade head` for the real database.
- **SQLAlchemy imports:** Never `from sqlalchemy import coalesce` — it's not a standalone name. Use `func.coalesce()` for SQL coalesce operations. Other SQL functions (`sum`, `count`, `max`, `min`) are also accessed via `func.*`, not imported directly.
