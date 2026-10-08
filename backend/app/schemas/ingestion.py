import enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, field_validator
from pathlib import Path


class StorageStrategy(str, enum.Enum):
    SYMLINK = "symlink"       # Enlace simbólico (recomendado, 0 bytes extra)
    COPY = "copy"             # Copia física de archivos
    REFERENCE = "reference"   # Referencia directa a la ruta original


class StructureStrategy(str, enum.Enum):
    AUTO_HIERARCHICAL = "auto_hierarchical"  # Subcarpetas = Módulos
    FLAT = "flat"                              # Todo en un único módulo


class ImportResourceRequest(BaseModel):
    """Esquema de entrada para importar un recurso desde una carpeta local."""
    title: str
    resource_type: str  # "course" o "book"
    category: str = "General"
    description: Optional[str] = None
    difficulty: str = "BEGINNER"  # Solo para cursos
    author: Optional[str] = None  # Solo para libros
    source_path: str  # Ruta absoluta al directorio fuente
    storage_strategy: StorageStrategy = StorageStrategy.REFERENCE
    structure_strategy: StructureStrategy = StructureStrategy.AUTO_HIERARCHICAL
    cover_path: Optional[str] = None  # URL o ruta resuelta de la portada

    @field_validator('source_path')
    @classmethod
    def validate_source_path(cls, v: str) -> str:
        p = Path(v)
        if not p.is_absolute():
            raise ValueError('source_path debe ser una ruta absoluta')
        return v


class ImportResultResponse(BaseModel):
    """Respuesta tras importar un recurso."""
    resource_id: str
    resource_type: str
    title: str
    modules_created: int = 0
    lessons_created: int = 0
    assets_created: int = 0
    warnings: List[str] = []


class DirectoryValidationResponse(BaseModel):
    """Respuesta de validación de un directorio."""
    exists: bool
    is_directory: bool
    total_files: int = 0
    subdirectories: List[str] = []
    media_files: Dict[str, Any] = {}  # {"video": [...], "pdf": [...], "epub": [...]}

