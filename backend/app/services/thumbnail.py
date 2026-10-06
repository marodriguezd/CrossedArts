from typing import Optional
from backend.app.core.settings import settings

COVER_PROXY_PREFIX = "/api/v1/content/cover-image"


class ThumbnailService:
    # Directorio raíz de archivos estáticos
    STATIC_DIR = settings.static_dir

    # Rutas de los placeholders por defecto
    COURSE_PLACEHOLDER = "/static/placeholders/course_placeholder.png"
    BOOK_PLACEHOLDER = "/static/placeholders/book_placeholder.png"

    @staticmethod
    def resolve_cover_url(
        cover_path_meta: Optional[str],
        source_path: Optional[str],
        resource_type: str
    ) -> str:
        """
        Resuelve la ruta o URL de la portada del recurso aplicando el orden de prioridad:
        1. Portada explícita definida en los metadatos (URL externa).
        2. Portada explícita en ruta proxy del backend (/api/v1/content/cover-image/...).
        3. Portada explícita en ruta interna resuelta (/static/covers/...).
        4. Portada placeholder por defecto según el tipo de recurso.
        """
        # 1. Prioridad: Portada explícita — URL externa
        if cover_path_meta and cover_path_meta.startswith("http"):
            return cover_path_meta

        # 2. Prioridad: Ruta de proxy
        if cover_path_meta and cover_path_meta.startswith(COVER_PROXY_PREFIX + "/"):
            filename = cover_path_meta[len(COVER_PROXY_PREFIX + "/"):]
            local_path = settings.covers_dir / filename
            if local_path.is_file():
                return cover_path_meta

        # 3. Prioridad: Portada explícita — ruta interna /static/
        if cover_path_meta and cover_path_meta.startswith("/static/"):
            relative = cover_path_meta[len("/static/"):]
            local_path = ThumbnailService.STATIC_DIR / relative
            if local_path.is_file():
                # Si es un enlace simbólico, servirlo por el proxy
                if local_path.is_symlink():
                    return f"{COVER_PROXY_PREFIX}/{local_path.name}"
                return cover_path_meta
            
            # Si no existe en el static del repo, ver si existe en covers_dir
            if cover_path_meta.startswith("/static/covers/"):
                filename = cover_path_meta[len("/static/covers/"):]
                local_covers_path = settings.covers_dir / filename
                if local_covers_path.is_file():
                    return f"{COVER_PROXY_PREFIX}/{filename}"

        # 4. Prioridad: Placeholder genérico
        if resource_type == "course":
            return ThumbnailService.COURSE_PLACEHOLDER
        return ThumbnailService.BOOK_PLACEHOLDER
