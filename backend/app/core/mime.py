"""Canonical MIME type resolution from a file name.

Previously each service resolved MIME on its own and the scanner assigned
``video/mp4`` to ALL videos (a .mkv or .avi ended up mistyped). A single
deterministic function used by ingestion and the scanner is centralized here.
"""

from pathlib import Path
from typing import Union
import mimetypes

# Curated extension -> canonical MIME type map.
#
# Takes precedence over `mimetypes.guess_type` because stdlib values depend on
# the OS registry: e.g. `.mkv` or `.md` do not resolve the same on every
# install. Pinning them here keeps typing reproducible on any machine and OS.
_CANONICAL_MIME: dict[str, str] = {
    # Video
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
    # Documents
    ".pdf": "application/pdf",
    ".epub": "application/epub+zip",
    ".txt": "text/plain",
    ".md": "text/markdown",
}

# Prefixes/types accepted from the stdlib.
#
# `mimetypes.guess_type` consults the OS registry, so it can return irrelevant
# and machine-inconsistent types (e.g. `.xyz` -> `chemical/x-xyz`). Only media/
# document types relevant to a learning library are accepted; the rest falls
# back to the generic binary type, which is deterministic.
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
    """Return the MIME type of `filename` deterministically.

    Resolution order:
      1. Curated canonical map (stable values across systems).
      2. Stdlib `mimetypes.guess_type`, only for recognized media or
         document types (avoids system-dependent values).
      3. `application/octet-stream` when nothing resolves.

    The extension is compared case-insensitively; directories are ignored.
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
