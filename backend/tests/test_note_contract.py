"""The backend note contract matches the canonical (browser) one.

The SQLite frontend declares `note.title NOT NULL` and `note.tags`, and its DAO
creates and updates both. The backend used to store only `content`, so an API
note silently lost the title and the tags. These tests pin the repaired contract:
a note always has a real title, tags are optional, and a partial update never
overwrites a field that was not sent.
"""
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.services.note import NoteService, derive_note_title


def _create_note(client: TestClient, **payload):
    return client.post("/api/v1/notes", json=payload)


def test_create_note_keeps_title_and_tags(client: TestClient):
    response = _create_note(
        client,
        title="Mi idea principal",
        content="El cuerpo de la nota.",
        tags="física, repaso",
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == "Mi idea principal"
    assert body["tags"] == "física, repaso"
    assert body["content"] == "El cuerpo de la nota."


def test_create_note_without_title_derives_it_from_the_content(client: TestClient):
    response = _create_note(client, content="Primera línea\n\nSegunda línea")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == "Primera línea", "el título nunca queda vacío"
    assert body["tags"] is None, "las etiquetas son opcionales"


def test_standalone_note_remains_valid_with_the_full_contract(client: TestClient):
    response = _create_note(client, content="Idea suelta", title="Idea suelta")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["resource_id"] is None
    assert body["lesson_id"] is None
    assert body["title"] == "Idea suelta"


def test_patch_title_preserves_content_and_tags(client: TestClient):
    created = _create_note(
        client, title="Título viejo", content="Contenido intacto", tags="a,b"
    ).json()

    response = client.patch(
        f"/api/v1/notes/{created['id']}", json={"title": "Título nuevo"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Título nuevo"
    assert body["content"] == "Contenido intacto"
    assert body["tags"] == "a,b"


def test_patch_with_empty_tags_clears_them_without_touching_the_rest(client: TestClient):
    created = _create_note(
        client, title="Título", content="Contenido", tags="a,b"
    ).json()

    response = client.patch(f"/api/v1/notes/{created['id']}", json={"tags": ""})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tags"] == "", "una cadena vacía es un valor real: vacía etiquetas"
    assert body["title"] == "Título"
    assert body["content"] == "Contenido"


def test_patch_without_any_field_is_rejected(client: TestClient):
    created = _create_note(client, content="Contenido").json()

    response = client.patch(f"/api/v1/notes/{created['id']}", json={})

    assert response.status_code == 422, response.text


def test_service_content_update_does_not_overwrite_title_or_tags(db: Session):
    note = NoteService.create_note(
        db, None, "Contenido original", title="Título original", tags="a,b"
    )

    updated = NoteService.update_note(db, note.id, "Contenido nuevo")

    assert updated.content == "Contenido nuevo"
    assert updated.title == "Título original"
    assert updated.tags == "a,b"


def test_create_note_with_blank_title_derives_instead_of_storing_whitespace(
    client: TestClient,
):
    """A blank title is "no title": the content provides a real headline."""
    response = _create_note(client, title="   ", content="Titular del cuerpo")

    assert response.status_code == 201, response.text
    assert response.json()["title"] == "Titular del cuerpo"


def test_patch_with_blank_title_is_rejected(client: TestClient):
    """`title` can never become empty, not even with whitespace."""
    created = _create_note(client, content="Contenido intacto").json()

    response = client.patch(
        f"/api/v1/notes/{created['id']}", json={"title": "   "}
    )

    assert response.status_code == 422, response.text


def test_derive_note_title_skips_blank_lines_and_never_returns_empty():
    assert derive_note_title("\n\n  Primera real  \nresto") == "Primera real"
    assert derive_note_title("   ") == "Nota"
    assert derive_note_title("x" * 300) == "x" * 255


def test_the_model_itself_derives_the_title_on_write(db: Session):
    """The rule holds for every construction path, not only `NoteService`.

    `Note` carries `default="Nota"`, so a caller building the row directly used
    to persist the placeholder while the same note through the service got its
    first line. The model now derives it on insert/update, the way the session
    model already derives its scope.
    """
    import uuid

    from backend.app.models.activity import Note

    direct = Note(id=uuid.uuid4(), content="Titular directo\n\ncuerpo")
    db.add(direct)
    db.commit()
    db.refresh(direct)
    assert direct.title == "Titular directo"

    direct.content = "Titular reescrito\nresto"
    direct.title = "   "
    db.commit()
    db.refresh(direct)
    assert direct.title == "Titular reescrito", (
        "un título en blanco se deriva del contenido, nunca se guarda vacío"
    )

    verbatim = Note(id=uuid.uuid4(), title="Título del autor", content="Otra cosa")
    db.add(verbatim)
    db.commit()
    db.refresh(verbatim)
    assert verbatim.title == "Título del autor", (
        "un título real nunca se sobrescribe con el contenido"
    )

    empty = Note(id=uuid.uuid4(), content="   ")
    db.add(empty)
    db.commit()
    db.refresh(empty)
    assert empty.title == "Nota", "sin texto utilizable queda el fallback neutro"
