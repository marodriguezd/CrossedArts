import os
import re
import json
import uuid
import zipfile
import defusedxml.ElementTree as ET
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import select

from pypdf import PdfReader
from backend.app.models.resource import MediaAsset
from backend.app.models.content import ExtractedMetadata, Transcript, TranscriptSegment, ContentIndex
from backend.app.core.logging import get_logger

logger = get_logger("services.extractor")

# Idioma indeterminado (ISO 639-2). Se usa cuando la fuente no declara idioma:
# etiquetar transcriptos como español era una afirmación falsa.
UNDETERMINED_LANGUAGE = "und"


def normalize_language(raw_language: Any) -> Optional[str]:
    """Valida y normaliza un identificador de idioma declarado por la fuente.

    Acepta códigos ISO 639-1/-2 ("es", "en", "spa"...) y etiquetas BCP-47
    simples ("en-US", "pt_BR"). Devuelve None si no es un código plausible:
    un valor libre ("idioma del video") no debe persistirse como idioma.
    """
    if not isinstance(raw_language, str):
        return None
    candidate = raw_language.strip().lower().replace("_", "-")
    if not candidate:
        return None
    parts = candidate.split("-")
    if not (2 <= len(parts[0]) <= 3 and parts[0].isalpha()):
        return None
    return candidate[:10]


def infer_transcript_language(data: Any, file_path: Path) -> str:
    """Infiere el idioma del transcripto desde metadatos; si no, indeterminado.

    Orden de preferencia: campo `language`/`languages` del JSON de la fuente;
    pista en el nombre de archivo (video.en.srt); 'und' como último recurso.
    Nunca se asume español.
    """
    if isinstance(data, dict):
        for key in ("language", "language_code", "lang"):
            normalized = normalize_language(data.get(key))
            if normalized:
                return normalized
        languages = data.get("languages")
        if isinstance(languages, list):
            for item in languages:
                normalized = normalize_language(item)
                if normalized:
                    return normalized

    stem = file_path.stem
    stem_match = re.search(r"\.([a-z]{2,3})$", stem.lower())
    if stem_match:
        normalized = normalize_language(stem_match.group(1))
        if normalized:
            return normalized

    return UNDETERMINED_LANGUAGE

class ContentExtractor(ABC):
    @abstractmethod
    def can_handle(self, mime_type: str, file_path: Path) -> bool:
        """Determina si este extractor puede procesar el tipo MIME o extensión."""
        pass

    @abstractmethod
    def extract(self, db: Session, media_asset_id: uuid.UUID, file_path: Path, commit: bool = True) -> None:
        """Extrae, indexa y persiste el contenido en la base de datos."""
        pass


class PDFExtractor(ContentExtractor):
    def can_handle(self, mime_type: str, file_path: Path) -> bool:
        return mime_type == "application/pdf" or file_path.suffix.lower() == ".pdf"

    def extract(self, db: Session, media_asset_id: uuid.UUID, file_path: Path, commit: bool = True) -> None:
        if not file_path.exists():
            return

        reader = PdfReader(str(file_path.resolve()))
        page_count = len(reader.pages)

        # Extraer metadatos básicos
        meta = reader.metadata
        title = meta.title if meta and meta.title else file_path.stem
        author = meta.author if meta and meta.author else "Desconocido"

        # Extraer Tabla de Contenidos (TOC) simplificada
        toc = []
        try:
            outline = reader.outline
            def parse_outline(items, depth=0):
                res = []
                for item in items:
                    if isinstance(item, list):
                        res.extend(parse_outline(item, depth + 1))
                    else:
                        title_str = getattr(item, 'title', str(item))
                        res.append({"title": title_str, "depth": depth})
                return res
            if outline:
                toc = parse_outline(outline)
        except Exception:
            toc = []

        # Extraer texto de páginas e indexar
        full_text_list = []

        # Eliminar índices anteriores si existen para asegurar idempotencia
        from backend.app.models.content import EmbeddingRecord
        old_content_ids = db.scalars(
            select(ContentIndex.id).where(ContentIndex.media_asset_id == media_asset_id)
        ).all()
        if old_content_ids:
            chunk_size = 500
            for i in range(0, len(old_content_ids), chunk_size):
                chunk = old_content_ids[i:i + chunk_size]
                db.query(EmbeddingRecord).filter(
                    EmbeddingRecord.entity_id.in_(chunk),
                    EmbeddingRecord.entity_type == "content_index"
                ).delete(synchronize_session=False)
        db.query(ContentIndex).filter(ContentIndex.media_asset_id == media_asset_id).delete()

        pages_to_add = []
        for idx, page in enumerate(reader.pages, start=1):
            text = page.extract_text()
            if text:
                text_clean = text.strip()
                if text_clean:
                    full_text_list.append(text_clean)
                    # Indexar página
                    content_idx = ContentIndex(
                        id=uuid.uuid4(),
                        media_asset_id=media_asset_id,
                        section_identifier=f"page_{idx}",
                        content=text_clean
                    )
                    pages_to_add.append(content_idx)
        if pages_to_add:
            db.add_all(pages_to_add)

        full_text = "\n\n".join(full_text_list)

        # Crear o actualizar ExtractedMetadata
        stmt = select(ExtractedMetadata).where(ExtractedMetadata.media_asset_id == media_asset_id)
        extracted = db.scalars(stmt).first()

        if not extracted:
            extracted = ExtractedMetadata(
                id=uuid.uuid4(),
                media_asset_id=media_asset_id,
                title=title,
                author=author,
                page_count=page_count,
                toc={"items": toc} if toc else None,
                raw_text=full_text
            )
        else:
            extracted.title = title
            extracted.author = author
            extracted.page_count = page_count
            extracted.toc = {"items": toc} if toc else None
            extracted.raw_text = full_text

        db.add(extracted)
        if commit:
            db.commit()
        else:
            db.flush()


class EPUBExtractor(ContentExtractor):
    def can_handle(self, mime_type: str, file_path: Path) -> bool:
        return mime_type == "application/epub+zip" or file_path.suffix.lower() == ".epub"

    def extract(self, db: Session, media_asset_id: uuid.UUID, file_path: Path, commit: bool = True) -> None:
        if not file_path.exists() or not zipfile.is_zipfile(file_path):
            return

        title = file_path.stem
        author = "Desconocido"
        raw_text_parts = []
        toc = []

        # Eliminar índices anteriores para asegurar idempotencia
        from backend.app.models.content import EmbeddingRecord
        old_content_ids = db.scalars(
            select(ContentIndex.id).where(ContentIndex.media_asset_id == media_asset_id)
        ).all()
        if old_content_ids:
            chunk_size = 500
            for i in range(0, len(old_content_ids), chunk_size):
                chunk = old_content_ids[i:i + chunk_size]
                db.query(EmbeddingRecord).filter(
                    EmbeddingRecord.entity_id.in_(chunk),
                    EmbeddingRecord.entity_type == "content_index"
                ).delete(synchronize_session=False)
        db.query(ContentIndex).filter(ContentIndex.media_asset_id == media_asset_id).delete()

        try:
            with zipfile.ZipFile(file_path) as z:
                # 1. Encontrar container.xml
                container_xml = z.read("META-INF/container.xml")
                root_container = ET.fromstring(container_xml)
                ns = {"ns": "urn:oasis:names:tc:opendocument:xmlns:container"}
                rootfile = root_container.find(".//ns:rootfile", ns)
                if rootfile is None:
                    return
                opf_path = rootfile.attrib["full-path"]
                opf_dir = Path(opf_path).parent

                # 2. Leer OPF
                opf_data = z.read(opf_path)
                root_opf = ET.fromstring(opf_data)

                # Namespaces
                ns_opf = {
                    "opf": "http://www.idpf.org/2007/opf",
                    "dc": "http://purl.org/dc/elements/1.1/"
                }

                # Metadatos del OPF
                title_elem = root_opf.find(".//dc:title", ns_opf)
                if title_elem is not None:
                    title = title_elem.text
                creator_elem = root_opf.find(".//dc:creator", ns_opf)
                if creator_elem is not None:
                    author = creator_elem.text

                # Leer el manifiesto OPF y recorrer el spine para extraer los
                # capítulos en su orden de lectura.
                manifest_items = {}
                for item in root_opf.findall(".//opf:manifest/opf:item", ns_opf):
                    manifest_items[item.attrib["id"]] = item.attrib["href"]

                spine_items = []
                for itemref in root_opf.findall(".//opf:spine/opf:itemref", ns_opf):
                    spine_items.append(itemref.attrib["idref"])

                chapter_num = 1
                chapters_to_add = []
                total_extracted_size = 0
                for idref in spine_items:
                    href = manifest_items.get(idref)
                    if not href:
                        continue

                    import urllib.parse
                    decoded_href = urllib.parse.unquote(href)
                    # Mitigación de Zip Slip / Directory Traversal antes de normalizar
                    if ".." in Path(decoded_href).parts or decoded_href.startswith("/"):
                        continue
                    full_href = (opf_dir / decoded_href).as_posix() if str(opf_dir) != "." else decoded_href
                    full_href = os.path.normpath(full_href)

                    # Mitigación de Zip Slip / Directory Traversal
                    if ".." in Path(full_href).parts or full_href.startswith("/") or full_href.startswith(".."):
                        continue

                    try:
                        # Mitigación de Zip Bomb (limitar a 10MB por archivo)
                        info = z.getinfo(full_href)
                        if info.file_size > 10 * 1024 * 1024:
                            continue

                        total_extracted_size += info.file_size
                        if total_extracted_size > 100 * 1024 * 1024:
                            break

                        html_content = z.read(full_href).decode("utf-8", errors="ignore")
                        # Remover tags HTML con regex simple
                        text_only = re.sub(r"<[^>]+>", " ", html_content)
                        # Normalizar espacios
                        text_only = re.sub(r"\s+", " ", text_only).strip()

                        if text_only:
                            raw_text_parts.append(text_only)
                            # Intentar inferir título de capítulo
                            title_match = re.search(r"<title>(.*?)</title>", html_content, re.IGNORECASE)
                            chap_title = title_match.group(1).strip() if title_match else f"Capítulo {chapter_num}"
                            toc.append({"title": chap_title, "depth": 0})

                            # Indexar
                            content_idx = ContentIndex(
                                id=uuid.uuid4(),
                                media_asset_id=media_asset_id,
                                section_identifier=f"chapter_{chapter_num}",
                                content=text_only
                            )
                            chapters_to_add.append(content_idx)
                            chapter_num += 1
                    except Exception:
                        continue
                if chapters_to_add:
                    db.add_all(chapters_to_add)

        except Exception as e:
            logger.error("Error parseando EPUB %s: %s", file_path, e)
            raise e

        full_text = "\n\n".join(raw_text_parts)

        # Guardar en BD
        stmt = select(ExtractedMetadata).where(ExtractedMetadata.media_asset_id == media_asset_id)
        extracted = db.scalars(stmt).first()

        if not extracted:
            extracted = ExtractedMetadata(
                id=uuid.uuid4(),
                media_asset_id=media_asset_id,
                title=title,
                author=author,
                page_count=len(raw_text_parts),
                toc={"items": toc} if toc else None,
                raw_text=full_text
            )
        else:
            extracted.title = title
            extracted.author = author
            extracted.page_count = len(raw_text_parts)
            extracted.toc = {"items": toc} if toc else None
            extracted.raw_text = full_text

        db.add(extracted)
        if commit:
            db.commit()
        else:
            db.flush()


class TranscriptExtractor(ContentExtractor):
    def can_handle(self, mime_type: str, file_path: Path) -> bool:
        return file_path.suffix.lower() in [".json", ".srt", ".vtt"]

    def extract(self, db: Session, media_asset_id: uuid.UUID, file_path: Path, commit: bool = True) -> None:
        """
        Lee el archivo de transcripción (.json, .srt, .vtt) y lo asocia al MediaAsset de video.
        """
        if not file_path.exists():
            return

        segments_data = []
        declared_language: Optional[str] = None

        # 1. Parsear archivo según su extensión
        ext = file_path.suffix.lower()
        if ext == ".json":
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # Idioma declarado por la fuente (metadatos), si existe.
                    declared_language = infer_transcript_language(data, file_path)
                    # Soportar formatos comunes
                    if "segments" in data:
                        for s in data["segments"]:
                            segments_data.append({
                                "start": float(s.get("start", s.get("start_time", 0.0))),
                                "end": float(s.get("end", s.get("end_time", 0.0))),
                                "text": s.get("text", "").strip()
                            })
            except Exception as e:
                logger.error("Error leyendo transcripción JSON %s: %s", file_path, e)

        elif ext == ".srt":
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                # Parseador SRT simple
                blocks = content.strip().split("\n\n")
                for block in blocks:
                    lines = block.split("\n")
                    if len(lines) >= 3:
                        time_line = lines[1]
                        text_lines = " ".join(lines[2:])
                        # Parsear tiempos: 00:00:10,000 --> 00:00:15,000
                        match = re.match(r"(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)(?:\s+.*)?", time_line)
                        if match:
                            def to_sec(h, m, s, ms):
                                return int(h)*3600 + int(m)*60 + int(s) + int(ms)/1000.0
                            start = to_sec(*match.groups()[0:4])
                            end = to_sec(*match.groups()[4:8])
                            segments_data.append({
                                "start": start,
                                "end": end,
                                "text": text_lines.strip()
                            })
            except Exception as e:
                logger.error("Error leyendo transcripción SRT %s: %s", file_path, e)

        elif ext == ".vtt":
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                # Parseador VTT simple
                blocks = content.strip().split("\n\n")
                for block in blocks:
                    lines = [line.strip() for line in block.split("\n") if line.strip()]
                    time_line = None
                    text_lines = []
                    for idx, line in enumerate(lines):
                        if "-->" in line:
                            time_line = line
                            text_lines = lines[idx+1:]
                            break
                    if time_line:
                        match = re.match(r"(?:(\d+):)?(\d+):(\d+)\.(\d+)\s*-->\s*(?:(\d+):)?(\d+):(\d+)\.(\d+)(?:\s+.*)?", time_line)
                        if match:
                            def to_sec(h, m, s, ms):
                                h_val = int(h) if h else 0
                                return h_val*3600 + int(m)*60 + int(s) + int(ms)/1000.0
                            g = match.groups()
                            start = to_sec(g[0], g[1], g[2], g[3])
                            end = to_sec(g[4], g[5], g[6], g[7])
                            segments_data.append({
                                "start": start,
                                "end": end,
                                "text": " ".join(text_lines).strip()
                            })
            except Exception as e:
                logger.error("Error leyendo transcripción VTT %s: %s", file_path, e)

        # Si no encontramos ningún segmento, no hacemos nada
        if not segments_data:
            return

        # Idioma efectivo: metadatos declarados o, en su defecto, indeterminado.
        if declared_language is None:
            declared_language = infer_transcript_language(None, file_path)

        # 2. Eliminar transcripciones anteriores asociadas y sus embeddings
        from backend.app.models.content import EmbeddingRecord
        # Obtener IDs de segmentos anteriores
        old_segment_ids = db.scalars(
            select(TranscriptSegment.id)
            .join(Transcript)
            .where(Transcript.media_asset_id == media_asset_id)
        ).all()
        if old_segment_ids:
            chunk_size = 500
            for i in range(0, len(old_segment_ids), chunk_size):
                chunk = old_segment_ids[i:i + chunk_size]
                db.query(EmbeddingRecord).filter(
                    EmbeddingRecord.entity_id.in_(chunk),
                    EmbeddingRecord.entity_type == "transcript_segment"
                ).delete(synchronize_session=False)

        # También el embedding del transcript completo en ContentIndex
        old_content_ids = db.scalars(
            select(ContentIndex.id)
            .where(ContentIndex.media_asset_id == media_asset_id, ContentIndex.section_identifier == "transcript")
        ).all()
        if old_content_ids:
            chunk_size = 500
            for i in range(0, len(old_content_ids), chunk_size):
                chunk = old_content_ids[i:i + chunk_size]
                db.query(EmbeddingRecord).filter(
                    EmbeddingRecord.entity_id.in_(chunk),
                    EmbeddingRecord.entity_type == "content_index"
                ).delete(synchronize_session=False)

        db.query(Transcript).filter(Transcript.media_asset_id == media_asset_id).delete()
        db.query(ContentIndex).filter(ContentIndex.media_asset_id == media_asset_id, ContentIndex.section_identifier == "transcript").delete()

        # 3. Crear Transcript y TranscriptSegments
        transcript = Transcript(
            id=uuid.uuid4(),
            media_asset_id=media_asset_id,
            language=declared_language or UNDETERMINED_LANGUAGE
        )
        db.add(transcript)
        if commit:
            db.commit()
        else:
            db.flush()

        full_text_list = []
        segs_to_add = []
        for s in segments_data:
            seg = TranscriptSegment(
                id=uuid.uuid4(),
                transcript_id=transcript.id,
                start_time=s["start"],
                end_time=s["end"],
                text=s["text"]
            )
            segs_to_add.append(seg)
            full_text_list.append(s["text"])
        if segs_to_add:
            db.add_all(segs_to_add)

        # Indexar transcripción completa en el ContentIndex
        full_transcript_text = " ".join(full_text_list)
        content_idx = ContentIndex(
            id=uuid.uuid4(),
            media_asset_id=media_asset_id,
            section_identifier="transcript",
            content=full_transcript_text
        )
        db.add(content_idx)
        if commit:
            db.commit()
        else:
            db.flush()


class VideoExtractor(ContentExtractor):
    def can_handle(self, mime_type: str, file_path: Path) -> bool:
        return mime_type.startswith("video/") or file_path.suffix.lower() in [".mp4", ".webm", ".mov", ".mkv", ".avi"]

    def extract(self, db: Session, media_asset_id: uuid.UUID, file_path: Path, commit: bool = True) -> None:
        # El video en sí no tiene extracción directa de texto en esta clase base.
        # Sirve para canalizar la búsqueda de subtítulos asociados (.srt/.vtt/.json).
        pass


class ContentIntelligenceManager:
    def __init__(self, db: Session):
        self.db = db
        self.extractors: List[ContentExtractor] = [
            PDFExtractor(),
            EPUBExtractor(),
            TranscriptExtractor(),
            VideoExtractor()
        ]

    def extract_and_index(self, media_asset_id: uuid.UUID, commit: bool = True) -> bool:
        """Busca el MediaAsset, selecciona el extractor apropiado y ejecuta la extracción."""
        asset = self.db.get(MediaAsset, media_asset_id)
        if not asset:
            return False

        file_path = Path(asset.file_path)
        if not file_path.exists():
            return False

        for ext in self.extractors:
            if ext.can_handle(asset.mime_type, file_path):
                # Usar transacción anidada (savepoint) para aislar fallos de extracción individuales
                try:
                    with self.db.begin_nested():
                        ext.extract(self.db, media_asset_id, file_path, commit=False)

                        # Si el activo de medios tiene una transcripción al lado en formato SRT o JSON,
                        # intentar extraerla automáticamente (e.g. video.mp4 y video.srt)
                        if asset.media_type == "video":
                            for suffix in [".srt", ".json", ".vtt"]:
                                transcript_path = file_path.with_suffix(suffix)
                                if transcript_path.exists():
                                    self.extractors[2].extract(self.db, media_asset_id, transcript_path, commit=False)
                                    break
                    if commit:
                        self.db.commit()
                    return True
                except Exception as e:
                    logger.error("Error extrayendo metadatos de %s: %s", file_path, e)
                    return False
        return False
