# Backend Memory & Conventions

## 1. Database Migration Discipline (Alembic)
* **Context:** DomestiK uses Alembic for tracking database schema changes on SQLite (`~/.domestik/domestik.db`). However, the test suite (`backend/tests/conftest.py`) initializes a clean, in-memory SQLite database and creates tables directly using SQLAlchemy metadata (`Base.metadata.create_all`).
* **Critical Trap:** Because tests create tables on-the-fly from Python classes, the test suite will pass even if you modify a database model and forget to generate an Alembic migration.
* **Commands:**
  * Generate a new migration: `PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini revision --autogenerate -m "description"`
  * Apply migrations: `PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini upgrade head`
  * Check history: `PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini history`

## 2. Configuration and Data Directory
* **Singleton Settings:** All configuration flows through a Pydantic `BaseSettings` singleton in `backend/app/core/settings.py`.
* **Path Management:** Never use `os.getcwd()` for data paths. Always use `settings.data_dir`, `settings.media_dir`, `settings.covers_dir`, or `settings.db_path`.
* **Data Location:** User data lives in `~/.domestik/`.

## 3. Joined Table Inheritance Query Constraint
* **Trap:** When using SQLAlchemy's Joined Table Inheritance (e.g., `Course` and `Book` inheriting from `LearningResource`), mixing the parent model and child models in a single `db.query()` aggregate call generates ambiguous SQL. SQLAlchemy produces a FROM clause with the parent table duplicated, causing `ambiguous column name: learning_resource.id`.
* **Rule:** Use **separate queries** for each table count when querying across Joined Table Inheritance hierarchies, or use `scalar_subquery()` to isolate each count:
  ```python
  total = db.query(func.count(LearningResource.id)).scalar() or 0
  courses = db.query(func.count(Course.id)).scalar() or 0
  ```

## 4. File Upload Security & Staging
* **Sanitize Components:** Use `PurePosixPath(filename).parts` and filter out `..`, `.`, and `""` components. Then verify the resolved destination is still within the intended staging directory using `dest.resolve().is_relative_to(upload_dir.resolve())`.
* **Upload vs Import distinctions:**
  * **Upload Mode (`/import-from-upload`)**: Files are copied to the server staging directory. Enforce size limits and file type whitelists (e.g., `{".pdf", ".epub", ".mp4", ".mp3"}`).
  * **Import Mode (`/content/import` - symlink/reference)**: Files stay in their original location. Do NOT apply file size limits here.
* **Cleanup:** The `shutil.rmtree` cleanup must run on ALL code paths (success + error) via a `try/finally` block.

## 5. Local Importer and Platform Specifics
* **Linux Mount Points:** Dynamic mounting occurs under `/run/media/{username}/NombreDisco`. The code auto-detects user via `getpass.getuser()`.
* **Windows Drive Paths:** Check logical units from `A` to `Z` using `os.path.exists(f"{letter}:\\")`.
* **Security Validation (`is_safe_path`):** Allow user home, `/media`, `/run/media`, `/mnt`, and Windows letters. Block path components starting with a dot (except `.domestik`).

## 6. Video Streaming and Cover Management
* **Video Streaming:** Serve content with support for seeks (HTTP Range Requests) using Starlette's native `FileResponse`. Do not use manual byte generator chunking with `StreamingResponse`.
* **Covers:** User covers reside in `settings.covers_dir` (`~/.domestik/covers`). The `/content/upload-cover` endpoint returns URLs pointing to `/api/v1/content/cover-image/{filename}`.

## 7. Embedding Service Providers
* **HuggingFace Local Provider:** Setting `embedding_provider` to `"huggingface"` initializes `HuggingFaceEmbeddings` locally using the model defined in `huggingface_embed_model` (defaults to `"sentence-transformers/all-MiniLM-L6-v2"`).
* **Dependencies:** Requires `sentence-transformers` to be installed. This allows running offline CPU-based semantic embedding generation.

