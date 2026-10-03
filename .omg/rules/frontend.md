---
description: NiceGUI/Quasar UI components, dark mode styling overrides, checklists, and inline javascript rules.
globs:
  - "frontend/**"
---

# Frontend UI Rules

- **Theme Class Overrides:** Override Quasar styling classes globally in `layout.py` (`.q-field__native`, `.q-placeholder`, etc.) to map variables rather than using static `.props('dark')` on inputs.
- **NiceGUI Container Clearing:** Always clear parent container elements via `self.container.clear()` *before* evaluating early return guards on empty lists in reactive renders.
- **Class Toggle Pattern:** Do not use ternary operations for class toggling; use explicit `if/else` checks.
- **Double-Submit Guard:** Add an `is_importing` or equivalent boolean check at the top of async action handlers.
- **Inline JavaScript:** Extract inline scripts exceeding ~20 lines into dedicated `.js` static files to allow proper linting and debugging.
- **CSS Deduplication:** Check for style element presence by unique ID before executing `ui.add_head_html()` to prevent duplicate tags on page navigation.
