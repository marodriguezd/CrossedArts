# About CrossedArts

CrossedArts is a personal learning environment built around a local-first model.

The project started from a practical problem: study material tends to end up scattered across course platforms, PDFs, notes, flashcards and unrelated tools, while the data created by the learner remains tied to whichever service currently hosts it.

CrossedArts is an attempt to put those pieces in one place without turning the project into a cloud service.

## Why the project is local-first

The browser application is the primary product.

It can run from GitHub Pages without a server because the important parts of the application live on the client:

- React and TypeScript provide the interface.
- SQLite compiled to WebAssembly provides the relational data model.
- IndexedDB persists the database between sessions.
- The File System Access API connects the application to local media folders.
- Web Workers/WebAssembly and WebGPU are used by some local AI components.

This separation gives the project a useful property: the application can be deployed as static files while the learner still has a real relational database and not just a collection of browser key/value entries.

SQLite is the canonical store for learning data. Semantic embeddings are deliberately kept in a separate IndexedDB store so they can be rebuilt or discarded without changing the relational database.

## The data model

The application treats learning as a connected set of objects rather than a list of isolated screens.

At the core are courses, modules, lessons, books, notes, flashcards, concepts, imported resources and learning sessions.

A lesson can contain its own Markdown content and can be associated with notes, resources, concepts and local media. Study sessions can be scoped to a resource or lesson, so the history records what was actually studied.

The knowledge graph sits on top of this model. It is not a separate knowledge base.

Some graph relationships are derived from existing foreign-key relationships. User-created connections are stored explicitly in the knowledge_connection table. This avoids maintaining a second copy of relationships that already exist elsewhere in the database.

## Study model

CrossedArts uses SuperMemo-2 (SM-2) for spaced repetition.

The important design decision is not the algorithm itself but keeping it as a single scheduling authority. Flashcard reviews update the same flashcard state that is used to determine what is due next.

Study sessions can contain flashcard review and ephemeral practice questions. Only the facts of the session are persisted: timing, mode, cards reviewed, questions answered, correct answers and the associated resource or lesson.

There is deliberately no universal learning score. A percentage that does not have a clear underlying measurement would make the interface look more precise without making it more useful.

The same principle is used elsewhere in the application: "continue learning" selects the next incomplete lesson deterministically instead of presenting an opaque recommendation score.

## Search and retrieval

The application has two retrieval paths.

The first is plain local search using the relational data already in SQLite. It works without embeddings, WebGPU or an LLM.

The second is a hybrid retrieval layer. When semantic search is available, CrossedArts combines lexical matches with local embeddings and uses the resulting candidates to ground AI actions.

The semantic index is treated as derived data. Content is hashed with SHA-256 and vectors are associated with the corresponding content hash and pipeline version. A content change can therefore invalidate only the affected vectors instead of rebuilding everything.

This is an important architectural boundary: the relational database remains authoritative; the embedding index can be recreated.

## Local AI

AI is an optional layer, not a dependency of the learning system.

The browser can use WebLLM/WebGPU for local inference, with CPU/WASM models available as fallbacks. The default WebGPU model is Qwen3 1.7B, while the registry also contains smaller models for lower-resource devices.

A local model has a practical cost: the first use requires downloading model assets. CrossedArts asks for consent before that first large download, then reuses the cached model locally.

The same idea applies to semantic embeddings. They are generated on-device and cached separately from the main SQLite database.

The application can also connect to Ollama or OpenAI. Those modes are intentionally explicit because they change the data boundary. Local-first does not mean that every possible provider is local; it means the local path is the default architectural foundation.

## Media files

Large course media is another reason for the local-first approach.

The application can access a selected folder through the File System Access API, scan it recursively and match media files to lessons.

The files themselves do not become database blobs. Playback uses temporary object URLs, and those URLs are released when they are no longer needed.

That choice keeps the SQLite backup portable and avoids making a database export contain gigabytes of video.

The trade-off is equally explicit: restoring the database on another machine does not restore the local media folder. The folder has to be selected again.

## Backups and portability

CrossedArts exposes SQLite and JSON export/import from the application settings.

SQLite is the more important boundary because it preserves the relational database in a standard format rather than hiding the data behind an application-specific backup format.

Backups include learning data stored in SQLite. They do not include local media files or ephemeral file-system handles.

JSON backup/import is also validated before replacing the current database state.

## Why there is still a backend

The static web app is the primary runtime, but a Python backend remains in the repository.

That is intentional rather than transitional.

Some workloads are more comfortable on the server side: batch document ingestion, heavier processing and additional semantic/LLM integrations. Keeping the backend optional lets the browser application stay simple for normal use without throwing away a useful server-side toolchain.

The two environments therefore have different jobs instead of pretending they are the same runtime.

## What CrossedArts does not try to do

Several things are intentionally out of scope:

- It does not require a cloud account for normal study.
- It does not automatically invent knowledge-graph relationships.
- It does not make AI the source of truth for learning data.
- It does not turn every generated question into permanent content.
- It does not calculate a universal "knowledge score".
- It does not promise conflict-free synchronization between multiple devices.

The project favors explicit state, deterministic behavior and recoverable data over opaque automation.

## Constraints and trade-offs

Local-first has real limitations.

The application depends on browser storage, so storage policies and quotas are still browser concerns.

Local AI is constrained by the hardware and browser capabilities available to the user. WebGPU may not be available, and even when it is, larger models can be expensive in memory. CPU/WASM fallbacks trade performance for compatibility.

File System Access API support is also narrower than general browser support, so local folder integration is primarily aimed at Chromium-based browsers.

Multi-tab coordination works through local storage coordination and IndexedDB reloads rather than a cloud synchronization service. There is no automatic multi-device conflict resolution.

These are constraints of the design, not edge cases hidden behind the documentation.

## From DomestiK to CrossedArts

The project originally grew under the name **DomestiK** as a Python application.

Moving to CrossedArts changed the center of gravity from a local server application to a browser application with a relational database running on the client.

The backend was kept because some workloads still benefit from Python. The frontend became the default because static deployment, local persistence and direct file access make the main study workflow easier to use across machines.

That architectural split is one of the main ideas behind the project.

## License

CrossedArts is released under the **GNU General Public License v3.0 only (GPL-3.0-only)**.

Third-party dependencies and model artifacts keep their respective licenses and terms.
