# CrossedArts — Engineering Guide

## Architecture Boundaries

**Frontend (`frontend/`):** React 19 + TypeScript + Vite SPA. All learning functionality works without a backend. Deploys to GitHub Pages.

**Backend (`backend/`):** Optional Python FastAPI server for batch ingestion and advanced analysis. Not required for daily use.

**Data flow:**
- SQLite WASM is the canonical database
- IndexedDB persists the serialized SQLite database
- Embedding vectors stored separately in IndexedDB (`CrossedArts_Embeddings`)
- Local media accessed via File System Access API (not persisted in database)

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
- All UI text in Spanish
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
npm test             # Run test suite (424 tests, 30 files)
npm run typecheck    # TypeScript type checking
npm run build        # Production build (outputs to dist/)
```

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

The frontend test suite (424 tests, 30 files) validates:
- SQLite WASM initialization without network access
- SM-2 algorithm accuracy
- Study session lifecycle and persistence
- Knowledge graph integrity and migrations
- Resource organization and detail views
- Lesson-scoped study with note isolation
- Relational integrity (foreign keys, ON DELETE behavior)
- Binary/JSON export and import
- Local AI providers and hybrid RAG
- Document ingestion (PDF, EPUB, TXT, MD)
- Grounded study generation
- Multi-tab coordination via BroadcastChannel
- Local calendar day streak logic

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

4. **Ollama CORS:** Browser calls to `localhost:11434` require `OLLAMA_ORIGINS="*"` environment variable.

5. **WASM filename:** Vite resolves `sql.js` browser build which expects `sql-wasm-browser.wasm`. The project deploys `sql-wasm.wasm` (identical binary). `locateFile` must normalize the name and resolve against `document.baseURI`.

6. **Command palette vs single-key shortcuts:** Handlers in `LessonWorkspace.tsx` and `ReviewCenter.tsx` compare `e.key` without checking modifiers. Any global shortcut handler must include `if (e.ctrlKey || e.metaKey || e.altKey) return;`.

7. **Overlay z-index:** Command palette `z-[70]`, AIAssistantDrawer `z-50`, ConfirmDialog `z-[60]`. Overlays are mutually exclusive.

8. **Color literal false positives:** `translate-y-` and `-translate-x-` contain substring `slate-`. Use `/\bslate-\d/` to check for actual literal palette colors.

9. **Unicode normalization:** `normalizeWithMap(text)` returns `{ normalized, origin }` to map normalized indices back to original text. Never use `indexOf` on normalized text for highlighting.

10. **ARIA testing:** `readFileSync(...).includes('aria-controls')` only checks the string exists, not that the ARIA is valid. Test rendered output, not source code.

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
│   │   │   ├── ui/                   # Shared primitives (Button, Badge, Panel)
│   │   │   └── layout/Shell.tsx      # App shell
│   │   ├── db/
│   │   │   ├── dao.ts                # Data access with SM-2
│   │   │   ├── schema.ts             # DDL (11 tables)
│   │   │   ├── sqliteBridge.ts       # WASM + IndexedDB bridge
│   │   │   ├── exportImport.ts       # Binary/JSON backup
│   │   │   └── seedDemo.ts           # Demo data
│   │   ├── lib/
│   │   │   ├── localEmbeddings/      # Transformers.js embeddings
│   │   │   ├── localLlm/             # WebLLM engine
│   │   │   └── localRag/             # Hybrid retrieval
│   │   ├── pages/                    # Dashboard, Library, ReviewCenter, etc.
│   │   ├── services/
│   │   │   ├── studySession.ts       # Session state machine
│   │   │   ├── commandPalette.ts     # Ctrl+K palette logic
│   │   │   └── localMediaService.ts  # File System Access API
│   │   └── hooks/                    # useTheme, useCommandPaletteHotkey
│   └── tests/                        # 30 test files, 424 tests
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
