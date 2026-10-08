"""learning_session supports lesson-scoped study (resource_id nullable)

The frontend domain (SQLite WASM) treats a study session scoped to a lesson
without a resource as valid state: its own legacy-database migration rebuilds
learning_session with `resource_id` nullable and accepts either a resource or
a lesson anchor. The backend model declared resource_id NOT NULL, so both
halves of the product disagreed about which sessions exist.

This migration makes the backend agree with the implemented product behavior:

- `resource_id` becomes nullable (ON DELETE CASCADE is preserved);
- `lesson_id` and `mode` columns are added for lesson-scoped sessions;
- a CHECK constraint guarantees the session always keeps a scope anchor
  (resource_id or lesson_id), matching the frontend domain rule;
- indexes on the scope anchors support the dashboard/session queries.

SQLite cannot relax a NOT NULL column with ALTER TABLE, so the table is
recreated in a data-preserving way (the same technique batch mode uses, made
explicit here so the CHECK constraint lands in the same rebuild).

Fresh installs (models) and upgraded installs converge to the same schema.

Revision ID: f3a9c2d41b57
Revises: d8d6741e257c
Create Date: 2026-10-05 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from backend.app.core.database import GUID


# revision identifiers, used by Alembic.
revision: str = 'f3a9c2d41b57'
down_revision: Union[str, Sequence[str], None] = 'd8d6741e257c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Make resource_id nullable, add lesson_id/mode, enforce a scope anchor."""
    conn = op.get_bind()
    dialect = conn.dialect.name
    inspector = sa.inspect(conn)
    existing_columns = {c['name'] for c in inspector.get_columns('learning_session')}

    if dialect == 'sqlite':
        # Reconstrucción explícita y conservadora: SQLite no permite relajar
        # NOT NULL con ALTER TABLE ni añadir un CHECK con ALTER.
        has_lesson_id = 'lesson_id' in existing_columns
        lesson_select = 'lesson_id' if has_lesson_id else 'NULL'
        conn.execute(sa.text("""
            CREATE TABLE learning_session_migrated (
                id GUID NOT NULL,
                resource_id GUID,
                lesson_id GUID,
                mode VARCHAR(20) NOT NULL,
                started_at DATETIME NOT NULL,
                ended_at DATETIME,
                duration_minutes INTEGER NOT NULL,
                inactive_seconds INTEGER NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT ck_learning_session_scope CHECK (resource_id IS NOT NULL OR lesson_id IS NOT NULL),
                FOREIGN KEY(resource_id) REFERENCES learning_resource (id) ON DELETE CASCADE,
                FOREIGN KEY(lesson_id) REFERENCES lesson (id) ON DELETE CASCADE
            )
        """))
        conn.execute(sa.text(f"""
            INSERT INTO learning_session_migrated
                (id, resource_id, lesson_id, mode, started_at, ended_at, duration_minutes, inactive_seconds)
            SELECT id, resource_id, {lesson_select}, 'flashcards', started_at, ended_at, duration_minutes, inactive_seconds
            FROM learning_session
        """))
        conn.execute(sa.text("DROP TABLE learning_session"))
        conn.execute(sa.text("ALTER TABLE learning_session_migrated RENAME TO learning_session"))
        # Recrear TODOS los índices: al reconstruir la tabla, SQLite descarta los
        # índices previos (incluidos los de a1b2c3d4e5f6, que conceptualmente
        # siguen siendo de esa revisión). Sin esto, upgraded != fresh install.
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_started_at ON learning_session (started_at)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_ended_at ON learning_session (ended_at)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_resource_id ON learning_session (resource_id)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_lesson_id ON learning_session (lesson_id)"))
        return

    # Otros dialectos: ALTER TABLE incremental.
    if 'mode' not in existing_columns:
        op.add_column(
            'learning_session',
            sa.Column('mode', sa.String(length=20), nullable=False, server_default='flashcards')
        )
    if 'lesson_id' not in existing_columns:
        op.add_column('learning_session', sa.Column('lesson_id', GUID(), nullable=True))
    op.alter_column('learning_session', 'resource_id', existing_type=GUID(), nullable=True)
    op.create_index('ix_learning_session_resource_id', 'learning_session', ['resource_id'], unique=False)
    op.create_index('ix_learning_session_lesson_id', 'learning_session', ['lesson_id'], unique=False)
    op.create_check_constraint(
        'ck_learning_session_scope',
        'learning_session',
        'resource_id IS NOT NULL OR lesson_id IS NOT NULL'
    )


def downgrade() -> None:
    """Restaura resource_id NOT NULL y elimina el soporte de lecciones.

    Downgrade destructivo por diseño: las sesiones acotadas solo a lección no
    pueden representarse bajo el esquema anterior y se eliminan de forma
    explícita (nunca en silencio) antes de reactivar la restricción.
    """
    conn = op.get_bind()
    dialect = conn.dialect.name

    if dialect == 'sqlite':
        conn.execute(sa.text("""
            CREATE TABLE learning_session_downgrade (
                id GUID NOT NULL,
                resource_id GUID NOT NULL,
                started_at DATETIME NOT NULL,
                ended_at DATETIME,
                duration_minutes INTEGER NOT NULL,
                inactive_seconds INTEGER NOT NULL,
                PRIMARY KEY (id),
                FOREIGN KEY(resource_id) REFERENCES learning_resource (id) ON DELETE CASCADE
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO learning_session_downgrade
                (id, resource_id, started_at, ended_at, duration_minutes, inactive_seconds)
            SELECT id, resource_id, started_at, ended_at, duration_minutes, inactive_seconds
            FROM learning_session
            WHERE resource_id IS NOT NULL
        """))
        conn.execute(sa.text("DROP TABLE learning_session"))
        conn.execute(sa.text("ALTER TABLE learning_session_downgrade RENAME TO learning_session"))
        # Restaurar los índices que existían antes de esta revisión (a1b2c3d4e5f6).
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_started_at ON learning_session (started_at)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_ended_at ON learning_session (ended_at)"))
        return

    op.drop_constraint('ck_learning_session_scope', 'learning_session', type_='check')
    op.drop_index('ix_learning_session_lesson_id', table_name='learning_session')
    op.drop_index('ix_learning_session_resource_id', table_name='learning_session')
    op.drop_column('learning_session', 'lesson_id')
    op.drop_column('learning_session', 'mode')
    op.alter_column('learning_session', 'resource_id', existing_type=GUID(), nullable=False)
