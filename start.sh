#!/usr/bin/env bash
# =============================================================================
# DomestiK — Script de inicio (Linux / macOS)
# Uso:  chmod +x start.sh && ./start.sh [--dev] [--quiet]
# =============================================================================
set -euo pipefail

# ── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[DomestiK]${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()  { echo -e "${RED}  ✗${NC} $*"; exit 1; }

# ── Flags ────────────────────────────────────────────────────────────────────
DEV_MODE=false
QUIET=false
for arg in "$@"; do
  case "$arg" in
    --dev)   DEV_MODE=true ;;
    --quiet) QUIET=true ;;
    --help|-h)
      echo "Uso: ./start.sh [--dev] [--quiet]"
      echo "  --dev    Habilita auto-reload (desarrollo)"
      echo "  --quiet  Suprime salida de pip/install"
      exit 0 ;;
  esac
done

# ── Directorio del proyecto ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Actualización de Git ─────────────────────────────────────────────────────
info "Comprobando actualizaciones del proyecto..."
if command -v git &>/dev/null && [ -d ".git" ]; then
  if git fetch --quiet 2>/dev/null; then
    if git pull --ff-only --quiet 2>/dev/null; then
      ok "Proyecto actualizado correctamente (o ya estaba al dia)."
    else
      warn "Hay cambios locales o ramas divergentes. Se omitió la actualización automática."
    fi
  else
    warn "No se pudo conectar al repositorio remoto para actualizar."
  fi
else
  warn "Git no encontrado o no es un repositorio Git. Saltando actualización."
fi

PORT=${DOMESTIK_PORT:-8088}
PYTHON_MIN="3.11"
VENV_DIR=".venv"
DATA_DIR="$HOME/.domestik"
ENV_FILE="$DATA_DIR/.env"
EXAMPLE_ENV="$SCRIPT_DIR/.env.example"

# Suppress mode flag for pip
PIP_QUIET=""
if $QUIET; then PIP_QUIET="--quiet"; fi

# ── Funciones auxiliares ─────────────────────────────────────────────────────
version_gte() {
  [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

find_python311() {
  for cmd in python3.11 python3 python; do
    if command -v "$cmd" &>/dev/null; then
      ver=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?')
      if version_gte "$ver" "$PYTHON_MIN"; then
        echo "$cmd"
        return 0
      fi
    fi
  done
  return 1
}

install_python_debian() {
  info "Detectado Debian/Ubuntu — instalando Python 3.11..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3.11 python3.11-venv python3.11-dev > /dev/null 2>&1
}

install_python_fedora() {
  info "Detectado Fedora — instalando Python 3.11..."
  sudo dnf install -y -q python3.11 python3.11-devel 2>/dev/null
}

install_python_macos() {
  info "Detectado macOS — instalando Python 3.11 via Homebrew..."
  if ! command -v brew &>/dev/null; then
    fail "Homebrew no esta instalado. Instalalo desde https://brew.sh"
  fi
  brew install python@3.11
}

# ── 1. Detectar / instalar Python 3.11 ──────────────────────────────────────
info "Verificando Python >= ${PYTHON_MIN}..."
PYTHON_CMD=""
if PYTHON_CMD=$(find_python311); then
  ok "Python encontrado: $($PYTHON_CMD --version 2>&1)"
else
  warn "Python >= ${PYTHON_MIN} no encontrado. Intentando instalar..."
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command -v apt-get &>/dev/null; then
      install_python_debian
    elif command -v dnf &>/dev/null; then
      install_python_fedora
    else
      fail "Gestor de paquetes no soportado. Instala Python 3.11 manualmente."
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    install_python_macos
  else
    fail "Sistema operativo no soportado: $OSTYPE"
  fi

  if PYTHON_CMD=$(find_python311); then
    ok "Python instalado: $($PYTHON_CMD --version 2>&1)"
  else
    fail "No se pudo instalar Python 3.11. Instalalo manualmente: https://www.python.org/downloads/"
  fi
fi

# ── 2. Crear entorno virtual ────────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
  info "Creando entorno virtual en .venv/..."
  "$PYTHON_CMD" -m venv "$VENV_DIR"
  ok "Entorno virtual creado."
else
  ok "Entorno virtual existente."
fi

# ── 3. Activar entorno virtual ──────────────────────────────────────────────
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
ok "Entorno virtual activado."

# ── 4. Instalar dependencias ───────────────────────────────────────────────
info "Instalando dependencias..."
pip install --upgrade pip $PIP_QUIET
pip install -r backend/requirements.txt $PIP_QUIET
ok "Dependencias instaladas."

# ── 5. Directorio de datos y .env ───────────────────────────────────────────
mkdir -p "$DATA_DIR"
ok "Directorio de datos: $DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$EXAMPLE_ENV" ]; then
    cp "$EXAMPLE_ENV" "$ENV_FILE"
    ok "Archivo .env creado desde .env.example"
  else
    touch "$ENV_FILE"
    ok "Archivo .env creado (vacio)."
  fi
fi

# Asegurar puerto configurado en .env
if grep -qE '^\s*#\s*PORT=' "$ENV_FILE" 2>/dev/null; then
  sed -i.bak "s/^\s*#\s*PORT=.*/PORT=$PORT/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  ok "Puerto configurado: $PORT"
elif ! grep -qE '^\s*PORT=' "$ENV_FILE" 2>/dev/null; then
  printf "\n# Configurado por start.sh\nPORT=%s\n" "$PORT" >> "$ENV_FILE"
  ok "Puerto configurado: $PORT"
else
  ok "Puerto ya configurado en .env"
fi

# Asegurar embedding_provider configurado a huggingface en .env
if grep -qE '^\s*(#\s*)?EMBEDDING_PROVIDER\s*=\s*(mock|""|'\'\''|""\s*)' "$ENV_FILE" 2>/dev/null; then
  sed -i.bak "s/^\s*\(#\s*\)\?EMBEDDING_PROVIDER\s*=.*/EMBEDDING_PROVIDER=huggingface/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  ok "Configurado proveedor de embeddings local: huggingface"
elif ! grep -qE '^\s*EMBEDDING_PROVIDER=' "$ENV_FILE" 2>/dev/null; then
  printf "\n# Configurado automáticamente por start.sh\nEMBEDDING_PROVIDER=huggingface\n" >> "$ENV_FILE"
  ok "Configurado proveedor de embeddings local: huggingface"
fi

# ── 6. Migraciones de base de datos ────────────────────────────────────────
info "Aplicando migraciones de base de datos..."
export PYTHONPATH="."
if alembic -c backend/alembic.ini upgrade head 2>/dev/null; then
  ok "Base de datos lista."
else
  warn "Alembic no aplico migraciones (puede ser normal si la DB ya esta al dia)."
fi

# ── 7. Crear directorios auxiliares ─────────────────────────────────────────
mkdir -p "$DATA_DIR/content" "$DATA_DIR/covers"
ok "Directorios de contenido y portadas listos."

# ── 8. Verificar puerto disponible ─────────────────────────────────────────
if command -v lsof &>/dev/null && lsof -i ":$PORT" -sTCP:LISTEN &>/dev/null; then
  warn "Puerto $PORT en uso. Probando 8089..."
  PORT=8089
  sed -i.bak "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  ok "Puerto cambiado a: $PORT"
fi

# ── 9. Iniciar servidor ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}===========================================================${NC}"
echo -e "${BOLD}  DomestiK — Gestor de Aprendizaje${NC}"
echo -e "${BOLD}===========================================================${NC}"
echo -e "  URL:    ${GREEN}http://127.0.0.1:${PORT}${NC}"
echo -e "  Datos:  ${CYAN}${DATA_DIR}${NC}"
echo -e "  Modo:   $(${DEV_MODE} && echo "Desarrollo (auto-reload)" || echo "Produccion")"
echo -e "${BOLD}===========================================================${NC}"
echo ""

export PYTHONPATH="."
export PORT="$PORT"

# ── 10. Abrir el navegador automáticamente ──────────────────────────────────
(
  python -c "
import socket, time, webbrowser, subprocess, shutil, sys

url = 'http://127.0.0.1:$PORT'

for _ in range(60):
    try:
        with socket.create_connection(('127.0.0.1', $PORT), timeout=1):
            break
    except OSError:
        time.sleep(0.5)

# Intentar abrir en Opera primero
opera_candidates = ['opera', 'opera-stable']
if sys.platform == 'darwin':
    opera_paths = ['/Applications/Opera.app/Contents/MacOS/Opera']
else:
    opera_paths = ['/usr/bin/opera', '/usr/bin/opera-stable', '/opt/opera/opera', '/snap/bin/opera']

for candidate in opera_candidates:
    if shutil.which(candidate):
        try:
            subprocess.Popen([candidate, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sys.exit(0)
        except Exception:
            pass

for path in opera_paths:
    import os
    if os.path.isfile(path) and os.access(path, os.X_OK):
        try:
            subprocess.Popen([path, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sys.exit(0)
        except Exception:
            pass

# Fallback: navegador predeterminado
webbrowser.open(url)
"
) &>/dev/null &

exec python -m backend.app.main
