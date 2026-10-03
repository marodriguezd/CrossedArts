---
description: Application performance budgets, N+1 query avoidance, and lazy loading assets.
alwaysApply: true
---

# Performance Rules

- **Aggregations:** Avoid multiple count queries. Use `CASE WHEN` to perform aggregations in a single query.
- **Pagination:** Implement pagination (`LIMIT` / `OFFSET`) on all unbounded lists.
- **N+1 Avoidance:** Always load relationships via `selectinload()` or `joinedload()` if they are looped over or serialized.
- **Asset Lazy Loading:** Set `preload="metadata"` on HTML5 `<video>` tags and `loading="lazy"` on all images.
- **Input Debounce:** Apply 300ms debounce to search and text inputs.
