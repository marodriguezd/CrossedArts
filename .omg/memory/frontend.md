# Frontend Memory & Conventions

## 1. Editorial Design System
* **Context:** The frontend uses an editorial/magazine aesthetic with three font families and CSS custom properties for theming.
* **Fonts:** Cormorant Garamond (display titles), Source Sans 3 (body text), DM Mono (metadata, KPIs).
* **Theme:** CSS custom properties in `:root` (light) and `.dark-theme` (dark). Dark mode is cookie-based with full page reload.
* **Key File:** `frontend/app/layout.py` contains the complete design system.

## 2. Input Readability in Dark/Light Themes (NiceGUI/Quasar)
* **Trap:** Using `.props('dark')` statically causes inputs to use white text, which is invisible on white backgrounds in light mode. Omitting it in dark mode makes text illegible (dark text on dark background).
* **Rule:** Override Quasar styling classes globally in `layout.py` based on active theme variables:
  * Text: `.q-field__native`, `.q-field__input` should use `color: var(--text-primary) !important;`
  * Placeholders/Labels: `.q-placeholder`, `.q-field__label` should use `color: var(--text-muted) !important;`
  * Icons/Dropdown arrows: `.q-field__marginal`, `.q-icon` should use `color: var(--text-secondary) !important;`

## 3. NiceGUI Container Clearing and Early Returns
* **Trap:** When writing reactive rendering functions (e.g. `render_activity`), doing an early return on falsy/empty collections before calling `self.container.clear()` prevents loading state or old elements from being cleared.
* **Rule:** Always clear the container first, or check for empty states inside the container context to render the fallback text.

## 4. Toggle CSS Classes Pattern
* **Trap:** Ternary expressions for toggle (like `remove='hidden' if h else 'hidden'`) can evaluate to the same value on both branches and fail.
* **Rule:** Always use explicit `if/else` patterns for toggling classes:
  ```python
  def toggle_something():
      is_hidden = 'hidden' in self.element.classes
      if is_hidden:
          self.element.classes(remove='hidden')
      else:
          self.element.classes(add='hidden')
  ```

## 5. Double-Submit Guards in Async Dialogs
* **Rule:** Prevent double-submit race conditions in dialogs with async handlers. Always add an `is_importing` or equivalent boolean guard at the top of the handler BEFORE any validation.

## 6. Inline JavaScript Limits
* **Rule:** When inline JS exceeds ~20 lines, extract it to a separate `.js` file and load it via `ui.add_head_html(...)` or `ui.add_static_file()` to ease linting and debugging.

## 7. CSS Deduplication in NiceGUI
* **Rule:** Avoid duplicate `<style>` tags from `ui.add_head_html()` re-injecting CSS on page navigation by checking if a style tag with a unique ID already exists:
  ```python
  js = f"""
  if (!document.getElementById('domestik-theme')) {{
      var style = document.createElement('style');
      style.id = 'domestik-theme';
      style.textContent = {css_content};
      document.head.appendChild(style);
  }}
  """
  ui.run_javascript(js)
  ```

## 8. Refreshable Checklists & SQL Sync
* **Rule:** Wrap checklists or dropdown list grids in a `@ui.refreshable` method and call `.refresh(...)` to dynamically update items.
* **Rule:** Synchronize relationships in a single synchronous database block by matching saved IDs and incremental changes to optimize SQLite performance.
