# DomestiK Repository Comprehensive Codebase Analysis

**Prepared by**: `teamwork_preview_explorer`  
**Date**: 2026-06-22  

---

## Executive Summary
This report presents the findings of a comprehensive, read-only analysis of the **DomestiK** repository. The codebase implements a self-hosted, local-first learning operating system combining course/book ingestion, study session tracking, space repetition, semantic search, and an AI tutor. The backend uses **FastAPI** with **SQLAlchemy** and **SQLite**, while the frontend is built using **NiceGUI** (which runs server-side on top of FastAPI/Quasar).

Our analysis identified critical security vulnerabilities (XXE, XSS), architectural bottlenecks (loopback HTTP overhead, Python-based vector math), database state pollution (active vs ended sessions), out-of-sync migrations, and python deprecation issues.

---

## 1. Code Flaws & Logic Bugs

### 1.1. Out-of-Sync Database Migrations in Local Environment
* **Location**: Local database file (`domestik.db`) and migration scripts in `backend/alembic/versions`.
* **Details**: Checking the database version with `alembic current` returns `c8b5c0cd3cf0` (migration `create_knowledge_tables`). However, the head migration version is `9bd4577cf6f2` (`add_inactive_seconds_to_session`).
* **Impact**: The physical local SQLite database file `domestik.db` is missing the `inactive_seconds` column on the `learning_session` table. Running the server in development or production will result in a database error (`OperationalError: no such column: inactive_seconds`) when updating a study session's heartbeat. This was not caught in tests because the test suite initializes an in-memory database using `Base.metadata.create_all` directly instead of executing migrations.
* **Recommendation**:
  1. Upgrade the local database schema by running:
     ```bash
     PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini upgrade head
     ```
  2. Implement a validation step in CI/CD or startup that runs `alembic check` to verify if models match the current database schema.

### 1.2. Session `ended_at` State Pollution
* **Location**: `backend/app/services/session.py` (lines 31–58) and `LearningSession` model in `backend/app/models/activity.py`.
* **Details**: The periodic heartbeat callback (`update_session_heartbeat`) registers activity by updating the `ended_at` timestamp of the session to `datetime.utcnow()`.
* **Impact**: Both active (in-progress) and ended (completed) sessions have a non-null `ended_at` field in the database. There is no explicit boolean flag or state column (e.g. `status`) to differentiate between a session currently running and one that was explicitly finalized.
* **Recommendation**:
  - Add a `last_heartbeat_at` or `status` column to the `LearningSession` schema. Only write to `ended_at` when `SessionService.end_session()` is explicitly executed.

### 1.3. Broken `vis-network.min.js` Offline Script
* **Location**: `static/js/vis-network.min.js` (referenced in `frontend/app/pages/knowledge_graph.py` on line 268).
* **Details**: The file size is only 68 bytes. It contains a single line of text:  
  `Redirecting to /vis-network@10.1.0/standalone/umd/vis-network.min.js`.
* **Impact**: This file does not contain actual JavaScript. If served offline, the browser throws a syntax error: `SyntaxError: Unexpected identifier 'to'`. Vis.js is not defined, completely breaking the local rendering of the Knowledge Graph page.
* **Recommendation**:
  - Download the complete payload of `vis-network.min.js` from `https://unpkg.com/vis-network@10.1.0/standalone/umd/vis-network.min.js` and overwrite the 68-byte placeholder file.

---

## 2. Deprecations

### 2.1. Timezone-Naive UTC Datetimes (`datetime.utcnow`)
* **Location**:
  - Services: `backend/app/services/session.py` (lines 21, 40, 69) and `backend/app/services/workflow.py` (lines 80, 249, 292, 310, 321, 358, 404, 405).
  - Models: `backend/app/models/activity.py` (line 21), `backend/app/models/content.py` (lines 24, 41, 84, 99, 113), `backend/app/models/resource.py` (line 72), `backend/app/models/workflow.py` (lines 108, 142, 169, 191).
* **Details**: Widespread usage of `datetime.utcnow()` and passing `default=datetime.utcnow` to SQLAlchemy columns.
* **Impact**: In Python 3.12+, `datetime.utcnow()` is deprecated and scheduled for removal in future versions. Moreover, it produces offset-naive datetime objects, which can trigger errors (`TypeError: can't subtract offset-naive and offset-aware datetimes`) if compared against timezone-aware dates.
* **Recommendation**:
  - Replace `datetime.utcnow()` with `datetime.now(timezone.utc)`.
  - In SQLAlchemy models, use timezone-aware fields, or define column default parameters as `default=lambda: datetime.now(timezone.utc)`.

### 2.2. Legacy SQLAlchemy 1.x Query Interface (`db.query`)
* **Location**:
  - `backend/app/services/note.py` (lines 79, 86).
  - `backend/app/services/extractor.py` (lines 72, 76, 145, 149, 380, 391, 396, 397).
  - `backend/app/services/insights.py` (lines 205, 247).
* **Details**: Use of `db.query(Model).filter(...)` instead of the 2.0 `select()` syntax.
* **Impact**: Bypasses compile optimizations and is deprecated in SQLAlchemy 2.0.
* **Recommendation**:
  - Rewrite these expressions to utilize `db.execute(select(...))` or `db.execute(delete(...))`.

---

## 3. Architectural Improvements

### 3.1. Service-Layer Transaction Boundary Pollution
* **Location**: Services `WorkflowService`, `ProgressService`, `SessionService`, `NoteService`.
* **Details**: Services invoke `db.commit()` internally (e.g. `WorkflowService.create_goal` line 147, `ProgressService.recalculate_course_progress` line 43, etc.).
* **Impact**: Inhibits transaction composition. If a higher-level workflow needs to perform multiple operations atomically (e.g. creating a course, assigning a plan, and initializing a goal), and one of them fails, the database cannot rollback because intermediate commits were already executed.
* **Recommendation**:
  - Remove `db.commit()` from inner service methods and rely on `db.flush()` instead. Manage transaction boundaries (`db.commit()` or `db.rollback()`) inside FastAPI endpoint controllers or via request dependencies.

### 3.2. Performance Bottleneck in Vector Similarities (Pure Python Cosine Sim)
* **Location**: `backend/app/services/semantic_search.py` (lines 60–80).
* **Details**: Cosine similarity is calculated inside a loop using pure Python (`zip` and `sum` functions) over up to 3000 vectors loaded from the SQLite database.
* **Impact**: Vector serialization/deserialization from a JSON column and manual math in Python will result in severe latency and CPU spikes as the knowledge base grows.
* **Recommendation**:
  - Integrate a vectorized library such as `numpy` or `faiss` to do in-memory similarity computations, or load the native SQLite `sqlite-vec` or `sqlite-vss` extension.

### 3.3. Double-Hop HTTP Loopback Overhead in Frontend
* **Location**: Frontend pages (e.g., `DashboardPage` and `LibraryPage` in `frontend/app/`).
* **Details**: NiceGUI runs on the server side in the same process as FastAPI. However, NiceGUI pages invoke the API using loopback HTTP calls through `APIClient` (e.g., fetching `/api/v1/notes`).
* **Impact**: This creates a redundant roundtrip: Browser -> Server (WebSocket) -> Server (HTTP Loopback Client) -> Server (FastAPI Router) -> Server (Database) -> JSON serialization -> loopback network -> JSON deserialization -> Browser update.
* **Recommendation**:
  - Refactor NiceGUI pages to import service modules directly and run operations locally using a scoped DB session, skipping the HTTP overhead entirely.

### 3.4. N+1 Lazy Loading Queries
* **Location**: `backend/app/api/courses.py` (line 20) and `backend/app/api/resources.py`.
* **Details**: Running `db.get(Course, course_id)` retrieves the course, but accessing nested relations (modules, lessons, tasks) during schema serialization triggers separate database queries for every entity.
* **Impact**: Slow queries due to multiple SQL executions.
* **Recommendation**:
  - Eagerly load relationships using `joinedload(Course.modules).joinedload(Module.lessons)` where appropriate.

---

## 4. Security Vulnerabilities

### 4.1. Unsecured XML Parsing (XXE / XML Entity Expansion)
* **Location**: `backend/app/services/extractor.py` (lines 155, 165) in `EPUBExtractor`.
* **Details**: The extractor parses user-submitted EPUB XML documents (container.xml, OPF files) using `xml.etree.ElementTree.fromstring()`.
* **Impact**: `ElementTree` is vulnerable to XML External Entity Injection (XXE) and XML Entity Expansion attacks (Billion Laughs DoS) if malicious EPUB files are uploaded.
* **Recommendation**:
  - Replace `xml.etree.ElementTree` with `defusedxml.ElementTree` or configure the parser to block external DTD resolution.

### 4.2. Reflected Cross-Site Scripting (XSS) in Media Viewer
* **Location**: `backend/app/components/media_viewer.py` (lines 28–34, 108).
* **Details**: Formats database attributes (`self.mime_type`, `self.media_id`) directly into HTML templates:
  ```python
  html_code = f"""
  <video id="video-{self.media_id}" ...>
      <source src="{video_url}" type="{self.mime_type}">
  </video>
  """
  ui.html(html_code)
  ```
* **Impact**: If a malicious user imports a file with a crafted MIME type containing script tags (e.g., `video/mp4";><script>alert(1)</script>`), NiceGUI will render it raw via `ui.html()`, causing arbitrary JS execution in the viewer's context.
* **Recommendation**:
  - Sanitize all string variables using HTML escaping before formatting, or use NiceGUI's standard `ui.video()` component instead of building raw HTML strings.
