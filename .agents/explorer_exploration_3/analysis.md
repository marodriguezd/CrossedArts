# Codebase Analysis Report: DomestiK

**Prepared by:** Codebase Explorer 3  
**Date:** 2026-06-22  
**Target Directory:** `/home/marodriguezd/Github/DomestiK`

---

## 1. Executive Summary

DomestiK is a self-hosted, local-first "Learning Operating System" built using FastAPI, SQLAlchemy, and NiceGUI. While the core architecture is modular and handles complex features (like content extraction, spaced repetition review, habits, and knowledge graph relations), there are critical bugs, architectural inefficiencies, testing infrastructure smells, and security concerns.

The most urgent issues include:
*   An **out-of-sync local database (`domestik.db`)** that is missing columns and schema types present in the head migration version, which will cause runtime application crashes.
*   **77 deprecation warnings** triggered during testing by the deprecated `datetime.utcnow()`.
*   **Poorly structured test files** with hardcoded absolute import paths.
*   **Performance/Resource leaks** due to repetitive instantiation of HTTP clients (httpx) instead of connection pooling, and sequential HTTP calls for batches.
*   **Unhandled SQL variable limits** in the ingestion/extraction logic.

---

## 2. Database, ORM & Migration Practices

### 2.1 Out-of-Sync Local Database (`domestik.db`)
*   **Observation:** The current migration state in `domestik.db` is `c8b5c0cd3cf0` (migration `create_knowledge_tables`). The head of the migrations under `backend/alembic/versions` is `9bd4577cf6f2` (`add_inactive_seconds_to_session`).
*   **Evidence:**
    *   Running `alembic current` yields `c8b5c0cd3cf0`.
    *   Checking the SQLite schema of `learning_session` directly reveals it does not contain the `inactive_seconds` column (which is present in the latest Python model `LearningSession`).
    *   Checking the SQLite schema of `media_progress` shows that `last_position` and `duration` are still `INTEGER` columns, whereas the latest Python model and migration `9bd4577cf6f2` declare them as `Float`.
*   **Impact:** Any user interaction that inserts or updates `LearningSession` or `MediaProgress` models via the application will trigger a database error and crash the request at runtime.

### 2.2 The `create_all` vs. Alembic Lifespan Trap
*   **Observation:** In `backend/app/main.py`, the lifespan context manager initializes the database using `Base.metadata.create_all(bind=engine)`.
*   **Impact:** 
    *   SQLAlchemy’s `create_all()` only creates tables if they are completely missing. It **does not alter existing tables** or add new columns when models change.
    *   This creates a false sense of security. The application starts up and outputs `[DomestiK] Base de datos SQLite inicializada correctamente.` even though the physical schema is obsolete and out-of-sync with the Python classes.
*   **Recommendation:** Programmatic migration check at startup using Alembic or verifying the database schema is upgraded to the latest revision (e.g. running `alembic upgrade head` programmatic wrapper in lifespan, or blocking startup with a schema out-of-sync warning).

### 2.3 Portability & Custom SQL Functions
*   **Observation:** The search service (`backend/app/services/search.py`) utilizes the custom SQLite function `func.remove_accents(...)` within SQLAlchemy `select` queries to normalize text. This custom function is registered directly in SQLite connections via `Engine` event listeners in `backend/app/core/database.py`.
*   **Impact:** If the application database backend is changed (e.g., PostgreSQL, which has native accent-removal tools or type decorators like `unaccent`), this code will throw SQL syntax errors. Furthermore, the `remove_accents` SQLite registration logic will not run on PostgreSQL, meaning portability is broken despite PostgreSQL-specific GUID logic being present.

---

## 3. Testing Infrastructure & Pytest Warnings

### 3.1 Hardcoded User Paths in Tests
*   **Observation:** 7 test files, including the global `backend/tests/conftest.py`, contain the following hardcoded line:
    ```python
    sys.path.insert(0, "/home/marodriguezd/Github/DomestiK")
    ```
*   **Impact:** This is a major code smell and design fragility. Running pytest on any other machine or CI/CD runner will fail or import code from unexpected paths if the exact home directory structure `/home/marodriguezd` does not exist.
*   **Recommendation:** Remove the hardcoded path and use dynamic paths relative to `__file__`, or rely on python workspace installation / standard `PYTHONPATH` exports:
    ```python
    import os
    import sys
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    ```

### 3.2 Pytest Warnings: `datetime.utcnow()` Deprecation
*   **Observation:** Running the test suite yields **77 deprecation warnings** related to `datetime.utcnow()`.
*   **Impact:** In Python 3.12, `datetime.utcnow()` is deprecated and will be removed in a future version.
*   **Trap Consideration:** Replacing `utcnow()` with timezone-aware `datetime.now(timezone.utc)` directly in some models will result in comparisons between offset-naive (from SQLite or other parts) and offset-aware datetimes, causing `TypeError: can't subtract offset-naive and offset-aware datetimes` at runtime.
*   **Recommendation:**
    *   Use timezone-naive UTC representation consistently via:
        ```python
        from datetime import datetime, timezone
        default_utc_naive = lambda: datetime.now(timezone.utc).replace(tzinfo=None)
        ```
    *   Alternatively, fully migrate SQLModel/SQLAlchemy schemas to support timezone-aware datetime decorators and enforce it uniformly.

---

## 4. Code Quality & Code Duplication

### 4.1 Connection Pool Socket Exhaustion Anti-pattern
*   **Observation:** HTTP client connections are created ad-hoc for every call without reuse:
    *   `OpenAILLMProvider` and `OllamaLLMProvider` (`backend/app/services/llm.py`) construct a new `httpx.AsyncClient` per prompt generation.
    *   `OllamaEmbeddingProvider` and `OpenAIEmbeddingProvider` (`backend/app/services/embedding.py`) construct a new `httpx.Client` per vector request.
    *   `APIClient` (`frontend/app/api_client.py`) opens and closes a new `httpx.AsyncClient` inside every `get`, `post`, `patch`, and `delete` helper function.
*   **Impact:** Establishing a connection requires TCP handshakes (and SSL/TLS for OpenAI). Creating clients per-request introduces high latency, CPU overhead, and triggers port/socket exhaustion under heavy workload.
*   **Recommendation:** Use a shared client instance (e.g. a singleton client wrapper or FastAPI dependency injection client provider).

### 4.2 N+1 API Calls on Frontend Page Loading
*   **Observation:** In `frontend/app/pages/habits.py`, loading the habits list triggers sequential network calls for each habit:
    ```python
    self.habits = await APIClient.get("/workflow/habits")
    for h in self.habits:
        stats = await APIClient.get(f"/workflow/habits/{h['id']}/stats")
        self.habit_stats[h["id"]] = stats
    ```
*   **Impact:** If a user has 15 habits registered, loading the page triggers 16 individual API requests. This increases page load time significantly.
*   **Recommendation:** Optimize the backend `/workflow/habits` endpoint to return habits with their statistics pre-computed/joined, or provide a bulk statistics retrieval endpoint.

---

## 5. Architectural Improvements

### 5.1 Sequential HTTP Requests for Batch Embeddings
*   **Observation:** In `OllamaEmbeddingProvider.get_embeddings_batch`, the batch endpoint is mocked as:
    ```python
    def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        return [self.get_embedding(t) for t in texts]
    ```
*   **Impact:** When importing a document (like a PDF or EPUB) that yields dozens or hundreds of chunks, this results in hundreds of sequential HTTP calls to Ollama.
*   **Recommendation:** Ollama's embeddings endpoint supports array input. The provider should send the list of texts in a single batch request to Ollama to utilize GPU batching parallelization.

### 5.2 SQLite Parameter Limit Hazard during Extraction
*   **Observation:** In `PDFExtractor.extract` and `EPUBExtractor.extract` (`backend/app/services/extractor.py`), existing metadata index segments are cleared using:
    ```python
    db.query(EmbeddingRecord).filter(
        EmbeddingRecord.entity_id.in_(old_content_ids),
        EmbeddingRecord.entity_type == "content_index"
    ).delete(synchronize_session=False)
    ```
*   **Impact:** SQLite has a parameter limit (traditionally 999). If a textbook containing more than 999 pages is re-indexed, `old_content_ids` will contain > 999 values, crashing the deletion query with a `too many SQL variables` database exception.
*   **Recommendation:** Partition the `old_content_ids` list into chunks of 500 when executing `in_()` queries, or use a join-delete construct.

### 5.3 Orphaned Database Seeding Module
*   **Observation:** `backend/app/core/seeding.py` is fully implemented with realistic seed data for books, courses, notes, and habits, but it is **never imported or invoked** in the codebase.
*   **Recommendation:** Register a CLI flag (e.g. `python -m backend.app.main --seed`) or a button in the NiceGUI Settings menu to trigger `seed_db()`.

---

## 6. Security Flaws

### 6.1 Path Traversal / Arbitrary File Discovery
*   **Observation:** The application runs as a local-first service but does not implement authentication. Under this model, all endpoints are publicly exposed on the port.
*   **Vulnerability Details:**
    *   The `/content/import` and `/content/validate-directory` API endpoints allow scanning and referencing folders on the server's local storage.
    *   While `is_safe_path` attempts to restrict requests to the user's home folder `~` or current working directory `cwd`, any user on the network who can access the web port can request files like `/cover-image/` or trigger ingestion of sensitive folders in `~` (e.g. personal documents, data folders, etc.), bypassing the application boundary.
*   **Recommendation:** If the application is meant to be accessed remotely, a basic authentication mechanism (such as a shared secret token, API key, or simple password gate) should be integrated, and path-referencing ingestion should be restricted to a single sandbox directory (e.g. `data/inbox`).
