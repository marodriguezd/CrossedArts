import os
import uuid
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.database import get_db
from backend.app.core.security import is_safe_path
from backend.app.models.resource import MediaAsset
from backend.app.models.activity import MediaProgress
from backend.app.models.course_structure import Lesson
from backend.app.services.progress import ProgressService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(prefix="/media", tags=["Media"])

@router.get("/{media_id}")
def get_media_info(media_id: uuid.UUID, db: Session = Depends(get_db)):
    """Return a specific MediaAsset's metadata."""
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


@router.get("/{media_id}/stream")
def stream_media(
    media_id: uuid.UUID,
    db: Session = Depends(get_db)
):
    """
    Stream the local video file with range-request support (HTTP Range
    Requests): required for fast seeking/rewind in browsers.
    """
    asset = db.get(MediaAsset, media_id)
    if not asset:
        raise get_http_exception("MEDIA_NOT_FOUND", f"El archivo de medios con ID {media_id} no existe.")

    path = asset.file_path
    if not is_safe_path(path):
        raise get_http_exception("FORBIDDEN_PATH", "Acceso denegado a la ruta del archivo especificado.")

    if not os.path.exists(path):
        raise get_http_exception("FILE_NOT_FOUND", f"El archivo físico en la ruta {path} no se encuentra disponible.")

    return FileResponse(
        path,
        media_type=asset.mime_type,
        headers={"Accept-Ranges": "bytes"}
    )


@router.post("/{media_id}/progress")
def update_media_progress(
    media_id: uuid.UUID,
    position: float,  # position in seconds or page number
    duration: float,  # duration in seconds or total pages
    db: Session = Depends(get_db)
):
    """
    Update a video's playback mark.
    Past 90% watched, the linked lesson is auto-marked completed.
    """
    asset = db.get(MediaAsset, media_id)
    if not asset:
        raise get_http_exception("MEDIA_NOT_FOUND", f"El archivo de medios con ID {media_id} no existe.")

    # Find or create the progress row.
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

    # 90% rule for lesson auto-completion.
    completion_threshold = 0.90
    if duration > 0 and (position / duration) >= completion_threshold:
        progress.is_watched = True
        # When linked to a course lesson.
        if asset.lesson_id:
            lesson = db.get(Lesson, asset.lesson_id)
            if lesson and not lesson.is_completed:
                # Sync via ProgressService to recalculate overall progress.
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
    """Get a MediaAsset's saved resume mark."""
    stmt = select(MediaProgress).where(MediaProgress.media_asset_id == media_id)
    progress = db.scalars(stmt).first()
    if not progress:
        return {"last_position": 0, "duration": 0, "is_watched": False}
    return {
        "last_position": progress.last_position,
        "duration": progress.duration,
        "is_watched": progress.is_watched
    }
