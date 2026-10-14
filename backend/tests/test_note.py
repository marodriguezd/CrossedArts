import uuid
from sqlalchemy.orm import Session

from backend.app.models.resource import Book
from backend.app.services.note import NoteService

def test_note_crud_lifecycle(db: Session):
    book = Book(
        id=uuid.uuid4(),
        title="Libro para Anotaciones"
    )
    db.add(book)
    db.commit()

    note = NoteService.create_note(db, book.id, "Esta es una nota inicial")
    assert note.content == "Esta es una nota inicial"
    assert note.resource_id == book.id

    notes_list = NoteService.list_notes_by_resource(db, book.id)
    assert len(notes_list) == 1
    assert notes_list[0].id == note.id

    updated_note = NoteService.update_note(db, note.id, "Contenido modificado")
    assert updated_note.content == "Contenido modificado"

    deleted = NoteService.delete_note(db, note.id)
    assert deleted is True

    # Comprobar que ya no existe
    notes_list = NoteService.list_notes_by_resource(db, book.id)
    assert len(notes_list) == 0
