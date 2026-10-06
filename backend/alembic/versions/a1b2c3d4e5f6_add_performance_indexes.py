"""add_performance_indexes

Revision ID: a1b2c3d4e5f6
Revises: 9bd4577cf6f2
Create Date: 2026-06-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '9bd4577cf6f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [
    ('ix_learning_resource_status', 'learning_resource', ['status']),
    ('ix_learning_resource_updated_at', 'learning_resource', ['updated_at']),
    ('ix_learning_resource_type', 'learning_resource', ['type']),
    ('ix_learning_session_ended_at', 'learning_session', ['ended_at']),
    ('ix_learning_session_started_at', 'learning_session', ['started_at']),
    ('ix_note_created_at', 'note', ['created_at']),
    ('ix_task_is_completed', 'task', ['is_completed']),
    ('ix_embedding_record_entity', 'embedding_record', ['entity_type', 'entity_id']),
]


def upgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name
    for index_name, table_name, columns in INDEXES:
        if dialect == 'sqlite':
            op.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({', '.join(columns)})")
        else:
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name
    for index_name, table_name, _ in INDEXES:
        if dialect == 'sqlite':
            op.execute(f"DROP INDEX IF EXISTS {index_name}")
        else:
            op.drop_index(index_name, table_name=table_name)
