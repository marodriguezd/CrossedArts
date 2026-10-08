import uuid
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.models.resource import Book
from backend.app.models.activity import Note


def test_api_learning_paths(client: TestClient, db: Session):
    # Crear Path
    response = client.post("/api/v1/workflow/paths", json={"title": "FastAPI Path", "description": "Ruta rápida"})
    assert response.status_code == 201
    data = response.json()
    path_id = data["id"]
    assert data["title"] == "FastAPI Path"

    # Obtener Paths
    response = client.get("/api/v1/workflow/paths")
    assert response.status_code == 200
    assert len(response.json()) >= 1

    # Agregar Item
    book = Book(id=uuid.uuid4(), title="FastAPI Avanzado")
    db.add(book)
    db.commit()

    response = client.post(
        f"/api/v1/workflow/paths/{path_id}/items",
        json={"resource_id": str(book.id), "sequence_order": 1}
    )
    assert response.status_code == 201
    item_id = response.json()["id"]

    # Toggle item
    response = client.post(f"/api/v1/workflow/items/{item_id}/toggle")
    assert response.status_code == 200
    assert response.json()["is_completed"]

    # Borrar item y path
    response = client.delete(f"/api/v1/workflow/items/{item_id}")
    assert response.status_code == 200
    response = client.delete(f"/api/v1/workflow/paths/{path_id}")
    assert response.status_code == 200


def test_api_study_plans(client: TestClient):
    response = client.post(
        "/api/v1/workflow/plans",
        json={"title": "Ruta Diaria", "daily_goal_minutes": 25, "weekly_goal_minutes": 150}
    )
    assert response.status_code == 201
    plan_id = response.json()["id"]

    response = client.get("/api/v1/workflow/plans")
    assert response.status_code == 200
    assert len(response.json()) >= 1

    response = client.delete(f"/api/v1/workflow/plans/{plan_id}")
    assert response.status_code == 200


def test_api_goals_and_progress(client: TestClient, db: Session):
    response = client.post(
        "/api/v1/workflow/goals",
        json={"title": "Meta de Horas", "target_type": "study_time", "target_value": 300.0}
    )
    assert response.status_code == 201
    goal_id = response.json()["id"]

    response = client.post(f"/api/v1/workflow/goals/{goal_id}/progress", json={"value_change": 120.0, "notes": "Buen día"})
    assert response.status_code == 200
    assert response.json()["current_value"] == 120.0


def test_api_habits(client: TestClient):
    response = client.post("/api/v1/workflow/habits", json={"name": "Escribir Notas", "frequency": "daily", "target_days_per_week": 5})
    assert response.status_code == 201
    habit_id = response.json()["id"]

    response = client.post(f"/api/v1/workflow/habits/{habit_id}/record")
    assert response.status_code == 200

    response = client.get(f"/api/v1/workflow/habits/{habit_id}/stats")
    assert response.status_code == 200
    assert response.json()["streak_days"] == 1


def test_api_spaced_repetition(client: TestClient, db: Session):
    # Sembrar recurso y nota
    book = Book(id=uuid.uuid4(), title="Clean Architecture")
    db.add(book)
    db.commit()
    note = Note(id=uuid.uuid4(), resource_id=book.id, content="El acoplamiento estable dice...")
    db.add(note)
    db.commit()

    response = client.post("/api/v1/workflow/reviews", json={"note_id": str(note.id)})
    assert response.status_code == 201
    item_id = response.json()["id"]

    # Probar la evaluación
    response = client.post(f"/api/v1/workflow/reviews/{item_id}/submit", json={"quality": 4})
    assert response.status_code == 200
    assert response.json()["repetitions"] == 1

    # AI Concept Check
    response = client.post(f"/api/v1/workflow/reviews/{item_id}/ai-concept-check")
    assert response.status_code == 200
    assert "concept_check_question" in response.json()
