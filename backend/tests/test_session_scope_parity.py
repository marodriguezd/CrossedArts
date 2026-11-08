"""The session-scope contract is ONE table read by both layers.

`resolve_session_scope` / `resolve_effective_session_scope` (backend) and
`resolveStudySessionScope` / `resolveEffectiveStudySessionScope` (frontend) are
mirrors of the same domain rule. Until now nothing tied them together: one side
could change a single branch and every test on both sides kept passing while the
two layers disagreed about what a session is.

`shared/session-scope-cases.json` is that tie. Each implementation is checked
against the same rows, so a divergence fails the test on the side that moved.
A new case belongs in the fixture, never in one test only.
"""
import json
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.models.activity import (
    resolve_effective_session_scope,
    resolve_session_scope,
)
from backend.app.schemas.session import StartSessionRequest

CASES_PATH = Path(__file__).resolve().parents[2] / "shared" / "session-scope-cases.json"
CASES = json.loads(CASES_PATH.read_text(encoding="utf-8"))


def _anchors(case: dict) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """Real anchors: the fixture says which ones exist, never their value."""
    resource_id = uuid.uuid4() if case["resource"] else None
    lesson_id = uuid.uuid4() if case["lesson"] else None
    return resource_id, lesson_id


@pytest.mark.parametrize("case", CASES["derivation"], ids=lambda case: case["name"])
def test_derivation_matches_the_shared_table(case: dict) -> None:
    resource_id, lesson_id = _anchors(case)
    assert resolve_session_scope(resource_id, lesson_id) == case["expected"]


@pytest.mark.parametrize("case", CASES["effective"], ids=lambda case: case["name"])
def test_effective_scope_matches_the_shared_table(case: dict) -> None:
    resource_id, lesson_id = _anchors(case)
    assert (
        resolve_effective_session_scope(case["declared"], resource_id, lesson_id)
        == case["expected"]
    )


@pytest.mark.parametrize("case", CASES["validation"], ids=lambda case: case["name"])
def test_declared_scope_validation_matches_the_shared_table(case: dict) -> None:
    resource_id, lesson_id = _anchors(case)
    payload = {
        "scope": case["declared"],
        "resource_id": resource_id,
        "lesson_id": lesson_id,
    }

    if case["valid"]:
        request = StartSessionRequest(**payload)
        # A coherent declared scope is never reinterpreted.
        assert request.scope == case["declared"]
        return

    with pytest.raises(ValidationError):
        StartSessionRequest(**payload)


def test_an_undeclared_scope_is_derived_not_rejected() -> None:
    """Omitting `scope` is legal: the anchors decide, and global review has none."""
    request = StartSessionRequest()
    assert request.scope == "global"
