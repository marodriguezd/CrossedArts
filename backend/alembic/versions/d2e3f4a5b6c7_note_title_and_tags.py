"""note gains the title and tags the canonical schema requires

The audit found a data-contract gap: the browser SQLite schema (the canonical
source of truth) declares `note.title TEXT NOT NULL` and `note.tags`, and its
DAO creates and updates both. The backend only stored `content`, so a note
created or edited through the API silently lost two fields the product already
treats as part of the note.

This revision closes the gap without rewriting user work:

- `title` is added nullable, backfilled from the first non-empty line of the
  content (truncated to 255 characters) or `'Nota'` when the content has no
  usable text, and only then tightened to NOT NULL. It keeps NO SERVER default:
  the canonical browser schema declares none, and the ORM's `default="Nota"` is
  applied in Python, never rendered into the DDL. A migrated install must
  therefore reject `INSERT INTO note(content)` exactly like a fresh one, which
  the default would have silently turned into a titleless note. `content` is
  never modified.
- `tags` is added nullable, matching the frontend.
- Every step checks the live columns first, so a revision that was applied
  halfway (column added, `alembic_version` not bumped) converges instead of
  failing with "duplicate column name".

The downgrade is DESTRUCTIVE by design and declared as such: it drops both
columns, so titles and tags are lost, but every note and its content survive.

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-11-01 17:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_NOTE_TITLE = "Nota"


def _derive_title(content: str) -> str:
    """First non-empty line of the content, or the neutral default.

    Migrations cannot import application services (they must keep working after
    the service layer evolves), so the rule lives here too. Characters are
    truncated to the column width.
    """
    for line in (content or "").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped[:255]
    return DEFAULT_NOTE_TITLE


def _note_columns(conn) -> dict:
    """Live columns of `note`, keyed by name (source of the idempotency guards)."""
    return {column["name"]: column for column in sa.inspect(conn).get_columns("note")}


def upgrade() -> None:
    """Add `title` (backfilled) and `tags` to every note."""
    conn = op.get_bind()
    columns = _note_columns(conn)

    if "title" not in columns:
        op.add_column('note', sa.Column('title', sa.String(length=255), nullable=True))
    if "tags" not in columns:
        op.add_column('note', sa.Column('tags', sa.Text(), nullable=True))

    # Only rows this revision left without a title are backfilled: NULL is the
    # only state it creates, so a title written by the user (or by a previous
    # run) is never rewritten.
    rows = conn.execute(
        sa.text("SELECT id, content FROM note WHERE title IS NULL")
    ).fetchall()
    for note_id, content in rows:
        conn.execute(
            sa.text("UPDATE note SET title = :title WHERE id = :note_id"),
            {"title": _derive_title(content), "note_id": note_id},
        )

    if _note_columns(conn)["title"]["nullable"]:
        with op.batch_alter_table("note") as batch_op:
            batch_op.alter_column(
                "title", existing_type=sa.String(length=255), nullable=False
            )


def downgrade() -> None:
    """Drop `title` and `tags`. DESTRUCTIVE by design: content is preserved."""
    columns = _note_columns(op.get_bind())
    # Batch mode, like the upgrade's NOT NULL tightening: SQLite can only drop a
    # column natively from 3.35 on, so both directions go through the same
    # table-rebuild path instead of requiring that version. The guard stays per
    # column, so a half-applied downgrade is a no-op rather than an error.
    with op.batch_alter_table("note") as batch_op:
        if "tags" in columns:
            batch_op.drop_column('tags')
        if "title" in columns:
            batch_op.drop_column('title')
