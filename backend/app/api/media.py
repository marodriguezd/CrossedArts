import os
import re
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status, Response
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.database import get_db
from backend.app.models.resource import MediaAsset
from backend.app.models.activity import MediaProgress
from backend.app.models.course_structure import Lesson
from backend.app.services.progress import ProgressService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(prefix="/media", tags=["Media"])

@router.get("/{media_id}")
def get_media_info(media_id: uuid.UUID, db: Session = Depends(get_db)):
    """Retorna los metadatos de un MediaAsset específico."""
    asset = db.get(MediaAsset, media_id)
    if not asset:
        raise get_http_exception("MEDIA_NOT_FOUND", f"El archivo de medios {media_id} no existe.")
    return {
        "id": asset.id,
        "resource_id": asset.resource_id,
        "lesson_id": asset.lesson_id,
        "media_type": asset.media_type,
        "file_name": asset.file_name,
        "file_size": asset.file_size,
        "mime_type": asset.mime_type
    }

# ==========================================
# STREAMING CON SOPORTE HTTP RANGE REQUESTS
# ==========================================
@router.get("/{media_id}/stream")
def stream_media(
    media_id: uuid.UUID, 
    db: Session = Depends(get_db)
):
    """
    Transmite el archivo de video local por streaming soportando peticiones de rango (HTTP Range Requests).
    Esto es crucial para permitir el seeking y rebobinado rápido en navegadores.
    """
    asset = db.get(MediaAsset, media_id)
    if not asset:
        raise get_http_exception("MEDIA_NOT_FOUND", f"El archivo de medios con ID {media_id} no existe.")

    path = asset.file_path
    from backend.app.core.security import is_safe_path
    if not is_safe_path(path):
        raise get_http_exception("FORBIDDEN_PATH", "Acceso denegado a la ruta del archivo especificado.")

    if not os.path.exists(path):
        raise get_http_exception("FILE_NOT_FOUND", f"El archivo físico en la ruta {path} no se encuentra disponible.")

    return FileResponse(
        path,
        media_type=asset.mime_type,
        headers={"Accept-Ranges": "bytes"}
    )


# ==========================================
# SEGUIMIENTO DE PROGRESO DE MEDIOS (VIDEO)
# ==========================================
@router.post("/{media_id}/progress")
def update_media_progress(
    media_id: uuid.UUID,
    position: float,  # posición en segundos o número de página
    duration: float,  # duración en segundos o páginas totales
    db: Session = Depends(get_db)
):
    """
    Actualiza la marca de reproducción de un video.
    Si se ha visto más del 90% (umbral), marca la lección asociada automáticamente como completada.
    """
    asset = db.get(MediaAsset, media_id)
    if not asset:
        raise get_http_exception("MEDIA_NOT_FOUND", f"El archivo de medios con ID {media_id} no existe.")

    # Buscar o crear el progreso
    stmt = select(MediaProgress).where(MediaProgress.media_asset_id == media_id)
    progress = db.scalars(stmt).first()

    if not progress:
        progress = MediaProgress(
            id=uuid.uuid4(),
            media_asset_id=media_id,
            last_position=position,
            duration=duration,
            is_watched=False
        )
    else:
        progress.last_position = position
        progress.duration = duration

    # Regla del 90% para autocompletar la lección
    completion_threshold = 0.90
    if duration > 0 and (position / duration) >= completion_threshold:
        progress.is_watched = True
        # Si está asociado a una lección de un curso
        if asset.lesson_id:
            lesson = db.get(Lesson, asset.lesson_id)
            if lesson and not lesson.is_completed:
                # Usar el ProgressService para sincronizar y recalcular el avance general
                ProgressService.toggle_lesson_completion(db, lesson.id, True)

    db.add(progress)
    db.commit()

    return {
        "media_id": media_id,
        "last_position": progress.last_position,
        "duration": progress.duration,
        "is_watched": progress.is_watched
    }


@router.get("/{media_id}/progress")
def get_media_progress(media_id: uuid.UUID, db: Session = Depends(get_db)):
    """Obtiene la marca de reanudación guardada de un MediaAsset."""
    stmt = select(MediaProgress).where(MediaProgress.media_asset_id == media_id)
    progress = db.scalars(stmt).first()
    if not progress:
        return {"last_position": 0, "duration": 0, "is_watched": False}
    return {
        "last_position": progress.last_position,
        "duration": progress.duration,
        "is_watched": progress.is_watched
    }
