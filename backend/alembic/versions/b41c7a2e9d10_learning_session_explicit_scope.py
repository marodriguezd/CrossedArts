"""learning_session gains an explicit `scope` and a `finalized` mark

The audit found a domain inconsistency that survived the previous pass: the
frontend SQLite database treats a session with neither `resource_id` nor
`lesson_id` as a legitimate session (the cross-library review started from
`ReviewCenter` when no resource is selected), while the backend rejected
"scope-less" sessions outright. Both halves disagreed about which sessions
exist at all.

This migration aligns the backend with the ONE canonical rule, shared with the
frontend (`frontend/src/services/sessionScope.ts` and
`backend/app/models/activity.resolve_session_scope`):

- a session is scoped to a LESSON (`lesson_id` present), to a RESOURCE
  (`resource_id` present and no lesson) or is GLOBAL (no anchor at all);
- the scope is persisted explicitly in the new `scope` column, never inferred
  from missing data;
- the DB guarantees the value domain and that a `global` session never carries
  an anchor. It deliberately does NOT require `lesson_id` for the `lesson`
  scope: `ON DELETE SET NULL` (ON DELETE CASCADE in the legacy schema) can
  unlink a lesson from an already finished lesson-scoped session, and study
  history is never destroyed. The effective scope is re-derived from the
  surviving anchors on read.

Existing rows are backfilled deterministically: lesson -> lesson, resource only
-> resource, no anchors -> global. No existing row changes meaning.

The same migration adds `finalized`, the explicit "session was formally closed"
mark. `ended_at` is also written by the heartbeat (as a last-activity stamp), so
it cannot express finalization on its own; without a dedicated mark,
`SessionService.end_session` could not be idempotent: repeating it would move the
end timestamp and re-apply the goal updates. Existing rows are treated as
unfinalized so their first explicit `end` behaves exactly as before.

Revision ID: b41c7a2e9d10
Revises: f3a9c2d41b57
Create Date: 2026-10-07 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from backend.app.core.database import GUID


# revision identifiers, used by Alembic.
revision: str = 'b41c7a2e9d10'
down_revision: Union[str, Sequence[str], None] = 'f3a9c2d41b57'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_SCOPE_BACKFILL = """
    CASE
        WHEN lesson_id IS NOT NULL THEN 'lesson'
        WHEN resource_id IS NOT NULL THEN 'resource'
        ELSE 'global'
    END
"""


def upgrade() -> None:
    """Add the explicit `scope` column and align the scope CHECK constraints."""
    conn = op.get_bind()
    dialect = conn.dialect.name
    inspector = sa.inspect(conn)
    existing_columns = {c['name'] for c in inspector.get_columns('learning_session')}

    if dialect != 'sqlite' and 'finalized' not in existing_columns:
        op.add_column(
            'learning_session',
            sa.Column('finalized', sa.Boolean(), nullable=False, server_default=sa.text('0'))
        )

    if 'scope' in existing_columns:
        return

    if dialect == 'sqlite':
        # SQLite cannot add a CHECK constraint with ALTER TABLE, so the table is
        # rebuilt preserving every existing row (same explicit technique used by
        # the previous session migrations).
        conn.execute(sa.text("""
            CREATE TABLE learning_session_scoped (
                id GUID NOT NULL,
                resource_id GUID,
                lesson_id GUID,
                scope VARCHAR(10) NOT NULL DEFAULT 'global',
                mode VARCHAR(20) NOT NULL,
                started_at DATETIME NOT NULL,
                ended_at DATETIME,
                finalized BOOLEAN NOT NULL DEFAULT 0,
                duration_minutes INTEGER NOT NULL,
                inactive_seconds INTEGER NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT ck_learning_session_scope_values CHECK (scope IN ('global', 'resource', 'lesson')),
                CONSTRAINT ck_learning_session_scope CHECK (scope <> 'global' OR (resource_id IS NULL AND lesson_id IS NULL)),
                CONSTRAINT ck_learning_session_resource_scope CHECK (scope <> 'resource' OR resource_id IS NOT NULL),
                FOREIGN KEY(resource_id) REFERENCES learning_resource (id) ON DELETE CASCADE,
                FOREIGN KEY(lesson_id) REFERENCES lesson (id) ON DELETE CASCADE
            )
        """))
        conn.execute(sa.text(f"""
            INSERT INTO learning_session_scoped
                (id, resource_id, lesson_id, scope, mode, started_at, ended_at, finalized, duration_minutes, inactive_seconds)
            SELECT id, resource_id, lesson_id, {_SCOPE_BACKFILL}, mode, started_at, ended_at,
                   0, duration_minutes, inactive_seconds
            FROM learning_session
        """))
        conn.execute(sa.text("DROP TABLE learning_session"))
        conn.execute(sa.text("ALTER TABLE learning_session_scoped RENAME TO learning_session"))
        # Rebuilding the table drops every index in SQLite: they are recreated
        # exactly once here so upgraded installs match fresh installs.
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_started_at ON learning_session (started_at)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_ended_at ON learning_session (ended_at)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_resource_id ON learning_session (resource_id)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_lesson_id ON learning_session (lesson_id)"))
        return

    # Otros dialectos: se sueltan las restricciones antiguas y se añaden las nuevas.
    op.drop_constraint('ck_learning_session_scope', 'learning_session', type_='check')
    op.add_column(
        'learning_session',
        sa.Column('scope', sa.String(length=10), nullable=False, server_default='global')
    )
    op.execute(sa.text(f"UPDATE learning_session SET scope = {_SCOPE_BACKFILL}"))
    op.create_check_constraint(
        'ck_learning_session_scope_values',
        'learning_session',
        "scope IN ('global', 'resource', 'lesson')"
    )
    op.create_check_constraint(
        'ck_learning_session_scope',
        'learning_session',
        "scope <> 'global' OR (resource_id IS NULL AND lesson_id IS NULL)"
    )
    op.create_check_constraint(
        'ck_learning_session_resource_scope',
        'learning_session',
        "scope <> 'resource' OR resource_id IS NOT NULL"
    )


def downgrade() -> None:
    """Restore the previous contract: a session must keep a scope anchor.

    Downgrade DESTRUCTIVO por diseño: las sesiones globales (repaso transversal)
    no pueden representarse bajo el esquema anterior, así que se eliminan de
    forma explícita antes de reactivar la restricción. Nunca en silencio.
    """
    conn = op.get_bind()
    dialect = conn.dialect.name

    if dialect == 'sqlite':
        conn.execute(sa.text("""
            CREATE TABLE learning_session_downgrade (
                id GUID NOT NULL,
                resource_id GUID,
                lesson_id GUID,
                mode VARCHAR(20) NOT NULL,
                started_at DATETIME NOT NULL,
                ended_at DATETIME,
                finalized BOOLEAN NOT NULL DEFAULT 0,
                duration_minutes INTEGER NOT NULL,
                inactive_seconds INTEGER NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT ck_learning_session_scope CHECK (resource_id IS NOT NULL OR lesson_id IS NOT NULL),
                FOREIGN KEY(resource_id) REFERENCES learning_resource (id) ON DELETE CASCADE,
                FOREIGN KEY(lesson_id) REFERENCES lesson (id) ON DELETE CASCADE
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO learning_session_downgrade
                (id, resource_id, lesson_id, mode, started_at, ended_at, duration_minutes, inactive_seconds)
            SELECT id, resource_id, lesson_id, mode, started_at, ended_at, duration_minutes, inactive_seconds
            FROM learning_session
            WHERE resource_id IS NOT NULL OR lesson_id IS NOT NULL
        """))
        conn.execute(sa.text("DROP TABLE learning_session"))
        conn.execute(sa.text("ALTER TABLE learning_session_downgrade RENAME TO learning_session"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_started_at ON learning_session (started_at)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_ended_at ON learning_session (ended_at)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_resource_id ON learning_session (resource_id)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_learning_session_lesson_id ON learning_session (lesson_id)"))
        return

    op.drop_constraint('ck_learning_session_resource_scope', 'learning_session', type_='check')
    op.drop_constraint('ck_learning_session_scope_values', 'learning_session', type_='check')
    op.drop_constraint('ck_learning_session_scope', 'learning_session', type_='check')
    op.drop_column('learning_session', 'scope')
    op.drop_column('learning_session', 'finalized')
    op.create_check_constraint(
        'ck_learning_session_scope',
        'learning_session',
        'resource_id IS NOT NULL OR lesson_id IS NOT NULL'
    )