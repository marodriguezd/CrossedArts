from typing import Optional
from backend.app.core.settings import settings

COVER_PROXY_PREFIX = "/api/v1/content/cover-image"


class ThumbnailService:
    # Static-files root directory.
    STATIC_DIR = settings.static_dir

    # Default placeholder paths.
    COURSE_PLACEHOLDER = "/static/placeholders/course_placeholder.png"
    BOOK_PLACEHOLDER = "/static/placeholders/book_placeholder.png"

    @staticmethod
    def resolve_cover_url(
        cover_path_meta: Optional[str],
        source_path: Optional[str],
        resource_type: str
    ) -> str:
        """
        Resolve the resource cover path/URL by priority:
        1. Explicit cover from metadata (external URL).
        2. Explicit cover on the backend proxy route (/api/v1/content/cover-image/...).
        3. Explicit cover on a resolved internal route (/static/covers/...).
        4. Default placeholder cover for the resource type.
        """
        # 1. Explicit cover: external URL.
        if cover_path_meta and cover_path_meta.startswith("http"):
            return cover_path_meta

        # 2. Proxy route.
        if cover_path_meta and cover_path_meta.startswith(COVER_PROXY_PREFIX + "/"):
            filename = cover_path_meta[len(COVER_PROXY_PREFIX + "/"):]
            local_path = settings.covers_dir / filename
            if local_path.is_file():
                return cover_path_meta

        # 3. Explicit cover: internal /static/ route.
        if cover_path_meta and cover_path_meta.startswith("/static/"):
            relative = cover_path_meta[len("/static/"):]
            local_path = ThumbnailService.STATIC_DIR / relative
            if local_path.is_file():
                # Symlinks are served through the proxy.
                if local_path.is_symlink():
                    return f"{COVER_PROXY_PREFIX}/{local_path.name}"
                return cover_path_meta

            # Fall back to covers_dir when missing from the repo static tree.
            if cover_path_meta.startswith("/static/covers/"):
                filename = cover_path_meta[len("/static/covers/"):]
                local_covers_path = settings.covers_dir / filename
                if local_covers_path.is_file():
                    return f"{COVER_PROXY_PREFIX}/{filename}"

        # 4. Generic placeholder.
        if resource_type == "course":
            return ThumbnailService.COURSE_PLACEHOLDER
        return ThumbnailService.BOOK_PLACEHOLDER
