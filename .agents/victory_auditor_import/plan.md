# Victory Audit Plan — Import System Restructuring

## 1. Timeline & Provenance Audit (Phase A)
- **Step A1**: Examine git commits history and file modification logs.
  - *Verification*: Confirm that modifications are iterative, timestamps are realistic, and no pre-existing verification logs/outputs are checked in.
- **Step A2**: Verify directory structures and metadata compliance.
  - *Verification*: Confirm that all code changes are in the correct directories and `.agents/` folder contains only metadata.

## 2. Forensic Integrity Check (Phase B)
- **Step B1**: Code inspection for prohibited patterns (development mode).
  - *Verification*: Verify `frontend/app/components/import_dialog.py` has no tabs/selectors, uses `FolderPickerDialog`, has a unified flow, contains a purple copy switch defaulting to False (`reference` strategy), and has no native bridge or browser folder upload JS logic.
- **Step B2**: Verify backend strategy implementation in `backend/app/services/ingestion.py`.
  - *Verification*: Confirm `_resolve_storage_path` implements `reference` strategy (resolving the path without copying) and `copy` strategy (copying the file). Confirm the bugfix replacing `dest_file.lexists()` with `os.path.lexists(dest_file)` is correct.
- **Step B3**: Check for facades or hardcoded bypasses.
  - *Verification*: Confirm all logic operates dynamically on the database and filesystem.

## 3. Independent Test Execution (Phase C)
- **Step C1**: Run the specific ingestion API test suite.
  - *Command*: `PYTHONPATH=. .venv/bin/pytest backend/tests/test_ingestion_api.py`
  - *Verification*: 5 tests should pass successfully.
- **Step C2**: Run the entire project test suite.
  - *Command*: `PYTHONPATH=. .venv/bin/pytest backend/tests -x -q`
  - *Verification*: All 171 tests must pass successfully.
- **Step C3**: Compare test results against claimed team reports.
  - *Verification*: Assert that there are no discrepancies between the results.
