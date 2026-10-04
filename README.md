# CrossedArts

**A local-first personal learning environment for courses, notes, books and study sessions.**

[Open the web app](https://marodriguezd.github.io/CrossedArts/) · [About the project](ABOUT.md)

CrossedArts is built around a simple idea: your study data should remain useful and portable without depending on a cloud account.

The main application runs as a static web app on GitHub Pages. Courses, lessons, notes, books, flashcards, concepts and study history are stored locally in the browser using SQLite compiled to WebAssembly and persisted through IndexedDB.

## What you can do

- Organize courses into modules and lessons, with editable Markdown content.
- Keep books, notes and imported documents in the same local library.
- Study with spaced repetition using the SuperMemo-2 (SM-2) algorithm.
- Run focused study sessions with flashcards, practice questions or a mixed mode.
- Work with local video/audio folders without copying the media into the database.
- Explore relationships between courses, lessons, notes, books, concepts and imported resources in a 2D knowledge graph.
- Search the library locally without requiring embeddings or an LLM.
- Import .txt, .md, .pdf and .epub files and keep their extracted content in the local database.
- Use optional AI modes: an on-device model in the browser, Ollama, OpenAI, or an offline heuristic demo mode.
- Use a small Pomodoro timer directly from the application shell.
- Export and restore your data as SQLite or JSON.

## Local-first by design

The GitHub Pages application does not need a backend to work.

Its core storage path is:

    Browser
      ├─ React + TypeScript
      ├─ SQLite (WebAssembly)
      └─ IndexedDB persistence

The SQLite database is the canonical source of truth for learning data. Semantic embeddings live separately in IndexedDB, so the relational database does not have to carry vector data.

Local media is kept outside the database. When a user selects a course folder, CrossedArts scans it and creates temporary object URLs for playback. Those file handles and temporary URLs are not stored in SQLite.

Backups therefore have a clear boundary: the database can be restored on another device, but local media folders must be selected again.

## Study workflow

A study session can combine:

1. Due flashcards scheduled by SM-2.
2. Practice questions generated for the current session.
3. A local session summary with the activity that actually happened.

Practice questions are ephemeral. CrossedArts stores the session facts, not a permanent copy of every generated prompt.

There is no global "knowledge score". Progress is based on actual local activity and explicit state.

## Knowledge graph

The graph is a navigation and organization layer over the same relational data used everywhere else in the app.

It can represent:

- courses
- modules
- lessons
- books
- notes
- concepts
- imported resources

Structural relationships are derived from the existing data model. User-created relationships are stored explicitly and validated before they are written.

The graph does not automatically invent semantic relationships, and flashcards or study sessions are intentionally not graph nodes.

## AI and search

AI is optional.

The browser can run a small local language model through WebLLM/WebGPU, with CPU/WASM fallbacks for supported models. The first model download requires network access; once cached locally, the selected model can run without a remote inference service.

CrossedArts also has a local semantic retrieval layer based on Transformers.js and a multilingual E5 embedding model. Retrieval combines lexical matching with semantic results when the semantic index is available, and falls back to lexical search when it is not.

Other provider modes are explicit:

- **Demo:** offline heuristic responses.
- **Local:** on-device inference.
- **Ollama:** a model running on your machine.
- **OpenAI:** remote inference. The application warns that API data leaves the browser and that browser storage is not a secure secret store.

The core library and study features do not require AI.

## Data and privacy

The important distinction is between the application itself and optional providers.

With the local modes, learning data stays in the browser and inference runs locally. Choosing Ollama or OpenAI changes that boundary because the corresponding requests are sent to the selected provider.

CrossedArts does not require a user account or a cloud database for its main workflow.

## Optional Python backend

The repository also contains a Python backend based on FastAPI, SQLAlchemy and Alembic.

It is a companion for tasks that are better suited to a server-side environment, such as batch ingestion and additional semantic/LLM workflows. It is not required by the GitHub Pages application.

To run it locally:

    python -m venv .venv
    source .venv/bin/activate
    pip install -r backend/requirements.txt

    PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
    python -m backend.app.main

The API listens on http://127.0.0.1:8080 by default.

## Development

### Frontend

Requirements: Node.js 20+ and a modern browser.

    git clone https://github.com/marodriguezd/CrossedArts.git
    cd CrossedArts/frontend

    npm ci
    npm run dev

The Vite development server runs at http://localhost:5173.

Run the checks used by CI:

    npm run typecheck
    npm test
    npm run build

The current GitHub Actions workflow runs frontend type checking, the frontend test suite, the production build, and the backend pytest suite before deploying to GitHub Pages.

### Browser support

The core application works in modern browsers with WebAssembly and IndexedDB support.

Local folder access uses the File System Access API and therefore depends on browser support. The implementation currently targets Chromium-based browsers such as Chrome, Edge and Brave for that feature.

## Repository layout

    CrossedArts/
    ├── frontend/       # React + TypeScript application
    ├── backend/        # Optional FastAPI companion
    ├── static/         # Shared covers and media assets
    ├── ABOUT.md        # Project rationale and technical notes
    ├── AGENTS.md       # Development/agent guidance
    ├── README.md       # Main documentation
    └── README.es.md    # Spanish documentation

## License

CrossedArts is released under the **GNU General Public License v3.0 only (GPL-3.0-only)**.

See LICENSE for the full text.

Third-party libraries and model artifacts keep their own licenses.
