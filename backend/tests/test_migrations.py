import os


def test_alembic_inactive_seconds_has_default():
    """Verify the migration fix: inactive_seconds column has server_default='0'."""
    versions_dir = os.path.join(
        os.path.dirname(__file__), "..", "alembic", "versions"
    )
    migration_file = None
    for fname in os.listdir(versions_dir):
        if fname.startswith("9bd4577cf6f2"):
            migration_file = os.path.join(versions_dir, fname)
            break

    assert migration_file is not None, "Migration file 9bd4577cf6f2 not found"

    with open(migration_file) as f:
        content = f.read()

    assert "server_default='0'" in content or 'server_default="0"' in content, (
        "Migration 9bd4577cf6f2 must have server_default='0' for inactive_seconds"
    )


def test_all_migrations_exist():
    """Verify all expected migration files are present."""
    versions_dir = os.path.join(
        os.path.dirname(__file__), "..", "alembic", "versions"
    )
    files = [f for f in os.listdir(versions_dir) if f.endswith(".py") and not f.startswith("__")]

    # At least the initial migration and the inactive_seconds migration
    assert len(files) >= 2
    names = " ".join(files)
    assert "initial" in names.lower() or "dc7034d6ba93" in names
    assert "9bd4577cf6f2" in names


def test_alembic_ini_exists():
    """Verify alembic.ini is present and configured."""
    assert os.path.exists("backend/alembic.ini")

    with open("backend/alembic.ini") as f:
        content = f.read()

    assert "script_location" in content
    assert "sqlalchemy.url" in content


def test_alembic_upgrade_head_clean_database(tmp_path):
    """Verify alembic upgrade head runs cleanly from scratch without duplicate index errors."""
    import subprocess
    import sys
    test_db = tmp_path / "test_fresh_migration.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{test_db}"
    res = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"],
        env=env,
        capture_output=True,
        text=True,
        cwd=os.getcwd()
    )
    assert res.returncode == 0, f"Alembic upgrade head failed: {res.stderr}"
    assert test_db.exists()


def _run_alembic(database_url: str, *args: str):
    """Run an Alembic command against an isolated SQLite file."""
    import subprocess
    import sys

    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", *args],
        env=env,
        capture_output=True,
        text=True,
        cwd=os.getcwd(),
    )


def _normalize_check(sqltext: str) -> str:
    """Whitespace and redundant outer parentheses are not part of the rule."""
    value = " ".join((sqltext or "").split())
    while value.startswith("(") and value.endswith(")"):
        depth = 0
        redundant = True
        for index, char in enumerate(value):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and index != len(value) - 1:
                    redundant = False
                    break
        if not redundant or depth != 0:
            break
        value = value[1:-1].strip()
    return value


def _schema_per_table(path):
    """Indexes, foreign keys and CHECKs of every table, normalized.

    Comparing only index names missed a real divergence: fresh installs kept
    `ON DELETE CASCADE` on `learning_session` while the browser schema (the
    canonical one) declares `ON DELETE SET NULL`. Constraints are part of the
    contract too.
    """
    from sqlalchemy import create_engine, inspect

    engine = create_engine(f"sqlite:///{path}")
    inspector = inspect(engine)
    schema = {}
    for table in inspector.get_table_names():
        if table == "alembic_version":
            continue
        foreign_keys = set()
        for foreign_key in inspector.get_foreign_keys(table):
            options = foreign_key.get("options") or {}
            ondelete = options.get("ondelete") or foreign_key.get("ondelete")
            foreign_keys.add(
                (
                    tuple(foreign_key["constrained_columns"]),
                    foreign_key["referred_table"],
                    tuple(foreign_key["referred_columns"]),
                    (ondelete or "").upper(),
                )
            )
        checks = {
            _normalize_check(check.get("sqltext"))
            for check in inspector.get_check_constraints(table)
        }
        schema[table] = {
            "indexes": {index["name"] for index in inspector.get_indexes(table)},
            "foreign_keys": foreign_keys,
            "checks": checks,
            # Column nullability is part of the contract too: `create_all()` once
            # produced a nullable column that a migrated install declared NOT
            # NULL, and comparing only indexes/FKs/CHECKs could not see it.
            "columns": {
                (column["name"], bool(column["nullable"]))
                for column in inspector.get_columns(table)
            },
        }
    engine.dispose()
    return schema


def test_fresh_create_all_and_migrated_schema_agree(tmp_path):
    """`create_all()` and `alembic upgrade head` must build the SAME contract.

    Indexes, foreign keys (including ON DELETE behaviour) and CHECK constraints
    are compared table by table instead of trusting the docstrings.
    """
    import backend.app.models  # noqa: F401 - registers every table on the metadata
    from backend.app.core.database import Base
    from sqlalchemy import create_engine

    created_path = tmp_path / "created.db"
    migrated_path = tmp_path / "migrated.db"

    created_engine = create_engine(f"sqlite:///{created_path}")
    Base.metadata.create_all(bind=created_engine)
    created_engine.dispose()

    result = _run_alembic(f"sqlite:///{migrated_path}", "upgrade", "head")
    assert result.returncode == 0, f"Alembic upgrade head failed: {result.stderr}"

    created = _schema_per_table(created_path)
    migrated = _schema_per_table(migrated_path)

    assert set(created) == set(migrated), (
        "Tablas sólo en create_all: "
        f"{sorted(set(created) - set(migrated))}; sólo en migraciones: "
        f"{sorted(set(migrated) - set(created))}"
    )

    divergent = {
        table: {
            clave: {
                "faltan_en_create_all": sorted(migrated[table][clave] - created[table][clave], key=str),
                "faltan_en_migraciones": sorted(created[table][clave] - migrated[table][clave], key=str),
            }
            for clave in ("indexes", "foreign_keys", "checks", "columns")
            if created[table][clave] != migrated[table][clave]
        }
        for table in created
        if created[table] != migrated[table]
    }
    assert divergent == {}, f"Esquema divergente entre instalación fresca y migrada: {divergent}"


def test_session_history_survives_upgrade_from_previous_head(tmp_path):
    """Upgrading keeps every session and switches the anchors to SET NULL.

    Reproduces a real upgraded install: rows exist BEFORE the new revision. The
    migration must preserve them (including a resource session whose resource
    was already unlinked) and only change the rules, never the data.
    """
    from sqlalchemy import create_engine, inspect, text

    database_url = f"sqlite:///{tmp_path / 'upgraded.db'}"
    result = _run_alembic(database_url, "upgrade", "c58e1d7b3a22")
    assert result.returncode == 0, f"Alembic upgrade to the previous head failed: {result.stderr}"

    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO learning_resource (id, title, category, status, type) "
            "VALUES ('r1', 'Curso Legacy', 'General', 'NOT_STARTED', 'course')"
        ))
        # Joined-table inheritance: `module.course_id` references `course.id`,
        # not `learning_resource.id`, so the discriminator row is required.
        conn.execute(text(
            "INSERT INTO course (id, difficulty) VALUES ('r1', 'BEGINNER')"
        ))
        conn.execute(text(
            "INSERT INTO module (id, course_id, title, order_index) "
            "VALUES ('m1', 'r1', 'Módulo', 1)"
        ))
        conn.execute(text(
            "INSERT INTO lesson (id, module_id, title, duration_minutes, "
            "is_completed, lesson_type, order_index) "
            "VALUES ('l1', 'm1', 'Lección', 10, 0, 'VIDEO', 1)"
        ))
        conn.execute(text(
            "INSERT INTO learning_session "
            "(id, resource_id, lesson_id, scope, mode, started_at, duration_minutes, inactive_seconds) "
            "VALUES ('s-resource', 'r1', NULL, 'resource', 'flashcards', CURRENT_TIMESTAMP, 12, 0)"
        ))
        conn.execute(text(
            "INSERT INTO learning_session "
            "(id, resource_id, lesson_id, scope, mode, started_at, duration_minutes, inactive_seconds) "
            "VALUES ('s-lesson', 'r1', 'l1', 'lesson', 'flashcards', CURRENT_TIMESTAMP, 25, 0)"
        ))
        # A lesson-scoped session whose lesson was unlinked: the old CHECK did
        # not require a lesson anchor, so this state can exist before the
        # upgrade and must keep its declared scope afterwards.
        conn.execute(text(
            "INSERT INTO learning_session "
            "(id, resource_id, lesson_id, scope, mode, started_at, duration_minutes, inactive_seconds) "
            "VALUES ('s-unlinked', NULL, 'l1', 'lesson', 'flashcards', CURRENT_TIMESTAMP, 7, 0)"
        ))
        conn.execute(text(
            "UPDATE learning_session SET lesson_id = NULL WHERE id = 's-unlinked'"
        ))
    engine.dispose()

    result = _run_alembic(database_url, "upgrade", "head")
    assert result.returncode == 0, f"Alembic upgrade head failed: {result.stderr}"

    engine = create_engine(database_url)
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, resource_id, lesson_id, scope, duration_minutes "
            "FROM learning_session ORDER BY id"
        )).all()
    assert rows == [
        ("s-lesson", "r1", "l1", "lesson", 25),
        ("s-resource", "r1", None, "resource", 12),
        ("s-unlinked", None, None, "lesson", 7),
    ], "la migración no reescribe ni descarta ninguna sesión histórica"

    inspector = inspect(engine)
    ondelete = {
        foreign_key["constrained_columns"][0]: (
            (foreign_key.get("options") or {}).get("ondelete")
            or foreign_key.get("ondelete")
            or ""
        ).upper()
        for foreign_key in inspector.get_foreign_keys("learning_session")
    }
    assert ondelete == {"resource_id": "SET NULL", "lesson_id": "SET NULL"}

    checks = {
        _normalize_check(check.get("sqltext"))
        for check in inspector.get_check_constraints("learning_session")
    }
    assert "scope <> 'resource' OR resource_id IS NOT NULL" not in checks, (
        "el CHECK que impedía el desvinculado debe desaparecer"
    )
    assert "scope IN ('global', 'resource', 'lesson')" in checks
    assert "scope <> 'global' OR (resource_id IS NULL AND lesson_id IS NULL)" in checks
    engine.dispose()


def test_session_history_roundtrip_survives_downgrade(tmp_path):
    """The downgrade restores the old rules without deleting a single session.

    Rolling back is the path nobody exercises by hand: it re-adds the
    anchor-requiring CHECK, which cannot represent a session whose resource was
    unlinked (`ON DELETE SET NULL` produces exactly that state). The rule is to
    re-derive the DECLARED scope of those rows — the history stays, only its
    label becomes the global review it effectively is — and to do it BEFORE the
    constraint is created, or the downgrade aborts half applied.
    """
    from sqlalchemy import create_engine, inspect, text

    database_url = f"sqlite:///{tmp_path / 'roundtrip.db'}"
    result = _run_alembic(database_url, "upgrade", "c58e1d7b3a22")
    assert result.returncode == 0, f"Alembic upgrade to the previous head failed: {result.stderr}"

    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO learning_resource (id, title, category, status, type) "
            "VALUES ('r1', 'Curso Roundtrip', 'General', 'NOT_STARTED', 'course')"
        ))
        conn.execute(text("INSERT INTO course (id, difficulty) VALUES ('r1', 'BEGINNER')"))
        conn.execute(text(
            "INSERT INTO module (id, course_id, title, order_index) "
            "VALUES ('m1', 'r1', 'Módulo', 1)"
        ))
        conn.execute(text(
            "INSERT INTO lesson (id, module_id, title, duration_minutes, "
            "is_completed, lesson_type, order_index) "
            "VALUES ('l1', 'm1', 'Lección', 10, 0, 'VIDEO', 1)"
        ))
        conn.execute(text(
            "INSERT INTO learning_session "
            "(id, resource_id, lesson_id, scope, mode, started_at, duration_minutes, inactive_seconds) "
            "VALUES ('s-resource', 'r1', NULL, 'resource', 'flashcards', CURRENT_TIMESTAMP, 12, 0)"
        ))
        conn.execute(text(
            "INSERT INTO learning_session "
            "(id, resource_id, lesson_id, scope, mode, started_at, duration_minutes, inactive_seconds) "
            "VALUES ('s-unlinked', 'r1', NULL, 'resource', 'flashcards', CURRENT_TIMESTAMP, 9, 0)"
        ))
    engine.dispose()

    result = _run_alembic(database_url, "upgrade", "head")
    assert result.returncode == 0, f"Alembic upgrade head failed: {result.stderr}"

    # The state `ON DELETE SET NULL` leaves behind: the anchor is gone, the
    # declared scope is untouched (that is the contract this phase introduced).
    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text("UPDATE learning_session SET resource_id = NULL WHERE id = 's-unlinked'"))
    engine.dispose()

    result = _run_alembic(database_url, "downgrade", "c58e1d7b3a22")
    assert result.returncode == 0, f"Alembic downgrade failed: {result.stderr}"

    engine = create_engine(database_url)
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, scope, duration_minutes FROM learning_session ORDER BY id"
        )).all()
    assert rows == [
        ("s-resource", "resource", 12),
        ("s-unlinked", "global", 9),
    ], "el downgrade no borra sesiones: sólo re-etiqueta la que ya no tiene ancla"

    inspector = inspect(engine)
    ondelete = {
        foreign_key["constrained_columns"][0]: (
            (foreign_key.get("options") or {}).get("ondelete")
            or foreign_key.get("ondelete")
            or ""
        ).upper()
        for foreign_key in inspector.get_foreign_keys("learning_session")
    }
    assert ondelete == {"resource_id": "CASCADE", "lesson_id": "CASCADE"}
    checks = {
        _normalize_check(check.get("sqltext"))
        for check in inspector.get_check_constraints("learning_session")
    }
    assert "scope <> 'resource' OR resource_id IS NOT NULL" in checks, (
        "el downgrade debe restaurar el contrato anterior"
    )
    engine.dispose()

    # And forward again: the roundtrip must not resurrect the deleted anchor nor
    # lose the row it had just re-labelled.
    result = _run_alembic(database_url, "upgrade", "head")
    assert result.returncode == 0, f"Alembic upgrade head after downgrade failed: {result.stderr}"
    engine = create_engine(database_url)
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, resource_id, scope FROM learning_session ORDER BY id"
        )).all()
    engine.dispose()
    assert rows == [
        ("s-resource", "r1", "resource"),
        ("s-unlinked", None, "global"),
    ]


def test_note_title_and_tags_are_backfilled_without_touching_content(tmp_path):
    """Upgrading keeps every note and gives it a real title.

    Reproduces a database created BEFORE `d2e3f4a5b6c7`: notes have only
    `content`. The migration must preserve the content verbatim, derive a
    non-empty `title` from the first non-empty line (or `Nota`) and leave `tags`
    NULL. No note is rewritten or dropped.
    """
    from sqlalchemy import create_engine, text

    database_url = f"sqlite:///{tmp_path / 'notes.db'}"
    result = _run_alembic(database_url, "upgrade", "c1d2e3f4a5b6")
    assert result.returncode == 0, f"Alembic upgrade to the previous head failed: {result.stderr}"

    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO note (id, content, created_at, updated_at) "
            "VALUES ('n1', 'Primera línea real del contenido', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        # Content with no usable text: the title must fall back, never be empty.
        conn.execute(text(
            "INSERT INTO note (id, content, created_at, updated_at) "
            "VALUES ('n2', '   \n  ', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
    engine.dispose()

    result = _run_alembic(database_url, "upgrade", "head")
    assert result.returncode == 0, f"Alembic upgrade head failed: {result.stderr}"

    engine = create_engine(database_url)
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, content, title, tags FROM note ORDER BY id"
        )).all()
    engine.dispose()

    assert rows == [
        ("n1", "Primera línea real del contenido", "Primera línea real del contenido", None),
        ("n2", "   \n  ", "Nota", None),
    ], "el contenido no cambia, el título se deriva y las etiquetas quedan NULL"

    # Y la columna queda con EXACTAMENTE las mismas reglas que en una base
    # fresca: `title` NOT NULL y sin default de servidor. Con un default, una
    # base migrada aceptaría `INSERT INTO note(content)` que la fresca rechaza.
    from sqlalchemy import inspect

    engine = create_engine(database_url)
    columns = {column["name"]: column for column in inspect(engine).get_columns("note")}
    engine.dispose()
    assert columns["title"]["nullable"] is False
    assert columns["title"]["default"] is None, (
        "el default de servidor de `title` debe desaparecer tras el backfill"
    )
    assert columns["tags"]["nullable"] is True
