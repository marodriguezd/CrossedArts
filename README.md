# CrossedArts — Learning Operating System

**Live application:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md)

---

## What It Is

CrossedArts is a personal, **local-first visual learning and knowledge platform** that runs entirely in the browser. It brings courses, books, imported documents, notes, concepts and the work you produce into one environment — all stored in a local SQLite database with no required backend server.

Everything is organised the way a learner actually studies: a **Dashboard** gallery of what you are learning, a **knowledge graph** of how those pieces relate, a **mountain** progress view of a learning context, and **practice work** that records what you produced. It is deliberately **domain-neutral**: it works the same for mathematics, music, programming or art.

The application is designed for learners who want full ownership of their study data without depending on cloud services or subscriptions.

## Capabilities

- **Dashboard gallery:** A curated, visual entry point to your learning — courses, books, imported documents and practice work, grouped by purpose (continue learning, imported resources, practice work)
- **Today / Focus:** A single, deterministic answer to "what should I do now?" — the next lesson, due reviews, pending practice work, unmet goals and recently studied resources, each with the reason it is listed
- **Courses & Lessons:** Hierarchical course structure with modules, lessons, and editable Markdown content
- **Books & Resources:** Library catalog with reading progress, imported documents (PDF, EPUB, TXT, MD), and resource organization
- **Study Sessions:** Unified flashcard review (SM-2), practice questions, and mixed modes with local progress tracking
- **Practice Work:** Exercises, projects, essays, drawings or code that you produce, linked to the resource, lesson or concept it demonstrates — in any discipline. Each item opens a **practice workspace** with Markdown content, a persisted checklist, a self-rating and the context it belongs to
- **Learning Goals:** Explicit, user-defined goals (course, book, practice, habit) with target dates; goal progress is derived from measured progress only, never invented
- **Analytics:** Daily study series, accuracy, per-resource activity, range comparison (7/30/90 days/all) and streak — computed from real study sessions and reviews
- **Knowledge Graph:** Interactive 2D visualization of courses, books, modules, lessons, notes, concepts, practice work and their relationships, plus **structural analytics** (degree, components, weakly connected and recently touched nodes) that describe topology and never rank importance
- **Mountain progress:** A journey indicator, global or scoped to a course, using real measured progress and real course modules as milestones
- **Course packages:** Export the *educational material* of a resource (syllabus and proposed work, never your progress or notes) as a portable JSON package to share and import additively
- **Local Media:** Video and audio playback from local folders via the File System Access API
- **Local Search:** Deterministic SQL-based search across all content, plus a global command palette (Ctrl+K)
- **Document Ingestion:** In-browser parsing of PDF, EPUB, TXT, and MD files with SHA-256 deduplication
- **AI Providers:** Local on-device inference (WebLLM/WebGPU), heuristic demo mode, Ollama, or OpenAI API. Answers carry **source citations** back to the exact resource, lesson or note they were grounded in, plus the provider and model that produced them
- **Backup & Export:** Binary SQLite export/import and JSON backup with schema validation
- **PWA:** Offline-capable app shell with service worker caching

## Local-First Model

CrossedArts uses a dual-storage architecture:

- **SQLite WASM** (`sql.js`): The canonical relational database running in the browser. Stores all learning data — courses, lessons, notes, flashcards, concepts, sessions, and resources.
- **IndexedDB**: Persistence layer that survives browser restarts. The SQLite database is serialized to IndexedDB on every mutation.

**What works without a backend:**
- All learning activities (courses, lessons, notes, flashcards, study sessions)
- Local media playback
- Document ingestion and search
- Knowledge graph visualization
- Backup and restore

**What requires network access:**
- Initial download of local AI models (WebLLM weights, embedding model)
- OpenAI API calls (opt-in)
- Ollama connection (opt-in, local server)

## AI & Search

CrossedArts supports four AI provider modes:

| Mode | Description | Network Required |
|------|-------------|-----------------|
| **Local (WebLLM)** | On-device inference via WebGPU. Models: Qwen3 1.7B (default), Llama 3.2 1B, SmolLM2 1.7B, Qwen3 0.6B | First download only |
| **Demo** | Heuristic responses based on local content. No AI model loaded | No |
| **Ollama** | Connects to a local Ollama server at `http://localhost:11434` | Local network |
| **OpenAI** | Uses OpenAI API with in-memory key storage | Yes |

**Embeddings & RAG:**
- Local embeddings via Transformers.js with `onnx-community/embeddinggemma-300m-ONNX` (768 native dimensions, stored as 256d via Matryoshka Representation Learning)
- Hybrid retrieval combining lexical search and semantic embeddings
- Vectors cached in IndexedDB with SHA-256 content hashing and pipeline versioning (`v2.0-embeddinggemma-mrl256-sha256`)
- All embedding computation happens on-device; the browser integration uses the verified ONNX EmbeddingGemma 300M export and currently prefers WASM for correctness

## Progress Semantics

CrossedArts tracks several different things that are all called "progress". They are never mixed silently: measured progress (completed lessons, pages read) is shown as a percentage; coarse status (`not started` / `in progress` / `completed`) is shown as a status and never as an invented percentage. Practice completion, concept mastery and study activity are separate concepts with their own meaning.

The full rules — including which artifact participates in the gallery, the graph, the mountain and course packages — are documented in [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Limitations

- **Not a full LMS:** CrossedArts has no classes, enrolment, grading, teacher accounts or remote classroom. Course packages are portable *educational material*, not a management system.
- **Browser support:** Chrome, Edge, or Brave required for local media features (File System Access API). Other browsers can use all non-media features.
- **Local AI hardware:** WebGPU-capable GPU recommended for local LLM inference. CPU fallback is available but slower.
- **First download:** Initial use of local AI requires downloading model weights; the embedding model is fetched on demand and cached by the browser.
- **Media backup:** Local media files are not included in SQLite backups. Only the database is backed up; media must be re-linked after restore.
- **No automatic sync:** Multi-device synchronization is not built-in. Export/import is the manual transfer mechanism.
- **Single-user:** No multi-user support or authentication.

## Quick Start

### Prerequisites

- Node.js v22 or higher (the test suite uses `--experimental-strip-types`)
- Chrome, Edge, or Brave browser

### Installation & Development

```bash
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Testing

```bash
cd frontend
npm test
```

The test suite includes 551 tests across 44 test files covering SQLite initialization, SM-2 algorithm, study sessions, knowledge graph (including structural analytics), RAG and citation provenance, document ingestion, AI providers, learning-artifact projection, mountain scoping, course-package conflicts, learning goals, analytics, focus planning, the practice workspace, WCAG theme contrast and disabled-state legibility.

#### Visual & responsive QA (optional)

The render layer is verified programmatically with Playwright against the production build — three viewports (desktop 1280×800, tablet 834×1112, mobile 390×844), checking horizontal overflow, console errors, expected headings per view, the command palette, the theme toggle and the practice workspace:

```bash
cd frontend
npx playwright install chromium   # once
npm run build
npm run preview -- --port 4173 --strictPort &
QA_URL=http://localhost:4173 npm run qa:visual
```

Screenshots are written to `/tmp/crossedarts-qa` (never committed). The runner exits non-zero if any objective check fails.

### Build

```bash
cd frontend
npm run build
```

Production assets are generated in `frontend/dist/`.

## Architecture

CrossedArts is a monorepo with two independent components:

- **`frontend/`**: React 19 + TypeScript + Vite single-page application. Deploys to GitHub Pages.
- **`backend/`**: Optional Python FastAPI server for batch ingestion and advanced analysis.

The frontend is fully functional without the backend. The backend provides additional services for heavy processing workflows.

## Backend Companion

The optional Python backend provides:

- Batch document ingestion (PDF, EPUB)
- Metadata extraction and thumbnail generation
- Sentence Transformers embeddings
- LangChain LLM workflows

Setup:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
python -m backend.app.main
```

The API server runs at `http://127.0.0.1:8080` with interactive documentation at `/docs`.

## Data Backup

Inside the Settings view:

- **Export SQLite:** Download a standard `.sqlite` database file
- **Import SQLite:** Restore from a previous `.sqlite` backup
- **Export JSON:** Generate a structured dump of all tables
- **Import JSON:** Restore from a JSON backup (validated before any changes)

## License

CrossedArts is licensed under [GPL-3.0-only](LICENSE).

Third-party dependencies retain their respective licenses:
- `onnx-community/embeddinggemma-300m-ONNX`: Gemma Terms of Use
- `Xenova/multilingual-e5-small`: MIT
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0
- Transformers.js (`@huggingface/transformers`): Apache-2.0
- SQLite WASM (`sql.js`): MIT
