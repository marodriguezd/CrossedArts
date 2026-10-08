import os
import json
import yaml
import uuid
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any, Iterator
from pathlib import Path
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.logging import get_logger
from backend.app.core.mime import guess_mime_type
from backend.app.models.resource import Course, Book, MediaAsset
from backend.app.models.base import ResourceStatus, CourseDifficulty

logger = get_logger("services.scanner")

# Extensiones reconocidas por el scanner.
VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".mkv", ".avi"]
BOOK_EXTENSIONS = [".pdf", ".epub"]

# Profundidad de recorrido por defecto y máxima (evita crawls sin límite).
DEFAULT_MAX_DEPTH = 3
MAX_SCAN_DEPTH = 8
# Profundidad con la que un scanner busca archivos dentro de su carpeta de recurso.
RESOURCE_FILE_DEPTH = 3

# Pistas de carpetas organizadoras históricas (compatibilidad). Se usan como
# respaldo SOLO cuando no hay metadata, nunca como única señal: la detección
# principal es contenido directo (vídeos / pdf / epub) o metadata explícita.
COURSE_FOLDER_HINTS = {"courses", "cursos"}
BOOK_FOLDER_HINTS = {"books", "libros"}


def iter_files_bounded(
    path: Path, extensions: List[str], max_depth: int
) -> Iterator[Path]:
    """
    Recorre `path` de forma acotada y ordenada, devolviendo archivos con las
    extensiones indicadas. `max_depth` limita los niveles de subcarpetas para
    que el escaneo nunca se convierta en un crawl sin límite.
    """
    path = Path(path)
    if not path.is_dir():
        return
    root_depth = len(path.parts)
    for root_dir, dirnames, filenames in os.walk(path):
        current_depth = len(Path(root_dir).parts) - root_depth
        # No descender más allá del límite y no seguir enlaces simbólicos.
        dirnames[:] = sorted(
            d for d in dirnames if not (Path(root_dir) / d).is_symlink()
        )
        if current_depth >= max_depth:
            dirnames[:] = []
        for filename in sorted(filenames):
            candidate = Path(root_dir) / filename
            if candidate.suffix.lower() in extensions:
                yield candidate


class ScanResult(BaseModel):
    discovered: int = 0
    created: int = 0
    updated: int = 0
    errors: List[str] = []
    warnings: List[str] = []


class BaseScanner(ABC):
    def __init__(self, resource_type: str):
        self.resource_type = resource_type

    @abstractmethod
    def can_handle(self, path: Path, metadata: Optional[Dict[str, Any]]) -> bool:
        """Determina si este scanner puede procesar el directorio dado."""
        pass

    @abstractmethod
    def scan(self, db: Session, path: Path, metadata: Optional[Dict[str, Any]], background_tasks: Optional[Any] = None) -> tuple[bool, bool]:
        """
        Procesa el recurso de aprendizaje en el path dado.
        Retorna una tupla (creado: bool, actualizado: bool).
        """
        pass

    def load_metadata(self, path: Path) -> Optional[Dict[str, Any]]:
        """
        Carga la metadata de forma priorizada: metadata.json > metadata.yaml.
        """
        json_path = path / "metadata.json"
        yaml_path = path / "metadata.yaml"

        if json_path.is_file():
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                raise ValueError(f"Error parseando metadata.json en {path}: {str(e)}")

        if yaml_path.is_file():
            try:
                with open(yaml_path, "r", encoding="utf-8") as f:
                    return yaml.safe_load(f)
            except Exception as e:
                raise ValueError(f"Error parseando metadata.yaml en {path}: {str(e)}")

        return None

    @staticmethod
    def _has_parent_hint(path: Path, hints: set) -> bool:
        """¿Alguna carpeta contenedora tiene un nombre organizador histórico?"""
        return any(part.lower() in hints for part in path.parts[:-1])


class CourseScanner(BaseScanner):
    def __init__(self):
        super().__init__("course")

    def can_handle(self, path: Path, metadata: Optional[Dict[str, Any]]) -> bool:
        # 1. Metadata explícita: máxima prioridad.
        if metadata and metadata.get("resource_type") == "course":
            return True
        if metadata and metadata.get("resource_type") not in (None, "course"):
            return False
        if not path.is_dir():
            return False
        # 2. Contenido directo: una carpeta con vídeos es un curso.
        if any(p.suffix.lower() in VIDEO_EXTENSIONS for p in path.iterdir() if p.is_file()):
            return True
        # 3. Compatibilidad: carpeta bajo un contenedor histórico (Courses/…).
        #    No clasifica la carpeta contenedora en sí (sus archivos directos
        #    ya se habrían detectado en el paso 2).
        if self._has_parent_hint(path, COURSE_FOLDER_HINTS):
            return True
        return False

    def scan(self, db: Session, path: Path, metadata: Optional[Dict[str, Any]], background_tasks: Optional[Any] = None) -> tuple[bool, bool]:
        source_path = str(path.resolve())

        # Buscar recurso existente por source_path
        stmt = select(Course).where(Course.source_path == source_path)
        course = db.scalars(stmt).first()

        created = False
        updated = False

        # Datos por defecto (Heurística)
        title = path.name
        description = None
        category = "General"
        difficulty = CourseDifficulty.BEGINNER

        # Sobrescribir con metadata si existe
        if metadata:
            title = metadata.get("title", title)
            description = metadata.get("description", description)
            category = metadata.get("category", category)
            diff_str = metadata.get("difficulty", "beginner").upper()
            if diff_str in CourseDifficulty.__members__:
                difficulty = CourseDifficulty[diff_str]

        if not course:
            course = Course(
                id=uuid.uuid4(),
                title=title,
                description=description,
                category=category,
                status=ResourceStatus.NOT_STARTED,
                source_path=source_path,
                difficulty=difficulty
            )
            db.add(course)
            created = True
        else:
            # Validar si hay cambios para actualizar
            if (course.title != title or
                course.description != description or                 course.category != category or
                 course.difficulty != difficulty):
                course.title = title
                course.description = description
                course.category = category
                course.difficulty = difficulty
                db.add(course)
                updated = True

        db.commit()

        # ==========================================
        # INDEXACIÓN DE VÍDEOS (MEDIA ASSETS) DEL CURSO
        # ==========================================
        # Recorrido acotado: nunca se camina el sistema de archivos sin límite.
        video_files = list(iter_files_bounded(path, VIDEO_EXTENSIONS, RESOURCE_FILE_DEPTH))

        # Cache all existing media assets for this course to avoid N+1 queries in loops
        existing_assets_list = db.scalars(
            select(MediaAsset).where(MediaAsset.resource_id == course.id)
        ).all()
        existing_assets_by_path = {a.file_path: a for a in existing_assets_list}

        # Primero, asegurar que tenemos lecciones para asociar.
        # Si el curso no tiene módulos/lecciones en la base de datos, creamos una estructura heurística básica
        from backend.app.models.course_structure import Module, Lesson

        stmt_modules = select(Module).where(Module.course_id == course.id)
        existing_modules = db.scalars(stmt_modules).all()

        if not existing_modules and path.is_dir():
            # Crear un módulo por defecto
            default_mod = Module(id=uuid.uuid4(), course_id=course.id, title="Contenido Principal", order_index=1)
            db.add(default_mod)
            db.commit()

            for idx, vf in enumerate(video_files, start=1):
                lesson_title = vf.stem
                lesson = Lesson(
                    id=uuid.uuid4(),
                    module_id=default_mod.id,
                    title=lesson_title,
                    is_completed=False,
                    order_index=idx
                )
                db.add(lesson)
                db.flush()

                # Crear MediaAsset
                asset = MediaAsset(
                    id=uuid.uuid4(),
                    resource_id=course.id,
                    lesson_id=lesson.id,
                    media_type="video",
                    file_path=str(vf.resolve()),
                    file_name=vf.name,
                    file_size=vf.stat().st_size if vf.exists() else 0,
                    mime_type=guess_mime_type(vf)
                )
                db.add(asset)
                db.flush()
                self._schedule_extraction(db, asset.id, background_tasks)

        else:
            # Si ya existen módulos y lecciones en BD, precargamos las lecciones UNA sola vez (evita N+1 en el bucle)
            stmt_les = (
                select(Lesson)
                .join(Lesson.module)
                .where(Lesson.module.has(course_id=course.id))
            )
            course_lessons = db.scalars(stmt_les).all()

            # Mapeamos los archivos físicos a las lecciones existentes
            for file_path in video_files:
                # Evitar duplicados por ruta resuelta.
                existing_asset = existing_assets_by_path.get(str(file_path.resolve()))
                if existing_asset:
                    if not existing_asset.extracted_metadata:
                        self._schedule_extraction(db, existing_asset.id, background_tasks)
                    continue

                # Emparejar con lección: por número inicial del nombre (orden) o
                # por título de lección normalizado (mapa explícito de archivo).
                lesson_match = self._match_lesson(course_lessons, file_path)

                asset = MediaAsset(
                    id=uuid.uuid4(),
                    resource_id=course.id,
                    lesson_id=lesson_match.id if lesson_match else None,
                    media_type="video",
                    file_path=str(file_path.resolve()),
                    file_name=file_path.name,
                    file_size=file_path.stat().st_size if file_path.exists() else 0,
                    mime_type=guess_mime_type(file_path)
                )
                db.add(asset)
                db.flush()
                existing_assets_by_path[asset.file_path] = asset
                self._schedule_extraction(db, asset.id, background_tasks)

        db.commit()
        return created, updated

    @staticmethod
    def _normalize_title(value: str) -> str:
        import re
        import unicodedata

        text = unicodedata.normalize("NFD", str(value))
        text = "".join(c for c in text if unicodedata.category(c) != "Mn").lower()
        text = re.sub(r"^[\d\s._-]+", "", text)
        return re.sub(r"[^a-z0-9]+", " ", text).strip()

    def _match_lesson(self, lessons: list, file_path: Path):
        """
        Empareja un archivo de vídeo con una lección de la lista precargada del curso.

        Estrategia (sin inventar relaciones):
        1. Número inicial del archivo -> `order_index` de una lección.
        2. Título del archivo normalizado -> título de lección normalizado.
        """
        import re

        match = re.search(r"^\d+", file_path.name)
        if match:
            order_num = int(match.group())
            for lesson in lessons:
                if lesson.order_index == order_num:
                    return lesson

        normalized_stem = self._normalize_title(file_path.stem)
        if normalized_stem:
            for lesson in lessons:
                if self._normalize_title(lesson.title) == normalized_stem:
                    return lesson
        return None

    @staticmethod
    def _schedule_extraction(db: Session, asset_id, background_tasks: Optional[Any]) -> None:
        """Programa (o ejecuta) la extracción de contenido de un asset."""
        if background_tasks is not None:
            def run_background_extraction(asset_id=asset_id):
                # `SessionLocal` se importa en tiempo de llamada: las pruebas
                # parchean la fábrica para usar su propia base.
                from backend.app.core.database import SessionLocal
                from backend.app.services.extractor import ContentIntelligenceManager
                db_local = SessionLocal()
                try:
                    manager = ContentIntelligenceManager(db_local)
                    manager.extract_and_index(asset_id, commit=True)
                finally:
                    db_local.close()
            background_tasks.add_task(run_background_extraction)
        else:
            from backend.app.services.extractor import ContentIntelligenceManager
            ContentIntelligenceManager(db).extract_and_index(asset_id, commit=True)


class BookScanner(BaseScanner):
    def __init__(self):
        super().__init__("book")

    def can_handle(self, path: Path, metadata: Optional[Dict[str, Any]]) -> bool:
        # 1. Metadata explícita: máxima prioridad.
        if metadata and metadata.get("resource_type") == "book":
            return True
        if metadata and metadata.get("resource_type") not in (None, "book"):
            return False
        if not path.is_dir():
            return False
        # 2. Contenido directo: una carpeta con PDF/EPUB es un libro, esté
        #    donde esté (ya no depende de llamarse Books/).
        return any(p.suffix.lower() in BOOK_EXTENSIONS for p in path.iterdir() if p.is_file())

    def scan(self, db: Session, path: Path, metadata: Optional[Dict[str, Any]], background_tasks: Optional[Any] = None) -> tuple[bool, bool]:
        source_path = str(path.resolve())

        # Buscar recurso existente por source_path
        stmt = select(Book).where(Book.source_path == source_path)
        book = db.scalars(stmt).first()

        created = False
        updated = False

        # Datos por defecto (Heurística)
        title = path.name
        description = None
        category = "General"
        author = "Desconocido"

        # Buscar archivos de libros físicos (profundidad acotada).
        book_files = list(iter_files_bounded(path, BOOK_EXTENSIONS, RESOURCE_FILE_DEPTH))

        # Si la carpeta tiene metadata
        if metadata:
            title = metadata.get("title", title)
            description = metadata.get("description", description)
            category = metadata.get("category", category)
            author = metadata.get("author", author)

        if not book:
            book = Book(
                id=uuid.uuid4(),
                title=title,
                description=description or (f"Archivo: {book_files[0].name}" if book_files else None),
                category=category,
                status=ResourceStatus.NOT_STARTED,
                source_path=source_path,
                author=author,
                reading_percentage=0.0
            )
            db.add(book)
            created = True
        else:
            if (book.title != title or
                book.description != description or
                book.category != category or
                 book.author != author):
                book.title = title
                book.category = category
                book.author = author
                if description:
                    book.description = description
                db.add(book)
                updated = True

        db.commit()

        # Cache all existing media assets for this book to avoid N+1 queries in loop
        existing_assets_list = db.scalars(
            select(MediaAsset).where(MediaAsset.resource_id == book.id)
        ).all()
        existing_assets_by_path = {a.file_path: a for a in existing_assets_list}

        # ==========================================
        # INDEXACIÓN DE ARCHIVOS DE LIBROS (MEDIA ASSETS)
        # ==========================================
        for p in book_files:
            # Evitar duplicados por ruta resuelta.
            existing_asset = existing_assets_by_path.get(str(p.resolve()))

            if existing_asset:
                if not existing_asset.extracted_metadata:
                    CourseScanner._schedule_extraction(db, existing_asset.id, background_tasks)
                continue

            mtype = "pdf" if p.suffix.lower() == ".pdf" else "epub"
            mime = guess_mime_type(p)

            asset = MediaAsset(
                id=uuid.uuid4(),
                resource_id=book.id,
                lesson_id=None,
                media_type=mtype,
                file_path=str(p.resolve()),
                file_name=p.name,
                file_size=p.stat().st_size if p.exists() else 0,
                mime_type=mime
            )
            db.add(asset)
            db.flush()
            existing_assets_by_path[asset.file_path] = asset
            CourseScanner._schedule_extraction(db, asset.id, background_tasks)

        db.commit()
        return created, updated


class ScannerManager:
    def __init__(self, db: Session):
        self.db = db
        self.scanners: List[BaseScanner] = [
            CourseScanner(),
            BookScanner()
        ]

    def scan_directory(
        self,
        library_path: str,
        background_tasks: Optional[Any] = None,
        max_depth: int = DEFAULT_MAX_DEPTH,
    ) -> ScanResult:
        """
        Escanea el directorio raíz y delega la detección a los scanners.

        - La profundidad de recursión es configurable y acotada
          (`max_depth`, por defecto 3, máximo 8): nunca se hace un crawl
          ilimitado del sistema de archivos.
        - La clasificación prioriza metadata explícita; sin metadata, se
          detecta por contenido (vídeos / pdf / epub) directamente en la
          carpeta. Las carpetas organizadoras históricas no se procesan como
          recurso, pero sí se recorren.
        - Al procesar una carpeta como recurso no se desciende más dentro de
          ella: sus archivos pertenecen a ese recurso.
        """
        result = ScanResult()
        root = Path(library_path)

        if not root.is_dir():
            result.errors.append(f"El directorio raíz {library_path} no es un directorio válido.")
            return result

        try:
            bounded_depth = max(1, min(int(max_depth), MAX_SCAN_DEPTH))
        except (TypeError, ValueError):
            bounded_depth = DEFAULT_MAX_DEPTH

        try:
            self._walk_directory(root, depth=0, max_depth=bounded_depth, result=result, background_tasks=background_tasks)
        except Exception as e:
            logger.error("Error durante el escaneo de %s: %s", library_path, e)
            result.errors.append(f"Error durante el escaneo de directorios: {str(e)}")

        return result

    def _walk_directory(
        self,
        path: Path,
        depth: int,
        max_depth: int,
        result: ScanResult,
        background_tasks: Optional[Any] = None,
    ) -> None:
        """Recorre `path`; si un scanner lo reclama, no desciende más."""
        handled = self._process_directory(path, result, background_tasks)
        if handled:
            return

        if depth >= max_depth:
            return

        try:
            children = sorted(
                (child for child in path.iterdir() if child.is_dir() and not child.is_symlink()),
                key=lambda p: p.name.lower(),
            )
        except OSError as e:
            result.warnings.append(f"No se pudo leer {path}: {str(e)}")
            return

        for child in children:
            self._walk_directory(child, depth + 1, max_depth, result, background_tasks)

    def _process_directory(self, path: Path, result: ScanResult, background_tasks: Optional[Any] = None) -> bool:
        """Intenta procesar un directorio con los scanners disponibles.

        Devuelve True si algún scanner lo ha reclamado como recurso.
        """
        try:
            # 1. Cargar metadatos
            # Buscamos de forma genérica metadata.json/metadata.yaml usando el primer scanner para cargarlo
            metadata = self.scanners[0].load_metadata(path)
        except Exception as e:
            result.warnings.append(str(e))
            metadata = None

        for scanner in self.scanners:
            if scanner.can_handle(path, metadata):
                try:
                    result.discovered += 1
                    created, updated = scanner.scan(self.db, path, metadata, background_tasks)
                    if created:
                        result.created += 1
                    if updated:
                        result.updated += 1
                    return True
                except Exception as e:
                    self.db.rollback()
                    result.errors.append(f"Error escaneando {path} con {scanner.__class__.__name__}: {str(e)}")
                    return True

        if metadata:
            result.warnings.append(
                f"Directorio {path} contiene metadata pero ningún scanner registrado pudo procesarlo."
            )
        return False
