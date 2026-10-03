## 2026-06-24T12:12:28Z
You are a teamwork_preview_worker.
Your working directory is /home/marodriguezd/Github/DomestiK/.agents/worker_import_redesign/.
You must restructure the import system of DomestiK to prioritize the local-first model as follows:

1. Modify `frontend/app/components/import_dialog.py` to:
   - Remove Tabs/Mode selectors (only keep a single flow for selecting folder path).
   - In that flow, use the folder selector button that pops up `FolderPickerDialog`.
   - When a folder is selected via `FolderPickerDialog`, run automatic validation using `_validate_directory()` (asynchronously).
   - Add a switch/checkbox "Copiar archivos físicamente a la biblioteca" (default False).
   - When importing: if switch is True, send `storage_strategy="copy"`, else send `storage_strategy="reference"`.
   - Clean up and remove all unused code, webkitdirectory JS, native bridge div `self._bridge`, and any related event handlers (`_on_native_folder_selected`, `_on_upload_done`, `_get_picker_js`, `_inject_resources`, etc.).

2. Add test coverage in `backend/tests/` (e.g., create `backend/tests/test_ingestion_api.py`) to test:
   - The `/content/validate-directory` endpoint.
   - The `/content/import` endpoint, verifying both `reference` and `copy` storage strategies (mocking filesystem directory structures or using a temp directory).
   - Make sure all test scenarios are genuine and verify model states in database.

3. Run the full pytest suite: `PYTHONPATH=. .venv/bin/pytest backend/tests` to verify that everything passes.

Please document all your edits, the commands you ran, and test results in /home/marodriguezd/Github/DomestiK/.agents/worker_import_redesign/changes.md, and write a handoff.md report summarizing your work. Then message the parent.
