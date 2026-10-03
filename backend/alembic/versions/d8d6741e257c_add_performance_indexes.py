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


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index('ix_learning_resource_status', 'learning_resource', ['status'])
    op.create_index('ix_learning_resource_created_at', 'learning_resource', ['created_at'])
    op.create_index('ix_learning_session_ended_at', 'learning_session', ['ended_at'])
    op.create_index('ix_task_is_completed', 'task', ['is_completed'])
    op.create_index('ix_note_created_at', 'note', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_note_created_at', table_name='note')
    op.drop_index('ix_task_is_completed', table_name='task')
    op.drop_index('ix_learning_session_ended_at', table_name='learning_session')
    op.drop_index('ix_learning_resource_created_at', table_name='learning_resource')
    op.drop_index('ix_learning_resource_status', table_name='learning_resource')

