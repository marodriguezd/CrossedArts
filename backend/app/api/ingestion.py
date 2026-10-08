from fastapi import APIRouter, Depends, Query, status, BackgroundTasks
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.settings import settings
from backend.app.schemas.ingestion import (
    ImportResourceRequest, ImportResultResponse, DirectoryValidationResponse
)
from backend.app.services.ingestion import IngestionService
from backend.app.api.dependencies import get_http_exception
import uuid
import os
import shutil
from pathlib import Path
from typing import Optional
from fastapi import UploadFile, File, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
import mimetypes
from backend.app.core.security import is_safe_path
from backend.app.core.logging import get_logger

logger = get_logger("api.ingestion")

# Límites de subida y recursos
# Límites aplican SOLO a endpoints de upload (donde se copian archivos al servidor).
# El endpoint /import no necesita límites cuando usa symlink/reference (los archivos
# permanecen en su ubicación original en disco).
MAX_UPLOAD_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB por archivo multimedia
MAX_TOTAL_IMPORT_SIZE = 10 * 1024 * 1024 * 1024  # 10 GB agregado por lote de importación
MAX_COVER_FILE_SIZE = 20 * 1024 * 1024  # 20 MB por portada/imagen
ALLOWED_UPLOAD_EXTENSIONS = {
    ".mp4", ".webm", ".mov", ".mkv", ".avi", ".pdf", ".epub",
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".txt",
    ".png", ".jpg", ".jpeg", ".gif", ".webp"
}
ALLOWED_COVER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

CHUNK_SIZE = 64 * 1024  # 64 KB

router = APIRouter(prefix="/content", tags=["Content Management"])


@router.post("/import", response_model=ImportResultResponse, status_code=status.HTTP_201_CREATED)
def import_resource(payload: ImportResourceRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Importa un recurso de aprendizaje (curso o libro) desde una carpeta local del sistema.
    Soporta enlace simbólico, referencia directa o copia física.
    Sin límites de tamaño en modo symlink/reference (los archivos permanecen en su ubicación original).
    """
    try:
        service = IngestionService(db)
        return service.import_resource(payload, background_tasks=background_tasks)
    except ValueError as e:
        raise get_http_exception(
            "IMPORT_ERROR", str(e),
            status_code=status.HTTP_400_BAD_REQUEST
        )


@router.post("/validate-directory", response_model=DirectoryValidationResponse)
def validate_directory(path: str = Query(..., description="Ruta absoluta del directorio a validar"), db: Session = Depends(get_db)):
    """
    Valida un directorio local y retorna un resumen de archivos multimedia encontrados.
    """
    service = IngestionService(db)
    return service.validate_directory(path)


@router.post("/import-from-upload", response_model=ImportResultResponse, status_code=status.HTTP_201_CREATED)
async def import_from_upload(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    files: list[UploadFile] = File(..., description="Archivos del directorio a importar"),
    title: str = Form(...),
    resource_type: str = Form(...),
    category: str = Form("General"),
    description: Optional[str] = Form(None),
    difficulty: str = Form("BEGINNER"),
    author: Optional[str] = Form(None),
    structure_strategy: str = Form("auto_hierarchical"),
    cover_path: Optional[str] = Form(None),
):
    """
    Importa un recurso desde archivos subidos por el usuario mediante el explorador nativo.
    Los archivos se copian al servidor (modo 'copy' siempre — symlink/reference no aplican
    aquí porque los archivos vienen del navegador, no de una ruta del servidor).

    Aplica límites de tamaño (2GB/archivo, 10GB total) y validación de extensiones.
    Limpia directorios temporales de forma determinista ante cualquier error.
    """
    upload_dir = settings.data_dir / "uploads" / "imports" / f"{uuid.uuid4().hex[:12]}"
    upload_dir.mkdir(parents=True, exist_ok=True)

    uploaded_count = 0
    total_size = 0

    try:
        for upload_file in files:
            original_path = upload_file.filename or ""
            safe_parts = [p for p in Path(original_path).parts if p not in ("..", ".", "")]
            safe_path = Path(*safe_parts) if safe_parts else Path("unnamed_file")
            dest = upload_dir / safe_path

            if not dest.resolve().is_relative_to(upload_dir.resolve()):
                continue

            if upload_file.size and upload_file.size > MAX_UPLOAD_FILE_SIZE:
                shutil.rmtree(upload_dir, ignore_errors=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"El archivo '{original_path}' supera el límite permitido de 2 GB."
                )

            ext = Path(original_path).suffix.lower()
            if ext and ext not in ALLOWED_UPLOAD_EXTENSIONS:
                continue

            dest.parent.mkdir(parents=True, exist_ok=True)

            def write_file_with_limit():
                nonlocal total_size
                current_file_size = 0
                with open(dest, "wb") as buffer:
                    while True:
                        chunk = upload_file.file.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        current_file_size += len(chunk)
                        if current_file_size > MAX_UPLOAD_FILE_SIZE:
                            raise HTTPException(
                                status_code=413,
                                detail=f"El archivo '{original_path}' supera el límite permitido de 2 GB."
                            )
                        if total_size + len(chunk) > MAX_TOTAL_IMPORT_SIZE:
                            raise HTTPException(
                                status_code=413,
                                detail="El tamaño total de los archivos subidos supera el límite de 10 GB."
                            )
                        buffer.write(chunk)
                        total_size += len(chunk)

            try:
                await run_in_threadpool(write_file_with_limit)
                uploaded_count += 1
            except HTTPException:
                shutil.rmtree(upload_dir, ignore_errors=True)
                raise
            except Exception as e:
                if dest.exists():
                    dest.unlink(missing_ok=True)
                logger.warning("Error subiendo el archivo %s: %s", upload_file.filename, e)
                continue
            finally:
                await upload_file.close()

        if uploaded_count == 0:
            shutil.rmtree(upload_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="No se pudo subir ningún archivo válido. Verifica las extensiones y permisos.")

        service = IngestionService(db)
        result = service.import_resource(
            ImportResourceRequest(
                title=title,
                resource_type=resource_type,
                category=category,
                description=description,
                difficulty=difficulty,
                author=author,
                source_path=str(upload_dir.resolve()),
                storage_strategy="copy",
                structure_strategy=structure_strategy,
                cover_path=cover_path,
            ),
            background_tasks=background_tasks,
        )
        shutil.rmtree(upload_dir, ignore_errors=True)
        return result
    except HTTPException:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise get_http_exception(
            "IMPORT_ERROR", f"Error al procesar importación: {str(e)}",
            status_code=status.HTTP_400_BAD_REQUEST
        )


@router.post("/upload-cover")
async def upload_cover(
    file: Optional[UploadFile] = File(None),
    local_path: Optional[str] = Form(None),
    strategy: str = Form("copy"),  # "copy" or "symlink"
):
    """
    Sube o asocia una imagen de portada para un recurso.
    Si se proporciona `file`, se guarda el archivo subido en `static/covers/` con límite de 20 MB.
    Si se proporciona `local_path`, se copia o enlaza (symlink) según `strategy`.
    """
    static_dir = settings.covers_dir
    static_dir.mkdir(parents=True, exist_ok=True)

    if file:
        filename = Path(file.filename or "cover.png").name
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_COVER_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solo se permiten archivos de imagen (.jpg, .jpeg, .png, .webp, .gif)"
            )

        if file.size and file.size > MAX_COVER_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="El archivo de portada supera el límite permitido de 20 MB."
            )

        dest_path = static_dir / filename
        if dest_path.exists():
            name, file_ext = os.path.splitext(filename)
            filename = f"{name}_{uuid.uuid4().hex[:6]}{file_ext}"
            dest_path = static_dir / filename

        try:
            def write_cover_file():
                written = 0
                with open(dest_path, "wb") as buffer:
                    while True:
                        chunk = file.file.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > MAX_COVER_FILE_SIZE:
                            raise HTTPException(
                                status_code=413,
                                detail="El archivo de portada supera el límite permitido de 20 MB."
                            )
                        buffer.write(chunk)

            await run_in_threadpool(write_cover_file)
        except HTTPException:
            if dest_path.exists():
                dest_path.unlink(missing_ok=True)
            raise
        except Exception as e:
            if dest_path.exists():
                dest_path.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail=f"No se pudo guardar el archivo: {str(e)}")
        finally:
            await file.close()

        return {"cover_path": str(dest_path.resolve()), "url": f"/api/v1/content/cover-image/{filename}"}

    elif local_path:
        if not is_safe_path(local_path):
            raise HTTPException(status_code=400, detail="Acceso denegado a la ruta del archivo especificado.")

        src_path = Path(local_path).resolve()
        if not src_path.is_file():
            raise HTTPException(status_code=400, detail="La ruta del archivo original no es válida o el archivo no existe.")

        # Validar extensión de imagen permitida
        if src_path.suffix.lower() not in ALLOWED_COVER_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Solo se permiten archivos de imagen (.jpg, .jpeg, .png, .webp, .gif)")

        filename = src_path.name
        dest_path = static_dir / filename

        if dest_path.exists():
            name, ext = os.path.splitext(filename)
            filename = f"{name}_{uuid.uuid4().hex[:6]}{ext}"
            dest_path = static_dir / filename

        if strategy == "symlink":
            try:
                def make_symlink():
                    if dest_path.is_symlink() or dest_path.exists():
                        dest_path.unlink()
                    os.symlink(src_path, dest_path)
                await run_in_threadpool(make_symlink)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"No se pudo crear el enlace simbólico: {str(e)}")
        else:
            try:
                await run_in_threadpool(shutil.copy2, src_path, dest_path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"No se pudo copiar el archivo: {str(e)}")

        return {"cover_path": str(dest_path.resolve()), "url": f"/api/v1/content/cover-image/{filename}"}

    else:
        raise HTTPException(status_code=400, detail="Debe proporcionar un archivo a subir o una ruta de archivo local.")


@router.get("/cover-image/{filename}")
def serve_cover_image(filename: str):
    """
    Sirve un archivo de portada desde static/covers/ directamente, siguiendo
    enlaces simbólicos que apunten fuera del directorio raíz de forma segura.
    """
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Nombre de archivo de portada no válido")

    _, ext = os.path.splitext(filename.lower())
    if ext not in ALLOWED_COVER_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Extensión de archivo de portada no permitida")

    covers_dir = settings.covers_dir
    file_path = covers_dir / filename

    if not file_path.exists() and not file_path.is_symlink():
        raise HTTPException(status_code=404, detail="Archivo de portada no encontrado")

    real_path = os.path.realpath(file_path)

    if not is_safe_path(real_path):
        raise HTTPException(status_code=400, detail="Acceso denegado a la ruta del archivo especificado.")

    if not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="El archivo referenciado por la portada no existe en disco")

    # Validar que el tipo MIME del archivo resuelto sea realmente una imagen
    mime_type, _ = mimetypes.guess_type(real_path)
    if not mime_type or not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo solicitado no es una imagen válida")

    return FileResponse(real_path)
