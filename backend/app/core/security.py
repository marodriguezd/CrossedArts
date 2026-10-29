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
        if os.name == 'nt':
            in_workspace = resolved_path.lower() == workspace_dir.lower() or resolved_path.lower().startswith(workspace_dir.lower() + os.sep)
        else:
            in_workspace = resolved_path == workspace_dir or resolved_path.startswith(workspace_dir + os.sep)

        # Inside the workspace, only check sensitive hidden components, then allow.
        if in_workspace:
            return not _has_blocked_hidden_part(Path(resolved_path))

        # Check against blocked system directories.
        for blocked_dir in BLOCKED_SYSTEM_DIRS:
            blocked_resolved = os.path.abspath(os.path.realpath(blocked_dir))
            if os.name == 'nt':
                if resolved_path.lower() == blocked_resolved.lower() or resolved_path.lower().startswith(blocked_resolved.lower() + os.sep):
                    return False
            else:
                if resolved_path == blocked_resolved or resolved_path.startswith(blocked_resolved + os.sep):
                    return False

        # Reject hidden folders/files in path components: block any part
        # starting with '.' except allowed namespaces.
        if _has_blocked_hidden_part(Path(resolved_path)):
            return False

        # Allowed scope outside the workspace:
        # - User-home subfolders (excluding the home itself for safety).
        # - External drives/media under /media or /mnt (Linux) or any drive on Windows.
        home_dir = os.path.abspath(os.path.realpath(os.path.expanduser("~")))

        if os.name == 'nt':
            in_home_sub = resolved_path.lower().startswith(home_dir.lower() + os.sep)
            is_exactly_home = resolved_path.lower() == home_dir.lower()
        else:
            in_home_sub = resolved_path.startswith(home_dir + os.sep)
            is_exactly_home = resolved_path == home_dir

        if is_exactly_home:
            return False

        if in_home_sub:
            return True

        if os.name == 'nt':
            # On Windows, any drive or external storage (C:\, D:\, E:\, ...) is valid
            # as long as it is not inside protected system folders.
            if re.match(r'^[a-zA-Z]:\\', resolved_path):
                return True
        else:
            # On Linux, explicitly allow /media, /run/media and /mnt.
            in_media = resolved_path == "/media" or resolved_path.startswith("/media" + os.sep)
            in_run_media = resolved_path == "/run/media" or resolved_path.startswith("/run/media" + os.sep)
            in_mnt = resolved_path == "/mnt" or resolved_path.startswith("/mnt" + os.sep)
            if in_media or in_run_media or in_mnt:
                return True

        return False
    except Exception:
        return False
