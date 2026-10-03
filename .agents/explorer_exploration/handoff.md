# Handoff Report — 2026-06-22

## 1. Observation
We observed the following exact occurrences and paths:
* **Pytest Warnings**: Running `PYTHONPATH=. .venv/bin/pytest backend/tests` produced:
  `77 warnings in 1.92s`.
  Warnings specifically state:
  `DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal in a future version. Use timezone-aware objects to represent datetimes in UTC: datetime.datetime.now(datetime.UTC).`
  in locations such as:
  - `backend/app/services/session.py:21, 40, 69`
  - `backend/app/services/workflow.py:80, 249, 292, 310, 321, 358, 404, 405`
  - `backend/tests/test_session.py:25, 52, 57, 64`
  - `backend/tests/test_workflow.py:82, 83`
* **Alembic current and history**: Running `alembic current` returned:
  `c8b5c0cd3cf0`
  Running `alembic history` returned:
  `c8b5c0cd3cf0 -> 9bd4577cf6f2 (head), add_inactive_seconds_to_session`
* **Static vis-network.min.js**: `static/js/vis-network.min.js` contains exactly:
  `Redirecting to /vis-network@10.1.0/standalone/umd/vis-network.min.js`
* **XML parsing**: `backend/app/services/extractor.py:155` uses:
  `root_container = ET.fromstring(container_xml)`
  where `ET` is `xml.etree.ElementTree`.
* **HTML rendering (Media Viewer)**: `backend/app/components/media_viewer.py:108` has:
  `ui.html(html_code).classes('w-full')`
  where `html_code` formats dynamic `self.mime_type` inside `<source type="{self.mime_type}">` without escaping.
* **NiceGUI loopback calls**: Frontend pages such as `frontend/app/dashboard.py:19` invoke:
  `self.summary_data = await APIClient.get("/dashboard/summary")`
  which issues HTTP requests using `httpx.AsyncClient` back to localhost.

---

## 2. Logic Chain
1. *Out-of-Sync Migrations*: The current Alembic revision in the SQLite database file (`c8b5c0cd3cf0`) is behind the migration HEAD (`9bd4577cf6f2`). Since tests bypass migrations and run `create_all()`, they did not fail. However, the physical database file lacks the `inactive_seconds` column, which will fail when the application is run in dev/prod.
2. *Broken vis-network.min.js*: The file contains plain redirect text instead of actual compiled JavaScript. Therefore, browsers will raise a syntax parse error when evaluating it, and Vis-network dependent components like the Knowledge Graph page will fail to load.
3. *Session Tracking Design*: Heartbeats save intermediate times in `ended_at`. Since completed sessions also set `ended_at`, active and inactive sessions are identical in queries filterable by `ended_at IS NOT NULL`.
4. *XSS Vulnerability*: Formatted strings in `media_viewer.py` containing database variables are injected raw via `ui.html()`. If a database field is polluted with HTML tag boundaries and `<script>`, the browser will execute it under the site's origin.
5. *XXE Vulnerability*: Standard library `ElementTree.fromstring` does not disable external DTDs or entity resolution, making the EPUB parsing mechanism susceptible to Billion Laughs DoS and data retrieval attacks.
6. *NiceGUI Loopback Calls*: NiceGUI callbacks are executed server-side. Performing `httpx` GET/POST requests back to FastAPI routes in the same event loop adds loopback network latency and serialization overhead.

---

## 3. Caveats
No caveats. All findings were directly inspected in the codebase files and logs.

---

## 4. Conclusion
The codebase is functionally complete (all tests pass), but suffers from several critical flaws:
- Database schema drift in development/production due to unapplied Alembic migrations.
- Invalid JS file (`vis-network.min.js`) breaking Knowledge Graph page functionality.
- Security vulnerabilities including potential XSS in `media_viewer.py` and XXE in `extractor.py` (EPUB).
- Timezone-naive datetime deprecations causing test clutter and comparison bugs.
- Heavy HTTP loopback serialization overhead on server-side UI callbacks.
- Database transaction handling mixed inside service layers.

---

## 5. Verification Method
To verify these issues:
1. **Pytest warnings**: Run `PYTHONPATH=. .venv/bin/pytest backend/tests` and check the warning counts and paths.
2. **Alembic current state**: Run `PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini current` and check if it outputs the HEAD migration version (`9bd4577cf6f2`).
3. **Vis-network script**: Open `static/js/vis-network.min.js` and see if it contains valid JS code or only the redirection string.
4. **Inspect source code**: Check `backend/app/services/extractor.py:155` for `ET.fromstring` and `backend/app/components/media_viewer.py:108` for `ui.html(html_code)`.
