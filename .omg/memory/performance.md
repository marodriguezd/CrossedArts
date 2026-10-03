# Performance Memory & Conventions

## 1. Performance Budget (100ms Rule)
* **Goal:** DomestiK targets <300ms for all page loads and <50ms for button interactions.
* **Rules:**
  * Consolidate aggregate queries using `CASE WHEN` to avoid multiple `COUNT(*)` queries.
  * Add pagination everywhere (use `LIMIT`/`OFFSET` with a default of 50).
  * Debounce user search/filter inputs by 300ms.

## 2. SQLite Performance Pragmas
* **Rule:** Enable performance pragmas in the `set_sqlite_pragma` listener in `database.py`:
  * `PRAGMA cache_size=-10000` (10MB cache)
  * `PRAGMA journal_mode=WAL`
  * `PRAGMA synchronous=NORMAL`
  * `PRAGMA temp_store=MEMORY`

## 3. N+1 Query Patterns (Avoidance)
* **Rule:** Use `selectinload()` or `joinedload()` when querying relationships that are accessed inside loops or returned as lists.
* **Key areas to check:**
  * `get_recent_activity_direct()`
  * `get_learning_paths_direct()`
  * File scanners in loops.

## 4. Video & Media Lazy Loading
* **Rules:**
  * Set `preload="metadata"` on `<video>` tags.
  * Add `loading="lazy"` on all cover images (`<img>` tags).
  * Scope `MutationObserver` to specific containers instead of `document.body` with `subtree: true`.
