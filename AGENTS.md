# CrossedArts — Engineering Guide

## Architecture Boundaries

**Frontend (`frontend/`):** React 19 + TypeScript + Vite SPA. All learning functionality works without a backend. Deploys to GitHub Pages.

**Backend (`backend/`):** Optional Python FastAPI server for batch ingestion and advanced analysis. Not required for daily use.

**Data Flow & Storage Contract:**
- **Browser Canonical Source of Truth:** SQLite WASM running in the client memory is the single authoritative source of truth for all user entities (courses, books, lessons, flashcards, notes, concepts, relations, practice work, and learning goals).
- **IndexedDB (`CrossedArts_DB`):** Holds the binary serialized copy of the SQLite database using atomic Compare-And-Swap (CAS) multi-tab coordination.
- **IndexedDB (`CrossedArts_Embeddings`):** Dedicated vector storage cache for local client-side Transformers.js embeddings (`onnx-community/embeddinggemma-300m-ONNX`, Matryoshka 256d).
- **Local Media Access:** Accessed strictly on-demand via Chromium File System Access API. Media handles and `blob:` URLs are never persisted to SQLite.
- **Derived Data:** Learning goal progress, daily analytics streaks, and focus plans are strictly derived on read from relational data, never duplicated as independent state.
- **Semantic Indexing:** Refreshed incrementally in the browser. In-flight content edits flag a dirty state that triggers a deterministic, coalesced follow-up pass without blocking UI reads.
- **Optional Backend (`backend/`):** Optional helper for offline heavy ingestion (batch scanner/metadata extraction) and server-side LLM orchestration. The backend MUST NEVER silently become the source of truth for user learning state, learner progress, or notes.
- **Playback telemetry is not learning state:** `POST /media/{id}/progress` writes the resume position, the duration and its own `is_watched` flag. It never completes a lesson nor moves course progress: a `Range`-heavy stream or a re-requested mark would otherwise complete a lesson nobody watched (RFC 9110 safe-method semantics; completion is a client fact).
- **Legacy Compatibility:** All backward compatibility translations (for legacy DomestiK settings, database files, and directory paths) are strictly isolated in `backend/app/core/compatibility.py`. New features never reference legacy namespaces. The legacy `DomestiKSettings` alias lives there too (module `__getattr__`, lazy import), never in `core/settings.py`.

## Invariants

### 1. Client-Side & Zero-Web-Access Default
- The frontend must function without network access for all core learning features
- `sql-wasm.wasm` must reside in `frontend/public/` — never load from CDN
- No external scripts or fonts in `frontend/index.html`

### 2. SQLite Bridge Concurrency
- `dbBridge.init()` must share a single promise between all callers
- Terminal states: `idle` / `initializing` / `ready` / `failed`
- `useAppData()` exposes `initError`; `App.tsx` stops mounting on failure
- Lazy views must call `dbBridge.ensureInitialized()` before reading
- All data modifications must call `await dbBridge.persist()`
- Persistence uses CAS: `saveToStorageWithCas()` compares the persisted coordinator revision and rejects `StaleWriteError` when another tab wrote first; `persist()` surfaces this as state `stale-other-tab`

### 3. Schema Migrations
- New tables/columns require updates to: `schema.ts`, `exportImport.ts` (`getDatabaseTables()`), and `seedDemo.ts`
- Migrations must be idempotent
- A migration must land on the SAME schema `create_all()` produces, including column nullability:
  `test_fresh_create_all_and_migrated_schema_agree` compares columns, foreign keys (with `ON DELETE`),
  CHECKs and indexes table by table. It caught `note.created_at`/`updated_at` being nullable only on
  migrated installs (fixed by `e3f4a5b6c7d8`).

### 3b. Domain Contracts Shared With The Backend
- Session scope (`learning_session.scope`): `lesson`, `resource` or `global`. Global review is an explicit first-class scope, NOT a session without scope. Rule lives in `services/sessionScope.ts` (frontend) and `resolve_session_scope` (backend); both derive the scope from the anchors and validate declared scopes.
- Session-scope case table: `shared/session-scope-cases.json` (root `shared/`, not under `frontend/` or `backend/`) holds the derivation, effective-scope and validation rows. Both suites read it, so parity is verified, not assumed.
- Declared vs effective scope: the stored `scope` is HISTORY and is never rewritten when an anchor disappears. `resolveEffectiveStudySessionScope` / `resolve_effective_session_scope` derive the effective value on read (`resource` with no resource reports `global`). Write paths (`validateStudySessionScope`, `StartSessionRequest`, the model's `before_insert`/`before_update`) reject a declared scope that is incoherent with its anchors.
- Session history survives deletion: both `learning_session` anchors are nullable and unlink with `ON DELETE SET NULL`, in the browser schema and in the backend (model + Alembic). Never re-add an FK `CASCADE` or an ORM `delete-orphan` there.
- Notes: `note.resource_id` is NULLABLE. A standalone note is valid; deleting a resource/lesson unlinks (`ON DELETE SET NULL`) and never destroys user work. No placeholder resources are ever created.
- `note.title` is contract, not decoration: NOT NULL in the canonical schema and derived from the first non-empty line of the content (255 max, neutral fallback «Nota»). ONE implementation lives in `models/activity.py` (`derive_note_title`) and the model applies it on insert/update (`_derive_note_title_on_write`), so a row built directly obeys the rule too; `services/note.py` re-exports that same function. Mirrors kept in sync: `deriveNoteTitle` in `db/dao/notes.ts` and the backfill in migration `d2e3f4a5b6c7`. A partial update cannot blank it. Changing the rule means changing every mirror.
- Recent activity is honest: `RecentActivityItem.resource_id` is a REAL resource id or `None` — never the session's own id and never an invented `resource_type` (`lesson`/`global`/`standalone` are not resource types). Every item carries its own `title`; `scope` is emitted only on session items.

### 4. SM-2 Algorithm
- Ease Factor never below 1.30
- Grades < 3: reset `repetition_count = 0`, `interval_days = 1`
- Grades 3–5: calculate interval using Ease Factor

### 5. File System Access API
- Always check `'showDirectoryPicker' in window` before use
- Wrap in try/catch; ignore `AbortError` silently
- Never persist `blob:` URLs or `FileSystemHandle`s in SQLite
- Revoke URLs on lesson change or view exit

### 6. UI Language & Theming
- All UI text in Spanish, and NO UI copy lives in components: it belongs to `src/i18n/locales/*`
  (six languages, `LocaleKey` derived from `en`) and is resolved through `translateKey`/`useLanguage` —
  including attributes (`aria-label`, `title`, `placeholder`). `i18n_literal_guard.test.ts` is a per-file
  RATCHET: new files must have zero Spanish literals and migrated copy lowers the budget, never raises it
- Use semantic CSS tokens (`--c-canvas`, `--c-ink`, `--c-accent`) — no literal color palettes in JSX
- Theme: light (cream) default, dark (charcoal) alternative, persisted in `localStorage`

### 7. Data Backup Safety
- JSON backup import must pass `validateJsonBackup()` before any `DELETE`
- API keys in memory only; `localStorage` only with explicit user opt-in

### 8. Git Hygiene
- Never commit agent logs, temporary files, or artifacts (`.omg`, `.agents`, `.opencode`, `PLAN.md`)
- `.gitignore` must cover `node_modules/`, `.venv/`, `*.db`, `*.sqlite`, `__pycache__/`

## Commands

### Frontend

```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Start dev server (Vite)
npm test             # Run test suite (907 tests, 89 files)
npm run typecheck    # TypeScript type checking
npm run build        # Production build (outputs to dist/)
```

### Visual / responsive QA (optional, Playwright)

```bash
cd frontend
npx playwright install chromium          # once per machine
npm run build
npm run preview:qa                            # in one terminal (127.0.0.1:4173, strict)
QA_URL=http://localhost:4173 npm run qa:visual # in another
npm run qa:embeddings                         # opt-in: real model download + inference
```

`frontend/scripts/visual-qa.mjs` walks the real views (Panel, Hoy, Metas,
Análisis, Biblioteca, detalle de recurso, espacio de trabajo práctico, Grafo,
estadística del grafo) at desktop/tablet/mobile, asserting page-level horizontal
overflow, console/page errors and the presence of each view's key headings. It
also smoke-tests the local ONNX runtime in a real browser (`ort/` artifacts
served as JS modules, glue evaluated and the WASM instance created both on the
page and in a module worker — the realm `wasm.proxy` boots), fails on any
request to a foreign origin, and exits 2 with an explicit message when the
preview server is unreachable. It exits non-zero on any failure. Screenshots go
to `/tmp/crossedarts-qa` and must never be committed.

`frontend/scripts/embedding-qa.mjs` (`npm run qa:embeddings`) is a separate
OPT-IN smoke test, never part of CI: it serves `dist/` itself, downloads the real
embedding model (~280 MB from the Hub), indexes the demo library through
Settings → «Reindexar contenido», and verifies what a static build cannot — the
vectors land in `CrossedArts_Embeddings` with the effective MRL dimension, unit
L2 norm and provenance, they survive a reload, and the main thread stays
responsive while indexing (heartbeat per phase, the evidence that `wasm.proxy`
runs inference off the page). It also asks the tutor a paraphrased question (no
shared words with the corpus) and asserts the correct fragment appears as the
FIRST citation with a hybrid/semantic retrieval mode. Budget ~5 minutes and
network access; a clean run prints a per-phase report.

### Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
python -m backend.app.main
```

### Testing

```bash
# Frontend
cd frontend && npm test

# Backend
PYTHONPATH=. pytest backend/tests -q
```

## Testing Expectations

The frontend test suite (907 tests, 89 files) validates:
- SQLite WASM initialization without network access
- SM-2 algorithm accuracy
- Study session lifecycle and persistence
- Knowledge graph integrity and migrations
- Resource organization and detail views
- Lesson-scoped study with note isolation
- Relational integrity (foreign keys, ON DELETE behavior)
- Binary/JSON export and import
- Local AI providers and hybrid RAG (including citation provenance)
- Document ingestion (PDF, EPUB, TXT, MD) and memory limits
- Grounded study generation
- Service Worker cache boundaries and dynamic route exclusions
- Multi-tab coordination via BroadcastChannel
- Local calendar day streak logic
- Learning goals: validation, progress derivation, deadline classification, persistence
- Analytics: range windows, accuracy, per-resource activity, daily series, streak
- Focus plan determinism and prioritisation
- Practice workspace: checklist parsing/serialisation and draft validation
- Graph structural analytics: components, degree, mean+2σ thresholds, insights
- Search and command palette integration for goals
- RAG provenance gate: citations describe EXACTLY the visible context
- RAG query tokenization: Spanish function words never become lexical candidates
  (`tokenizeQuery` = closed-class filter for retrieval, `tokenizeLexical` unchanged for
  grounding) and surviving content terms are weighted by BM25 IDF over the retrieval's own
  document collection (`computeLexicalIdf`), so rarity ranks hits instead of a raw count
- Semantic corpus: KnowledgeDocument boundary + incremental content manifest
- Bounded semantic chunking: fragment boundaries are measured relative to the chunk's
  start, so no document collapses into hundreds of degenerate fragments
- Embedding engine lifecycle: a WebGPU→CPU fallback that resolves after `unload()` or a
  newer `loadModel()` is discarded instead of hijacking the active pipeline, and a failed load
  leaves NO model announced (`getLoadedModelId()` is null, never a phantom the cache would key on)
- Embedding cache handle: it yields on `versionchange`, so another tab's `deleteDatabase` or
  `IDB_VERSION` bump is never blocked forever by our memoized connection
- Streaming rewrites: `onChunk` stays append-only, a rewritten tail travels as a replacement
  event, a deltas-only consumer keeps the previous fallback, and the end-to-end path
  (service → provider → engine) forwards the event to the consumer
- UI ARIA resolution: every `aria-controls`/`aria-labelledby`/`aria-describedby` reference in
  `components/` and `pages/` resolves to an id declared in the same file (checked over the sources),
  and `SectionHeading` puts that id in the RENDERED `<h2>` (checked with `renderToStaticMarkup`;
  `ui/primitives.ts` exists so the test runner can import it, since it cannot load `.tsx`)
- Overlay coordination: `services/overlayStack.ts` orders open overlays by open time, keeps several
  live instances of the same type, and makes only the top one answer `Escape`
- Local clock presentation: `localDate.formatLocalClockTime` fixes 24 h `HH:MM:SS` (never the
  browser's locale, never `24:00:00` from `hour12: false`)
- Session scope contract (lesson / resource / global) on SQLite, including the declared-vs-effective split after
  `ON DELETE SET NULL` and the fact that the anchor-requiring CHECK is gone
- Session history survives the deletion of its resource or lesson, on both sides: the browser bridge rebuilds an
  existing database that still carries the retired CHECK exactly once (the migrated DDL converges with a fresh
  one) and the backend keeps every row through `upgrade`, `downgrade` and a second `upgrade`
- Note title/tags contract: derived title on create, no blanking on partial update, and the four places that
  implement the rule (backend service, browser DAO, migration backfill, schema) agree
- Recent activity honesty: real resource id or `None`, no invented `resource_type`, own `title` per entry,
  `scope` only on sessions (typed as a `Literal` domain), and a finalized session without an end stamp is
  skipped instead of breaking the feed
- Error-code contract: every domain failure carries its own `code`/`http_status` (`core/errors.py`
  `DomainError`, subclasses per failure mode) and the router only forwards it; a missing lesson is
  `LESSON_NOT_FOUND`, a parse failure is `NOTE_PARSE_ERROR` 422, and an unclassified failure stays a 500
- Note-title rule holds for every construction path: the model derives it on write, not only `NoteService`
- Semantic manifest lifecycle: the purge of a fragment that left the corpus is PERSISTED (a key deleted only in
  memory came back on every boot and was purged again, so the manifest never shrank), and loading is per
  identity `(modelId, pipelineVersion)` — a single "loaded" flag skipped a second model's stored hashes and
  recomputed all of them
- UI copy stays in the dictionaries: view copy, ARIA labels, titles and placeholders resolve through
  `translateKey`/`useLanguage`, and the i18n guard caps the remaining Spanish literals per file
- Orphan vectors: vectors of deleted material are freed by ONE reconcile (`pruneChunksNotIn`) against the
  live corpus at indexing time, not by a hook on each delete path — a new delete path cannot leak them
- Retrieval bookkeeping is honest: `fuseResults` derives `retrievalMode` from which channels actually found
  the document (never from the score), `maxTotalResults` is an exact cap checked before appending, and
  `trimChatHistory` preserves the transcript order instead of hoisting `system` turns to the front
- Session-scope parity: `shared/session-scope-cases.json` is the ONE case table, read by
  `frontend/tests/session_scope_parity.test.ts` and `backend/tests/test_session_scope_parity.py`. A new case
  belongs in the fixture, so the two implementations cannot drift apart silently
- Local LLM runtime contract: single `generate()` API, delta-only streaming plus an explicit
  replacement event (`onReplace`) that retracts already-streamed text when a WASM backend rewrites it
- Task-aware, deterministic local model selection
- DAO modularisation: façade + domain modules, single row mapper

## CI & Deployment Workflows

- **PR Validation (`.github/workflows/ci.yml`)**: Runs on pull requests to `main` and manual triggers. Executes complete frontend checks (typecheck, tests, build) and backend checks (pinned dependencies, Ruff, Mypy, Pytest) with a consolidated quality gate.
- **Main Deployment (`.github/workflows/deploy.yml`)**: Runs on pushes to `main` and manual triggers. Strictly gates deployment to GitHub Pages on passing complete backend quality checks (Ruff, Mypy, Pytest) and frontend quality checks (typecheck, tests, build).
- **Visual QA (`.github/workflows/visual-qa.yml`)**: PR and manual-only workflow running automated responsive Playwright visual regression checks across desktop, tablet, and mobile viewports.

## Safety Constraints

**Never modify:**
- `frontend/public/sql-wasm.wasm` (critical binary)
- `frontend/vite.config.ts` `base` setting (must remain `'./'`)
- `frontend/src/db/schema.ts` without updating all migration paths
- `frontend/src/index.css` semantic tokens without updating `tailwind.config.js`

**Always preserve:**
- Spanish UI language
- Semantic color tokens (no literal `slate-*`, `purple-*`, `indigo-*` in JSX)
- Offline capability for core features
- Data export/import functionality

## Common Pitfalls

1. **Vite base path:** Must remain `'./'` for GitHub Pages. Changing to `/` breaks asset loading.

2. **Node.js imports in browser:** `node:fs` and `node:path` in `sqliteBridge.ts` are for test environment only, protected by `typeof window === 'undefined'`.

3. **SQLite foreign keys:** `db.export()` resets `PRAGMA foreign_keys`. Re-assert after each persist.

4. **Ollama CORS:** Browser calls to `localhost:11434` require the app's own origin to be allowed via `OLLAMA_ORIGINS`. Prefer the exact origin (e.g. `OLLAMA_ORIGINS=http://localhost:5173`) over `"*"`, which exposes the local Ollama server to any page in the browser.

5. **WASM filename:** Vite resolves `sql.js` browser build which expects `sql-wasm-browser.wasm`. The project deploys `sql-wasm.wasm` (identical binary). `locateFile` must normalize the name and resolve against `document.baseURI`.

6. **Command palette vs single-key shortcuts:** Handlers in `LessonWorkspace.tsx` and `ReviewCenter.tsx` compare `e.key` without checking modifiers. Any global shortcut handler must include `if (e.ctrlKey || e.metaKey || e.altKey) return;`.

7. **Overlay z-index:** Command palette `z-[70]`, page modals (Library, KnowledgeGraph, study modals) `z-50`, ConfirmDialog `z-[60]`, AIAssistantDrawer `z-[45]`. The drawer is the only NON-modal surface, so it lives BELOW any page modal: at the same layer its opaque panel covered the right-hand action buttons of the dialogs (`justify-end` footers) at viewports ≤1024 px. Overlays are mutually exclusive and coordinate through `services/overlayStack.ts`: an overlay registers on open and only the one on TOP reacts to `Escape`, so a keypress meant for a dialog never closes the drawer (and its conversation) underneath.

8. **Color literal false positives:** `translate-y-` and `-translate-x-` contain substring `slate-`. Use `/\bslate-\d/` to check for actual literal palette colors.

9. **Unicode normalization:** `normalizeWithMap(text)` returns `{ normalized, origin }` to map normalized indices back to original text. Never use `indexOf` on normalized text for highlighting.

10. **ARIA testing:** `readFileSync(...).includes('aria-controls')` only checks the string exists, not that the ARIA is valid. Test rendered output, not source code.

11. **vis-network must stay on the `esnext` build:** `KnowledgeGraph.tsx` imports from `vis-network/esnext` and `vis-data/esnext` on purpose. The `peer`/`umd` builds bundle a core-js `Set` whose instances expose no `Symbol.iterator`, which makes vis-network's transpiled private-field getters throw `... is not a function or its return value is not iterable` inside `new Network()`. The `esnext` builds use native `#private` fields, need no polyfills and shrink the graph chunk. Do not "tidy" these imports back to `vis-network`.

12. **Text-transform and assertion strings:** `innerText` returns rendered text, so anything styled with `type-micro` (uppercase) reads as `MÁS CONECTADOS`. Compare UI strings case-insensitively when asserting on rendered output.

13. **Lexical ranking: frequency weighting cannot replace the function-word filter.** BM25 IDF alone was measured on the demo library: `df` comes from the retrieval's own documents, so a grammatical word that happens to appear once (`sin`, df=1 of 45) weighs the maximum and makes an unrelated card the 3rd citation, while `una`/`como` still let a React lesson take 2nd place. `tokenizeQuery` decides WHAT is a candidate (closed class, Spanish); `computeLexicalIdf` decides how much each surviving content term weighs. Removing either half reopens the noise. Fusion compounds it: any lexical candidate gets most of its score from the normalized RRF term, so mere presence in the channel outranks a better-quality hit.

14. **Chunk boundaries are offsets, not absolute positions.** `splitAtBoundary` receives the chunk's `cursor` and measures every candidate cut *inside* the window that starts there. Comparing the absolute index of a line break against half the absolute limit held trivially from the second fragment on, and the cut landed on the very break the overlap had just re-read: a 2.4 KB note of ~590-character paragraphs became 211 fragments of 11–80 characters (one vector and one citation each). Any change to the boundary rules keeps that relative measurement.

15. **pytest's `-q` hides its own summary.** `pyproject.toml` sets `addopts = "--tb=short -q"`, and with `-q` pytest prints no `383 passed` line at all: `| tail -5` shows progress dots and reads like a run that reported nothing. Read the result with `-o addopts="" --tb=no` and keep the exit status (`pipefail` or `PIPESTATUS`). The shell also exports `PORT=0`, so pytest needs `env -u PORT`. Baseline at this commit: 444 backend tests, 907 frontend tests in 89 files.

19. **An error code is part of the error, never guessed from its message.** `get_http_exception(code, message, status_code)` takes the code the failure actually deserves, and the services carry it on the exception (`DomainError` in `core/errors.py`, subclassed as `NoteError` / `SessionError` / `ProgressError`). The blanket `except ValueError` it replaced told clients that a missing LESSON was `RESOURCE_NOT_FOUND`, and that a failed relation parse was a 404 on a note that existed; `POST /notes` with a bad anchor answered 400, which is the same lie in status form. A new failure mode gets its own exception class with its code and status, and an unclassified failure stays a 500 instead of being dressed as "not found".

16. **Never re-add the anchor CHECK on `learning_session`.** `CHECK (scope <> 'resource' OR resource_id IS NOT NULL)` looks like a harmless integrity rule and is a data-loss bug: SQLite evaluates CHECK constraints on the internal UPDATE performed by `ON DELETE SET NULL`, so deleting a resource with a resource-scoped session fails with `CHECK constraint failed` — the material cannot be deleted and the history is not unlinked either. It is absent from `buildLearningSessionTableSql` (browser) and from the backend model/migration on purpose. Coherence of a DECLARED scope is validated on write and the EFFECTIVE scope is derived on read.

17. **`learning_session` has two states that look contradictory and are not.** `finalized` is the formal close marker while `ended_at` is nullable and also written by the heartbeat. Any reader that presents "closed" activity filters on `finalized` AND `ended_at IS NOT NULL`; filtering on `finalized` alone turns one legal legacy row into a 500 for the whole dashboard (`RecentActivityItem.timestamp` is required).

18. **One table definition per migration target.** `buildLearningSessionTableSql(tableName)` in `db/schema.ts` is the single source for `SCHEMA_SQL` and for the existing-database rebuild in `sqliteBridge.ts`, and the detector normalizes whitespace before comparing DDL. When the two copies were written separately, reformatting one made `hasSessionScopeChecks` return false forever and the table was rebuilt (and persisted) on every boot. Same shape as `buildPracticeWorkTableSql`.

## File Map

```
CrossedArts/
├── frontend/
│   ├── public/sql-wasm.wasm          # SQLite WASM binary (critical)
│   ├── src/
│   │   ├── ai/aiService.ts           # AI provider orchestration
│   │   ├── components/
│   │   │   ├── common/               # ConfirmDialog, CommandPalette.ts, ThemeToggle
│   │   │   ├── lesson/LessonWorkspace.tsx
│   │   │   ├── ai/                   # AIAssistantDrawer, MarkdownMessage.ts
│   │   │   ├── practice/PracticeWorkPanel.tsx  # Practice workspace
│   │   │   ├── ui/                   # Shared primitives (Button, Badge, Panel)
│   │   │   └── layout/Shell.tsx      # App shell
│   │   ├── db/
│   │   │   ├── dao.ts                # Fachada del acceso a datos local
│   │   │   ├── dao/                  # Módulos por dominio (sessions, notes,
│   │   │   │                         #   practiceWork, goals) + sqlRows/queries
│   │   │   ├── schema.ts             # DDL (13 tablas)
│   │   │   ├── sqliteBridge.ts       # WASM + IndexedDB bridge
│   │   │   ├── exportImport.ts       # Binary/JSON backup
│   │   │   └── seedDemo.ts           # Demo data
│   │   ├── lib/
│   │   │   ├── localEmbeddings/      # Transformers.js embeddings
│   │   │   │                         #   + corpus.ts (frontera KnowledgeDocument)
│   │   │   │                         #   + contentManifest.ts (hashes incrementales)
│   │   │   ├── localLlm/             # WebLLM engine + runtime contract
│   │   │   └── localRag/             # Hybrid retrieval
│   │   ├── ai/
│   │   │   ├── aiService.ts          # Orquestación + barrera anti-alucinación
│   │   │   └── knowledge/            # KnowledgeDocument (frontera semántica)
│   │   ├── pages/                    # Dashboard, Library, ReviewCenter, FocusToday,
│   │   │                             # GoalsView, AnalyticsView, KnowledgeGraph, etc.
│   │   ├── services/
│   │   │   ├── sessionScope.ts       # Ámbitos de sesión (lesson/resource/global)
│   │   │   ├── studySession.ts       # Session state machine
│   │   │   ├── commandPalette.ts     # Ctrl+K palette logic
│   │   │   ├── goals.ts              # Goal validation, progress, deadlines
│   │   │   ├── analytics.ts          # Study/review analytics + streaks
│   │   │   ├── focus.ts              # Deterministic "what now" plan
│   │   │   ├── graphExploration.ts   # Graph filters + structural analytics
│   │   │   └── localMediaService.ts  # File System Access API
│   │   └── hooks/                    # useTheme, useCommandPaletteHotkey, useGoalProgress
│   ├── scripts/visual-qa.mjs         # Playwright visual/responsive QA (optional)
│   └── tests/                        # 89 test files, 907 tests
├── backend/
│   ├── alembic/                      # Database migrations
│   ├── app/
│   │   ├── api/                      # FastAPI routers
│   │   ├── core/                     # Config, database, security
│   │   ├── models/                   # SQLAlchemy ORM
│   │   ├── schemas/                  # Pydantic models
│   │   └── services/                 # Ingestion, embeddings, LLM
│   └── tests/                        # Backend test suite
└── .github/workflows/deploy.yml     # CI/CD pipeline
```
