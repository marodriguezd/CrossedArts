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
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License MIT" />
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

### 1. 100% Client-Side Static Deployment (GitHub Pages First)
- Runs entirely as a lightning-fast Single Page Application (SPA) without requiring containers or servers.
- Automated CI/CD deployment via GitHub Actions in `.github/workflows/deploy.yml`.
- Try it instantly without installing anything: [marodriguezd.github.io/CrossedArts](https://marodriguezd.github.io/CrossedArts/).

### 2. In-Browser SQLite Engine (WASM + IndexedDB)
- Full SQLite engine compiled to WebAssembly (`sql.js`) executing in the browser main thread.
- Transparent synchronization with `IndexedDB` (`CrossedArts_IDB`) to persist relational states across sessions.
- Full relational schema (`learning_resource`, `course`, `book`, `module`, `lesson`, `note`, `flashcard`, `concept`, `knowledge_connection`, `learning_session`).
- Total data portability: native binary `.sqlite` / `.db` import/export and structured JSON backups.

### 3. Local Media Streaming (Zero Disk Duplication)
- Native integration with the **File System Access API** (`window.showDirectoryPicker`) for Chromium-based browsers (Chrome, Edge, Brave).
- Mount your local course folders from your hard drive and stream video lessons using ephemeral in-memory object URLs without uploading large files or duplicating gigabytes of storage.

### 4. Active Recall & Spaced Repetition (SuperMemo-2 Algorithm)
- Interactive flashcard review center for rapid memory consolidation.
- Mathematical **SuperMemo-2 (SM-2)** implementation calculating the Ease Factor (minimum 1.30), repetition streaks, and optimal review intervals based on the Hermann Ebbinghaus forgetting curve.

### 5. Interactive 2D Knowledge Graph
- Visual concept mapping with particle-physics force simulation powered by `vis-network`.
- Map and navigate cross-cutting connections between academic concepts, course lessons, books, and study notes.

### 6. Hybrid Pedagogical AI Tutor
- Context-aware study assistant accessible from any view in the drawer.
- **Offline Demo Mode:** 100% disconnected, zero network calls, offering Socratic answers and study advice.
- **Local Ollama Mode:** Connects directly to local Ollama models (`http://localhost:11434`) for private offline inference.
- **External API Providers:** Compatible with OpenAI and Gemini API keys stored securely in your browser's `localStorage`.

### 7. Optional Python Backend Companion
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
│   │   ├── pages/                # Views: Dashboard, Library, ReviewCenter, Graph, etc.
│   │   └── types/                # TypeScript domain models (models.ts)
│   └── tests/                    # Zero-Web-Access test fleet (23 integration tests)
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
The project includes 23 tests verifying offline SQLite initialization, SM-2 math, binary/JSON exports, and offline security:

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

Distributed under the **MIT** License. See `LICENSE` for details.
