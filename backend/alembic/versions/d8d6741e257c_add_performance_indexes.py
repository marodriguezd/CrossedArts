"""add_performance_indexes

Revision ID: d8d6741e257c
Revises: a1b2c3d4e5f6
Create Date: 2026-07-02 18:19:45.948727

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8d6741e257c'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEXES = [
    ('ix_learning_resource_created_at', 'learning_resource', ['created_at']),
    ('ix_learning_resource_status', 'learning_resource', ['status']),
    ('ix_learning_session_ended_at', 'learning_session', ['ended_at']),
    ('ix_task_is_completed', 'task', ['is_completed']),
    ('ix_note_created_at', 'note', ['created_at']),
]


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    dialect = conn.dialect.name
    for index_name, table_name, columns in INDEXES:
        if dialect == 'sqlite':
            op.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({', '.join(columns)})")
        else:
            try:
                op.create_index(index_name, table_name, columns, unique=False)
            except Exception:
                pass


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    dialect = conn.dialect.name
    for index_name, table_name, _ in INDEXES:
        if dialect == 'sqlite':
            op.execute(f"DROP INDEX IF EXISTS {index_name}")
        else:
            try:
                op.drop_index(index_name, table_name=table_name)
            except Exception:
                pass

