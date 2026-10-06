"""
Registro (logging) estructurado de CrossedArts.

Todos los módulos del backend registran a través de `get_logger(...)` en lugar
de `print(...)`: los diagnósticos quedan etiquetados con nivel y módulo, pueden
silenciarse por configuración y no acaban en stdout mezclados con la salida de
la API.

Reglas de contenido (nunca registrar):
- claves de API ni secretos,
- datos personales de usuario,
- contenido completo de archivos o de modelos,
- salidas largas de LLM.
Los mensajes deben ser breves y suficientes para diagnosticar.
"""
import logging
import os

_ROOT_LOGGER_NAME = "crossedarts"
_configured = False


def configure_logging(level: str | None = None) -> None:
    """Configura el logger raíz del proyecto una única vez."""
    global _configured
    if _configured:
        return

    resolved_level = (level or os.getenv("CROSSEDARTS_LOG_LEVEL", "INFO")).upper()
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
            datefmt="%H:%M:%S",
        )
    )

    root = logging.getLogger(_ROOT_LOGGER_NAME)
    root.setLevel(getattr(logging, resolved_level, logging.INFO))
    root.addHandler(handler)
    # Sin propagación: evita duplicar mensajes si la aplicación anfitriona ya
    # configuró el logging raíz de Python.
    root.propagate = False
    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Devuelve un logger del proyecto (`crossedarts.<name>`)."""
    configure_logging()
    return logging.getLogger(f"{_ROOT_LOGGER_NAME}.{name}")
