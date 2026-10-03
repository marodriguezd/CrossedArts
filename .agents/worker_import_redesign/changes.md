# Changes Document — worker_import_redesign

## 1. Modificación de `frontend/app/components/import_dialog.py`
- Eliminado el selector de pestañas/modos (`import_mode`, `self._render_mode_selection`, etc.).
- Simplificado el flujo para mantener únicamente la selección de directorio en el servidor mediante `FolderPickerDialog`.
- Configurada la validación automática al confirmar la selección en el diálogo `FolderPickerDialog` a través de un callback asíncrono (`_on_folder_selected` y `_validate_directory` usando `asyncio.create_task`).
- Añadido el interruptor/switch "Copiar archivos físicamente a la biblioteca" que por defecto es `False`.
- Configurado el bloque de importación final (`_do_import`) para enviar `storage_strategy="copy"` si el switch está activado, y `storage_strategy="reference"` en caso contrario.
- Limpieza completa y eliminación del puente nativo `self._bridge`, eventos de subida/selección nativa (`_on_native_folder_selected`, `_on_upload_done`), scripts JS de webkitdirectory (`_get_picker_js`, `_inject_resources`), constantes globales de ID y estados no utilizados.

## 2. Corrección de Bug en `backend/app/services/ingestion.py`
- Corregido un fallo en `_resolve_storage_path` donde se llamaba al método inexistente `.lexists()` en un objeto `Path` (PosixPath). Reemplazado con `os.path.lexists(dest_file)`.

## 3. Cobertura de Pruebas en `backend/tests/test_ingestion_api.py`
- Creado un archivo de pruebas integrado completo para validar:
  - El endpoint `/api/v1/content/validate-directory`.
  - El endpoint `/api/v1/content/import` con estrategias de almacenamiento de tipo `reference` y `copy`.
  - Escenarios de rutas válidas, inexistentes y no seguras/fuera del workspace.
  - El correcto estado y persistencia de modelos ORM (`Course`, `Book`, `Module`, `Lesson`, `MediaAsset`) en la base de datos de pruebas.

## 4. Comandos Ejecutados
- Ejecución de pruebas del frontend:
  ```bash
  PYTHONPATH=. .venv/bin/pytest backend/tests/test_frontend.py
  ```
- Ejecución de pruebas de la API de ingesta:
  ```bash
  PYTHONPATH=. .venv/bin/pytest backend/tests/test_ingestion_api.py
  ```
- Ejecución de suite de pruebas completa:
  ```bash
  PYTHONPATH=. .venv/bin/pytest backend/tests -x -q
  ```
