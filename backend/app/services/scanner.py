import os
import json
import yaml
import uuid
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from pathlib import Path
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.models.resource import LearningResource, Course, Book, MediaAsset
from backend.app.models.activity import MediaProgress
from backend.app.models.base import ResourceStatus, CourseDifficulty

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


class CourseScanner(BaseScanner):
    def __init__(self):
        super().__init__("course")

    def can_handle(self, path: Path, metadata: Optional[Dict[str, Any]]) -> bool:
        if metadata and metadata.get("resource_type") == "course":
            return True
        # Heurística: Si está en la carpeta de Courses
        return "courses" in path.parts[-3:].__str__().lower()

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
        category = "Fotografía" if "photo" in title.lower() else "General"
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
        # Buscar todos los archivos de video en el directorio del curso de forma recursiva
        video_extensions = [".mp4", ".webm", ".mov", ".mkv"]

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
            
            # Buscar videos y crear lecciones heurísticas
            video_files = []
            for root_dir, _, files in os.walk(path):
                for f in files:
                    file_path = Path(root_dir) / f
                    if file_path.suffix.lower() in video_extensions:
                        video_files.append(file_path)
            
            video_files.sort() # Orden alfabético
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
                    mime_type="video/mp4"
                )
                db.add(asset)
                db.flush()
                if background_tasks is not None:
                    def run_background_extraction(asset_id):
                        from backend.app.core.database import SessionLocal
                        from backend.app.services.extractor import ContentIntelligenceManager
                        db_local = SessionLocal()
                        try:
                            manager = ContentIntelligenceManager(db_local)
                            manager.extract_and_index(asset_id, commit=True)
                        finally:
                            db_local.close()
                    background_tasks.add_task(run_background_extraction, asset.id)
                else:
                    from backend.app.services.extractor import ContentIntelligenceManager
                    ContentIntelligenceManager(db).extract_and_index(asset.id, commit=True)

        else:
            # Si ya existen módulos y lecciones en BD, mapeamos los archivos físicos a las lecciones existentes
            # buscando coincidencia por índice u orden
            for root_dir, _, files in os.walk(path):
                for f in files:
                    file_path = Path(root_dir) / f
                    if file_path.suffix.lower() in video_extensions:
                        # Buscar si existe un MediaAsset con este path para evitar duplicar
                        existing_asset = existing_assets_by_path.get(str(file_path.resolve()))
                        if existing_asset:
                            if not existing_asset.extracted_metadata:
                                if background_tasks is not None:
                                    def run_background_extraction(asset_id):
                                        from backend.app.core.database import SessionLocal
                                        from backend.app.services.extractor import ContentIntelligenceManager
                                        db_local = SessionLocal()
                                        try:
                                            manager = ContentIntelligenceManager(db_local)
                                            manager.extract_and_index(asset_id, commit=True)
                                        finally:
                                            db_local.close()
                                    background_tasks.add_task(run_background_extraction, existing_asset.id)
                                else:
                                    from backend.app.services.extractor import ContentIntelligenceManager
                                    ContentIntelligenceManager(db).extract_and_index(existing_asset.id, commit=True)
                            continue
                            
                        # Intentar emparejar con lección
                        # Heurística: buscar lección cuya order_index coincida con los primeros números del nombre del archivo
                        lesson_match = None
                        import re
                        match = re.search(r"^\d+", file_path.name)
                        if match:
                            order_num = int(match.group())
                            # Buscar lección en la BD
                            stmt_les = (
                                select(Lesson)
                                .join(Lesson.module)
                                .where(Lesson.module.has(course_id=course.id))
                                .where(Lesson.order_index == order_num)
                            )
                            lesson_match = db.scalars(stmt_les).first()
                            
                        # Crear el MediaAsset
                        asset = MediaAsset(
                            id=uuid.uuid4(),
                            resource_id=course.id,
                            lesson_id=lesson_match.id if lesson_match else None,
                            media_type="video",
                            file_path=str(file_path.resolve()),
                            file_name=file_path.name,
                            file_size=file_path.stat().st_size if file_path.exists() else 0,
                            mime_type="video/mp4"
                        )
                        db.add(asset)
                        db.flush()
                        existing_assets_by_path[asset.file_path] = asset

                        if background_tasks is not None:
                            def run_background_extraction(asset_id):
                                from backend.app.core.database import SessionLocal
                                from backend.app.services.extractor import ContentIntelligenceManager
                                db_local = SessionLocal()
                                try:
                                    manager = ContentIntelligenceManager(db_local)
                                    manager.extract_and_index(asset_id, commit=True)
                                finally:
                                    db_local.close()
                            background_tasks.add_task(run_background_extraction, asset.id)
                        else:
                            from backend.app.services.extractor import ContentIntelligenceManager
                            ContentIntelligenceManager(db).extract_and_index(asset.id, commit=True)

        db.commit()
        return created, updated


class BookScanner(BaseScanner):
    def __init__(self):
        super().__init__("book")

    def can_handle(self, path: Path, metadata: Optional[Dict[str, Any]]) -> bool:
        if metadata and metadata.get("resource_type") == "book":
            return True
        # Heurística: Si está en la carpeta de Books y contiene PDF/EPUB
        if "books" in path.parts[-3:].__str__().lower() or "books" in path.name.lower():
            # Buscar si hay un archivo .pdf o .epub en esta carpeta
            if path.is_dir():
                return any(p.suffix.lower() in [".pdf", ".epub"] for p in path.iterdir())
        return False

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

        # Buscar archivos de libros físicos
        book_files = []
        if path.is_dir():
            for p in path.iterdir():
                if p.suffix.lower() in [".pdf", ".epub"]:
                    book_files.append(p)
        
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
            # Evitar duplicados
            existing_asset = existing_assets_by_path.get(str(p.resolve()))
            
            if existing_asset:
                if not existing_asset.extracted_metadata:
                    if background_tasks is not None:
                        def run_background_extraction(asset_id):
                            from backend.app.core.database import SessionLocal
                            from backend.app.services.extractor import ContentIntelligenceManager
                            db_local = SessionLocal()
                            try:
                                manager = ContentIntelligenceManager(db_local)
                                manager.extract_and_index(asset_id, commit=True)
                            finally:
                                db_local.close()
                        background_tasks.add_task(run_background_extraction, existing_asset.id)
                    else:
                        from backend.app.services.extractor import ContentIntelligenceManager
                        ContentIntelligenceManager(db).extract_and_index(existing_asset.id, commit=True)
                continue
            
            if not existing_asset:
                mtype = "pdf" if p.suffix.lower() == ".pdf" else "epub"
                mime = "application/pdf" if mtype == "pdf" else "application/epub+zip"
                
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

                if background_tasks is not None:
                    def run_background_extraction(asset_id):
                        from backend.app.core.database import SessionLocal
                        from backend.app.services.extractor import ContentIntelligenceManager
                        db_local = SessionLocal()
                        try:
                            manager = ContentIntelligenceManager(db_local)
                            manager.extract_and_index(asset_id, commit=True)
                        finally:
                            db_local.close()
                    background_tasks.add_task(run_background_extraction, asset.id)
                else:
                    from backend.app.services.extractor import ContentIntelligenceManager
                    ContentIntelligenceManager(db).extract_and_index(asset.id, commit=True)

        db.commit()
        return created, updated


class ScannerManager:
    def __init__(self, db: Session):
        self.db = db
        self.scanners: List[BaseScanner] = [
            CourseScanner(),
            BookScanner()
        ]

    def scan_directory(self, library_path: str, background_tasks: Optional[Any] = None) -> ScanResult:
        """
        Escanea el directorio raíz configurado y delega la detección a los scanners registrados.
        """
        result = ScanResult()
        root = Path(library_path)

        if not root.is_dir():
            result.errors.append(f"El directorio raíz {library_path} no es un directorio válido.")
            return result

        # Caminar directorios (máximo 2 niveles de profundidad para evitar loops infinitos)
        try:
            for item in root.iterdir():
                if not item.is_dir():
                    continue

                # Si es un directorio organizador (ej: Courses/ o Books/), caminar un nivel más y no procesarlo a él mismo
                if item.name.lower() in ["courses", "books"]:
                    for sub_item in item.iterdir():
                        if sub_item.is_dir():
                            self._process_directory(sub_item, result, background_tasks)
                else:
                    # Procesar subdirectorios de primer nivel como recursos potenciales
                    self._process_directory(item, result, background_tasks)
        except Exception as e:
            result.errors.append(f"Error durante el escaneo de directorios: {str(e)}")

        return result

    def _process_directory(self, path: Path, result: ScanResult, background_tasks: Optional[Any] = None):
        """Intenta procesar un directorio con los scanners disponibles."""
        try:
            # 1. Cargar metadatos
            # Buscamos de forma genérica metadata.json/metadata.yaml usando el primer scanner para cargarlo
            metadata = self.scanners[0].load_metadata(path)
        except Exception as e:
            result.warnings.append(str(e))
            metadata = None

        handled = False
        for scanner in self.scanners:
            if scanner.can_handle(path, metadata):
                try:
                    result.discovered += 1
                    created, updated = scanner.scan(self.db, path, metadata, background_tasks)
                    if created:
                        result.created += 1
                    if updated:
                        result.updated += 1
                    handled = True
                    break
                except Exception as e:
                    self.db.rollback()
                    result.errors.append(f"Error escaneando {path} con {scanner.__class__.__name__}: {str(e)}")
                    handled = True
                    break

        if not handled and metadata:
            result.warnings.append(
                f"Directorio {path} contiene metadata pero ningún scanner registrado pudo procesarlo."
            )
