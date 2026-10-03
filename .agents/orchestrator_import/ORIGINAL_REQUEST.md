# Original User Request

## Initial Request — 2026-06-24T12:09:01Z

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
