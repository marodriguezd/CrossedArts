#!/bin/bash

# Obtener la ruta del directorio donde está guardado este script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verificar si el entorno virtual existe
if [ ! -d ".venv" ]; then
    echo "[Error] No se encontró el entorno virtual (.venv) en $SCRIPT_DIR"
    exit 1
fi

# Activar el entorno virtual
echo "[DomestiK] Activando entorno virtual..."
source .venv/bin/activate

# Arrancar la aplicación
echo "[DomestiK] Iniciando aplicación..."
python -m backend.app.main
