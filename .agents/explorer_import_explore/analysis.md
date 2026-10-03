# Analysis Report: DomestiK Import System

## Summary of Core Findings
The DomestiK content import system is split into two modes: "Server Folder" (local backend directories using custom pickers) and "Upload from PC" (web-based folder upload utilizing `webkitdirectory` via inline JavaScript fetch requests). While basic safety validation exists for file extensions, sizes, and path traversals, the ingestion service (`IngestionService`) and `/content/*` API endpoints currently have zero test coverage in the test suite.

---

## Detailed Findings

### 1. Frontend Import Configuration (`import_dialog.py`)
- **File path**: `frontend/app/components/import_dialog.py`
- **Tabs/Modes**: 
  - `server` ("Carpeta del Servidor"): Selects files already accessible by the server. Uses a `FolderPickerDialog` to pick directory paths.
  - `upload` ("Subir desde mi PC"): Uses the client browser native file picker to select a folder and uploads its files recursively.
- **JavaScript & DOM Bridge**:
  - A hidden `<input type="file" id="native-dir-picker-..." webkitdirectory multiple>` is injected dynamically via `ui.run_javascript()` in `_inject_resources()`.
  - A hidden NiceGUI bridge element (`_bridge`) is defined with event handlers to bridge JS callbacks back to Python:
    - `native-folder-selected` maps to `_on_native_folder_selected()` to update selected file counts and folder names in UI.
    - `native-upload-done` maps to `_on_upload_done()` to finalize UI loading states, show success message, and close the dialog.
- **Mapping to APIs**:
  - **Server mode**: Sends JSON payload to `POST /content/import` containing `title`, `resource_type`, `category`, `description`, `source_path`, `storage_strategy`, `structure_strategy`, `cover_path` and difficulty (if course) or author (if book). Storage strategies include `reference`, `symlink`, and `copy`.
  - **Upload mode**: Formulates a multi-part `FormData` body in injected JavaScript (`_do_upload_import()`). Files are attached using `formData.append('files', files[i], filePath)` (preserving subdirectories via `webkitRelativePath`). This `FormData` is POSTed directly to `/content/import-from-upload` via the browser's `fetch()` API. Storage strategy is forced to `"copy"` in backend since files originate from the client.

### 2. Backend APIs for Ingestion (`ingestion.py`)
- **File paths**: 
  - `backend/app/api/ingestion.py` (FastAPI router definitions)
  - `backend/app/services/ingestion.py` (`IngestionService` logic)
  - `backend/app/schemas/ingestion.py` (Pydantic schemas)
- **FastAPI Endpoints**:
  - `POST /content/import`: Maps to `IngestionService.import_resource`. Handles server-side folder imports. Supports `symlink`, `copy`, and `reference` strategies.
  - `POST /content/validate-directory`: Returns metadata of local paths, including files counts, subdirectories, and media asset categorization.
  - `POST /content/import-from-upload`: Extracts files, checks file size constraints (`MAX_UPLOAD_FILE_SIZE = 2GB`), and validates file extensions against `ALLOWED_UPLOAD_EXTENSIONS`. Normalizes uploaded file paths to prevent directory traversal via `Path(original_path).parts`. Drops files into a temporary directory inside `settings.data_dir / "uploads" / "imports"`, processes the ingestion via `IngestionService` using copy strategy, and cleans up the temp dir.
  - `POST /content/upload-cover`: Sube/asocia portadas (via direct upload or path reference).
  - `GET /content/cover-image/{filename}`: Serves cover images securely using `is_safe_path()`.

### 3. JavaScript and `webkitdirectory` References
- `webkitdirectory` is only used inside `frontend/app/components/import_dialog.py`:
  - Line 77: `input.webkitdirectory = true;` in `_inject_resources()`.
  - Line 99: `files[0].webkitRelativePath` to extract the folder name.
  - Line 739: JSDoc description of `_do_upload_import()`.
  - Line 801: `formData.append('files', files[i], filePath)` using `files[i].webkitRelativePath` to preserve relative folder paths.
- Custom inline JavaScript injection occurs twice:
  - Line 72: `_inject_resources()` (attaches `<input>` to `document.body`).
  - Line 776: `_do_upload_import()` (generates multi-part `fetch()` to `/content/import-from-upload`).

### 4. Import & Ingestion Tests
- **Verification of existing tests**: A search across `backend/tests/` shows:
  - `test_security.py` tests path safety utilities like `is_safe_path()`.
  - `test_scanner.py` tests directory scanning using `ScannerManager` (which parses `metadata.json` / `metadata.yaml` or heuristically parses folders).
  - **Crucially**: There are **zero** tests for `IngestionService` or the `/content/*` API endpoints. No tests import `IngestionService` or make requests to `/content/import` or `/content/import-from-upload`.

### 5. Running the Test Suite
- Executing `PYTHONPATH=. .venv/bin/pytest backend/tests` successfully passes all existing tests:
  - Results: `166 passed, 1255 warnings in 7.75s`.
