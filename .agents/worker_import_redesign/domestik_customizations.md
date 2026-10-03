---
name: domestik-customizations
description: Custom workspace rules, guidelines, and auto-improvement instructions for DomestiK.
---

# DomestiK Workspace Customization Skill

This file serves as a persistent guide and rulebook for all AI agents working on the **DomestiK** repository. It contains guidelines for code layout, testing protocols, database migration discipline, and instructions for how future agents should auto-improve and extend this guide when new patterns or pitfalls are discovered.

---

## Guidelines for Auto-Improvement

To maintain high development quality and prevent recurring issues, agents must update this document whenever new lessons, constraints, or guidelines are discovered.

### Criteria for Adding a Rule
An agent should append a new rule or update an existing one when:
1. **Recurring Failures:** A specific bug pattern or configuration error is found and fixed more than once.
2. **Hidden Divergence:** A gap is identified between the test environment and the production/development runtime environment (e.g., missing migrations).
3. **Workflow Friction:** A specific command structure or environment variable configuration is required for tools (e.g., `PYTHONPATH` settings) but is not documented.
4. **Codebase Specifics:** Project-specific patterns, conventions, or design decisions are established that future agents must follow to ensure consistency.

### Step-by-Step Editing Process for Agents
When updating this file, future agents must follow this exact protocol:
1. **Read Entire File:** Read the existing `SKILL.md` first to understand the context and avoid duplicate rules.
2. **Preserve Frontmatter:** Keep the YAML frontmatter section at the top of the file exactly as it is.
3. **Draft the Rule:** Formulate the new rule with a clear title, description, and concrete, actionable steps or commands.
4. **Append to Lessons & Rules:** Locate the `## Learnt Lessons & Rules` section and append the new rule at the bottom. Do not delete or overwrite existing rules unless they are outdated or incorrect.
5. **Verify Formatting:** Ensure the markdown is clean, properly formatted, and easy for future agents to parse.
6. **Commit and Document:** Explain the new rule in the handoff report and commit message.

---

## Learnt Lessons & Rules

### 1. Virtualenv and Pytest Usage
* **Description:** DomestiK uses a local virtual environment named `.venv` in the repository root. Commands and tests must be run using this virtual environment's binaries to prevent package version mismatch issues.
* **Context:** Running tests or scripts with global Python installations can fail due to missing dependencies. Setting the `PYTHONPATH` is also required so that modules in `backend/` and `frontend/` can resolve correctly.
* **Actionable Commands:**
  - Run all tests:
    ```bash
    PYTHONPATH=. .venv/bin/pytest backend/tests -x -q
    ```
  - Run a specific test file:
    ```bash
    PYTHONPATH=. .venv/bin/pytest backend/tests/test_session.py
    ```

### 2. Database Migration Discipline (Alembic)
* **Description:** DomestiK uses Alembic for tracking database schema changes on the SQLite database (`~/.domestik/domestik.db`). However, the test suite (`backend/tests/conftest.py`) initializes a clean, in-memory SQLite database and creates tables directly using SQLAlchemy metadata (`Base.metadata.create_all`).
* **Critical Trap:** Because tests create tables on-the-fly from Python classes, the test suite will pass even if you modify a database model and forget to generate an Alembic migration. If this happens, the physical database will not be updated, and the application will fail in production/development.
* **Actionable Commands:**
  - After modifying any database model (classes inheriting from SQLModel/SQLAlchemy `Base`), always generate a new migration:
    ```bash
    PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini revision --autogenerate -m "describe_your_changes_here"
    ```
  - Apply migrations to the local database file:
    ```bash
    PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini upgrade head
    ```
  - Check the migration history:
    ```bash
    PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini history
    ```

### 3. Refactoring Status — All Complete
* **Description:** DomestiK underwent a complete internal audit on 2026-06-22 identifying 10 critical flaws, database drift issues, performance bottlenecks, and security vulnerabilities. All 10 issues have been **resolved**. Additional architectural improvements (config centralization, `~/.domestik/` data migration, LangChain AI, editorial frontend redesign) were also completed.
* **Current State:** The codebase is fully refactored. See `PLAN.md` for the original audit details and completion status.
* **Key References:**
  - `PLAN.md` — Original 10-issue audit and completion status
  - `AGENTS.md` — Onboarding guide for new agents
  - `.env.example` — Configuration template (copy to `~/.domestik/.env`)

### 4. Configuration and Data Directory
* **Description:** All configuration flows through a Pydantic `BaseSettings` singleton in `backend/app/core/settings.py`. All user data lives in `~/.domestik/` (database, media, covers, `.env`).
* **Critical Rule:** Never use `os.getcwd()` for data paths. Always use `settings.data_dir`, `settings.media_dir`, `settings.covers_dir`, or `settings.db_path`.
* **Configuration Source:** Settings are loaded from `~/.domestik/.env` (optional, defaults work out of the box). See `.env.example` for all options.

### 5. AI Subsystem Architecture
* **Description:** The AI subsystem uses LangChain as the abstraction layer with Pydantic schemas for structured output. Three providers are supported: `mock` (default, no API needed), `ollama` (local inference), and `openai` (or compatible APIs).
* **Key Files:**
  - `backend/app/services/llm.py` — Chat model via `langchain_core` (`BaseChatModel`)
  - `backend/app/services/embedding.py` — Embedding model via `langchain_core` (`Embeddings`)
  - `backend/app/schemas/ai.py` — Pydantic models for structured LLM output
  - `backend/app/services/semantic_search.py` — Cosine similarity search across indexed content
* **Mock Mode:** Returns predictable responses for testing. No external API calls.

### 6. Editorial Design System
* **Description:** The frontend uses an editorial/magazine aesthetic with three font families and CSS custom properties for theming.
* **Fonts:** Cormorant Garamond (display titles), Source Sans 3 (body text), DM Mono (metadata, KPIs).
* **Theme:** CSS custom properties in `:root` (light) and `.dark-theme` (dark). Dark mode is cookie-based with full page reload.
* **Key File:** `frontend/app/layout.py` contains the complete design system (CSS variables, font imports, component styles).

### 7. Test Fleet Architecture (2026-06-22 Renewal)
* **Description:** The test suite was completely renewed on 2026-06-22, growing to 163 tests across 25 test files. Configuration is centralized in `pyproject.toml` and shared fixtures in `conftest.py`.
* **Run Command:** `PYTHONPATH=. .venv/bin/pytest backend/tests -x -q` (or simply `pytest` if `pyproject.toml` pythonpath is respected).
* **Test Configuration:** `pyproject.toml` at project root defines `testpaths`, `pythonpath`, `filterwarnings`, and coverage settings.
* **Shared Fixtures (`conftest.py`):**
  - `db` — In-memory SQLite session (fresh per test, `StaticPool` for thread safety).
  - `client` — FastAPI `TestClient` with `get_db` dependency override.
  - `sample_course` / `sample_book` — Pre-seeded ORM objects for tests that just need a resource.
  - `tmp_data_dir` — Temporary directory for filesystem tests.
* **Test File Inventory (25 files):**
  | File | Tests | Coverage Area |
  |------|-------|---------------|
  | `test_api.py` | 11 | Core REST API (CRUD, polymorphism, dashboard) |
  | `test_api_workflow.py` | 5 | Workflow API (paths, plans, goals, habits, reviews) |
  | `test_ai_learning.py` | 6 | AI tutor, quiz gen, insights, context retrieval |
  | `test_content_intelligence.py` | 3 | PDF extraction, SRT transcripts, full-text search |
  | `test_embedding_langchain.py` | 15 | LangChain embeddings: mock, indexing, caching, cosine |
  | `test_extractor.py` | 3 | Batch deletion (600+ records, chunk_size=500) |
  | `test_frontend.py` | 1 | NiceGUI import smoke test |
  | `test_knowledge.py` | 2 | Knowledge graph: concepts, connections, wiki-links |
  | `test_library_page.py` | 8 | UI sorting, filtering, category/status/path grouping logic |
  | `test_lifespan.py` | 3 | Health check, HTTP client lifecycle |
  | `test_llm_langchain.py` | 19 | LangChain LLM: templates, mock responses, streaming |
  | `test_media.py` | 5 | Thumbnails, scanners, streaming Range, playback |
  | `test_migrations.py` | 3 | Alembic file integrity, server_default fix |
  | `test_note.py` | 1 | Note CRUD lifecycle |
  | `test_progress.py` | 2 | Course/book progress calculation |
  | `test_scanner.py` | 6 | Filesystem scanner: JSON/YAML, idempotency |
  | `test_schemas_ai.py` | 10 | Pydantic AI models: validation, defaults, types |
  | `test_security.py` | 10 | `is_safe_path`: sandbox, dotdot, hidden dirs |
  | `test_semantic.py` | 5 | Cosine similarity, semantic search, related resources |
  | `test_services_direct.py` | 18 | Direct DB access: CRUD, dashboard, helpers |
  | `test_session.py` | 2 | Session lifecycle, duration, aggregations |
  | `test_settings.py` | 12 | DomestiKSettings: paths, providers, auto-compute |
  | `test_utils.py` | 4 | `utc_now_naive()`: type, naive, UTC approx |
  | `test_workflow.py` | 5 | Learning paths, plans, goals, habits, SM-2 |
  | `test_xxe_protection.py` | 6 | XXE injection, Billion Laughs, valid XML parsing |
* **Pattern: Service-layer tests** use `db` fixture directly (no HTTP). Example: `test_session.py`.
* **Pattern: API integration tests** use `client` fixture (TestClient). Example: `test_api.py`.
* **Pattern: services_direct tests** use `monkeypatch` to replace `_get_session` with a `_NoCloseSession` wrapper (prevents `db.close()` in `finally` blocks from detaching ORM objects).
* **Adding New Tests:** Create `backend/tests/test_<name>.py`, use the shared `db`/`client` fixtures. No need for `sys.path.insert` or local `client` fixtures — both are handled by `conftest.py` and `pyproject.toml`.

### 8. NiceGUI Container Clearing and Early Returns
* **Description:** When writing reactive functions in NiceGUI (like `render_activity`), avoid early return guard statements checking falsy collections (e.g. `if not self.recent_activity: return`) *before* clearing the container (`self.container.clear()`).
* **Critical Trap:** If the collection is empty (e.g. on a fresh installation with zero activities/records), the early return is triggered. This prevents the loading spinner or old elements from being cleared, leaving the UI in an infinite loading state.
* **Actionable Rule:** Always clear the container first, or use explicit checking (e.g. `if self.recent_activity is None: return` to only guard when the fetch is pending/uninitialized), and then check for empty states inside the container context to render the fallback text.

### 9. Quasar/NiceGUI Input Readability in Dark/Light Themes
* **Description:** Input-like elements (such as `ui.input`, `ui.select`, `ui.textarea`) in NiceGUI/Quasar do not automatically adapt their typed text, placeholder, or label colors to the active theme unless the `dark` prop is dynamically toggled or overridden globally.
* **Critical Trap:** Using `.props('dark')` statically will cause inputs to use white text, which is completely invisible on white/light backgrounds in light mode. Conversely, omitting the `dark` prop in dark mode makes typed text illegible (dark text on dark background).
* **Actionable Rule:** Override Quasar styling classes globally in layout.py to style inputs dynamically based on the current theme variables:
  - Text: `.q-field__native`, `.q-field__input` should use `color: var(--text-primary) !important;`
  - Placeholders/Labels: `.q-placeholder`, `.q-field__label` should use `color: var(--text-muted) !important;`
  - Icons/Dropdown arrows: `.q-field__marginal`, `.q-icon` should use `color: var(--text-secondary) !important;`

### 10. Dynamic Selector Borders and Event-Loop-Safe Local Explorers
* **Description:** UI elements and container cards (such as selections in a dialog) do not dynamically update their borders or styles in NiceGUI upon attribute changes unless they are wrapped in `@ui.refreshable` and explicitly refreshed.
* **Actionable Rule:**
  - Wrap type card selector rows or any dynamically restyled panels in a `@ui.refreshable` function. Call its `.refresh()` method within the element’s `.on('click', ...)` action callback to trigger instant visual updates.
  - To pick directory paths locally on the server filesystem, build a custom `ui.dialog` subclass that asynchronously lists directories using `pathlib.Path.iterdir()` (filtering hidden folders and handling `PermissionError`). This creates an event-loop-safe, responsive local folder explorer GUI without blocking NiceGUI's event loop or relying on OS-level toolkits (like tkinter).

### 11. NiceGUI Refreshable Checklists & SQL Transaction Synchronization
* **Description:** Dialogs managing resource relations/groupings inline (such as assigning resources to learning paths) need to be reactive to options created dynamically inside the dialog itself. When saving, relationship updates should be transaction-safe and minimize query footprint.
* **Actionable Rule:**
  - Wrap checklists or dropdown list grids in a `@ui.refreshable` method (e.g., `_render_paths_section`) and trigger `.refresh(args...)` upon new inline grouping/path creation to instantly show the newly created item and pre-check it.
  - Sincronizar asociaciones en un único bloque de base de datos síncrono. Obtener los IDs guardados actualmente, compararlos con los seleccionados por el usuario, y realizar de forma incremental solo los inserts y deletes necesarios para optimizar la velocidad y estabilidad en SQLite.
  - Para nuevos elementos secuenciados, calcular el `sequence_order` usando una consulta agregada `select(func.max(LearningPathItem.sequence_order))` sobre la ruta objetivo para colocarlo al final del trayecto.

### 12. Settings Singleton Testing & Service Hot-Reload
* **Description:** Modifying class-level global singletons (like Pydantic `BaseSettings` settings) inside tests causes changes to leak into subsequent tests, resulting in unexpected failures. In addition, changing parameters like AI providers requires re-initializing services in-memory to take effect immediately without restarting the application.
* **Actionable Rule:**
  - Wrap any unit/integration tests that call settings-modifying functions (e.g. `save_settings_direct`) in a `try...finally` block. Capture the original settings singleton attributes at the start, and restore them in the `finally` block to prevent settings pollution.
  - To apply settings changes to active stateful classes (like `LLMService` or `EmbeddingService`) in real-time, reset their initialization flags (e.g. `LLMService._initialized = False`) and call their initialization helper (`LLMService.initialize()`) to recreate the LangChain/API clients dynamically.

### 13. Settings Singleton Isolation in Unit Tests & Wording Alignment
* **Description:** Configuration classes (like `DomestiKSettings` inheriting from Pydantic's `BaseSettings`) load environment variables and local `.env` files automatically upon instantiation. Testing their default attributes using a shared global singleton can lead to unexpected test failures when run in developer environments with custom configurations (e.g. customized ports).
* **Actionable Rule:**
  - In unit tests validating default setting fallbacks, always instantiate a fresh configuration object passing `_env_file=None` (e.g. `s = DomestiKSettings(_env_file=None)`) rather than importing the global pre-instantiated singleton.
  - To maintain UI consistency and align with user-defined terms, keep visual wording (such as selecting options by "Agrupación" or displaying "Sin Agrupación Asignada") decoupled from internal technical/database terms (such as "Ruta de Aprendizaje").

### 14. File Upload Security — Path Traversal & Size Limits
* **Description:** When accepting file uploads via `UploadFile` (especially with `webkitdirectory` browser picks), the `filename` field can contain `..` path components. The `lstrip("/")` approach is insufficient — `../../etc/passwd` passes through. Additionally, without size limits, users can exhaust server disk.
* **Critical Distinction — Upload vs Import endpoints:**
  - **Upload endpoint (`/import-from-upload`)**: Files are ALWAYS copied to the server staging directory. Apply size limits and type validation here.
  - **Import endpoint (`/content/import`)**: When using `symlink` or `reference` storage strategies, files stay in their original location (e.g., external USB drive) — only a link/reference is created. Do NOT apply size limits in these modes. Limits only apply when `storage_strategy="copy"`.
* **Actionable Rules:**
  - **Always sanitize path components:** Use `PurePosixPath(filename).parts` and filter out `..`, `.`, and `""` components. Then verify the resolved destination is still within the intended staging directory using `dest.resolve().is_relative_to(upload_dir.resolve())`.
  - **Size limits only for copy mode:** Enforce file size limits on endpoints that copy files to server storage. Skip limits for symlink/reference modes where files remain in place.
  - **Always validate file types:** Maintain a whitelist of allowed extensions (e.g., `{".pdf", ".epub", ".mp4", ".mp3"}`) and reject uploads with disallowed extensions before writing to disk.
  - **Clean up staging dirs on success:** The `shutil.rmtree` cleanup must run on ALL code paths (success + error), not just error paths. Use `try/finally` or move cleanup after the import logic completes.

### 15. NiceGUI `toggle_*` Pattern — Use Simple `if/else`, Not Ternary
* **Description:** The `toggle_cover_input()` pattern using ternary expressions (`remove='hidden' if h else 'hidden'`) is error-prone because both branches can evaluate to the same value. The correct pattern uses simple `if/else` blocks.
* **Actionable Rule:** Always use the explicit `if/else` pattern for toggling CSS classes in NiceGUI:
  ```python
  def toggle_something():
      is_hidden = 'hidden' in self.element.classes
      if is_hidden:
          self.element.classes(remove='hidden')
      else:
          self.element.classes(add='hidden')
  ```
  Reference implementation: `frontend/app/components/edit_resource_dialog.py` lines 101-106.

### 16. Double-Submit Guards in Async Dialog Actions
* **Description:** NiceGUI dialogs with async submit handlers are vulnerable to double-submit race conditions. Between the click and the `loading` prop taking effect on the client, a second click can arrive. For upload operations, this causes duplicate server-side resource creation.
* **Actionable Rule:** Always add an `is_importing` (or equivalent flag) guard at the very top of async action handlers, BEFORE any validation:
  ```python
  async def _do_import(self):
      if self.is_importing:
          return
      # ... rest of logic
  ```

### 17. Upload Mode — Don't Show Controls That Are Ignored
* **Description:** When a dialog has multiple modes (e.g., "server folder" vs "native upload"), controls that only apply to one mode should be disabled or hidden in the other mode. Showing `storage_strategy` dropdown in upload mode where symlink/reference are meaningless creates misleading UX.
* **Actionable Rule:** When switching import modes, toggle visibility of mode-specific controls. For upload mode, either hide storage strategy / cover path controls, or forward their values to the backend.

### 18. Import Path Verification — Cross-Module References
* **Description:** When importing ORM model classes across modules, verify the actual module where the class is DEFINED, not where it is merely referenced via a string relationship. `Note` is defined in `backend.app.models.activity`, not `backend.app.models.resource` (which only has a string relationship reference).
* **Actionable Rule:** After any model restructuring, grep for all `import` statements referencing moved classes. Use IDE "Go to Definition" or grep to verify the correct import path.

### 19. Database Files Must Never Be Committed
* **Description:** SQLite database files (`*.db`, `*.db-shm`, `*.db-wal`) contain user data and should never be in version control. They were accidentally committed in a bulk file addition.
* **Actionable Rules:**
  - Add `*.db` and `*.db-*` (WAL/SHM) to `.gitignore` immediately.
  - If already committed: `git rm --cached backend/domestik.db domestik.db` then commit.
  - For new projects, always set up `.gitignore` BEFORE the first commit.

### 20. Inline JavaScript in NiceGUI — Maintenance Burden
* **Description:** Large inline JavaScript blocks (50+ lines) embedded as Python f-strings in NiceGUI are hard to maintain, lint, and debug. They lack syntax highlighting and f-string escaping (`{{`/`}}`) makes them error-prone.
* **Actionable Rule:** When inline JS exceeds ~20 lines, consider extracting it to a separate `.js` file and loading it via `ui.add_head_html('<script src="..."></script>')` or NiceGUI's `ui.add_static_file()`. This enables proper JS linting and debugging.

### 21. `httpx.stream()` vs `httpx.post()` — Use the Right Method
* **Description:** `client.stream()` is designed for streaming RESPONSE bodies (e.g., downloading files). For uploading data where the request body is fully materialized in memory, use `client.post()` instead. `stream()` adds overhead with no benefit when the request payload is already in memory.
* **Actionable Rule:** Use `client.post()` for upload operations. Reserve `client.stream()` for downloading large response bodies where you need progressive reading.

### 22. Performance Budget — 100ms Rule
* **Description:** Users perceive an interface as "instantaneous" if it responds in <100ms. Between 100-300ms it feels "fast". Above 300ms, slowness becomes noticeable. DomestiK targets <300ms for all page loads and <50ms for button feedback.
* **Actionable Rules:**
  - **Consolidate aggregate queries:** Replace multiple `COUNT(*)` queries with a single query using `CASE WHEN`. Example: 7 separate COUNTs → 1 query with conditional aggregation.
  - **Add pagination everywhere:** Never fetch unbounded result sets. Use `LIMIT`/`OFFSET` with a default page size (50 items).
  - **Fix N+1 patterns:** Use `selectinload()` or `joinedload()` for relationship access. Never access `obj.relationship.title` inside a loop without eager loading.
  - **Add SQLite indexes:** Index columns used in `WHERE`, `ORDER BY`, and `JOIN` clauses: `status`, `ended_at`, `created_at`, `is_completed`.
  - **Debounce user input:** Add 300ms debounce to search/filter inputs to avoid re-rendering on every keystroke.

### 23. SQLite Performance Pragmas
* **Description:** SQLite default settings are conservative. For a local-first app like DomestiK, we can safely tune pragmas for better performance.
* **Actionable Rules:**
  - `PRAGMA cache_size=-10000` (10MB cache, up from default 2MB) — reduces disk reads for large tables.
  - `PRAGMA journal_mode=WAL` — already set, enables concurrent reads during writes.
  - `PRAGMA synchronous=NORMAL` — already set, good tradeoff for WAL mode.
  - `PRAGMA temp_store=MEMORY` — store temp tables in memory instead of disk.
  - Add these in the `set_sqlite_pragma` event listener in `database.py`.

### 24. Frontend Font Loading Optimization
* **Description:** Google Fonts with many variants (16+) are render-blocking. Each variant is a separate HTTP request that delays First Contentful Paint.
* **Actionable Rules:**
  - Reduce to 4-6 font variants total (e.g., Regular + SemiBold for each of 2-3 families).
  - Add `&display=swap` to Google Fonts URLs for `font-display: swap`.
  - Add `<link rel="preconnect" href="https://fonts.googleapis.com">` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` before font links.
  - Consider self-hosting fonts for production to eliminate external CDN dependency.

### 25. N+1 Query Patterns in services_direct.py
* **Description:** The `services_direct.py` module calls backend functions directly. Some functions trigger lazy-loaded relationships inside loops, causing N+1 query patterns.
* **Key Offenders:**
  - `get_recent_activity_direct()`: Accesses `s.resource.title` per session → N+1.
  - `get_learning_paths_direct()`: Iterates `p.items` with lazy loading → N+1.
  - Scanner `scan()`: Queries `MediaAsset` per file in loop → N+1.
* **Actionable Rule:** Use `selectinload()` or `joinedload()` in queries that will access relationships. For `get_recent_activity_direct()`, add `.options(selectinload(LearningSession.resource))` to the query.

### 26. Video & Media Lazy Loading
* **Description:** Video elements with `preload="auto"` (browser default) download the entire video before playback. Cover images are loaded eagerly for all cards, even those off-screen.
* **Actionable Rules:**
  - Set `preload="metadata"` on `<video>` tags to load only duration/dimensions.
  - Add `loading="lazy"` to `<img>` tags for cover images.
  - Use `IntersectionObserver` for components that should only load when visible.
  - The `MutationObserver` in `media_viewer.py` observes `document.body` with `subtree: true` — this fires on every DOM mutation in the entire page. Scope it to the video container element instead.

### 28. Joined Table Inheritance — Never Mix Parent and Child in Single Aggregate Query
* **Description:** When using SQLAlchemy's Joined Table Inheritance (e.g., `Course` and `Book` inheriting from `LearningResource`), mixing the parent model and child models in a single `db.query()` aggregate call generates ambiguous SQL. SQLAlchemy produces a FROM clause with the parent table duplicated, causing `ambiguous column name` errors on the primary key column.
* **Critical Trap:** `db.query(func.count(LearningResource.id), func.count(Course.id), func.count(Book.id)).one()` generates:
  ```sql
  FROM learning_resource
    JOIN course ON learning_resource.id = course.id,
    learning_resource          -- DUPLICATED
    JOIN book ON learning_resource.id = book.id
  ```
  SQLite raises `ambiguous column name: learning_resource.id` because `learning_resource` appears twice in the FROM clause.
* **Actionable Rule:** Use **separate queries** for each table count when querying across Joined Table Inheritance hierarchies:
  ```python
  total = db.query(func.count(LearningResource.id)).scalar() or 0
  courses = db.query(func.count(Course.id)).scalar() or 0
  books = db.query(func.count(Book.id)).scalar() or 0
  ```
  Alternatively, use `scalar_subquery()` to isolate each count:
  ```python
  stats = db.query(
      select(func.count(LearningResource.id)).scalar_subquery().label('total'),
      select(func.count(Course.id)).scalar_subquery().label('courses'),
  ).one()
  ```
* **Reference:** `backend/app/api/dashboard.py` lines 23-29 (working pattern). `frontend/app/services_direct.py` lines 260-264 (fixed pattern).

### 27. CSS Deduplication in NiceGUI
* **Description:** `ui.add_head_html()` re-injects the full CSS block on every page navigation within the SPA, creating duplicate `<style>` tags.
* **Actionable Rule:** Check if a style tag with a unique ID already exists before injecting:
  ```python
  js = f"""
  if (!document.getElementById('domestik-theme')) {{
      var style = document.createElement('style');
      style.id = 'domestik-theme';
      style.textContent = {css_content};
      document.head.appendChild(style);
  }}
  """
  ui.run_javascript(js)
  ```
