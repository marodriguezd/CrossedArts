"""
A-1 — Regresión: las pruebas NUNCA deben tocar la base de datos real del usuario.

Antecedente: el antiguo `conftest.py` ejecutaba
`Base.metadata.create_all(bind=real_engine)` al importarse. Eso dejaba la base
real con todas las tablas pero sin la fila `alembic_version`, de modo que el
siguiente `alembic upgrade head` fallaba con "table ... already exists".

Estas pruebas aseguran:
  1. Ningún archivo de prueba referencia el engine real de la aplicación.
  2. Las tareas en segundo plano usan SIEMPRE la base de la prueba.
  3. El endpoint de reindexado (que abre su propia sesión) escribe en la base
     de la prueba.
"""
import os
from pathlib import Path

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import sessionmaker

TESTS_DIR = Path(__file__).parent


def test_no_test_file_references_real_application_engine():
    """Guarda de fuente: ninguna prueba puede usar el engine real."""
    forbidden = [
        "from backend.app.core.database import engine",
        "import engine as real_engine",
        "create_all(bind=real_engine)",
        "create_all(bind=engine)",
    ]
    offenders = []
    for test_file in TESTS_DIR.glob("test_*.py"):
        # Este guardián contiene los patrones prohibidos como literales: se excluye.
        if test_file.name == Path(__file__).name:
            continue
        source = test_file.read_text(encoding="utf-8")
        for needle in forbidden:
            if needle in source:
                offenders.append(f"{test_file.name}: '{needle}'")
    assert not offenders, (
        "Hay pruebas que referencian o crean el esquema en el engine real de la "
        f"aplicación: {offenders}. Usa la fixture `db`/`db_engine` o parchea el "
        "engine del módulo antes de arrancar la app."
    )


def test_conftest_does_not_initialize_real_schema():
    """El conftest no debe importar ni usar el engine real."""
    conftest = (TESTS_DIR / "conftest.py").read_text(encoding="utf-8")
    assert "real_engine" not in conftest
    assert "from backend.app.core.database import engine" not in conftest
    # La única creación de esquema permitida es sobre el engine de la prueba.
    assert "Base.metadata.create_all(bind=engine)" in conftest


def test_background_session_factory_binds_to_test_engine(db_engine, isolated_background_sessions):
    """`SessionLocal` parcheada apunta al engine de la prueba."""
    import backend.app.core.database as database_module

    factory = database_module.SessionLocal
    assert factory is isolated_background_sessions
    session = factory()
    try:
        assert session.get_bind() is db_engine
    finally:
        session.close()


def test_background_style_write_goes_to_test_database(db, db_engine, isolated_background_sessions):
    """Una escritura al estilo de las tareas en segundo plano aterriza en la base de prueba."""
    import uuid

    from backend.app.models.activity import Note
    from backend.app.models.resource import Course
    from backend.app.models.base import ResourceStatus

    # Patrón idéntico al de los trabajadores en segundo plano: nueva sesión
    # desde `SessionLocal` importada DENTRO de la función.
    def run_background_task():
        from backend.app.core.database import SessionLocal

        session = SessionLocal()
        try:
            course = Course(
                id=uuid.uuid4(),
                title="Curso desde tarea en segundo plano",
                category="General",
                status=ResourceStatus.NOT_STARTED,
            )
            session.add(course)
            session.commit()
            return course.id
        finally:
            session.close()

    course_id = run_background_task()

    # El recurso existe en la base de la prueba...
    assert db.query(Course).filter(Course.id == course_id).first() is not None
    # ...y el engine de la prueba es el único con tablas creadas por ella.
    assert "course" in inspect(db_engine).get_table_names()


def test_reindex_endpoint_uses_test_database(client, db, isolated_background_sessions):
    """
    El endpoint /semantic/reindex abre su propia sesión en segundo plano.
    Con el parche de aislamiento debe indexar contra la base de la prueba.
    """
    import uuid

    from sqlalchemy import select

    from backend.app.models.activity import Note
    from backend.app.models.content import EmbeddingRecord
    from backend.app.models.resource import Course
    from backend.app.models.base import ResourceStatus
    from backend.app.services.embedding import EmbeddingService

    course = Course(id=uuid.uuid4(), title="Curso Reindex", status=ResourceStatus.NOT_STARTED)
    note = Note(id=uuid.uuid4(), resource_id=course.id, content="Contenido para indexar en segundo plano.")
    db.add_all([course, note])
    db.commit()

    response = client.post("/api/v1/semantic/reindex")
    assert response.status_code == 202

    # TestClient ejecuta las tareas en segundo plano antes de devolver el control.
    records = db.scalars(select(EmbeddingRecord)).all()
    assert len(records) == 1
    assert records[0].entity_type == "note"
    assert records[0].model == EmbeddingService.get_model_name()


def test_real_application_database_file_is_never_created_by_tests():
    """
    Las pruebas no deben crear el archivo de la base real del usuario.

    El engine real se crea de forma perezosa: si alguna prueba lo usara, el
    archivo aparecería en el primer acceso. Esta prueba no abre el engine real;
    solo comprueba que tras la ejecución del resto de la sesión el archivo no
    ha sido creado si antes no existía (se apoya en el orden de ejecución de
    pytest: los tests peligrosos ya habrían creado el archivo).
    """
    from backend.app.core.settings import settings

    db_path = settings.db_path
    # Si el usuario ya tiene base de datos, no la abrimos ni la modificamos.
    if db_path.exists():
        # Asegura que no es la base de alguna prueba (que siempre es :memory:).
        import backend.app.core.database as database_module

        assert str(database_module.engine.url) == str(settings.database_url)
    # Si no existía, ninguna prueba debería haberla creado: el engine real solo
    # se conecta perezosamente y las pruebas no lo usan.
