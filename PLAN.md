# DomestiK — Master Plan

## Execution Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Original 10-Issue Audit (2026-06-22) | ✅ All Resolved |
| Phase 2 | Import Feature Audit — Security & Bugs (2026-06-24) | ✅ All Resolved |
| Phase 3 | Performance Budget & Optimization (2026-06-24) | 🔄 In Progress |

---

## Phase 1: Original Audit — All Resolved

| ID | Issue | Status |
|----|-------|--------|
| 1 | Critical Alembic Migration Failure (`server_default='0'`) | ✅ |
| 2 | API Contract Mismatch (Pydantic `Literal` discriminators) | ✅ |
| 3 | `datetime.utcnow()` deprecation | ✅ |
| 4 | Hardcoded absolute paths in tests | ✅ |
| 5 | Connection pool socket exhaustion | ✅ |
| 6 | Sequential batch embeddings | ✅ |
| 7 | SQLite parameter limit (chunked deletes) | ✅ |
| 8 | XXE injection (`defusedxml`) | ✅ |
| 9 | Directory traversal (sandboxed to `~/.domestik/`) | ✅ |
| 10 | NiceGUI-FastAPI loopback overhead (`services_direct.py`) | ✅ |

---

## Phase 2: Import Feature Audit — All Resolved

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| P2-1 | Critical | SQLite `.db` files committed to git | ✅ Removed + `.gitignore` updated |
| P2-2 | Critical | Path traversal via `..` in upload filename | ✅ `PurePosixPath` + `is_relative_to` |
| P2-3 | Critical | No file size limit on upload (copy mode only) | ✅ 2GB limit + extension whitelist |
| P2-4 | Medium | No file type validation on upload | ✅ Whitelist enforced |
| P2-5 | Medium | Temp dir never cleaned on success | ✅ `shutil.rmtree` on all paths |
| P2-6 | Medium | `UploadImportResponse` dead code | ✅ Removed |
| P2-7 | Medium | `toggle_cover_input()` inverted ternary | ✅ Fixed with if/else |
| P2-8 | Medium | No `is_importing` guard (double-submit) | ✅ Guard added |
| P2-9 | Medium | Storage/cover controls visible in upload mode | ✅ Hidden in upload mode |
| P2-10 | Medium | `Note` imported from wrong module | ✅ Fixed to `activity` |
| P2-11 | Low | `api_client.py` code quality issues | ✅ Fixed |

---

## Phase 3: Performance Budget & Optimization

### Performance Budget

| Interaction | Target | Current Est. |
|-------------|--------|-------------|
| Click → feedback | <50ms | ~10ms ✅ |
| Page navigation | <200ms | ~400-800ms ❌ |
| Dashboard load | <300ms | ~500-800ms ❌ |
| Library load | <300ms | ~400-1200ms ❌ |
| Text search | <200ms | ~300-5000ms ❌ |
| Semantic search | <500ms | ~1000-5000ms ❌ |
| Video first frame | <200ms | ~100-200ms ⚠️ |
| Video playback start | <500ms | ~500-2000ms ❌ |
| Import (5 files) | <2s | ~2-5s ⚠️ |
| Save / PATCH | <100ms | ~20-50ms ✅ |
| Delete resource | <500ms | ~100-300ms ✅ |
| About page | <200ms | ~300-500ms ❌ |

### Phase 3 Issues

| ID | Priority | Issue | Target Files | Target |
|----|----------|-------|--------------|--------|
| **P3-1** | **HIGH** | Dashboard: 7 separate COUNT/SUM queries | `frontend/app/services_direct.py:242-266` | Consolidate to 1-2 queries |
| **P3-2** | **HIGH** | Dashboard: N+1 in recent-activity (lazy resource loads) | `frontend/app/services_direct.py:271-314` | Use joinedload |
| **P3-3** | **HIGH** | Library: no pagination (fetches ALL resources) | `frontend/app/services_direct.py:26-38` | Add limit/offset |
| **P3-4** | **HIGH** | Library: no debounce on search input | `frontend/app/library.py` | Add 300ms debounce |
| **P3-5** | **HIGH** | Missing SQLite indexes on hot columns | `backend/alembic/` | Add indexes |
| **P3-6** | **HIGH** | SQLite: no `PRAGMA cache_size` tuning | `backend/app/core/database.py` | Set to 10000 pages |
| **P3-7** | **MEDIUM** | About page: 13 separate COUNT queries | `frontend/app/services_direct.py:752-776` | Consolidate to 1 query |
| **P3-8** | **MEDIUM** | Google Fonts: 16 variants, render-blocking | `frontend/app/layout.py` | Reduce to 4-6 + swap |
| **P3-9** | **MEDIUM** | CSS re-injected on every page navigation | `frontend/app/layout.py` | Deduplicate |
| **P3-10** | **MEDIUM** | Video: no `preload="metadata"`, eager load | `frontend/app/components/media_viewer.py` | Add preload + lazy |
| **P3-11** | **MEDIUM** | Resource cards: 2x `Path.is_file()` per card | `frontend/app/components/resource_card.py` | Pre-cache cover URLs |
| **P3-12** | **MEDIUM** | Habits page: N+1 API calls (per-habit stats) | `frontend/app/pages/habits.py` | Batch endpoint |
| **P3-13** | **MEDIUM** | Scanner: N+1 MediaAsset lookups in loop | `backend/app/services/scanner.py` | Bulk load existing assets |
| **P3-14** | **LOW** | Theme toggle: `location.reload()` destroys state | `frontend/app/layout.py` | CSS class toggle |

### Phase 3 Execution Waves

#### Wave 1: Database Layer (Agent 1 + Agent 2)
- **Agent 1 — Dashboard consolidation:** Rewrite `get_dashboard_summary_direct()` to use 1 query with `CASE WHEN`. Fix `get_recent_activity_direct()` N+1 with `selectinload`.
- **Agent 2 — SQLite optimizations:** Add indexes via Alembic migration. Add `PRAGMA cache_size=-10000` to `set_sqlite_pragma`.

#### Wave 2: Frontend Performance (Agent 3 + Agent 4)
- **Agent 3 — Library pagination + debounce:** Add `limit`/`offset` to `get_resources_direct()`. Add debounce to library search. Add "Load more" button.
- **Agent 4 — About page + Habits batch:** Consolidate 13 COUNTs to 1 query. Create batched habit stats endpoint.

#### Wave 3: Media & Assets (Agent 5 + Agent 6)
- **Agent 5 — Font + CSS optimization:** Reduce Google Font variants, add `font-display: swap`, add `<link rel="preconnect">`. Deduplicate CSS injection.
- **Agent 6 — Video lazy loading:** Add `preload="metadata"` to `<video>`, add `loading="lazy"` to cover images, fix `MutationObserver` leak in media_viewer.

#### Wave 4: Verification (Agent 7)
- **Agent 7 — Test suite:** Run full test suite. Fix any regressions.
