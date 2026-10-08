"""note.resource_id becomes nullable (standalone notes are valid)

The audit found a domain contract mismatch on notes. The frontend SQLite
database has always allowed `note.resource_id IS NULL` — a standalone note is
a first-class CrossedArts concept (a thought the student has not filed under any
resource yet) and the browser schema uses `ON DELETE SET NULL` for both
`resource_id` and `lesson_id`. The backend declared `resource_id NOT NULL` with
`ON DELETE CASCADE`, which meant:

- a standalone note could not be created through the backend at all;
- deleting a resource DELETED the user's notes, whereas the browser only
  unlinks them and keeps the work.

This migration aligns the backend with the implemented product behavior:

- `resource_id` becomes nullable with `ON DELETE SET NULL`;
- `lesson_id` switches from `ON DELETE CASCADE` to `ON DELETE SET NULL`.

No note is deleted or rewritten by this migration: existing rows keep their
values and their content.

Revision ID: c58e1d7b3a22
Revises: b41c7a2e9d10
Create Date: 2026-10-07 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from backend.app.core.database import GUID


# revision identifiers, used by Alembic.
revision: str = 'c58e1d7b3a22'
down_revision: Union[str, Sequence[str], None] = 'b41c7a2e9d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Make note.resource_id nullable and stop deleting notes with their parent."""
    conn = op.get_bind()
    if conn.dialect.name == 'sqlite':
        # SQLite no puede alterar nulabilidad ni la acción referencial: la tabla
        # se reconstruye conservando todas las filas (técnica explícita, la
        # misma que usa la migración de ámbito de sesión).
        conn.execute(sa.text("""
            CREATE TABLE note_migrated (
                id GUID NOT NULL,
                resource_id GUID,
                lesson_id GUID,
                content VARCHAR(5000) NOT NULL,
                created_at DATETIME,
                updated_at DATETIME,
                PRIMARY KEY (id),
                FOREIGN KEY(resource_id) REFERENCES learning_resource (id) ON DELETE SET NULL,
                FOREIGN KEY(lesson_id) REFERENCES lesson (id) ON DELETE SET NULL
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO note_migrated (id, resource_id, lesson_id, content, created_at, updated_at)
            SELECT id, resource_id, lesson_id, content, created_at, updated_at
            FROM note
        """))
        conn.execute(sa.text("DROP TABLE note"))
        conn.execute(sa.text("ALTER TABLE note_migrated RENAME TO note"))
        # Reconstruir la tabla descarta sus índices en SQLite: se recrean para
        # que una base actualizada tenga exactamente los mismos índices que una
        # instalación nueva (sin duplicados y sin pérdidas).
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_note_created_at ON note (created_at)"))
        return

    op.drop_constraint('note_ibfk_1', 'note', type_='foreignkey')
    op.drop_constraint('note_ibfk_2', 'note', type_='foreignkey')
    op.alter_column('note', 'resource_id', existing_type=GUID(), nullable=True)
    op.alter_column('note', 'lesson_id', existing_type=GUID(), nullable=True)
    op.create_foreign_key(
        'fk_note_resource', 'note', 'learning_resource', ['resource_id'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        'fk_note_lesson', 'note', 'lesson', ['lesson_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    """Restaura `resource_id NOT NULL` con `ON DELETE CASCADE`.

    Downgrade DESTRUCTIVO por diseño: las notas autónomas (sin recurso) y las
    notas huérfanas no pueden representarse bajo el esquema anterior. Se
    eliminan de forma explícita y el resto conserva su contenido.
    """
    conn = op.get_bind()
    if conn.dialect.name == 'sqlite':
        conn.execute(sa.text("""
            CREATE TABLE note_downgrade (
                id GUID NOT NULL,
                resource_id GUID NOT NULL,
                lesson_id GUID,
                content VARCHAR(5000) NOT NULL,
                created_at DATETIME,
                updated_at DATETIME,
                PRIMARY KEY (id),
                FOREIGN KEY(resource_id) REFERENCES learning_resource (id) ON DELETE CASCADE,
                FOREIGN KEY(lesson_id) REFERENCES lesson (id) ON DELETE SET NULL
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO note_downgrade (id, resource_id, lesson_id, content, created_at, updated_at)
            SELECT id, resource_id, lesson_id, content, created_at, updated_at
            FROM note
            WHERE resource_id IS NOT NULL
        """))
        conn.execute(sa.text("DROP TABLE note"))
        conn.execute(sa.text("ALTER TABLE note_downgrade RENAME TO note"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_note_created_at ON note (created_at)"))
        return

    op.drop_constraint('fk_note_lesson', 'note', type_='foreignkey')
    op.drop_constraint('fk_note_resource', 'note', type_='foreignkey')
    op.create_foreign_key(
        'note_ibfk_1', 'note', 'learning_resource', ['resource_id'], ['id'], ondelete='CASCADE'
    )
    op.create_foreign_key(
        'note_ibfk_2', 'note', 'lesson', ['lesson_id'], ['id'], ondelete='CASCADE'
    )
    op.execute(sa.text("DELETE FROM note WHERE resource_id IS NULL"))
    op.alter_column('note', 'resource_id', existing_type=GUID(), nullable=False)