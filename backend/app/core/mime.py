"""Resolución canónica de tipos MIME a partir de un nombre de archivo.

Antes, cada servicio resolvía el MIME por su cuenta y el scanner asignaba
``video/mp4`` a TODOS los vídeos (un .mkv o un .avi quedaban mal tipados). Aquí
se centraliza una única función determinista que usan la ingesta y el scanner.
"""

from pathlib import Path
from typing import Union
import mimetypes

# Mapa curado de extensiones -> tipo MIME canónico.
#
# Tiene prioridad sobre `mimetypes.guess_type` porque los valores de la stdlib
# dependen del registro del sistema operativo: por ejemplo `.mkv` o `.md` no
# resuelven igual en todas las instalaciones. Fijarlos aquí hace el tipado
# reproducible en cualquier máquina y sistema operativo.
_CANONICAL_MIME: dict[str, str] = {
    # Vídeo
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".m4v": "video/x-m4v",
    # Audio
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    # Documentos
    ".pdf": "application/pdf",
    ".epub": "application/epub+zip",
    ".txt": "text/plain",
    ".md": "text/markdown",
}

# Prefijos/tipos aceptados desde la stdlib.
#
# `mimetypes.guess_type` consulta el registro del sistema operativo, así que
# puede devolver tipos irrelevantes e inconsistentes entre máquinas (p. ej.
# `.xyz` -> `chemical/x-xyz`). Sólo se aceptan los tipos de media/documento
# relevantes para una biblioteca de aprendizaje; el resto degrada al tipo
# binario genérico, que es determinista.
_ACCEPTED_MIME_PREFIXES = ("video/", "audio/", "image/", "text/")
_ACCEPTED_MIME_TYPES = frozenset(
    {
        "application/pdf",
        "application/epub+zip",
        "application/zip",
        "application/json",
    }
)

DEFAULT_MIME_TYPE = "application/octet-stream"


def _is_acceptable_mime(mime: str) -> bool:
    return mime.startswith(_ACCEPTED_MIME_PREFIXES) or mime in _ACCEPTED_MIME_TYPES


def guess_mime_type(filename: Union[str, Path]) -> str:
    """Devuelve el tipo MIME de `filename` de forma determinista.

    Orden de resolución:
      1. Mapa canónico curado (valores estables entre sistemas).
      2. `mimetypes.guess_type` de la stdlib, sólo para tipos de media o
         documento reconocidos (evita valores dependientes del sistema).
      3. `application/octet-stream` si nada resuelve.

    La extensión se compara sin distinguir mayúsculas y se ignoran directorios.
    """
    name = Path(filename).name
    suffix = Path(name).suffix.lower()

    canonical = _CANONICAL_MIME.get(suffix)
    if canonical is not None:
        return canonical

    guessed, _ = mimetypes.guess_type(name)
    if guessed and _is_acceptable_mime(guessed):
        return guessed
    return DEFAULT_MIME_TYPE
