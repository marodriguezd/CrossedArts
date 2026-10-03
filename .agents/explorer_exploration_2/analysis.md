# DomestiK Codebase Analysis & Diagnostics Report

This report presents the findings of a comprehensive code quality, security, and architectural review of the **DomestiK** repository. The analysis focuses on backend-frontend integration, API contracts, database migration stability, performance bottlenecks, and security boundaries.

---

## Executive Summary

1. **Critical Database Migration Bug**: A broken Alembic migration (`9bd4577cf6f2`) prevents the physical SQLite database from upgrading to the head schema. The migration fails on tables with existing data due to adding a `NOT NULL` column without a default value. This was missed by tests because the test suite bypasses Alembic and creates tables directly from SQLAlchemy metadata.
2. **API Contract & State Corruption Bug**: The `/api/v1/resources` listing endpoint strips subclass-specific fields like `difficulty` (for courses) and `reading_percentage` (for books) due to using a restrictive base response schema (`ResourceBaseResponse`). In addition to visual bugs (books showing 0% progress), editing any course from the library page silently resets its difficulty to `BEGINNER` in the database, corrupting state.
3. **Severe Performance Bottleneck**: The semantic relation search (`get_related_resources`) performs in-memory averaging and cosine similarity calculations over the *entire database* (notes, transcripts, content pages) on every page render, resulting in $O(N)$ CPU complexity that scales poorly.
4. **Security Vulnerabilities**:
   - **XXE Injection**: The EPUB metadata extraction service uses Python's standard `xml.etree.ElementTree`, which is vulnerable to XML External Entity (XXE) and XML entity expansion (billion laughs) attacks.
   - **Directory Traversal / Excessive Path Scope**: The `is_safe_path` utility permits read access to the entire user home directory, exposing sensitive files (e.g., `.bash_history`, `.netrc`, browser profiles, local database files) that fall outside the narrow blacklist of hidden directories.

---

## 1. Code Quality & Logic Bugs

### 1.1 Critical Alembic Migration Failure
* **File Location**: `backend/alembic/versions/9bd4577cf6f2_add_inactive_seconds_to_session.py` (Line 25)
* **Observed Behavior / Error Trace**:
  When attempting to migrate the database:
  ```
  sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) Cannot add a NOT NULL column with default value NULL
  [SQL: ALTER TABLE learning_session ADD COLUMN inactive_seconds INTEGER NOT NULL]
  ```
* **Root Cause**: The migration command:
  ```python
  batch_op.add_column(sa.Column('inactive_seconds', sa.Integer(), nullable=False))
  ```
  adds a `NOT NULL` column to an existing table without providing a `server_default` value. On SQLite (and most other RDBMS), adding a `NOT NULL` column to a table that already contains data (such as the seeded study sessions) is prohibited because existing rows cannot accept a `NULL` value.
* **Test Gap**: The test suite runs successfully because `backend/tests/conftest.py` calls `Base.metadata.create_all(bind=engine)`, creating the database schema directly from the models in one pass. It completely bypasses Alembic migrations, creating a severe testing gap where broken migrations can reach production.
* **Proposed Solution**: 
  1. Add a server default to the migration file:
     ```python
     batch_op.add_column(sa.Column('inactive_seconds', sa.Integer(), nullable=False, server_default='0'))
     ```
  2. Implement a migration integration test in the test suite that runs `alembic upgrade head` on a test database to ensure schema migrations are always valid.

---

### 1.2 API Contract Mismatch & State Corruption (Course Difficulty & Book Progress)
* **File Locations**: 
  - `backend/app/api/resources.py` (Line 15)
  - `backend/app/schemas/resource.py` (Line 18)
  - `frontend/app/components/edit_resource_dialog.py` (Lines 26-27, 310-313)
* **Observed Behavior**:
  1. All books in the library display `0%` progress.
  2. Sorting books by progress does not work.
  3. Editing any course title/category from the library page silently resets its difficulty to `BEGINNER` in the database.
* **Root Cause**:
  The GET `/api/v1/resources` endpoint uses `response_model=List[ResourceBaseResponse]`. Because `ResourceBaseResponse` is the base schema, it does not include subclass-specific fields like `difficulty` (for courses) and `reading_percentage`/`author` (for books). Pydantic silently strips these fields when serializing the resources list.
  
  When the user opens the "Edit" dialog for a resource card, the frontend initializes the fields from the stripped list data:
  ```python
  self.difficulty = resource.get("difficulty", "BEGINNER") if resource.get("type") == "course" else None
  self.author = resource.get("author", "") if resource.get("type") == "book" else None
  ```
  For a course, `resource.get("difficulty")` is `None` (stripped), so it defaults to `"BEGINNER"`. On save, the dialog sends:
  ```python
  payload["difficulty"] = self.difficulty  # Sends "BEGINNER"
  ```
  The backend patches the database with `difficulty: "BEGINNER"`, wiping out the original value (e.g. `INTERMEDIATE` or `ADVANCED`).
* **Proposed Solution**:
  Define a polymorphic response schema for the `/resources` list endpoint using Pydantic Unions, permitting the endpoint to return the full properties of books and courses:
  ```python
  from typing import Union
  # In backend/app/api/resources.py
  @router.get("", response_model=List[Union[CourseBaseResponse, BookBaseResponse]])
  ```

---

### 1.3 Timezone Boundary Shifts in Habit Tracking & Streak Calculation
* **File Location**: `backend/app/services/workflow.py` (Lines 249, 292, 310, 321)
* **Observed Behavior**: Completing a habit on consecutive days (in local time) can result in a broken streak or ignored logs.
* **Root Cause**:
  Habit completion is recorded using `datetime.utcnow()` as the default date. Day boundaries are verified via UTC dates:
  ```python
  current_date = datetime.utcnow().date()
  recorded_dates = {r.date.date() for r in records}
  ```
  If a user in timezone `UTC+2` logs a habit at `00:30 AM` on June 24th, it is recorded as `22:30 PM` on June 23rd in UTC. If they already logged a completion on June 23rd, the system considers it a duplicate for the "same day" (June 23rd in UTC) and discards the new completion. On June 24th, if they do not log another habit, their streak is falsely reset to zero because no log exists for June 24th UTC.
* **Proposed Solution**:
  Perform date and streak calculations using the user's local date (retrieved from the client/browser timezone offset) rather than the server's UTC date.

---

### 1.4 False-Positive Concept Extraction on Notes
* **File Location**: `backend/app/services/knowledge_service.py` (Line 198)
* **Observed Behavior**: The knowledge graph displays irrelevant concepts like `#include`, `#ff0000`, or code comments as separate nodes.
* **Root Cause**:
  The tag extractor searches for `#` tags in notes using a naive regex:
  ```python
  tags = re.findall(r"#(\w+)", content)
  ```
  This matches:
  - C-style headers: `#include <stdio.h>` $\rightarrow$ `#include`
  - Hex color codes: `#ff0000` $\rightarrow$ `#ff0000`
  - Inline code comments: `# comment` $\rightarrow$ `#comment`
  - Markdown headings: `# Heading` (if no space is left)
* **Proposed Solution**:
  1. Exclude code blocks (bounded by ` ``` ` or ` ` `) before running regex parsing on Markdown text.
  2. Refine regex to ensure it only matches hashtags preceded by boundaries/whitespaces (e.g. `(?<=\s|^)#(\w+)`).

---

### 1.5 Orphaned Rows via Bypassed ORM Events on Bulk Deletes
* **File Location**: `backend/app/services/extractor.py` (Lines 76, 149, 396-397)
* **Observed Behavior**: Orphaned records accumulate in `EmbeddingRecord` and `KnowledgeConnection` tables.
* **Root Cause**:
  The application registers `after_delete` event listeners on models (e.g., `Note`, `Lesson`, `ContentIndex`) in `backend/app/models/__init__.py` to clean up polymorphic dependencies in `EmbeddingRecord` and `KnowledgeConnection`.
  However, `extractor.py` uses SQLAlchemy bulk delete queries:
  ```python
  db.query(ContentIndex).filter(ContentIndex.media_asset_id == media_asset_id).delete()
  ```
  In SQLAlchemy, bulk deletes (`.delete()`) do NOT instantiate objects and therefore **bypass ORM mapper event listeners** like `after_delete`. Consequently, any associated records in `EmbeddingRecord` and `KnowledgeConnection` are never cleaned up, resulting in database size leaks.
* **Proposed Solution**:
  Manually clean up the polymorphic associations before executing bulk deletes (as done elsewhere in the codebase), or load the objects and call `db.delete(obj)` to trigger the listeners, or implement standard cascading foreign keys if vector tables are refactored to be non-polymorphic.

---

### 1.6 Course Scanner Heuristic Collision in Multi-Module Courses
* **File Location**: `backend/app/services/scanner.py` (Lines 223-235)
* **Observed Behavior**: Scanning directories with identical file names in different subfolders matches them to the wrong modules/lessons.
* **Root Cause**:
  When mapping scanned video files to lessons, the scanner only filters by `course_id` and `order_index`:
  ```python
  stmt_les = (
      select(Lesson)
      .join(Lesson.module)
      .where(Lesson.module.has(course_id=course.id))
      .where(Lesson.order_index == order_num)
  )
  ```
  If a course has multiple modules (e.g. `Module 1` and `Module 2`) and both contain a lesson with `order_index = 1` (e.g. `01_intro.mp4`), the query resolves to whichever lesson is returned first by `.first()`, linking files from `Module 2` to `Module 1`'s lesson.
* **Proposed Solution**:
  Incorporate the module's folder name in the query to match the file to the correct module:
  ```python
  stmt_les = (
      select(Lesson)
      .join(Lesson.module)
      .where(Lesson.module.has(course_id=course.id, title=file_path.parent.name))
      .where(Lesson.order_index == order_num)
  )
  ```

---

## 2. Performance & Scalability Issues

### 2.1 Exponential Latency in Semantic Search & Page Rendering
* **File Location**: `backend/app/services/semantic_search.py` (Lines 191-255)
* **Observed Behavior**: Page load speed on Course Detail and Book Detail pages degrades as more items are added to the library.
* **Root Cause**:
  To display related resources on detail pages, `get_related_resources` calculates a "semantic fingerprint" (average vector) for the target resource and compares it against all other resources in the database.
  To do this, it loads *all* notes embeddings and up to 30 content pages/transcripts embeddings *for every resource in the database* into memory:
  ```python
  note_vectors = db.execute(stmt_notes).all()
  content_vectors = db.execute(stmt_content).all()
  trans_vectors = db.execute(stmt_trans).all()
  ```
  It then groups them, computes averages, normalizes them, and runs cosine similarities entirely in Python. Since this happens synchronously on every page render, it has $O(N)$ CPU and memory complexity, where $N$ is the number of text segments in the system.
* **Proposed Solution**:
  Cache the semantic fingerprint vector for each resource in a dedicated column on the `LearningResource` (or `Course`/`Book`) table. Recompute the fingerprint asynchronously only when the resource content changes (e.g., when a book is imported or a note is saved). This reduces the search complexity to $O(R)$ where $R$ is the number of resources, requiring only one vector fetch per resource.

---

### 2.2 Lack of Connection Pooling in AI Providers (Ollama & OpenAI)
* **File Location**: `backend/app/services/embedding.py` (Lines 83, 122, 149)
* **Observed Behavior**: Unnecessary network latency when sending batch embedding requests.
* **Root Cause**:
  For every embedding calculation, `get_embedding` instantiates a new HTTP client:
  ```python
  with httpx.Client() as client:
      response = client.post(...)
  ```
  Creating and destroying `httpx.Client()` instances on every request prevents HTTP connection reuse (keep-alive) and connection pooling. The system must establish a new TCP handshake (and TLS negotiation for OpenAI) on every single call. In a batch of 50 pages, this adds significant overhead.
  Additionally, `OllamaEmbeddingProvider.get_embeddings_batch` iterates sequentially over `get_embedding` rather than utilizing parallel calls or Ollama's batch embedding format.
* **Proposed Solution**:
  Use a single, shared persistent `httpx.AsyncClient` session initialized at application startup (e.g., in the FastAPI lifespan handler) and inject it into the LLM/Embedding services.

---

### 2.3 Hardcoded Scanning Limit on Global Semantic Search
* **File Location**: `backend/app/services/semantic_search.py` (Line 48)
* **Observed Behavior**: Older study notes and books are silently ignored in search results.
* **Root Cause**:
  When performing a global search without a `resource_id` filter, the system applies a hardcoded limit of 3000 records:
  ```python
  stmt_records = select(EmbeddingRecord).order_by(EmbeddingRecord.created_at.desc()).limit(3000)
  ```
  Once the total number of notes, transcripts, and pages exceeds 3000, any records created earlier will be completely omitted from semantic searches.
* **Proposed Solution**:
  Remove the hardcoded scanning limit or implement a vector index (e.g., SQLite `sqlite-vss` extension or an in-memory HNSW index) to search across all vectors efficiently.

---

## 3. Security Vulnerabilities

### 3.1 XML External Entity (XXE) Injection in EPUB Ingestion
* **File Location**: `backend/app/services/extractor.py` (Lines 6, 155, 165)
* **Vulnerability Description**:
  During EPUB ingestion, the system extracts the EPUB zip and parses metadata files (`container.xml` and OPF files) using standard Python XML library:
  ```python
  import xml.etree.ElementTree as ET
  ...
  root_container = ET.fromstring(container_xml)
  ```
  `xml.etree.ElementTree` does not disable external entity resolution by default. If an attacker uploads or points the scanner to a maliciously crafted EPUB file containing custom XML entities, they can trigger an XXE injection. This allows the attacker to:
  1. Read arbitrary files from the server's filesystem.
  2. Perform Server-Side Request Forgery (SSRF) by forcing the server to make requests to internal services.
  3. Trigger Denial of Service (billion laughs attack) via entity expansion.
* **Proposed Solution**:
  Use `defusedxml.ElementTree` instead of `xml.etree.ElementTree` to parse XML documents safely, which blocks external entities and entity expansion attacks.

---

### 3.2 Path Traversal & Excessive Scope in `is_safe_path`
* **File Location**: `backend/app/core/security.py` (Lines 16-48)
* **Vulnerability Description**:
  The path validation function `is_safe_path` checks if the resolved path starts with the user's home directory or CWD:
  ```python
  in_home = resolved_path == home_dir or resolved_path.startswith(home_dir + os.sep)
  in_cwd = resolved_path == cwd_dir or resolved_path.startswith(cwd_dir + os.sep)
  ```
  If either is true, the path is considered "safe", except if it contains specific blacklisted directory names: `[".ssh", ".gnupg", ".aws", ".gemini", ".config", ".env", ".git"]`.
  
  This scope is excessively broad. A user running this application (or an attacker accessing the unauthenticated API) has read access to the *entire* home directory. This includes:
  - `.bash_history` (often containing passwords or sensitive commands).
  - `.netrc` (credential storage).
  - Browser profile directories (e.g., `~/.mozilla` containing session cookies, history, and logins).
  - The application's database `domestik.db` (which contains private notes, study paths, and LLM queries).
* **Proposed Solution**:
  Restrict the scope of `is_safe_path` to only allow paths within the active workspace content directory (e.g., `data/` or specific user-configured storage folders) rather than the entire user home folder.

---

### 3.3 Lack of API Authentication
* **File Location**: `backend/app/main.py`
* **Vulnerability Description**:
  The backend API is completely unauthenticated. While designed for single-user local-first hosting, `README.md` markets the project as "autohospedable" (self-hostable). If a user self-hosts the application on a VPS or home server and exposes port `8000` (or mounts NiceGUI), any remote attacker can:
  - Query, modify, or delete any data (notes, study plans, etc.).
  - Upload arbitrary files or link files to the server's local home folder via the import/cover APIs.
  - Read files from the server's home directory using the `/media/stream` endpoint.
* **Proposed Solution**:
  Implement a basic token-based authentication mechanism (or a single-user password check) for the API endpoints and NiceGUI pages, or explicitly document and warn users to never expose the port to the public internet without a reverse proxy implementing auth (e.g. Authelia, basic auth, tailscale).

---

## 4. Architectural & Integration Observations

### 4.1 Synchronous NiceGUI-FastAPI Loopback Loop
* **File Location**: `frontend/app/api_client.py`
* **Observation**:
  NiceGUI and FastAPI run inside the exact same Python process. However, all NiceGUI pages communicate with the backend services by making HTTP loopback calls via `httpx.AsyncClient` to `127.0.0.1:8080/api/v1/...`.
  This creates significant, unnecessary overhead:
  - NiceGUI runs on the server $\rightarrow$ serializes data $\rightarrow$ opens local TCP port $\rightarrow$ routes through FastAPI middleware $\rightarrow$ executes SQL $\rightarrow$ serializes response $\rightarrow$ routes back over loopback $\rightarrow$ NiceGUI deserializes.
  
  This also creates a strict dependency on the loopback port and host matching the configuration. If the port changes or the server binds to a different interface, the frontend will fail to load page content.
* **Proposed Solution**:
  For page-level data fetching, NiceGUI pages should directly import and call the service layers (e.g. `SessionService`, `NoteService`) or share a database session directly, bypassing HTTP loopback entirely. Use the API Client only for client-side JavaScript calls (like the HTML5 video progress tracker).

---

### 4.2 Unused (Dead) Code: `ScannerManager`
* **File Location**: `backend/app/services/scanner.py`
* **Observation**:
  The `ScannerManager` is a well-designed directory scanner that walks local directories and imports resources automatically. However, there are no endpoints, CLI commands, or NiceGUI views that trigger this service. It is only utilized inside tests.
* **Proposed Solution**:
  Expose a "Scan Library" button in the library UI that triggers `ScannerManager.scan_directory` in the background, allowing users to automatically sync directories without importing each folder manually.
