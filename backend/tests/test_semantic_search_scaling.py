"""
A-4 / A-7 — Regresión: escalabilidad de la búsqueda semántica y tipos reales
en recursos relacionados.

Cubre:
  - SQLiteVectorStore: orden del top-k, umbral, aislamiento por modelo y por
    tipo de entidad, exclusión de entidades y paginación (offset).
  - Escalado: una búsqueda con miles de embeddings termina en tiempo razonable
    y devuelve el top-k correcto (detecta regresiones O(n²) o materiales totales).
  - get_related_resources devuelve el TIPO REAL (course/book) en lugar de
    etiquetar todo como "course".
"""
import json
import time
import uuid

import pytest

from backend.app.models.activity import Note
from backend.app.models.content import EmbeddingRecord
from backend.app.models.base import ResourceStatus
from backend.app.models.resource import Book, Course
from backend.app.services.semantic_search import SemanticSearchService
from backend.app.services.vector_store import SQLiteVectorStore, cosine_similarity

TEST_MODEL = "test-embedding-model"
_EMBED_DIM = 16


def _fake_embedding(text: str):
    """Embedding determinista por tokens, sin depender de proveedores reales."""
    import hashlib

    vector = [0.0] * _EMBED_DIM
    for token in text.lower().split():
        index = int(hashlib.md5(token.encode()).hexdigest(), 16) % _EMBED_DIM
        vector[index] += 1.0
    norm = sum(v * v for v in vector) ** 0.5 or 1.0
    return [v / norm for v in vector]


@pytest.fixture(autouse=True)
def deterministic_embedding_provider(monkeypatch):
    """Sustituye el proveedor de embeddings por el determinista de prueba."""
    from backend.app.services.embedding import EmbeddingService

    monkeypatch.setattr(EmbeddingService, "get_embedding", staticmethod(_fake_embedding))
    monkeypatch.setattr(EmbeddingService, "get_model_name", staticmethod(lambda: TEST_MODEL))
    yield


def _add_embedding(db, entity, entity_type: str, text: str, model: str = TEST_MODEL):
    # La fixture `db` usa autoflush=False: hay que confirmar explícitamente.
    db.add(EmbeddingRecord(
        entity_id=entity.id,
        entity_type=entity_type,
        vector=json.dumps(_fake_embedding(text)),
        model=model,
        hash_content="hash",
    ))
    db.commit()


def _make_course(db, title: str) -> Course:
    course = Course(id=uuid.uuid4(), title=title, status=ResourceStatus.NOT_STARTED)
    db.add(course)
    return course


def _make_book(db, title: str) -> Book:
    book = Book(
        id=uuid.uuid4(), title=title, status=ResourceStatus.NOT_STARTED,
        reading_percentage=0.0,
    )
    db.add(book)
    return book


# --------------------------------------------------------------------------- #
# SQLiteVectorStore                                                            #
# --------------------------------------------------------------------------- #


def test_vector_store_returns_sorted_top_k(db):
    records = []
    for i in range(40):
        records.append(EmbeddingRecord(
            entity_id=uuid.uuid4(),
            entity_type="note",
            vector=json.dumps([1.0 if j == i % 16 else 0.0 for j in range(16)]),
            model=TEST_MODEL,
            hash_content=f"h{i}",
        ))
    db.add_all(records)
    db.commit()

    store = SQLiteVectorStore(db)
    query = [1.0] + [0.0] * 15  # más similar a los índices i % 16 == 0
    hits = store.search(query, model=TEST_MODEL, limit=5, threshold=0.0)

    assert len(hits) == 5
    scores = [h.score for h in hits]
    assert scores == sorted(scores, reverse=True)
    # El mejor candidato debe ser un vector idéntico a la consulta.
    assert hits[0].score == pytest.approx(1.0)


def test_vector_store_filters_by_model(db):
    current = EmbeddingRecord(
        entity_id=uuid.uuid4(), entity_type="note",
        vector=json.dumps([1.0, 0.0]), model=TEST_MODEL, hash_content="h",
    )
    stale = EmbeddingRecord(
        entity_id=uuid.uuid4(), entity_type="note",
        vector=json.dumps([0.0, 1.0]), model="old-model", hash_content="h2",
    )
    db.add_all([current, stale])
    db.commit()

    store = SQLiteVectorStore(db)
    hits = store.search([1.0, 0.0], model=TEST_MODEL, limit=10, threshold=0.0)
    assert [h.entity_id for h in hits] == [str(current.entity_id)]


def test_vector_store_excludes_and_scopes_entities(db):
    a = EmbeddingRecord(entity_id=uuid.uuid4(), entity_type="note",
                        vector=json.dumps([1.0, 0.0]), model=TEST_MODEL, hash_content="a")
    b = EmbeddingRecord(entity_id=uuid.uuid4(), entity_type="note",
                        vector=json.dumps([0.9, 0.1]), model=TEST_MODEL, hash_content="b")
    c = EmbeddingRecord(entity_id=uuid.uuid4(), entity_type="content_index",
                        vector=json.dumps([0.8, 0.2]), model=TEST_MODEL, hash_content="c")
    db.add_all([a, b, c])
    db.commit()

    store = SQLiteVectorStore(db)

    hits = store.search([1.0, 0.0], model=TEST_MODEL, limit=10, threshold=0.0,
                        exclude_entity_ids=[a.entity_id])
    assert a.entity_id not in {h.entity_id for h in hits}

    hits = store.search([1.0, 0.0], model=TEST_MODEL, limit=10, threshold=0.0,
                        entity_types=["content_index"])
    assert [h.entity_id for h in hits] == [str(c.entity_id)]

    hits = store.search([1.0, 0.0], model=TEST_MODEL, limit=1, threshold=0.0)
    assert len(hits) == 1
    assert hits[0].score == pytest.approx(1.0)  # solo el mejor candidato


def test_vector_store_respects_threshold_and_batching(db):
    exact = EmbeddingRecord(entity_id=uuid.uuid4(), entity_type="note",
                            vector=json.dumps([1.0, 0.0]), model=TEST_MODEL, hash_content="e")
    weak = EmbeddingRecord(entity_id=uuid.uuid4(), entity_type="note",
                           vector=json.dumps([0.05, 1.0]), model=TEST_MODEL, hash_content="w")
    db.add_all([exact, weak])
    db.commit()

    store = SQLiteVectorStore(db, batch_size=1, scan_limit=50)
    hits = store.search([1.0, 0.0], model=TEST_MODEL, limit=10, threshold=0.9)
    assert [h.entity_id for h in hits] == [str(exact.entity_id)]


def test_cosine_similarity_edge_cases():
    assert cosine_similarity([1, 2, 3], [1, 2, 3]) == pytest.approx(1.0)
    assert cosine_similarity([1, 0], [0, 1]) == 0.0
    assert cosine_similarity([1, 0], [1, 0, 0]) == 0.0  # dimensiones distintas
    assert cosine_similarity([0, 0], [1, 1]) == 0.0     # vector nulo


# --------------------------------------------------------------------------- #
# Escalado                                                                     #
# --------------------------------------------------------------------------- #


def test_search_scales_with_thousands_of_embeddings(db):
    """
    1500 embeddings deben poder buscarse en un tiempo acotado.

    El límite no verifica hardware: detecta regresiones que materialicen todas
    las filas y recalculen la consulta sin acotar (comportamiento O(n·k) sano).
    """
    db.add_all([
        EmbeddingRecord(
            entity_id=uuid.uuid4(),
            entity_type="note",
            vector=json.dumps([(i % 16) / 16.0] * 16),
            model=TEST_MODEL,
            hash_content=f"scale-{i}",
        )
        for i in range(1500)
    ])
    db.commit()

    store = SQLiteVectorStore(db)
    query = [1.0] + [0.0] * 15

    started = time.perf_counter()
    hits = store.search(query, model=TEST_MODEL, limit=10, threshold=0.0)
    elapsed = time.perf_counter() - started

    assert len(hits) == 10
    assert elapsed < 5.0, f"La búsqueda tardó {elapsed:.2f}s: posible regresión de escalado"
    assert hits[0].score > 0


def test_semantic_search_applies_limit_and_offset(db):
    course = _make_course(db, "Curso Paginado")
    db.commit()
    for i in range(8):
        note = Note(id=uuid.uuid4(), resource_id=course.id, content=f"Matemáticas discretas tema {i} conjuntos y grafos.")
        db.add(note)
        db.commit()
        _add_embedding(db, note, "note", f"matematicas tema {i} conjuntos")
    db.commit()

    page_one = SemanticSearchService.search(db, "matematicas conjuntos", limit=3, offset=0)
    page_two = SemanticSearchService.search(db, "matematicas conjuntos", limit=3, offset=3)

    assert len(page_one) == 3
    assert len(page_two) == 3
    ids_one = {r["entity_id"] for r in page_one}
    ids_two = {r["entity_id"] for r in page_two}
    assert ids_one.isdisjoint(ids_two)
    assert page_one[0]["score"] >= page_one[1]["score"] >= page_one[2]["score"]


# --------------------------------------------------------------------------- #
# A-7: tipos reales en recursos relacionados                                   #
# --------------------------------------------------------------------------- #


def test_related_resources_return_real_domain_types(db):
    course = _make_course(db, "Curso de Color y Luz")
    book = _make_book(db, "Libro de Anatomía Artística")
    db.commit()

    note_course = Note(id=uuid.uuid4(), resource_id=course.id, content="armonía del color complementario")
    db.add(note_course)
    db.commit()
    _add_embedding(db, note_course, "note", "color complementario armonia")

    fragment_course = Note(id=uuid.uuid4(), resource_id=book.id, content="estructura del esqueleto humano")
    db.add(fragment_course)
    db.commit()
    _add_embedding(db, fragment_course, "note", "esqueleto anatomia estructura")

    related = SemanticSearchService.get_related_resources(db, course.id)

    by_id = {str(r["id"]): r for r in related}
    assert str(book.id) in by_id
    assert by_id[str(book.id)]["type"] == "book", "Un libro relacionado nunca debe reportarse como 'course'"
    assert by_id[str(book.id)]["title"] == "Libro de Anatomía Artística"


def test_related_resources_never_hardcode_course_type(db):
    """Un libro origen relacionado con cursos debe devolver type='course'."""
    book = _make_book(db, "Teoría de Grafos Aplicada")
    course_a = _make_course(db, "Algoritmos sobre Grafos")
    course_b = _make_course(db, "Estructuras de Datos y Grafos")
    db.commit()

    note_b = Note(id=uuid.uuid4(), resource_id=book.id, content="recorridos en anchura y profundidad")
    db.add(note_b)
    db.commit()
    _add_embedding(db, note_b, "note", "recorridos anchura profundidad grafos")

    for course, text in ((course_a, "bfs recorrido en anchura"), (course_b, "dfs recorrido en profundidad")):
        note = Note(id=uuid.uuid4(), resource_id=course.id, content=text)
        db.add(note)
        db.commit()
        _add_embedding(db, note, "note", text)

    related = SemanticSearchService.get_related_resources(db, book.id, limit=5)

    assert len(related) >= 2
    types = {str(r["id"]): r["type"] for r in related}
    assert types[str(course_a.id)] == "course"
    assert types[str(course_b.id)] == "course"


def test_related_resources_does_not_include_self(db):
    course = _make_course(db, "Curso Autorreferido")
    db.commit()
    note = Note(id=uuid.uuid4(), resource_id=course.id, content="contenido interno del curso")
    db.add(note)
    db.commit()
    _add_embedding(db, note, "note", "contenido interno del curso")

    related = SemanticSearchService.get_related_resources(db, course.id)
    assert course.id not in {r["id"] for r in related}
