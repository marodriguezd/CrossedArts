# About CrossedArts

## Why Local-First

CrossedArts stores all learning data on the user's device. The canonical database is SQLite compiled to WebAssembly, persisted to IndexedDB. This means:

- No account creation or authentication required
- No data leaves the device unless the user explicitly chooses an external AI provider
- Full data ownership with standard SQLite export/import
- No vendor lock-in or subscription dependency

The trade-off is that multi-device synchronization is not automatic. Users who need it must export and import their database manually.

## Architecture Decisions

**SQLite WASM as canonical storage:** The application uses `sql.js` to run a full SQLite engine in the browser. This provides relational integrity, SQL queries, and ACID transactions within the browser context. The database is serialized to IndexedDB on every mutation for persistence.

**IndexedDB as persistence layer:** IndexedDB stores the serialized SQLite database. This survives browser restarts and provides a simple key-value store that works across all modern browsers.

**Derived semantic index:** Embedding vectors are stored in a separate IndexedDB store (`CrossedArts_Embeddings`), decoupled from the canonical SQLite database. Vectors are invalidated by SHA-256 content hashing and pipeline versioning, so only modified content is recomputed.

**GitHub Pages deployment:** The frontend compiles to static assets and deploys to GitHub Pages via GitHub Actions. This provides free, reliable hosting with no server maintenance.

**Optional Python backend:** The backend is a separate FastAPI application for users who need batch processing (PDF/EPUB extraction, video transcripts, large-scale embeddings). It is not required for daily use.

## Study Model

CrossedArts uses the SuperMemo-2 (SM-2) algorithm for spaced repetition scheduling:

- **Grade scale:** 0–5 (0 = complete blackout, 5 = perfect recall)
- **Ease Factor:** Starts at 2.5, minimum 1.30, adjusted based on recall quality
- **Interval calculation:** Intervals grow exponentially for successful reviews; failed reviews reset to 1 day
- **Session lifecycle:** `idle → starting → active → paused → completed` with safe `cancelled`/`failed` states
- **Persistence:** Each review is saved immediately, so browser reloads never lose progress

The algorithm is deterministic and based on the Ebbinghaus forgetting curve. No adaptive learning or recommendation scores are used.

## Learning Model

CrossedArts models learning as a small, explicit chain:

```
LEARNING CONTENT  →  RELATIONSHIPS  →  PROGRESS  →  PRACTICE / EVIDENCE  →  OPTIONAL SHARING
```

- **Content** is a course, a book, an imported document, a note or a concept.
- **Relationships** are stored as real edges (foreign keys and explicit `knowledge_connection` rows) and shown in the knowledge graph.
- **Progress** is measured where the data supports it (lessons completed, pages read) and shown as a status where it does not. These are never mixed silently — see [`docs/PROGRESS.md`](docs/PROGRESS.md).
- **Practice work** is what the learner produces (exercise, project, essay, drawing, code, other). It is evidence linked to the resource, lesson or concept it demonstrates, and it appears in the dashboard gallery and the graph.
- **Sharing** is the course package: portable *educational material* (syllabus plus proposed practice work), transferred teacher → student. It never carries personal study state.

The dashboard gallery, the knowledge graph and the mountain progress view are three views over the same environment. Artifacts stay in their own tables on purpose; the shared behaviour lives in small, explicit projections (`services/galleryItems.ts`, `services/graphExploration.ts`, `services/mountainPath.ts`) rather than in a universal entity table.

## AI Boundaries

**What local AI can do:**
- Answer questions based on retrieved local context (RAG)
- Generate flashcards and practice questions from learning materials
- Explain concepts with citations to source content
- All inference happens on-device when using WebLLM mode

**What local AI cannot do:**
- Access external knowledge beyond what is in the local database
- Guarantee factual accuracy (models can hallucinate; the system includes anti-hallucination validation)
- Work without an initial model download (network required for first setup)

**Provider privacy:**
- **WebLLM:** Fully local, no network calls after download
- **Demo:** No network calls, heuristic responses only
- **Ollama:** Local network only, no external calls
- **OpenAI:** Requires API key and sends data to OpenAI servers

## Media Trade-offs

CrossedArts uses the File System Access API for local media playback:

- **Advantage:** No media files are copied into the browser database. Videos stream directly from the user's disk.
- **Limitation:** Only Chromium-based browsers support this API. Firefox and Safari users cannot use local media features.
- **Backup boundary:** Media files are not included in SQLite backups. After restoring a database on a new device, users must re-link their media folder.

## Non-Goals

CrossedArts is explicitly **not**:

- A cloud-sync platform (no automatic multi-device synchronization)
- A collaborative tool (no multi-user support, no shared workspaces)
- A mobile app (browser-only, no native iOS/Android apps)
- An adaptive learning system (no recommendation algorithms or learning path optimization)
- A content authoring platform (no WYSIWYG editor, no video creation)
- A replacement for formal education accreditation
- A complete LMS (no classes, enrolment, grading or teacher administration)
- A teacher management platform or a remote classroom system
- A full collaborative education platform

Course packages move *material* from one person to another; they are not a learning-management workflow. What a package contains is deliberately narrow: the resource, its modules and lessons, and the practice work proposed by the author — never progress, notes or sessions.

## Evolution from DomestiK

CrossedArts originated as **DomestiK**, a Python monolith using FastAPI, SQLAlchemy, Alembic, and NiceGUI. The project was reimplemented as a client-side application to:

- Eliminate the need for a running Python server
- Enable deployment to GitHub Pages with zero infrastructure cost
- Provide offline capability through browser-based storage
- Make the application accessible from any modern browser without installation

The Python backend was preserved as an optional companion for batch processing workflows that are impractical in the browser.

## License

CrossedArts is licensed under [GPL-3.0-only](LICENSE). The software is free to use, modify, and distribute under the terms of the GNU General Public License v3.0.

Third-party dependencies retain their original licenses:
- `Xenova/multilingual-e5-small`: MIT
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0
- Transformers.js (`@huggingface/transformers`): Apache-2.0
- SQLite WASM (`sql.js`): MIT
