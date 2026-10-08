import unicodedata
from typing import List, Dict, Any, Optional
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session, joinedload

from backend.app.models.resource import LearningResource, MediaAsset
from backend.app.models.activity import Note
from backend.app.models.content import ContentIndex, TranscriptSegment, Transcript

# Límite duro de resultados por fuente cuando el llamador no pide uno concreto.
# Cada consulta SQL aplica `limit + offset` a nivel de base de datos: nunca se
# cargan colecciones completas solo para devolver una página pequeña.
DEFAULT_SEARCH_LIMIT = 50
MAX_SEARCH_LIMIT = 200


class SearchService:
    @staticmethod
    def _clean_str(s: str) -> str:
        if s is None:
            return ""
        return "".join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn').lower()

    @staticmethod
    def search(
        db: Session,
        query: str,
        resource_type: Optional[str] = None,
        limit: int = DEFAULT_SEARCH_LIMIT,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Realiza una búsqueda textual tradicional a lo largo de:
        - Títulos/descripciones de cursos y libros
        - Contenido de notas de estudio
        - Transcripciones de lecciones de video
        - Metadatos y contenido extraído de PDF/EPUB

        Paginación: `limit`/`offset` se aplican sobre el ranking combinado.
        Cada consulta fuente carga como mucho `limit + offset` filas directamente
        desde la base de datos (SQL LIMIT), de modo que devolver una página nunca
        exige materializar todas las coincidencias. El comportamiento por defecto
        sigue siendo sensible para bibliotecas pequeñas.
        """
        if not query or not query.strip():
            return []

        safe_limit = max(0, min(int(limit), MAX_SEARCH_LIMIT))
        safe_offset = max(0, int(offset))
        # Filas que cada fuente debe cargar para poder rellenar la página pedida.
        fetch_per_source = safe_limit + safe_offset
        if fetch_per_source == 0:
            return []

        clean_query = query.strip()
        search_pattern = f"%{clean_query}%"
        results = []

        # 1. Búsqueda en LearningResources (Curso/Libro)
        # -----------------------------------------------
        stmt_resources = (
            select(LearningResource)
            .where(
                or_(
                    func.remove_accents(LearningResource.title).like(func.remove_accents(search_pattern)),
                    func.remove_accents(LearningResource.description).like(func.remove_accents(search_pattern))
                )
            )
            .limit(fetch_per_source)
        )
        resources = db.scalars(stmt_resources).all()
        for r in resources:
            if resource_type and r.type != resource_type:
                continue

            # Determinar si coincidió en título o descripción
            is_title_match = SearchService._clean_str(clean_query) in SearchService._clean_str(r.title)
            snippet = r.title if is_title_match else (r.description[:150] + "..." if r.description else "")
            score = 10.0 if is_title_match else 5.0

            results.append({
                "resource_id": r.id,
                "resource_title": r.title,
                "resource_type": r.type,
                "match_type": "title" if is_title_match else "description",
                "snippet": snippet,
                "score": score
            })

        # 2. Búsqueda en Notas de Estudio
        # --------------------------------
        stmt_notes = (
            select(Note)
            .options(joinedload(Note.resource))
            .where(func.remove_accents(Note.content).like(func.remove_accents(search_pattern)))
            .limit(fetch_per_source)
        )
        notes = db.scalars(stmt_notes).all()
        for n in notes:
            res = n.resource
            if not res or (resource_type and res.type != resource_type):
                continue

            # Extraer un fragmento del texto alrededor de la coincidencia
            snippet = SearchService._get_snippet(n.content, clean_query)

            results.append({
                "resource_id": res.id,
                "resource_title": res.title,
                "resource_type": res.type,
                "match_type": "note",
                "snippet": f"En notas: {snippet}",
                "score": 4.0
            })

        # 3. Búsqueda en Transcripciones
        # --------------------------------
        stmt_segments = (
            select(TranscriptSegment)
            .options(
                joinedload(TranscriptSegment.transcript)
                .joinedload(Transcript.media_asset)
                .joinedload(MediaAsset.resource)
            )
            .where(func.remove_accents(TranscriptSegment.text).like(func.remove_accents(search_pattern)))
            .limit(fetch_per_source)
        )
        segments = db.scalars(stmt_segments).all()
        for seg in segments:
            asset = seg.transcript.media_asset
            if not asset:
                continue
            res = asset.resource
            if not res or (resource_type and res.type != resource_type):
                continue

            # Extraer un fragmento
            snippet = SearchService._get_snippet(seg.text, clean_query)
            time_stamp = f"[{int(seg.start_time // 60)}:{int(seg.start_time % 60):02d}]"

            results.append({
                "resource_id": res.id,
                "resource_title": res.title,
                "resource_type": res.type,
                "match_type": "transcript",
                "snippet": f"{time_stamp} {snippet}",
                "score": 3.0
            })

        # 4. Búsqueda en Contenido Extraído e Indexado (PDF/EPUB)
        # --------------------------------------------------------
        stmt_indices = (
            select(ContentIndex)
            .options(
                joinedload(ContentIndex.media_asset)
                .joinedload(MediaAsset.resource)
            )
            .where(func.remove_accents(ContentIndex.content).like(func.remove_accents(search_pattern)))
            .limit(fetch_per_source)
        )
        indices = db.scalars(stmt_indices).all()
        for idx in indices:
            asset = idx.media_asset
            if not asset:
                continue
            res = asset.resource
            if not res or (resource_type and res.type != resource_type):
                continue

            snippet = SearchService._get_snippet(idx.content, clean_query)
            section = idx.section_identifier.replace("_", " ").title()

            results.append({
                "resource_id": res.id,
                "resource_title": res.title,
                "resource_type": res.type,
                "match_type": "document",
                "snippet": f"({section}) {snippet}",
                "score": 2.0
            })

        # Ordenar por puntuación y aplicar la página sobre el ranking combinado.
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[safe_offset:safe_offset + safe_limit]

    @staticmethod
    def _get_snippet(text: str, query: str, context_len: int = 60) -> str:
        """Helper para extraer una subcadena del texto alrededor de la palabra coincidente."""
        clean_text = SearchService._clean_str(text)
        clean_query = SearchService._clean_str(query)
        idx = clean_text.find(clean_query)
        if idx == -1:
            return text[:context_len * 2] + "..."

        start = max(0, idx - context_len)
        end = min(len(text), idx + len(query) + context_len)
        snippet = text[start:end]

        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(text) else ""
        return f"{prefix}{snippet}{suffix}"
