# Original User Request

## Initial Request — 2026-06-22T16:29:09Z

Verify that the DomestiK project runs, tests pass, and implement an auto-improvable `SKILL.md` structure in the project root that is registered and referenced in the agent's customizations to continuously improve agent efficiency and project quality.

Working directory: /home/marodriguezd/Github/DomestiK
Integrity mode: development

## Requirements

### R1. Workspace Verification
Verify that all current DomestiK tests and functions run and pass successfully.

### R2. Auto-Improvable SKILL.md
Create a `SKILL.md` file in the root of the project. This file must contain YAML frontmatter (with name and description) and instructions. It must include guidelines/instructions detailing how agents (like ourselves) should auto-improve this file when new lessons or rules are learned.

### R3. Reference Customizations
Register the root `SKILL.md` using `.agents/skills.json` and reference it inside `.agents/AGENTS.md`. Ensure that the agent configuration discovers and loads the rules.

## Acceptance Criteria

### Verification & Setup
- [ ] All pytest tests in `backend/tests` pass when run with `.venv/bin/pytest`.
- [ ] A `SKILL.md` file exists in the root directory.
- [ ] The file `SKILL.md` contains valid YAML frontmatter and a section detailing instructions on how agents should auto-improve this file.
- [ ] `.agents/skills.json` and `.agents/AGENTS.md` are present.
- [ ] The local customization files correctly reference and load the skill.

## 2026-06-22T16:49:38Z

Analyze the DomestiK codebase for potential flaws, bugs, and areas of improvement, and compile these findings into a detailed markdown plan (PLAN.md) and a clean, responsive HTML summary file, without implementing the code changes yet.

Working directory: /home/marodriguezd/Github/DomestiK
Integrity mode: development

## Requirements

### R1. Codebase Analysis & Flaw Identification
Perform a comprehensive analysis of the entire DomestiK repository to identify code quality issues, bugs, deprecations (like the `utcnow()` warnings we saw in pytest), architectural improvements, and security flaws.

### R2. PLAN.md Creation
Create a `PLAN.md` file in the root of the project detailing all found issues, proposed improvements, and detailed code examples demonstrating how to fix or refactor them, without writing the actual modifications into the codebase.

### R3. Summarized HTML Report
Generate a clean, modern, and responsive HTML report file named `plan.html` in the root of the project, summarizing the findings and proposed improvements. The HTML file must use a premium modern design (sleek dark mode, custom typography, grids, cards, hover effects) as outlined in the web application development guidelines.

## Acceptance Criteria

### Outputs & Scope
- [ ] A `PLAN.md` file exists in the root of the workspace.
- [ ] The `PLAN.md` file contains concrete code examples showing before/after refactoring for the major identified issues.
- [ ] A `plan.html` file exists in the root of the workspace.
- [ ] The `plan.html` file features a premium modern design (e.g., sleek dark mode, custom fonts, grids, cards) summarizing the plan.
- [ ] No changes are made to the actual application source code or tests (i.e. only `PLAN.md` and `plan.html` should be added/modified).

## 2026-06-24T12:09:01Z

Reestructuración del sistema de importación de DomestiK para priorizar el modelo local-first: por defecto se referencian los contenidos en su ubicación original en el disco duro del usuario (sin copiar), ofreciendo opcionalmente la posibilidad de copiarlos físicamente al directorio de la aplicación.

Working directory: /home/marodriguezd/Github/DomestiK
Integrity mode: development

## Requirements

### R1. Interfaz Unificada de Importación (Sin Pestañas)
Rediseñar el componente `ImportDialog` en `frontend/app/components/import_dialog.py` para eliminar las pestañas de selección de origen. Debe presentar un único flujo de importación:
1. Un campo para seleccionar la carpeta del PC mediante el diálogo de selección de directorios locales (`FolderPickerDialog`).
2. Al seleccionar la carpeta, se debe validar automáticamente para listar los contenidos detectados (vídeos/lecciones).
3. Un interruptor/check opcional etiquetado como "Copiar archivos físicamente a la biblioteca" (u otra etiqueta clara en español) que por defecto esté **desactivado**.
4. Al hacer clic en "Importar Recurso", si el interruptor está desactivado, el recurso se importa utilizando la estrategia `reference` (se guarda la ruta absoluta original). Si está activado, se utiliza la estrategia `copy`.

### R2. Limpieza de Lógicas Obsoletas de Subida (Upload)
Eliminar en el componente frontend `ImportDialog` cualquier referencia, botones, callbacks o inyección de scripts HTML relacionados con la subida de archivos vía navegador (`webkitdirectory`, inputs temporales en el DOM, `import-from-upload`, etc.) que ya no sean necesarios al estar unificado bajo el flujo de selección local.

## Acceptance Criteria

### Interfaz de Usuario (NiceGUI)
- [ ] El diálogo `Importar Recurso` no muestra pestañas ni selectores de modo (servidor/PC).
- [ ] Por defecto, el interruptor/check para copiar archivos físicamente está visible y desactivado.
- [ ] Al seleccionar una carpeta mediante el explorador local, se ejecuta la validación del directorio y se muestran los archivos encontrados.

### Lógica de Importación
- [ ] Por defecto, la importación envía `storage_strategy="reference"` al backend para utilizar la referencia a la ruta original.
- [ ] Si se activa el interruptor, la importación envía `storage_strategy="copy"` para copiar los archivos físicamente.
- [ ] La suite completa de tests de la aplicación (`PYTHONPATH=. .venv/bin/pytest backend/tests`) pasa con éxito tras la reestructuración.

## 2026-06-30T19:29:19Z

Resolve two critical user-facing issues in the DomestiK application:
1. **Cover image removal UX bug**: When editing a resource, clicking the trash icon / "Quitar Portada" clears the text input but does not immediately clear the cover image preview or show "Sin portada" in the UI. However, on clicking save, the cover is actually deleted in the backend database. This visual mismatch makes the user believe the cover was not removed.
2. **Video playback/viewer failure**: Uploaded videos cannot be viewed, and the video player fails to render or play the files. The streaming API must properly handle standard Range requests (HTTP 206 Partial Content) to support scrubbing/seeking in modern browsers, and the frontend layout/player must render the video component correctly.

Working directory: /data/data/com.termux/files/home/DomestiK
Integrity mode: development

## Requirements

### R1. Fix Cover Image Removal UI/UX
- When editing a resource or importing a new one, clicking the "Quitar Portada" (delete/trash) button must immediately:
  - Clear the cover path in the text input.
  - Reset the cover preview container to display "Sin portada" instead of showing the old image or "Archivo no encontrado".
  - Ensure the UI is reactive and reflects the cleared state immediately before the user clicks save.
- Saving a resource with a cleared cover must correctly persist the removal in the backend database.

### R2. Fix Video Playback and Streaming
- Ensure the video player in the lección view (`frontend/app/course_detail.py` and `frontend/app/components/media_viewer.py`) properly renders a playable video element when a video resource is selected.
- The media streaming endpoint (`/api/v1/media/{media_id}/stream`) must support range-requests (handling `Range` headers, returning HTTP `206 Partial Content` with correct `Content-Range`, `Content-Length`, and `Accept-Ranges: bytes` headers) to allow browsers to load and seek/rewind the video.
- All tests in `backend/tests/test_media.py` must pass.

## Acceptance Criteria

### Cover Image Behavior
- [ ] In the edit resource dialog, clicking "Quitar Portada" replaces the cover image preview with the "Sin portada" state instantly.
- [ ] In the import dialog, clicking "Quitar Portada" replaces the cover image preview with the "Sin portada" state instantly.
- [ ] Saving the resource after clearing the cover updates the resource's `cover_path` to `""` or `None` in the database.

### Video Playback and Streaming
- [ ] The FastAPI media stream endpoint returns `206 Partial Content` when a valid range query is sent (e.g. `Range: bytes=0-9`).
- [ ] The `VideoViewer` HTML video component properly plays video assets and tracks playback progress periodically.
- [ ] Running `PYTHONPATH=. .venv/bin/pytest backend/tests` finishes successfully with all tests passing.
