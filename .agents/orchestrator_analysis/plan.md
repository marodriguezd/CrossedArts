# Synthesized Codebase Flaws & Proposed Fixes

Here is the synthesized list of issues identified by the Codebase Explorers:

## 1. Critical Alembic Migration Failure
- **File**: `backend/alembic/versions/9bd4577cf6f2_add_inactive_seconds_to_session.py` (Line 25)
- **Problem**: The migration attempts to add a `NOT NULL` column (`inactive_seconds` to `learning_session` table) without providing a `server_default` value. On SQLite, adding a `NOT NULL` column to a table with existing data (e.g. seeded study sessions) triggers a `sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) Cannot add a NOT NULL column with default value NULL`.
- **Impact**: Database migrations cannot upgrade to head. The local database (`domestik.db`) is stuck at `c8b5c0cd3cf0` (missing `inactive_seconds` in `learning_session`, and having `last_position`/`duration` as `INTEGER` rather than `Float` in `media_progress`). The app will crash at runtime on updates/inserts to these tables.
- **Testing Gap**: The test suite runs successfully because `backend/tests/conftest.py` calls `Base.metadata.create_all(bind=engine)`, creating the schema from models directly in one pass and bypassing Alembic migrations.
- **Proposed Fix**:
  ```python
  # Before:
  batch_op.add_column(sa.Column('inactive_seconds', sa.Integer(), nullable=False))
  
  # After:
  batch_op.add_column(sa.Column('inactive_seconds', sa.Integer(), nullable=False, server_default='0'))
  ```
  Also, add an integration test that runs migrations via Alembic on a test database during pytest.

## 2. API Contract Mismatch & State Corruption
- **Files**: `backend/app/api/resources.py`, `backend/app/schemas/resource.py`, `frontend/app/components/edit_resource_dialog.py`
- **Problem**: The `/api/v1/resources` listing endpoint uses `response_model=List[ResourceBaseResponse]`. Because `ResourceBaseResponse` is the base schema, it does not include subclass-specific fields like `difficulty` (for courses) and `reading_percentage`/`author` (for books). Pydantic silently strips these fields during serialization.
- **Impact**: All books show 0% progress, and sorting books by progress fails. Additionally, when a user opens the "Edit" dialog for a course, the NiceGUI frontend initializes `difficulty` from the stripped data (which is `None`), defaulting it to `"BEGINNER"`. When the user clicks save, the frontend sends `"BEGINNER"` to the backend, silently overwriting and corrupting the course's true difficulty in the database.
- **Proposed Fix**:
  ```python
  # Before (in backend/app/api/resources.py):
  @router.get("", response_model=List[ResourceBaseResponse])
  
  # After (using Pydantic Union to return the correct polymorphic response schemas):
  from typing import Union
  from backend.app.schemas.resource import CourseBaseResponse, BookBaseResponse
  @router.get("", response_model=List[Union[CourseBaseResponse, BookBaseResponse]])
  ```

## 3. Pytest Deprecations: `datetime.utcnow()`
- **Problem**: 77 deprecation warnings are triggered in tests because of `datetime.utcnow()`. In Python 3.12, `utcnow()` is deprecated.
- **Impact**: Brittle code with warnings, potential removal in future Python versions. Replacing `utcnow()` with `datetime.now(timezone.utc)` directly could cause `TypeError` comparisons at runtime against timezone-naive datetimes stored in SQLite.
- **Proposed Fix**: Use a standard utility that returns a timezone-naive UTC datetime:
  ```python
  # Before:
  created_at = datetime.utcnow()
  
  # After:
  from datetime import datetime, timezone
  created_at = datetime.now(timezone.utc).replace(tzinfo=None)
  ```

## 4. Brittle Hardcoded Absolute Paths in Tests
- **Files**: `backend/tests/conftest.py` and 6 other test files.
- **Problem**: These files contain `sys.path.insert(0, "/home/marodriguezd/Github/DomestiK")`.
- **Impact**: Tests will fail on any other system where this path does not exist, breaking CI/CD compatibility.
- **Proposed Fix**:
  ```python
  # Before:
  sys.path.insert(0, "/home/marodriguezd/Github/DomestiK")
  
  # After:
  import os
  import sys
  sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
  ```

## 5. Connection Pool Socket Exhaustion Anti-pattern
- **Files**: LLM providers (`llm.py`), embedding providers (`embedding.py`), and NiceGUI APIClient (`api_client.py`).
- **Problem**: `httpx.Client()` or `httpx.AsyncClient()` is instantiated ad-hoc inside every prompt, embedding, and API Client call.
- **Impact**: No connection reuse (keep-alive) and connection pooling. Creates high TCP handshake overhead and risks socket/port leaks or exhaustion.
- **Proposed Fix**: Initialize a single, shared `httpx.AsyncClient` inside the FastAPI lifespan handler and inject it where needed.

## 6. Sequential HTTP Requests for Batch Embeddings
- **File**: `backend/app/services/embedding.py`
- **Problem**: `OllamaEmbeddingProvider.get_embeddings_batch` iterates sequentially over `get_embedding` instead of using Ollama's batch embedding format in a single request.
- **Impact**: Poor performance when importing multi-page documents (EPUB/PDF).
- **Proposed Fix**: Pass the list of texts in a single HTTP request to Ollama's batch embeddings endpoint.

## 7. SQLite Parameter Limit Hazard
- **File**: `backend/app/services/extractor.py` (Lines 72-75)
- **Problem**: When re-indexing, old content ids are deleted using `in_(old_content_ids)` in a single query.
- **Impact**: SQLite has a maximum parameter limit of 999. Ingesting large documents (>999 pages) will crash the deletion query with a `too many SQL variables` error.
- **Proposed Fix**: Chunk the deletion queries into batches of 500:
  ```python
  # After:
  for i in range(0, len(old_content_ids), 500):
      chunk = old_content_ids[i:i+500]
      db.query(EmbeddingRecord).filter(
          EmbeddingRecord.entity_id.in_(chunk),
          EmbeddingRecord.entity_type == "content_index"
      ).delete(synchronize_session=False)
  ```

## 8. Security Vulnerability: XML External Entity (XXE) Injection
- **File**: `backend/app/services/extractor.py`
- **Problem**: EPUB metadata extraction uses `xml.etree.ElementTree` without disabling external entities.
- **Impact**: Vulnerable to XXE and billion laughs denial-of-service if a malicious EPUB file is ingested.
- **Proposed Fix**: Use `defusedxml.ElementTree` instead of `xml.etree.ElementTree` to parse XML documents safely.

## 9. Security Vulnerability: Directory Traversal and API Exposure
- **Files**: `backend/app/core/security.py`, `backend/app/main.py`
- **Problem**: `is_safe_path` permits reading any non-hidden file in the user's home folder. The backend API is completely unauthenticated.
- **Impact**: Path traversal / arbitrary file reading. Remote attackers could read sensitive files in `~` (like `.bash_history` or browser profile folders) or read/modify the database.
- **Proposed Fix**: Restrict paths strictly to the workspace `data/` folder, and add authentication/documentation warning about port exposure.

## 10. NiceGUI-FastAPI Loopback Loop Overhead
- **File**: `frontend/app/api_client.py`
- **Problem**: NiceGUI (running in the same process as FastAPI) queries data by making local loopback HTTP calls (`127.0.0.1:8080/api/...`) via `httpx.AsyncClient`.
- **Impact**: High overhead from serialization/deserialization and loopback networking for simple server-side data fetching.
- **Proposed Fix**: Import and call the service layers directly for server-side NiceGUI pages, using the API client only for client-side JavaScript calls.
