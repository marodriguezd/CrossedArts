import unicodedata
from typing import List, Dict, Any, Optional
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session, joinedload

from backend.app.models.resource import LearningResource, MediaAsset
from backend.app.models.activity import Note
from backend.app.models.content import ContentIndex, TranscriptSegment, Transcript

# Hard per-source result cap when the caller asks for none. Every SQL query
# applies `limit + offset` at the database level: full collections are never
# loaded just to return one small page.
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
        Plain full-text search across:
        - course and book titles/descriptions
        - study-note contents
        - video-lesson transcripts
        - extracted PDF/EPUB metadata and content

        Pagination: `limit`/`offset` apply over the combined ranking. Each source
        query loads at most `limit + offset` rows straight from the database
        (SQL LIMIT), so returning a page never materializes every match. The
        default stays sensible for small libraries.
        """
        if not query or not query.strip():
            return []

        safe_limit = max(0, min(int(limit), MAX_SEARCH_LIMIT))
        safe_offset = max(0, int(offset))
        # Rows each source must load to fill the requested page.
        fetch_per_source = safe_limit + safe_offset
        if fetch_per_source == 0:
            return []

        clean_query = query.strip()
        search_pattern = f"%{clean_query}%"
        results = []

        # 1. LearningResources (course/book) search.
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

            # Title hit outranks a description hit.
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

        # 2. Study-note search.
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

            # Snippet around the match.
            snippet = SearchService._get_snippet(n.content, clean_query)

            results.append({
                "resource_id": res.id,
                "resource_title": res.title,
                "resource_type": res.type,
                "match_type": "note",
                "snippet": f"En notas: {snippet}",
                "score": 4.0
            })

        # 3. Transcript search.
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

        # 4. Extracted/indexed content (PDF/EPUB) search.
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

        # Rank by score, then slice the requested page.
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[safe_offset:safe_offset + safe_limit]

    @staticmethod
    def _get_snippet(text: str, query: str, context_len: int = 60) -> str:
        """Extract a text window around the matching word."""
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
