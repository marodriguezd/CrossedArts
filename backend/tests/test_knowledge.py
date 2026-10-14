import uuid
from sqlalchemy.orm import Session

from backend.app.models.resource import Book
from backend.app.services.note import NoteService
from backend.app.services.knowledge_service import KnowledgeService

def test_concept_and_connections_lifecycle(db: Session):
    c1 = KnowledgeService.create_concept(db, "Fotografía", "Arte de capturar luz")
    c2 = KnowledgeService.create_concept(db, "Composición")
    
    assert c1.name == "fotografía"
    assert c2.name == "composición"
    
    concepts = KnowledgeService.list_concepts(db)
    assert len(concepts) >= 2
    
    conn = KnowledgeService.create_connection(
        db, 
        source_id=c1.id, 
        source_type="concept", 
        target_id=c2.id, 
        target_type="concept",
        connection_type="related_to"
    )
    assert conn.connection_type == "related_to"
    
    related = KnowledgeService.get_related_entities(db, c1.id, "concept")
    assert len(related) == 1
    assert related[0]["entity_id"] == c2.id
    assert related[0]["entity_type"] == "concept"

def test_note_parsing_wiki_links_and_tags(db: Session):
    book = Book(
        id=uuid.uuid4(),
        title="Curso de Composición"
    )
    db.add(book)
    db.commit()

    note = NoteService.create_note(
        db, 
        resource_id=book.id, 
        content="Estudiando la regla de los tercios en #fotografía y #composición. Ver [[Enfoque Manual]] para más detalles."
    )
    
    concepts = KnowledgeService.list_concepts(db)
    concept_names = [c.name for c in concepts]
    assert "fotografía" in concept_names
    assert "composición" in concept_names
    assert "enfoque manual" in concept_names
    
    connections = KnowledgeService.get_related_entities(db, note.id, "note")
    # Expected connections:
    # - Note -> Resource (contains)
    # - Note -> Concept fotografia (tags)
    # - Note -> Concept composicion (tags)
    # - Note -> Concept "enfoque manual" (references)
    types = [conn["connection_type"] for conn in connections]
    assert "contains" in types
    assert "tags" in types
    assert "references" in types

    graph = KnowledgeService.get_knowledge_graph(db)
    assert len(graph["nodes"]) >= 4
    assert len(graph["links"]) >= 4
