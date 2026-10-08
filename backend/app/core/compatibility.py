"""
CrossedArts — Legacy DomestiK Compatibility Boundary.

This module centralizes all backward compatibility translation and resolution
for databases, directories, and settings originating from the legacy DomestiK era.

Design Rationale:
- Keeps legacy quirks isolated from current core business logic.
- Preserves backward compatibility without spreading `.domestik` checks across arbitrary modules.
- New features should exclusively reference CrossedArts namespaces.
"""
from pathlib import Path


def resolve_legacy_env_file() -> Path:
    """
    Returns ~/.crossedarts/.env if present, otherwise falls back to ~/.domestik/.env.
    """
    crossedarts_env = Path.home() / ".crossedarts" / ".env"
    if crossedarts_env.exists():
        return crossedarts_env
    return Path.home() / ".domestik" / ".env"


def resolve_legacy_data_dir() -> Path:
    """
    Resolves data directory, defaulting to ~/.crossedarts unless only ~/.domestik exists.
    """
    primary = Path.home() / ".crossedarts"
    legacy = Path.home() / ".domestik"
    if legacy.exists() and not primary.exists():
        return legacy
    return primary


def resolve_legacy_db_path(data_dir: Path) -> Path:
    """
    Resolves database path within data_dir, defaulting to crossedarts.db unless only domestik.db exists.
    """
    primary_db = data_dir / "crossedarts.db"
    legacy_db = data_dir / "domestik.db"
    if legacy_db.exists() and not primary_db.exists():
        return legacy_db
    return primary_db


def is_legacy_allowed_path_part(part: str) -> bool:
    """
    Checks if a dot-prefixed path component is an explicitly allowed data namespace.
    """
    return part in (".domestik", ".crossedarts")
