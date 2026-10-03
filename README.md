# 🏛️ CrossedArts — Learning Operating System

<p align="center">
  <a href="https://marodriguezd.github.io/CrossedArts/">
    <img src="https://img.shields.io/badge/🚀%20Web%20App-Try%20on%20GitHub%20Pages-7c3aed?style=for-the-badge&logo=githubpages&logoColor=white" alt="Try on GitHub Pages" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-Vite%20%2B%20React%2019%20%2B%20TS-61dafb?style=flat&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Database-SQLite%20WASM%20%2B%20IndexedDB-003B57?style=flat&logo=sqlite&logoColor=white" alt="SQLite WASM" />
  <img src="https://img.shields.io/badge/Active%20Recall-SuperMemo--2%20(SM--2)-10b981" alt="SM-2 Algorithm" />
  <img src="https://img.shields.io/badge/Knowledge%20Graph-Vis.js%202D-818cf8" alt="Vis.js" />
  <img src="https://img.shields.io/badge/Backend%20Companion-FastAPI%20%2B%20SQLAlchemy-059669?style=flat&logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/License-GPL--3.0--only-blue.svg" alt="License: GPL-3.0-only" />
</p>

<p align="center">
  <b>🇬🇧 English</b> • <a href="README.es.md">🇪🇸 Versión en Español</a>
</p>

---

🌐 **Live Application:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

**CrossedArts** is a personal, modular, local-first **Learning Operating System (LMS)** designed with a **GitHub Pages First** architecture.

It centralizes structured multimedia courses, technical books, Markdown study notes, spaced repetition flashcards powered by the **SuperMemo-2 (SM-2)** algorithm, and an interactive 2D knowledge graph—running an entire relational SQLite database directly inside your web browser with zero mandatory backend servers or cloud subscriptions.

For an in-depth dive into the system's philosophy, cognitive science foundations, and architecture, explore [ABOUT.md](ABOUT.md).

---

## ✨ Key Features

### 1. 100% Client-Side Static Deployment & Offline PWA
- Runs entirely as a lightning-fast Single Page Application (SPA) without requiring containers or servers.
- **Offline PWA Shell:** Includes a Web App Manifest and Service Worker (`sw.js`) that caches application shell assets and SQLite WASM, enabling CrossedArts to launch offline after initial visit.
- Automated CI/CD deployment via GitHub Actions in `.github/workflows/deploy.yml`.
- Try it instantly without installing anything: [marodriguezd.github.io/CrossedArts](https://marodriguezd.github.io/CrossedArts/).

### 2. In-Browser SQLite Engine & User-Owned Storage
- Full SQLite engine compiled to WebAssembly (`sql.js`) executing in the browser.
- Transparent synchronization with `IndexedDB` (`CrossedArts_IDB`) with explicit storage states (`ready`, `persisting`, `persisted`, `corrupt-storage`, `storage-unavailable`).
- Full relational schema (`learning_resource`, `course`, `book`, `module`, `lesson`, `note`, `flashcard`, `concept`, `knowledge_connection`, `learning_session`).
- **Data Portability & Backup Boundaries:**
  - Export/Import portable `.crossedarts.sqlite` binary files with SQLite format 3 and schema validation.
  - Backup includes all courses, progress, books, notes, flashcards, and concepts.
  - Video and audio files remain user-owned files on local storage outside the SQLite database; restore preserves relative lesson mappings for effortless folder re-association.

### 3. Local Media Folder Integration (File System Access API)
- Implemented via the standard **File System Access API** (`window.showDirectoryPicker`) for Chromium-based browsers (Chrome, Edge, Brave).
- Scans selected local course folders recursively and deterministically matches video files to course lessons.
- Files remain strictly on your local disk; ephemeral `URL.createObjectURL()` streams are generated in-memory per lesson session and revoked on navigation without persisting temporary `blob:` URLs or raw handles into SQLite.
- Core seeded experience operates 100% offline without remote media dependencies.

### 4. Unified Local Study Sessions (Active Recall, Practice & Progress)
- **One coherent workflow:** Start a study session, review due flashcards, answer grounded practice questions, and finish with a local progress summary.
- **Study modes:** `flashcards` (SM-2 due cards), `practice` (session-local generated questions) and `mixed` (deterministic: due flashcards first, then practice).
- **Mathematical SuperMemo-2 (SM-2):** Reused as the single scheduling authority, calculating the Ease Factor (minimum 1.30), repetition streaks, and optimal review intervals based on the Hermann Ebbinghaus forgetting curve. The full 0–5 grade scale is exposed with the real calculated next interval.
- **Session lifecycle:** `idle → starting → active → paused → completed`, plus safe `cancelled`/`failed` behavior. Reviews are persisted per card, so an unexpected reload never loses them; a session is only reported as completed when persistence succeeds.
- **Local history:** Session facts (start/end, mode, cards reviewed, questions answered, correct answers, associated resource) are stored in the existing `learning_session` table. No second history or scheduling system is introduced.
- **Practice stays ephemeral:** Generated questions and prompts are never permanently stored; only aggregate counters become part of the local history.
- **Honest summary:** Flashcard grades are not reduced to right/wrong, questions report correctness normally, and no universal "knowledge score" is invented.

```text
Study Session
   ↓
Flashcards → existing SM-2 → learning history
   ↓
Practice Questions → session-local feedback
   ↓
Session Summary → local progress
```

### 5. Lesson Workspace (First-Class Learning Unit)
Each lesson is a complete local workspace where learning actually happens, built entirely on the existing relational model (no parallel content store).
- **Content:** Lessons have an editable plain-text / Markdown `content` field stored in the existing `lesson` table (migrated idempotently). It is rendered as data, never as arbitrary HTML.
- **Workspace panel:** Title, module/course context, completion state, duration, content, notes, related resources, local media, concepts and progress in one place (`components/lesson/LessonWorkspace.tsx`).
- **Ordering:** Deterministic `Move up` / `Move down` reorders lessons within a module, normalising positions to `1..N` with no duplicates and keeping course totals consistent.
- **Progress:** Deterministic `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED` based on own content, associated notes and explicit relations (plus the existing completion flag) — never an invented percentage.
- **Continue learning:** A deterministic continuation action selects the first incomplete lesson by module/lesson order (or the last lesson when the course is complete). No recommendation scores or adaptive learning.
- **Local study & AI:** Study, review, practice, explain and flashcard generation reuse the existing scoped retrieval and SM-2 flow, all scoped to the lesson.

### 6. Knowledge Graph 2.0 & First-Class Resource Organization
- **Canonical local graph:** The lazy-loaded `KnowledgeGraph.tsx` (powered by `vis-network`) renders typed nodes for `course`, `book`, `module`, `lesson`, `note`, `concept` and imported `resource` entities. Structural edges (`contains`, `about`, `references`) are derived deterministically from SQLite foreign keys; flashcards and study sessions are deliberately **not** turned into graph nodes.
- **Explicit, user-controlled relationships:** Manual connections are validated (supported relation type, existing endpoints, no self-links, no duplicates) and persisted in the existing `knowledge_connection` table. Dangling relationships are pruned without leaving orphans.
- **Filters, detail panel & navigation:** Filter nodes by category, select a node to inspect its type, metadata and relationships, and jump straight back to the underlying course, lesson, note or resource. A textual relationship list keeps the graph usable without relying on the canvas.
- **Resource organization:** Create courses/modules/lessons, edit book metadata, associate notes with resources/lessons, and detect "unorganized" imported documents to link them to a course later. Every orphan resource offers **Open / Organize / Study** actions.
- **Unified resource detail views:** Courses, books, lessons, notes, imported resources and concepts each open in a dedicated destination. `ResourceDetail.tsx` shows metadata, extracted content (rendered as data, never as arbitrary HTML), indexing status and a **Related** section built from canonical graph + relational data. Books keep their reading progress and metadata editing; imported resources expose filename, SHA-256 fingerprint and fragments.
- **Deterministic local search:** Find courses, books, lessons, notes, concepts and imported resources with plain SQL matching — no embeddings, WebGPU or LLM required — and open any result directly.
- **Lesson-level study scope:** Start a study session from a lesson to prioritise that lesson, its associated notes/resources and its direct neighbours. The scope is stored on the existing `learning_session` (`lesson_id`) so history identifies what was studied, and it flows through the same retrieval layer to grounded AI actions (explain, flashcards, practice).
- **Canonical relationships only:** Valid relationship types are centralised (`GRAPH_RELATION_TYPES`), connections are validated before persistence, dangling connections are excluded from rendering and pruned only by an explicit cleanup path. Relationships are local canonical data — no automatic semantic relationship discovery.
- **Accessible confirmations:** Destructive actions (course/module/lesson/relationship) use a reusable `ConfirmDialog` with explicit consequence text, Escape-to-cancel, focus management and screen-reader semantics.

```text
Course
   ↓
Module
   ↓
Lesson Workspace
   ├── Content
   ├── Notes
   ├── Resources
   ├── Media
   ├── Concepts
   ├── Progress
   └── Local Study
   ↓
SQLite canonical graph relationships
   ↓
Knowledge Graph UI
   ↓
Resource / Detail View
   ├── Related knowledge
   ├── Study (SM-2 + practice)
   ├── Local RAG
   └── Local AI
   ↓
study workflow
```

### 7. Local-Native AI & Pedagogical Tutor (WebLLM + Hybrid Local RAG)
- **Local-Native On-Device Inference (WebLLM / WebGPU):** Run open-source LLMs (default `Qwen3 1.7B`, or `Llama 3.2 1B`, `SmolLM2 1.7B`) 100% on-device directly inside the browser using WebGPU. No API keys or remote servers required.
- **Initial Download & IndexedDB Caching:** The initial model download requires network access (~1 GB). Once downloaded, model weights are persistently cached in the browser's IndexedDB and execute completely offline without network calls.
- **Hybrid Semantic Local RAG (Zero Remote Vector DB):**
  - **In-Browser Embeddings:** Generates on-device text vectors using Transformers.js with `Xenova/multilingual-e5-small` (based on `intfloat/multilingual-e5-small`, MIT license, ONNX quantized q8, 384 dimensions, 94 languages, ~135 MB).
  - **E5 Semantic Prefixes:** Explicitly applies `query: ` to search inputs and `passage: ` to indexed materials for optimal retrieval quality.
  - **Vector Isolation & Cryptographic Hashing:** Embeddings are cached in a dedicated IndexedDB store (`CrossedArts_Embeddings`) completely decoupled from the canonical SQLite database. Only modified learning materials are recomputed using authoritative SHA-256 content hashing (`crypto.subtle`) and pipeline versioning (`v1.1-e5-sha256`).
  - **Calibrated Scoring & Source Deduplication:** Employs calibrated candidate thresholds, Reciprocal Rank Fusion (RRF), and diversity-preserving source deduplication with instant fallback to pure lexical retrieval.
- **Hybrid Multi-Mode Options:** Choose between On-Device WebGPU (`local`), Offline Heuristic (`demo`), Local Ollama server (`http://localhost:11434`), or direct OpenAI API.

### 8. Local Document Ingestion & End-to-End RAG
- **Zero-Cloud Document Parsing:** Import `.txt`, `.md`, `.pdf`, and `.epub` documents directly in the browser with 0 external network requests or remote OCR.
- **First-Class Learning Resources:** Extracted content integrates into canonical SQLite `learning_resource` and `note` records with title, author, and exact page/chapter metadata.
- **Resource Destination & Association:** Choose to import as standalone knowledge, new library books, or link to existing courses/lessons.
- **Grounded Pedagogical Actions:** Use the on-device assistant to explain resources with verifiable citations, strictly refusing to fabricate answers when local context is insufficient.

```text
Local file (.txt, .md, .pdf, .epub)
   ↓
Browser parser (Web Cryptography SHA-256)
   ↓
CrossedArts learning resource (SQLite WASM)
   ↓
Deterministic chunks (with page & chapter)
   ↓
Hybrid RAG (lexical + local embeddings)
   ↓
Local WebLLM grounded response
```

### 9. Optional Python Backend Companion
- Auxiliary REST API server in `backend/` built with **FastAPI**, **SQLAlchemy 2.0**, and **Alembic**.
- Ideal for heavy batch ingestion (bulk PDF/EPUB extraction, video transcript processing) and semantic search with vector embeddings.

---

## 📁 Repository Map

```text
CrossedArts/
├── frontend/                     # Client-Side Web Application (React 19 + Vite)
│   ├── public/                   # WASM binary (sql-wasm.wasm) & favicon
│   ├── src/
│   │   ├── ai/                   # Hybrid AI tutor engine (aiService.ts)
│   │   ├── components/           # UI components (Navbar, AIAssistantDrawer, etc.)
│   │   ├── db/                   # SQLite WASM bridge, schema, DAO & backups
│   │   ├── lib/                  # Local LLM, embeddings, hybrid RAG & ingestion
│   │   ├── pages/                # Views: Dashboard, Library, ReviewCenter, Graph, etc.
│   │   └── types/                # TypeScript domain models (models.ts)
│   └── tests/                    # Zero-Web-Access test fleet (143 integrity tests)
├── backend/                      # Optional Python Backend Companion (FastAPI)
│   ├── alembic/                  # Relational database migration scripts
│   ├── app/
│   │   ├── api/                  # REST endpoints (/api/v1)
│   │   ├── core/                 # Config, settings, database, utilities
│   │   ├── models/               # SQLAlchemy ORM models
│   │   ├── schemas/              # Pydantic schemas
│   │   └── services/             # Ingestion, embeddings, LLM, scanner services
│   └── tests/                    # Backend unit & integration tests
├── static/                       # Covers & shared media assets
├── .github/workflows/deploy.yml  # Automated GitHub Pages CI/CD pipeline
├── ABOUT.md                      # Philosophy, architecture & manifesto
├── AGENTS.md                     # Technical reference guide for agents and devs
├── README.md                     # This English documentation
└── README.es.md                  # Spanish documentation
```

---

## 🚀 Quick Start: Web Application

### Prerequisites
- **Node.js:** v20 or higher
- **Modern Browser:** Chrome, Edge, Brave, or Firefox with WebAssembly support

### Local Development
```bash
# 1. Clone the repository
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend

# 2. Install dependencies
npm install

# 3. Start Vite development server
npm run dev
```

Open `http://localhost:5173` in your browser.

### Run Integrity Tests (Zero-Web-Access Test Fleet)
The project includes 143 tests verifying offline SQLite initialization, SM-2 math, unified study sessions, the lesson workspace (content editing, ordering, progress, continuation), knowledge graph integrity and migrations, resource organization and detail views, lesson-scoped study, accessible confirmations, binary/JSON exports, local AI, hybrid RAG, document ingestion, and grounded study generation:

```bash
cd frontend
npm test
# Or execute directly via Node test runner:
node --test --experimental-strip-types tests/*.test.ts
```

### Build & Local Production Preview
```bash
cd frontend
npm run build
npm run preview
```
Production assets are generated in `frontend/dist/`.

---

## 🌐 GitHub Pages Deployment

1. Fork or push this repository to your GitHub account.
2. Navigate to **Settings** > **Pages** in your GitHub repository.
3. Under **Build and deployment** > **Source**, select **GitHub Actions**.
4. Every push to the `main` branch will automatically build and publish the application to `https://<your-username>.github.io/<your-repo>/`.

---

## 🐍 Optional Backend Companion

To run the optional Python FastAPI server for batch ingestion and semantic embeddings:

```bash
# 1. Create and activate virtual environment at project root
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r backend/requirements.txt

# 3. Run database migrations
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head

# 4. Start the FastAPI server (serves the API and mounts frontend/dist if built)
python -m backend.app.main
```
The API server starts at `http://127.0.0.1:8080` (interactive documentation available at `/docs`).

---

## 💾 Data Backups & Digital Sovereignty

Inside the **Settings** view in CrossedArts, you retain total ownership of your data:
* **Export SQLite (.sqlite):** Download a standard SQLite database file openable in any tool like DB Browser for SQLite.
* **Import SQLite (.sqlite):** Instantly restore previous databases.
* **Export JSON Backup:** Generate an open structured dump of all relational tables.
* **Restore JSON Backup:** Wipe and restore relational records from any JSON dump.

---

## 📄 License

License: GNU General Public License v3.0 only (GPL-3.0-only)

See [LICENSE](LICENSE) for the full license text.

### Third-Party Licenses & Assets

Third-party dependencies and model weights retain their respective licenses:
- `Xenova/multilingual-e5-small`: MIT License
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0 License
- Transformers.js (`@huggingface/transformers`): Apache-2.0 License
- SQLite WASM (`sql.js`): MIT License

