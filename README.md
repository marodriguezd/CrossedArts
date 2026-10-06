# CrossedArts — Learning Operating System

**Live application:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md)

---

## What It Is

CrossedArts is a personal, local-first Learning Management System that runs entirely in the browser. It centralizes courses, books, notes, flashcards, and a knowledge graph — all stored in a local SQLite database with no required backend server.

The application is designed for learners who want full ownership of their study data without depending on cloud services or subscriptions.

## Capabilities

- **Courses & Lessons:** Hierarchical course structure with modules, lessons, and editable Markdown content
- **Books & Resources:** Library catalog with reading progress, imported documents (PDF, EPUB, TXT, MD), and resource organization
- **Study Sessions:** Unified flashcard review (SM-2), practice questions, and mixed modes with local progress tracking
- **Knowledge Graph:** Interactive 2D visualization of courses, books, lessons, notes, concepts, and their relationships
- **Local Media:** Video and audio playback from local folders via the File System Access API
- **Local Search:** Deterministic SQL-based search across all content, plus a global command palette (Ctrl+K)
- **Document Ingestion:** In-browser parsing of PDF, EPUB, TXT, and MD files with SHA-256 deduplication
- **AI Providers:** Local on-device inference (WebLLM/WebGPU), heuristic demo mode, Ollama, or OpenAI API
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
- Local embeddings via Transformers.js with `Xenova/multilingual-e5-small` (384 dimensions, ~135 MB)
- Hybrid retrieval combining lexical search and semantic embeddings
- Vectors cached in IndexedDB with SHA-256 content hashing and pipeline versioning (`v1.1-e5-sha256`)
- All embedding computation happens on-device

## Limitations

- **Browser support:** Chrome, Edge, or Brave required for local media features (File System Access API). Other browsers can use all non-media features.
- **Local AI hardware:** WebGPU-capable GPU recommended for local LLM inference. CPU fallback is available but slower.
- **First download:** Initial use of local AI requires downloading model weights (~135 MB for embeddings).
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

The test suite includes 424 tests across 30 test files covering SQLite initialization, SM-2 algorithm, study sessions, knowledge graph, RAG, document ingestion, and AI providers.

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
- `Xenova/multilingual-e5-small`: MIT
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0
- Transformers.js (`@huggingface/transformers`): Apache-2.0
- SQLite WASM (`sql.js`): MIT
