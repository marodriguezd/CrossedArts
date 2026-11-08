"""note timestamps enforce the same rule as a fresh install

A fresh install and a migrated one disagreed about the same table:

    create_all() (the ORM contract)          migrated (older revision)
    created_at / updated_at NOT NULL         nullable

`TimestampMixin` declares both as `Mapped[datetime]` with a server default, so
SQLAlchemy makes them NOT NULL and every other table's migration does too. The
original `note` revision left them nullable, so a migrated install accepted a
row that a fresh one rejects — the same class of divergence this phase removed
for sessions and for `note.title`.

The upgrade fills any NULL first (the stricter column cannot hold one) and then
tightens the constraint; no note is dropped or rewritten. The downgrade relaxes
the columns again, which is permissive and loses nothing.

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-11-01 19:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TIMESTAMP_COLUMNS = ("created_at", "updated_at")


def _note_columns(conn) -> dict:
    """Live columns of `note`, keyed by name (source of the idempotency guards)."""
    return {column["name"]: column for column in sa.inspect(conn).get_columns("note")}


def upgrade() -> None:
    """Make the timestamps NOT NULL, repairing any legacy NULL first."""
    conn = op.get_bind()
    columns = _note_columns(conn)

    for name in TIMESTAMP_COLUMNS:
        conn.execute(
            sa.text(
                f"UPDATE note SET {name} = CURRENT_TIMESTAMP WHERE {name} IS NULL"
            )
        )

    with op.batch_alter_table("note") as batch_op:
        for name in TIMESTAMP_COLUMNS:
            if name in columns and columns[name]["nullable"]:
                batch_op.alter_column(
                    name, existing_type=sa.DateTime(), nullable=False
                )


def downgrade() -> None:
    """Relax the columns again. Permissive and non-destructive."""
    conn = op.get_bind()
    columns = _note_columns(conn)

    with op.batch_alter_table("note") as batch_op:
        for name in TIMESTAMP_COLUMNS:
            if name in columns and not columns[name]["nullable"]:
                batch_op.alter_column(
                    name, existing_type=sa.DateTime(), nullable=True
                )
