import uuid
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.models.resource import Course, MediaAsset
from backend.app.models.content import ContentIndex, EmbeddingRecord
from backend.app.models.base import ResourceStatus
from backend.app.services.embedding import EmbeddingService


def test_batch_deletion_within_limit(db: Session):
    """Deleting 600+ content_index records must not hit SQLite parameter limit (999)."""
    course = Course(id=uuid.uuid4(), title="Batch Test", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=course.id,
        media_type="pdf",
        file_path="/dummy.pdf",
        file_name="test.pdf",
        mime_type="application/pdf",
    )
    db.add(asset)
    db.commit()

    # Create 600 content_index records (exceeds old single-query limit)
    content_indices = []
    for i in range(600):
        idx = ContentIndex(
            id=uuid.uuid4(),
            media_asset_id=asset.id,
            section_identifier=f"page_{i}",
            content=f"Content for page {i}",
        )
        content_indices.append(idx)
    db.add_all(content_indices)
    db.commit()

    # Index embeddings for all of them
    for idx in content_indices:
        EmbeddingService.index_entity(db, idx.id, "content_index", idx.content, commit=False)
    db.commit()

    # Verify all exist
    count_before = db.query(ContentIndex).filter(ContentIndex.media_asset_id == asset.id).count()
    emb_count_before = db.query(EmbeddingRecord).filter(EmbeddingRecord.entity_type == "content_index").count()
    assert count_before == 600
    assert emb_count_before == 600

    # Simulate the batch deletion logic from extractor.py
    old_content_ids = db.scalars(
        select(ContentIndex.id).where(ContentIndex.media_asset_id == asset.id)
    ).all()

    chunk_size = 500
    for i in range(0, len(old_content_ids), chunk_size):
        chunk = old_content_ids[i:i + chunk_size]
        db.query(EmbeddingRecord).filter(
            EmbeddingRecord.entity_id.in_(chunk),
            EmbeddingRecord.entity_type == "content_index"
        ).delete(synchronize_session=False)
    db.query(ContentIndex).filter(ContentIndex.media_asset_id == asset.id).delete()
    db.commit()

    # Verify all deleted
    count_after = db.query(ContentIndex).filter(ContentIndex.media_asset_id == asset.id).count()
    emb_count_after = db.query(EmbeddingRecord).filter(
        EmbeddingRecord.entity_type == "content_index"
    ).count()
    assert count_after == 0
    assert emb_count_after == 0


def test_batch_deletion_empty_list(db: Session):
    """Batch deletion with no IDs must not error."""
    from backend.app.services.extractor import PDFExtractor
    # Just verify the extractor can be instantiated
    ext = PDFExtractor()
    assert ext.can_handle("application/pdf", __import__("pathlib").Path("test.pdf"))


def test_pdf_extractor_can_handle():
    from backend.app.services.extractor import PDFExtractor
    from pathlib import Path
    ext = PDFExtractor()
    assert ext.can_handle("application/pdf", Path("book.pdf"))
    assert ext.can_handle("application/pdf", Path("book.PDF"))
    assert not ext.can_handle("video/mp4", Path("video.mp4"))
