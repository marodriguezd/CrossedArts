import enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, field_validator
from pathlib import Path


class StorageStrategy(str, enum.Enum):
    SYMLINK = "symlink"       # Symlink (recommended, 0 extra bytes)
    COPY = "copy"             # Physical file copy
    REFERENCE = "reference"   # Direct reference to the original path


class StructureStrategy(str, enum.Enum):
    AUTO_HIERARCHICAL = "auto_hierarchical"  # Subfolders = modules
    FLAT = "flat"                              # Everything in one module


class ImportResourceRequest(BaseModel):
    """Input schema for importing a resource from a local folder."""
    title: str
    resource_type: str  # "course" or "book"
    category: str = "General"
    description: Optional[str] = None
    difficulty: str = "BEGINNER"  # Courses only
    author: Optional[str] = None  # Books only
    source_path: str  # Absolute path to the source directory
    storage_strategy: StorageStrategy = StorageStrategy.REFERENCE
    structure_strategy: StructureStrategy = StructureStrategy.AUTO_HIERARCHICAL
    cover_path: Optional[str] = None  # Cover URL or resolved path

    @field_validator('source_path')
    @classmethod
    def validate_source_path(cls, v: str) -> str:
        p = Path(v)
        if not p.is_absolute():
            raise ValueError('source_path debe ser una ruta absoluta')
        return v


class ImportResultResponse(BaseModel):
    """Response after importing a resource."""
    resource_id: str
    resource_type: str
    title: str
    modules_created: int = 0
    lessons_created: int = 0
    assets_created: int = 0
    warnings: List[str] = []


class DirectoryValidationResponse(BaseModel):
    """Directory validation response."""
    exists: bool
    is_directory: bool
    total_files: int = 0
    subdirectories: List[str] = []
    media_files: Dict[str, Any] = {}  # {"video": [...], "pdf": [...], "epub": [...]}

