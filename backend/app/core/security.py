import os
import re
from pathlib import Path
from typing import Union
from backend.app.core.compatibility import is_legacy_allowed_path_part
from backend.app.core.settings import settings

# Blocked system directories (resolved absolute and cross-platform).
BLOCKED_SYSTEM_DIRS = [
    "/etc", "/var", "/proc", "/sys", "/dev", "/boot", "/root",
    "/home/lost+found", "/usr/local/etc", "/tmp", "/var/tmp"
]

# Add Windows system folders when applicable.
if os.name == 'nt':
    system_root = os.environ.get('SystemRoot') or "C:\\Windows"
    program_files = os.environ.get('ProgramFiles') or "C:\\Program Files"
    program_files_x86 = os.environ.get('ProgramFiles(x86)') or "C:\\Program Files (x86)"
    program_data = os.environ.get('ProgramData') or "C:\\ProgramData"

    BLOCKED_SYSTEM_DIRS.extend([
        system_root,
        program_files,
        program_files_x86,
        program_data,
        "C:\\tmp",
        "D:\\tmp"
    ])

# Sensitive hidden folders blocked anywhere in the path.
BLOCKED_HIDDEN_DIR_NAMES = [
    ".ssh", ".gnupg", ".aws", ".gemini", ".config", ".env", ".git"
]


def _has_blocked_hidden_part(path: Path) -> bool:
    for part in path.parts:
        if part.startswith('.') and not is_legacy_allowed_path_part(part):
            return True
        if part in BLOCKED_HIDDEN_DIR_NAMES:
            return True
    return False


def _is_path_equal_or_subpath(path: str, parent: str) -> bool:
    """Check if `path` is equal to or located within `parent`, respecting OS case sensitivity."""
    if os.name == 'nt':
        p_lower, parent_lower = path.lower(), parent.lower()
        return p_lower == parent_lower or p_lower.startswith(parent_lower + os.sep)
    return path == parent or path.startswith(parent + os.sep)


def is_safe_path(path: Union[str, Path]) -> bool:
    """
    Check whether a file or directory path is safe, cross-platform (Windows and Linux).
    Blocks critical system directories and hidden config folders.
    Allows the app data directory, user-home subfolders, and external storage
    (drives on Windows, /media or /mnt on Linux).
    """
    try:
        path_str = str(path).strip()
        if not path_str:
            return False

        # Require an absolute path to avoid implicit resolution against CWD.
        if not os.path.isabs(path_str):
            return False

        resolved_path = os.path.abspath(os.path.realpath(path_str))

        # Check the app workspace (always allowed by definition).
        workspace_dir = os.path.abspath(os.path.realpath(str(settings.data_dir)))
        if _is_path_equal_or_subpath(resolved_path, workspace_dir):
            return not _has_blocked_hidden_part(Path(resolved_path))

        # Check against blocked system directories.
        for blocked_dir in BLOCKED_SYSTEM_DIRS:
            blocked_resolved = os.path.abspath(os.path.realpath(blocked_dir))
            if _is_path_equal_or_subpath(resolved_path, blocked_resolved):
                return False

        # Reject hidden folders/files in path components: block any part
        # starting with '.' except allowed namespaces.
        if _has_blocked_hidden_part(Path(resolved_path)):
            return False

        # Allowed scope outside the workspace:
        # - User-home subfolders (excluding the home itself for safety).
        # - External drives/media under /media or /mnt (Linux) or any drive on Windows.
        home_dir = os.path.abspath(os.path.realpath(os.path.expanduser("~")))
        is_exactly_home = (
            resolved_path.lower() == home_dir.lower()
            if os.name == 'nt'
            else resolved_path == home_dir
        )
        if is_exactly_home:
            return False

        if _is_path_equal_or_subpath(resolved_path, home_dir):
            return True

        if os.name == 'nt':
            # On Windows, any drive or external storage (C:\, D:\, E:\, ...) is valid
            # as long as it is not inside protected system folders.
            if re.match(r'^[a-zA-Z]:\\', resolved_path):
                return True
        else:
            # On Linux, explicitly allow /media, /run/media and /mnt.
            if any(_is_path_equal_or_subpath(resolved_path, prefix) for prefix in ("/media", "/run/media", "/mnt")):
                return True

        return False
    except Exception:
        return False
