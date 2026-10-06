import os
import uuid
import shutil
import hashlib
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.models.resource import Course, Book, MediaAsset, LearningResource
from backend.app.models.course_structure import Module, Lesson
from backend.app.models.base import ResourceStatus, CourseDifficulty, LessonType
from backend.app.core.settings import settings
from backend.app.schemas.ingestion import (
    ImportResourceRequest, ImportResultResponse,
    StorageStrategy, StructureStrategy, DirectoryValidationResponse
)

# Extensiones soportadas por tipo
MEDIA_EXTENSIONS = {
    "video": [".mp4", ".webm", ".mov", ".mkv", ".avi"],
    "pdf": [".pdf"],
    "epub": [".epub"],
    "audio": [".mp3", ".wav", ".flac", ".ogg", ".m4a"],
}

MIME_MAP = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
    ".pdf": "application/pdf", ".epub": "application/epub+zip",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
    ".ogg": "audio/ogg", ".m4a": "audio/mp4",
}


def _get_media_type(ext: str) -> str:
    """Determina el tipo de media a partir de la extensión."""
    ext = ext.lower()
    for media_type, extensions in MEDIA_EXTENSIONS.items():
        if ext in extensions:
            return media_type
    return "unknown"


def _get_lesson_type(ext: str) -> LessonType:
    """Mapea extensión de archivo a LessonType."""
    ext = ext.lower()
    if ext in MEDIA_EXTENSIONS["video"]:
        return LessonType.VIDEO
    elif ext in MEDIA_EXTENSIONS["pdf"]:
        return LessonType.PDF
    elif ext in MEDIA_EXTENSIONS["epub"]:
        return LessonType.EPUB
    return LessonType.ARTICLE


def _get_all_extensions() -> set:
    """Retorna todas las extensiones multimedia soportadas."""
    exts = set()
    for ext_list in MEDIA_EXTENSIONS.values():
        exts.update(ext_list)
    return exts


class IngestionService:
    """Servicio de ingesta de contenido desde carpetas locales."""

    def __init__(self, db: Session):
        self.db = db
        self.pending_asset_ids: List[uuid.UUID] = []

    def validate_directory(self, path_str: str) -> DirectoryValidationResponse:
        """Valida un directorio y retorna un resumen de su contenido multimedia."""
        from backend.app.core.security import is_safe_path
        if not is_safe_path(path_str):
            return DirectoryValidationResponse(exists=False, is_directory=False)
            
        path = Path(path_str)
        if not path.exists():
            return DirectoryValidationResponse(exists=False, is_directory=False)
        if not path.is_dir():
            return DirectoryValidationResponse(exists=True, is_directory=False)

        all_exts = _get_all_extensions()
        media_files: Dict[str, List[str]] = {"video": [], "pdf": [], "epub": [], "audio": []}
        subdirs = []
        total_files = 0

        for item in sorted(path.iterdir()):
            if item.is_dir() and not item.name.startswith('.'):
                subdirs.append(item.name)
            elif item.is_file():
                total_files += 1
                ext = item.suffix.lower()
                if ext in all_exts:
                    mtype = _get_media_type(ext)
                    if mtype in media_files:
                        media_files[mtype].append(item.name)

        # Escanear subdirectorios recursivamente buscando archivos multimedia (máx. 3 niveles para evitar DoS)
        def scan_recursive(dir_path: Path, current_depth: int):
            nonlocal total_files
            if current_depth > 3:
                return
            try:
                for item in dir_path.iterdir():
                    if item.is_dir():
                        if not item.name.startswith('.'):
                            scan_recursive(item, current_depth + 1)
                    elif item.is_file():
                        total_files += 1
                        ext = item.suffix.lower()
                        if ext in all_exts:
                            mtype = _get_media_type(ext)
                            if mtype in media_files:
                                media_files[mtype].append(item.name)
            except Exception:
                pass

        for subdir in path.iterdir():
            if subdir.is_dir() and not subdir.name.startswith('.'):
                scan_recursive(subdir, 1)

        return DirectoryValidationResponse(
            exists=True,
            is_directory=True,
            total_files=total_files,
            subdirectories=subdirs,
            media_files=media_files
        )

    def _register_asset_for_extraction(self, asset_id: uuid.UUID, background_tasks: Optional[Any] = None) -> None:
        if background_tasks is not None:
            self.pending_asset_ids.append(asset_id)
        else:
            from backend.app.services.extractor import ContentIntelligenceManager
            ContentIntelligenceManager(self.db).extract_and_index(asset_id, commit=False)

    def import_resource(self, request: ImportResourceRequest, background_tasks: Optional[Any] = None) -> ImportResultResponse:
        """Importa un recurso (curso o libro) desde una carpeta local."""
        from backend.app.core.security import is_safe_path
        from typing import Any
        if not is_safe_path(request.source_path):
            raise ValueError(f"Acceso denegado a la ruta del directorio '{request.source_path}'.")

        source = Path(request.source_path)
        if not source.exists() or not source.is_dir():
            raise ValueError(f"El directorio '{request.source_path}' no existe o no es un directorio válido.")

        # Verificar que no exista ya un recurso con este source_path
        stmt = select(LearningResource).where(LearningResource.source_path == str(source.resolve()))
        existing = self.db.scalars(stmt).first()
        if existing:
            raise ValueError(f"Ya existe un recurso registrado con la ruta '{source.resolve()}' (ID: {existing.id}).")

        self.pending_asset_ids = []

        try:
            if request.resource_type == "course":
                res = self._import_course(request, source, background_tasks)
            elif request.resource_type == "book":
                res = self._import_book(request, source, background_tasks)
            else:
                raise ValueError(f"Tipo de recurso no soportado: '{request.resource_type}'. Use 'course' o 'book'.")
            self.db.commit()

            if self.pending_asset_ids and background_tasks is not None:
                def run_background_extraction_and_reindex(asset_ids: List[uuid.UUID]):
                    from backend.app.core.database import SessionLocal
                    from backend.app.services.extractor import ContentIntelligenceManager
                    from backend.app.services.embedding import EmbeddingService
                    
                    db_local = SessionLocal()
                    try:
                        manager = ContentIntelligenceManager(db_local)
                        for aid in asset_ids:
                            try:
                                manager.extract_and_index(aid, commit=True)
                            except Exception as e:
                                logger.error("Error en extracción en segundo plano para asset %s: %s", aid, e)
                        # Reindexar embeddings
                        EmbeddingService.index_all_unindexed(db_local)
                    except Exception as e:
                        logger.error("Error inesperado en extracción en segundo plano: %s", e)
                    finally:
                        db_local.close()
                
                background_tasks.add_task(run_background_extraction_and_reindex, self.pending_asset_ids)

            return res
        except Exception as e:
            self.db.rollback()
            raise e

    def _resolve_storage_path(self, source_file: Path, strategy: StorageStrategy, dest_dir: Path) -> Path:
        """Resuelve la ruta de almacenamiento según la estrategia elegida."""
        from backend.app.core.security import is_safe_path
        if not is_safe_path(source_file):
            raise ValueError("Acceso denegado a la ruta del archivo de origen especificado.")
            
        if strategy == StorageStrategy.REFERENCE:
            return source_file.resolve()

        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_file = dest_dir / source_file.name
        source_resolved = source_file.resolve()

        # Preserve identical basenames from different source folders without
        # silently pointing two lessons at the first physical file.
        if os.path.lexists(dest_file):
            try:
                existing_resolved = Path(os.path.realpath(dest_file))
                if existing_resolved != source_resolved:
                    stem = source_file.stem
                    suffix = source_file.suffix
                    fingerprint = hashlib.sha256(str(source_resolved).encode('utf-8')).hexdigest()[:10]
                    dest_file = dest_dir / f'{stem}_{fingerprint}{suffix}'
            except OSError:
                raise ValueError(f'No se pudo validar el destino de almacenamiento: {dest_file}')

        if strategy == StorageStrategy.SYMLINK:
            if not os.path.lexists(dest_file):
                dest_file.symlink_to(source_resolved)
            return dest_file
        elif strategy == StorageStrategy.COPY:
            if not os.path.lexists(dest_file):
                shutil.copy2(source_resolved, dest_file)
            return dest_file

        return source_file.resolve()

    def _import_course(self, request: ImportResourceRequest, source: Path, background_tasks: Optional[Any] = None) -> ImportResultResponse:
        """Importa un curso con módulos y lecciones desde la estructura de carpetas."""
        # Parsear dificultad
        diff_str = request.difficulty.upper()
        difficulty = CourseDifficulty[diff_str] if diff_str in CourseDifficulty.__members__ else CourseDifficulty.BEGINNER

        course = Course(
            id=uuid.uuid4(),
            title=request.title,
            description=request.description,
            category=request.category,
            status=ResourceStatus.NOT_STARTED,
            source_path=str(source.resolve()),
            difficulty=difficulty,
            cover_path=request.cover_path
        )
        self.db.add(course)
        self.db.flush()

        modules_created = 0
        lessons_created = 0
        assets_created = 0
        warnings: List[str] = []
        all_exts = _get_all_extensions()

        # Directorio destino para almacenamiento (si aplica symlink/copy)
        storage_base = settings.media_dir / str(course.id)

        if request.structure_strategy == StructureStrategy.AUTO_HIERARCHICAL:
            # Buscar subdirectorios como módulos
            subdirs = sorted([d for d in source.iterdir() if d.is_dir() and not d.name.startswith('.')])

            if subdirs:
                for mod_idx, subdir in enumerate(subdirs, start=1):
                    module = Module(
                        id=uuid.uuid4(),
                        course_id=course.id,
                        title=subdir.name,
                        order_index=mod_idx
                    )
                    self.db.add(module)
                    self.db.flush()
                    modules_created += 1

                    # Buscar archivos multimedia en este subdirectorio de forma recursiva
                    media_files = sorted([
                        f for f in subdir.rglob("*")
                        if f.is_file() and f.suffix.lower() in all_exts
                    ], key=lambda x: str(x))

                    for les_idx, mf in enumerate(media_files, start=1):
                        storage_dest = storage_base / subdir.name
                        resolved_path = self._resolve_storage_path(mf, request.storage_strategy, storage_dest)

                        lesson_type = _get_lesson_type(mf.suffix)
                        lesson = Lesson(
                            id=uuid.uuid4(),
                            module_id=module.id,
                            title=mf.stem,
                            lesson_type=lesson_type,
                            order_index=les_idx,
                            is_completed=False
                        )
                        self.db.add(lesson)
                        self.db.flush()
                        lessons_created += 1

                        asset = MediaAsset(
                            id=uuid.uuid4(),
                            resource_id=course.id,
                            lesson_id=lesson.id,
                            media_type=_get_media_type(mf.suffix),
                            file_path=str(resolved_path),
                            file_name=mf.name,
                            file_size=mf.stat().st_size if mf.exists() else 0,
                            mime_type=MIME_MAP.get(mf.suffix.lower(), "application/octet-stream")
                        )
                        self.db.add(asset)
                        self.db.flush()
                        assets_created += 1
                        
                        # Extraer e indexar metadatos automáticamente
                        self._register_asset_for_extraction(asset.id, background_tasks)

                # También procesar archivos sueltos en la raíz del source
                root_media = sorted([
                    f for f in source.iterdir()
                    if f.is_file() and f.suffix.lower() in all_exts
                ])
                if root_media:
                    root_module = Module(
                        id=uuid.uuid4(),
                        course_id=course.id,
                        title="Material Adicional",
                        order_index=modules_created + 1
                    )
                    self.db.add(root_module)
                    self.db.flush()
                    modules_created += 1

                    for les_idx, mf in enumerate(root_media, start=1):
                        storage_dest = storage_base / "_root"
                        resolved_path = self._resolve_storage_path(mf, request.storage_strategy, storage_dest)

                        lesson_type = _get_lesson_type(mf.suffix)
                        lesson = Lesson(
                            id=uuid.uuid4(),
                            module_id=root_module.id,
                            title=mf.stem,
                            lesson_type=lesson_type,
                            order_index=les_idx,
                            is_completed=False
                        )
                        self.db.add(lesson)
                        self.db.flush()
                        lessons_created += 1

                        asset = MediaAsset(
                            id=uuid.uuid4(),
                            resource_id=course.id,
                            lesson_id=lesson.id,
                            media_type=_get_media_type(mf.suffix),
                            file_path=str(resolved_path),
                            file_name=mf.name,
                            file_size=mf.stat().st_size if mf.exists() else 0,
                            mime_type=MIME_MAP.get(mf.suffix.lower(), "application/octet-stream")
                        )
                        self.db.add(asset)
                        self.db.flush()
                        assets_created += 1
                        
                        # Extraer e indexar metadatos automáticamente
                        self._register_asset_for_extraction(asset.id, background_tasks)
            else:
                # No hay subdirectorios, tratar como flat
                modules_created, lessons_created, assets_created, warnings = self._create_flat_module(
                    course, source, request.storage_strategy, storage_base, all_exts, warnings, background_tasks
                )
        else:
            # Estrategia FLAT explícita
            modules_created, lessons_created, assets_created, warnings = self._create_flat_module(
                course, source, request.storage_strategy, storage_base, all_exts, warnings, background_tasks
            )

        return ImportResultResponse(
            resource_id=str(course.id),
            resource_type="course",
            title=course.title,
            modules_created=modules_created,
            lessons_created=lessons_created,
            assets_created=assets_created,
            warnings=warnings
        )

    def _create_flat_module(
        self, course: Course, source: Path,
        storage_strategy: StorageStrategy, storage_base: Path,
        all_exts: set, warnings: List[str],
        background_tasks: Optional[Any] = None
    ) -> Tuple[int, int, int, List[str]]:
        """Crea un único módulo con todas las lecciones en orden plano."""
        modules_created = 0
        lessons_created = 0
        assets_created = 0

        module = Module(
            id=uuid.uuid4(),
            course_id=course.id,
            title="Contenido Principal",
            order_index=1
        )
        self.db.add(module)
        self.db.flush()
        modules_created = 1

        # Recopilar TODOS los archivos multimedia recursivamente
        media_files = []
        for root_dir, _, files in os.walk(source):
            for f in sorted(files):
                fp = Path(root_dir) / f
                if fp.is_file() and fp.suffix.lower() in all_exts:
                    media_files.append(fp)

        media_files.sort(key=lambda x: x.name)

        for les_idx, mf in enumerate(media_files, start=1):
            storage_dest = storage_base / "flat"
            resolved_path = self._resolve_storage_path(mf, storage_strategy, storage_dest)

            lesson_type = _get_lesson_type(mf.suffix)
            lesson = Lesson(
                id=uuid.uuid4(),
                module_id=module.id,
                title=mf.stem,
                lesson_type=lesson_type,
                order_index=les_idx,
                is_completed=False
            )
            self.db.add(lesson)
            self.db.flush()
            lessons_created += 1

            asset = MediaAsset(
                id=uuid.uuid4(),
                resource_id=course.id,
                lesson_id=lesson.id,
                media_type=_get_media_type(mf.suffix),
                file_path=str(resolved_path),
                file_name=mf.name,
                file_size=mf.stat().st_size if mf.exists() else 0,
                mime_type=MIME_MAP.get(mf.suffix.lower(), "application/octet-stream")
            )
            self.db.add(asset)
            self.db.flush()
            assets_created += 1
            
            # Extraer e indexar metadatos automáticamente
            self._register_asset_for_extraction(asset.id, background_tasks)

        if not media_files:
            warnings.append(f"No se encontraron archivos multimedia en '{source}'.")

        return modules_created, lessons_created, assets_created, warnings

    def _import_book(self, request: ImportResourceRequest, source: Path, background_tasks: Optional[Any] = None) -> ImportResultResponse:
        """Importa un libro desde una carpeta local."""
        book = Book(
            id=uuid.uuid4(),
            title=request.title,
            description=request.description,
            category=request.category,
            status=ResourceStatus.NOT_STARTED,
            source_path=str(source.resolve()),
            author=request.author or "Desconocido",
            reading_percentage=0.0,
            cover_path=request.cover_path
        )
        self.db.add(book)
        self.db.flush()

        assets_created = 0
        warnings: List[str] = []
        storage_base = settings.media_dir / str(book.id)
        book_exts = set(MEDIA_EXTENSIONS["pdf"] + MEDIA_EXTENSIONS["epub"])

        # Buscar archivos de libro en la carpeta (nivel raíz primero)
        book_files = sorted([
            f for f in source.iterdir()
            if f.is_file() and f.suffix.lower() in book_exts
        ])

        if not book_files:
            # Buscar recursivamente si no hay nada en raíz
            for root_dir, _, files in os.walk(source):
                for f in sorted(files):
                    fp = Path(root_dir) / f
                    if fp.is_file() and fp.suffix.lower() in book_exts:
                        book_files.append(fp)

        for bf in book_files:
            resolved_path = self._resolve_storage_path(bf, request.storage_strategy, storage_base)
            mtype = "pdf" if bf.suffix.lower() == ".pdf" else "epub"
            mime = MIME_MAP.get(bf.suffix.lower(), "application/octet-stream")

            asset = MediaAsset(
                id=uuid.uuid4(),
                resource_id=book.id,
                lesson_id=None,
                media_type=mtype,
                file_path=str(resolved_path),
                file_name=bf.name,
                file_size=bf.stat().st_size if bf.exists() else 0,
                mime_type=mime
            )
            self.db.add(asset)
            self.db.flush()
            assets_created += 1
            
            # Extraer e indexar metadatos automáticamente
            self._register_asset_for_extraction(asset.id, background_tasks)

        if not book_files:
            warnings.append(f"No se encontraron archivos PDF o EPUB en '{source}'.")

        return ImportResultResponse(
            resource_id=str(book.id),
            resource_type="book",
            title=book.title,
            modules_created=0,
            lessons_created=0,
            assets_created=assets_created,
            warnings=warnings
        )
