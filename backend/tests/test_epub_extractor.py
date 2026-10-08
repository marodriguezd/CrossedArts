import uuid
import zipfile
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.models.resource import Book, MediaAsset
from backend.app.models.content import ExtractedMetadata, ContentIndex
from backend.app.models.base import ResourceStatus
from backend.app.services.extractor import EPUBExtractor


def create_mock_epub(path: Path, title="Test EPUB Book", author="Test Author", chapters=None):
    if chapters is None:
        chapters = [("Capitulo 1", "Texto del capitulo uno."), ("Capitulo 2", "Texto del capitulo dos.")]
    
    with zipfile.ZipFile(path, 'w') as z:
        # META-INF/container.xml
        container_content = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
        z.writestr("META-INF/container.xml", container_content)
        
        # OEBPS/content.opf
        opf_content = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
  </metadata>
  <manifest>
"""
        for i, _ in enumerate(chapters):
            opf_content += f'    <item id="chap_{i}" href="chap_{i}.html" media-type="application/xhtml+xml"/>\n'
        opf_content += """  </manifest>
  <spine>
"""
        for i in range(len(chapters)):
            opf_content += f'    <itemref idref="chap_{i}"/>\n'
        opf_content += """  </spine>
</package>"""
        z.writestr("OEBPS/content.opf", opf_content)
        
        # Chapters HTML
        for i, (chap_title, chap_text) in enumerate(chapters):
            html_content = f"""<html>
<head><title>{chap_title}</title></head>
<body>{chap_text}</body>
</html>"""
            z.writestr(f"OEBPS/chap_{i}.html", html_content)


def test_epub_extraction_success(db: Session, tmp_path: Path):
    epub_path = tmp_path / "test_book.epub"
    create_mock_epub(epub_path, title="El Quijote", author="Cervantes")

    book = Book(id=uuid.uuid4(), title="Test Book", status=ResourceStatus.NOT_STARTED)
    db.add(book)
    db.commit()

    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=book.id,
        media_type="epub",
        file_path=str(epub_path.resolve()),
        file_name="test_book.epub",
        mime_type="application/epub+zip"
    )
    db.add(asset)
    db.commit()

    extractor = EPUBExtractor()
    assert extractor.can_handle("application/epub+zip", epub_path)
    
    extractor.extract(db, asset.id, epub_path)

    # Validar persistencia de metadatos
    meta = db.scalars(select(ExtractedMetadata).where(ExtractedMetadata.media_asset_id == asset.id)).first()
    assert meta is not None
    assert meta.title == "El Quijote"
    assert meta.author == "Cervantes"
    assert meta.page_count == 2
    assert "Texto del capitulo uno" in meta.raw_text

    # Validar que los capítulos estén indexados en ContentIndex
    chapters = db.scalars(select(ContentIndex).where(ContentIndex.media_asset_id == asset.id)).all()
    assert len(chapters) == 2
    assert chapters[0].section_identifier == "chapter_1"
    assert "Texto del capitulo uno" in chapters[0].content


def test_epub_extraction_zip_slip_prevention(db: Session, tmp_path: Path):
    epub_path = tmp_path / "unsafe_book.epub"
    
    # Crear un zip con una ruta maliciosa conteniendo ".."
    with zipfile.ZipFile(epub_path, 'w') as z:
        # META-INF/container.xml
        container_content = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
        z.writestr("META-INF/container.xml", container_content)
        
        # OEBPS/content.opf referencing a path with ..
        opf_content = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Zip Slip</dc:title>
  </metadata>
  <manifest>
    <item id="chap_1" href="../outside.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap_1"/>
  </spine>
</package>"""
        z.writestr("OEBPS/content.opf", opf_content)
        z.writestr("outside.html", "<html><body>Hacked</body></html>")

    book = Book(id=uuid.uuid4(), title="Test Book Unsafe", status=ResourceStatus.NOT_STARTED)
    db.add(book)
    db.commit()

    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=book.id,
        media_type="epub",
        file_path=str(epub_path.resolve()),
        file_name="unsafe_book.epub",
        mime_type="application/epub+zip"
    )
    db.add(asset)
    db.commit()

    extractor = EPUBExtractor()
    extractor.extract(db, asset.id, epub_path)

    # Validar que no se haya extraído/procesado el archivo con ".."
    chapters = db.scalars(select(ContentIndex).where(ContentIndex.media_asset_id == asset.id)).all()
    assert len(chapters) == 0
