"""add_performance_indexes

Revision ID: d8d6741e257c
Revises: a1b2c3d4e5f6
Create Date: 2026-07-02 18:19:45.948727

Este intento repetía índices ya creados por a1b2c3d4e5f6
(ix_learning_resource_status, ix_learning_session_ended_at, ix_task_is_completed,
ix_note_created_at) y su downgrade podía borrar índices que conceptualmente
pertenecían a la migración anterior. La historia se corrige en sitio: esta
revisión solo es propietaria de `ix_learning_resource_created_at`, de modo que
cada índice tiene exactamente una migración propietaria y los subidas/bajadas
son deterministas (sin duplicados, sin borrados ajenos).
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd8d6741e257c'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Solo los índices de los que esta revisión es propietaria: los repetidos
# (status, ended_at, is_completed, note.created_at) pertenecen a a1b2c3d4e5f6.
INDEXES = [
    ('ix_learning_resource_created_at', 'learning_resource', ['created_at']),
]


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    dialect = conn.dialect.name
    for index_name, table_name, columns in INDEXES:
        if dialect == 'sqlite':
            op.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({', '.join(columns)})")
        else:
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    dialect = conn.dialect.name
    for index_name, table_name, _ in INDEXES:
        if dialect == 'sqlite':
            op.execute(f"DROP INDEX IF EXISTS {index_name}")
        else:
            op.drop_index(index_name, table_name=table_name)
