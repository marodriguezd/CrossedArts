import re
from typing import List, Dict, Any, Optional
import uuid
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import Session

from backend.app.models.knowledge import Concept, KnowledgeConnection
from backend.app.models.activity import Note
from backend.app.models.resource import LearningResource
from backend.app.models.course_structure import Lesson

class KnowledgeService:
    @staticmethod
    def create_concept(db: Session, name: str, description: Optional[str] = None, commit: bool = True) -> Concept:
        """Crea un nuevo concepto si no existe, o retorna el existente."""
        clean_name = name.strip().lower()
        stmt = select(Concept).where(Concept.name == clean_name)
        concept = db.scalars(stmt).first()

        if not concept:
            concept = Concept(
                id=uuid.uuid4(),
                name=clean_name,
                description=description
            )
            db.add(concept)
            if commit:
                db.commit()
                db.refresh(concept)
            else:
                db.flush()
        return concept

    @staticmethod
    def get_concept(db: Session, concept_id: uuid.UUID) -> Optional[Concept]:
        return db.get(Concept, concept_id)

    @staticmethod
    def list_concepts(db: Session) -> List[Concept]:
        return list(db.scalars(select(Concept).order_by(Concept.name)).all())

    @staticmethod
    def delete_concept(db: Session, concept_id: uuid.UUID) -> bool:
        concept = db.get(Concept, concept_id)
        if not concept:
            return False

        # Eliminar conexiones asociadas
        db.query(KnowledgeConnection).filter(
            or_(
                and_(KnowledgeConnection.source_id == concept_id, KnowledgeConnection.source_type == "concept"),
                and_(KnowledgeConnection.target_id == concept_id, KnowledgeConnection.target_type == "concept")
            )
        ).delete()

        db.delete(concept)
        db.commit()
        return True

    @staticmethod
    def create_connection(
        db: Session,
        source_id: uuid.UUID,
        source_type: str,
        target_id: uuid.UUID,
        target_type: str,
        connection_type: str = "related_to",
        weight: float = 1.0,
        commit: bool = True
    ) -> KnowledgeConnection:
        """Create a graph connection/semantic edge unless an identical one exists."""
        stmt = select(KnowledgeConnection).where(
            and_(
                KnowledgeConnection.source_id == source_id,
                KnowledgeConnection.source_type == source_type,
                KnowledgeConnection.target_id == target_id,
                KnowledgeConnection.target_type == target_type,
                KnowledgeConnection.connection_type == connection_type
            )
        )
        existing = db.scalars(stmt).first()
        if existing:
            return existing

        conn = KnowledgeConnection(
            id=uuid.uuid4(),
            source_id=source_id,
            source_type=source_type,
            target_id=target_id,
            target_type=target_type,
            connection_type=connection_type,
            weight=weight
        )
        db.add(conn)
        if commit:
            db.commit()
            db.refresh(conn)
        else:
            db.flush()
        return conn

    @staticmethod
    def get_related_entities(db: Session, entity_id: uuid.UUID, entity_type: str) -> List[Dict[str, Any]]:
        """Busca todas las entidades conectadas directamente a la entidad dada."""
        stmt = select(KnowledgeConnection).where(
            or_(
                and_(KnowledgeConnection.source_id == entity_id, KnowledgeConnection.source_type == entity_type),
                and_(KnowledgeConnection.target_id == entity_id, KnowledgeConnection.target_type == entity_type)
            )
        )
        connections = db.scalars(stmt).all()

        related = []
        for conn in connections:
            is_source = (conn.source_id == entity_id and conn.source_type == entity_type)
            rel_id = conn.target_id if is_source else conn.source_id
            rel_type = conn.target_type if is_source else conn.source_type

            # Resolve the related entity's name/title.
            name = "Desconocido"
            if rel_type == "concept":
                concept = db.get(Concept, rel_id)
                name = concept.name if concept else "Concepto no encontrado"
            elif rel_type == "note":
                note = db.get(Note, rel_id)
                if note:
                    name = note.content[:50] + "..." if len(note.content) > 50 else note.content
            elif rel_type == "resource":
                res = db.get(LearningResource, rel_id)
                name = res.title if res else "Recurso no encontrado"
            elif rel_type == "lesson":
                les = db.get(Lesson, rel_id)
                name = les.title if les else "Lección no encontrada"

            related.append({
                "connection_id": conn.id,
                "entity_id": rel_id,
                "entity_type": rel_type,
                "name": name,
                "connection_type": conn.connection_type,
                "direction": "outgoing" if is_source else "incoming",
                "weight": conn.weight
            })
        return related

    @staticmethod
    def parse_note_relations(db: Session, note_id: uuid.UUID, commit: bool = True) -> None:
        """
        Parse a note's content to extract:
        - Wiki-link references: [[Target]]
        - Hashtags/Concepts: #concepto
        - Auto-link the note to its Resource and Lesson (both optional: a
          standalone note invents no anchors).

        Transactional contract: full regeneration is atomic. With `commit=False`
        (internal use from NoteService, which commits once) nothing commits here:
        only `flush`. With `commit=True` it commits exactly once, at the end. A
        mid-parse failure never leaves a half-regenerated edge set.
        """
        note = db.get(Note, note_id)
        if not note:
            return

        # 1. Drop this note's existing connections before regenerating (idempotency).
        # Parsing runs as ONE transaction: `flush` (to get created concept ids)
        # with a SINGLE commit at the end, or no change at all on failure, so a
        # regeneration never leaves a half-built edge set.
        db.query(KnowledgeConnection).filter(
            and_(
                KnowledgeConnection.source_id == note_id,
                KnowledgeConnection.source_type == "note"
            )
        ).delete(synchronize_session=False)
        db.flush()

        # 2. Auto-link the Resource (Course/Book) when the note has one. A
        # STANDALONE note invents no placeholder resource: it keeps no
        # containment edge and stays valid.
        if note.resource_id is not None:
            KnowledgeService.create_connection(
                db,
                source_id=note_id,
                source_type="note",
                target_id=note.resource_id,
                target_type="resource",
                connection_type="contains",
                weight=1.0,
                commit=False
            )

        # 3. Auto-link the Lesson when present.
        if note.lesson_id:
            KnowledgeService.create_connection(
                db,
                source_id=note_id,
                source_type="note",
                target_id=note.lesson_id,
                target_type="lesson",
                connection_type="contains",
                weight=1.0,
                commit=False
            )

        content = note.content

        # 4. Extraer hashtags/conceptos: #fotografia
        tags = re.findall(r"#(\w+)", content)
        for tag in tags:
            concept = KnowledgeService.create_concept(db, tag, commit=False)
            KnowledgeService.create_connection(
                db,
                source_id=note_id,
                source_type="note",
                target_id=concept.id,
                target_type="concept",
                connection_type="tags",
                weight=1.0,
                commit=False
            )

        # 5. Extraer wiki-links: [[Destino]]
        wiki_links = re.findall(r"\[\[([^\]]+)\]\]", content)
        for link in wiki_links:
            link_clean = link.strip()

            # Caso A: El link es un UUID
            target_uuid = None
            try:
                target_uuid = uuid.UUID(link_clean)
            except ValueError:
                pass

            if target_uuid:
                # Comprobar si apunta a nota, concepto o recurso
                if db.get(Note, target_uuid):
                    KnowledgeService.create_connection(db, note_id, "note", target_uuid, "note", "references", commit=False)
                elif db.get(Concept, target_uuid):
                    KnowledgeService.create_connection(db, note_id, "note", target_uuid, "concept", "references", commit=False)
                elif db.get(LearningResource, target_uuid):
                    KnowledgeService.create_connection(db, note_id, "note", target_uuid, "resource", "references", commit=False)
                continue

            # Caso B: El link es el nombre de un Concepto
            concept = KnowledgeService.create_concept(db, link_clean, commit=False)
            KnowledgeService.create_connection(
                db,
                source_id=note_id,
                source_type="note",
                target_id=concept.id,
                target_type="concept",
                connection_type="references",
                weight=1.0,
                commit=False
            )

        # 6. Single commit point: the full edge set lands at once, or not at all.
        if commit:
            db.commit()
        else:
            db.flush()

    @staticmethod
    def get_knowledge_graph(db: Session) -> Dict[str, List[Dict[str, Any]]]:
        """Return every node and link for knowledge-graph rendering."""
        nodes = []
        concepts = db.scalars(select(Concept)).all()
        for c in concepts:
            nodes.append({
                "id": str(c.id),
                "type": "concept",
                "label": f"#{c.name}",
                "val": 15
            })

        notes = db.scalars(select(Note)).all()
        for n in notes:
            summary = n.content[:30] + "..." if len(n.content) > 30 else n.content
            nodes.append({
                "id": str(n.id),
                "type": "note",
                "label": summary,
                "val": 10
            })

        resources = db.scalars(select(LearningResource)).all()
        for r in resources:
            nodes.append({
                "id": str(r.id),
                "type": "resource",
                "label": r.title,
                "val": 20
            })

        # Lecciones
        lessons = db.scalars(select(Lesson)).all()
        for les in lessons:
            nodes.append({
                "id": str(les.id),
                "type": "lesson",
                "label": les.title,
                "val": 12
            })

        # Aristas/Conexiones
        edges = []
        connections = db.scalars(select(KnowledgeConnection)).all()
        for conn in connections:
            edges.append({
                "id": str(conn.id),
                "source": str(conn.source_id),
                "target": str(conn.target_id),
                "type": conn.connection_type,
                "weight": conn.weight
            })

        return {"nodes": nodes, "links": edges}
