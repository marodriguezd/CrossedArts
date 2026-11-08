"""study sessions survive the deletion of their resource or lesson

The previous contract contradicted itself. Both this backend and the browser
(SQLite WASM) declare `learning_session.resource_id`/`lesson_id` as history
anchors, and both docblocks promise `ON DELETE SET NULL` preserves an already
finished session when its material disappears. The backend, however, created
both foreign keys with `ON DELETE CASCADE` and the ORM relationship with
`delete-orphan`, so deleting a resource destroyed the study history.

The browser could not honour `SET NULL` either: its `learning_session` carried
`CHECK (scope <> 'resource' OR resource_id IS NOT NULL)`. SQLite evaluates
CHECK constraints on the internal UPDATE performed by a foreign-key action, so
deleting a resource with a resource-scoped session failed with
`CHECK constraint failed` instead of unlinking it.

This revision aligns the backend with the single shared rule:

- both anchors are nullable and unlink with `ON DELETE SET NULL`;
- the DB keeps only the value domain (`global`/`resource`/`lesson`) and the
  rule that a `global` session never carries an anchor;
- the anchor-requiring CHECK is dropped, because the unlinked state is a
  legitimate consequence of deletion, not invalid data. Write paths
  (`StartSessionRequest`, `SessionService.start_session` and the model event)
  still reject declared scopes that are incoherent with their anchors, and
  `resolve_effective_session_scope` reclassifies a session on read.

Existing rows are preserved verbatim: a declared scope that is still within
the domain and is not an anchored `global` keeps its value, including a
`resource` session whose resource was already unlinked. ONLY the rows whose
stored scope is impossible under the surviving rules are re-derived from their
anchors. No session changes meaning and none is deleted.

Rows whose NOT NULL columns hold NULL are repaired from the same defaults a
fresh install uses (`mode='flashcards'`, `started_at=CURRENT_TIMESTAMP`,
`finalized=0`, `duration_minutes=0`, `inactive_seconds=0`) instead of aborting
the whole upgrade with `NOT NULL constraint failed`. Those values are the ones
the column declarations already promise, so no row is dropped and none is
given a different meaning.

Revision ID: c1d2e3f4a5b6
Revises: c58e1d7b3a22
Create Date: 2026-11-01 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'c58e1d7b3a22'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DERIVED_SCOPE = """
    CASE
        WHEN lesson_id IS NOT NULL THEN 'lesson'
        WHEN resource_id IS NOT NULL THEN 'resource'
        ELSE 'global'
    END
"""

#: Keep the declared scope when the surviving CHECKs allow it. An unlinked
#: `resource` (resource_id NULL) is kept on purpose: it is the state the
#: deletion leaves behind and its effective scope is derived on read.
_PRESERVED_SCOPE = f"""
    CASE
        WHEN scope IN ('lesson', 'resource', 'global')
         AND NOT (scope = 'global' AND (lesson_id IS NOT NULL OR resource_id IS NOT NULL))
        THEN scope
        ELSE {_DERIVED_SCOPE}
    END
"""

#: Downgrade restores the anchor-requiring CHECK, which cannot represent an
#: unlinked resource session. Re-derive it (never delete the row): the history
#: is preserved and only its declared scope becomes the global review it now is.
_DOWNGRADE_SCOPE = f"""
    CASE
        WHEN scope IN ('lesson', 'resource', 'global')
         AND NOT (scope = 'global' AND (lesson_id IS NOT NULL OR resource_id IS NOT NULL))
         AND NOT (scope = 'resource' AND resource_id IS NULL)
        THEN scope
        ELSE {_DERIVED_SCOPE}
    END
"""


def _create_session_table(
    conn,
    table_name: str,
    *,
    resource_ondelete: str,
    lesson_ondelete: str,
    anchor_check: bool,
    finalized_expr: str,
    scope_expr: str,
) -> None:
    """Create `table_name` with the current column set and the given rules."""
    extra_check = (
        ",\n                CONSTRAINT ck_learning_session_resource_scope "
        "CHECK (scope <> 'resource' OR resource_id IS NOT NULL)"
        if anchor_check
        else ""
    )
    conn.execute(sa.text(f"""
        CREATE TABLE {table_name} (
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
            CONSTRAINT ck_learning_session_scope_values
                CHECK (scope IN ('global', 'resource', 'lesson')),
            CONSTRAINT ck_learning_session_scope
                CHECK (scope <> 'global' OR (resource_id IS NULL AND lesson_id IS NULL)){extra_check},
            FOREIGN KEY(resource_id) REFERENCES learning_resource (id)
                ON DELETE {resource_ondelete},
            FOREIGN KEY(lesson_id) REFERENCES lesson (id)
                ON DELETE {lesson_ondelete}
        )
    """))
    # NOT NULL columns are copied through COALESCE: a legacy row may hold NULL
    # where the new table forbids it, and the repair value is exactly the
    # default the CREATE above declares. Copying the NULL straight through would
    # abort the upgrade and leave the migration half applied.
    conn.execute(sa.text(f"""
        INSERT INTO {table_name}
            (id, resource_id, lesson_id, scope, mode, started_at, ended_at,
             finalized, duration_minutes, inactive_seconds)
        SELECT id, resource_id, lesson_id, {scope_expr},
               COALESCE(mode, 'flashcards'),
               COALESCE(started_at, CURRENT_TIMESTAMP),
               ended_at,
               COALESCE({finalized_expr}, 0),
               COALESCE(duration_minutes, 0),
               COALESCE(inactive_seconds, 0)
        FROM learning_session
    """))


def _recreate_session_indexes(conn) -> None:
    for index_name, column in (
        ("ix_learning_session_started_at", "started_at"),
        ("ix_learning_session_ended_at", "ended_at"),
        ("ix_learning_session_resource_id", "resource_id"),
        ("ix_learning_session_lesson_id", "lesson_id"),
    ):
        conn.execute(
            sa.text(
                f"CREATE INDEX IF NOT EXISTS {index_name} "
                f"ON learning_session ({column})"
            )
        )


def upgrade() -> None:
    """Unlink sessions instead of destroying them when their anchor disappears."""
    conn = op.get_bind()
    dialect = conn.dialect.name
    inspector = sa.inspect(conn)
    columns = {column["name"] for column in inspector.get_columns("learning_session")}

    if dialect == "sqlite":
        finalized_expr = "finalized" if "finalized" in columns else "0"
        scope_expr = _PRESERVED_SCOPE if "scope" in columns else _DERIVED_SCOPE

        # Alembic already runs the revision inside a transaction; an explicit
        # BEGIN here would fail. The pragma goes before the rebuild, exactly as
        # in `b41c7a2e9d10`.
        conn.execute(sa.text("PRAGMA foreign_keys = OFF;"))
        try:
            _create_session_table(
                conn,
                "learning_session_history_preserving",
                resource_ondelete="SET NULL",
                lesson_ondelete="SET NULL",
                anchor_check=False,
                finalized_expr=finalized_expr,
                scope_expr=scope_expr,
            )
            conn.execute(sa.text("DROP TABLE learning_session;"))
            conn.execute(
                sa.text(
                    "ALTER TABLE learning_session_history_preserving "
                    "RENAME TO learning_session;"
                )
            )
            _recreate_session_indexes(conn)
        finally:
            conn.execute(sa.text("PRAGMA foreign_keys = ON;"))
        return

    checks = {
        check.get("name") for check in inspector.get_check_constraints("learning_session")
    }
    if "ck_learning_session_resource_scope" in checks:
        op.drop_constraint(
            "ck_learning_session_resource_scope",
            "learning_session",
            type_="check",
        )

    foreign_keys = inspector.get_foreign_keys("learning_session")
    with op.batch_alter_table("learning_session") as batch_op:
        for foreign_key in foreign_keys:
            name = foreign_key.get("name")
            if name:
                batch_op.drop_constraint(name, type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_learning_session_resource",
            "learning_resource",
            ["resource_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_learning_session_lesson",
            "lesson",
            ["lesson_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    """Restore the previous contract: anchors CASCADE and `resource` needs one.

    Non-destructive where the old rules allow it: a row whose declared scope
    cannot be represented (an unlinked resource session) is re-derived to the
    global review it effectively is, never deleted.
    """
    conn = op.get_bind()
    dialect = conn.dialect.name
    inspector = sa.inspect(conn)
    columns = {column["name"] for column in inspector.get_columns("learning_session")}

    if dialect == "sqlite":
        finalized_expr = "finalized" if "finalized" in columns else "0"
        scope_expr = _DOWNGRADE_SCOPE if "scope" in columns else _DERIVED_SCOPE

        conn.execute(sa.text("PRAGMA foreign_keys = OFF;"))
        try:
            _create_session_table(
                conn,
                "learning_session_downgraded",
                resource_ondelete="CASCADE",
                lesson_ondelete="CASCADE",
                anchor_check=True,
                finalized_expr=finalized_expr,
                scope_expr=scope_expr,
            )
            conn.execute(sa.text("DROP TABLE learning_session;"))
            conn.execute(
                sa.text(
                    "ALTER TABLE learning_session_downgraded RENAME TO learning_session;"
                )
            )
            _recreate_session_indexes(conn)
        finally:
            conn.execute(sa.text("PRAGMA foreign_keys = ON;"))
        return

    foreign_keys = inspector.get_foreign_keys("learning_session")
    with op.batch_alter_table("learning_session") as batch_op:
        for foreign_key in foreign_keys:
            name = foreign_key.get("name")
            if name:
                batch_op.drop_constraint(name, type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_learning_session_resource",
            "learning_resource",
            ["resource_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_learning_session_lesson",
            "lesson",
            ["lesson_id"],
            ["id"],
            ondelete="CASCADE",
        )
    # The restored CHECK cannot represent a session whose resource was unlinked
    # (`ON DELETE SET NULL` leaves exactly that state). Re-derive those rows
    # BEFORE adding the constraint: adding it first would abort with "check
    # constraint is violated by some row" after the foreign keys were already
    # switched back to CASCADE, leaving the downgrade half applied. No row is
    # deleted; only its declared scope becomes the global review it effectively
    # is, same rule as the SQLite branch above.
    conn.execute(sa.text(f"UPDATE learning_session SET scope = {_DOWNGRADE_SCOPE}"))
    op.create_check_constraint(
        "ck_learning_session_resource_scope",
        "learning_session",
        "scope <> 'resource' OR resource_id IS NOT NULL",
    )
