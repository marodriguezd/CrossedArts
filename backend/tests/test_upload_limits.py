import io
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.core.settings import settings
import backend.app.api.ingestion as ingestion_module


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path: Path, monkeypatch):
    test_home = tmp_path / "test_home"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: test_home)
    settings.ensure_dirs()


def test_upload_cover_oversized(client: TestClient, monkeypatch):
    """Prueba que portadas mayores a MAX_COVER_FILE_SIZE se rechacen con HTTP 413."""
    monkeypatch.setattr(ingestion_module, "MAX_COVER_FILE_SIZE", 1024)  # 1 KB para test rápido

    oversized_data = b"A" * 2048
    response = client.post(
        "/api/v1/content/upload-cover",
        files={"file": ("large_cover.png", io.BytesIO(oversized_data), "image/png")}
    )
    assert response.status_code == 413
    assert "supera el límite" in response.json()["detail"]


def test_upload_cover_cleanup_on_failure(client: TestClient, monkeypatch):
    """Prueba que si falla la subida de portada, no queden archivos huérfanos."""
    monkeypatch.setattr(ingestion_module, "MAX_COVER_FILE_SIZE", 512)

    initial_files = set(settings.covers_dir.glob("*"))
    response = client.post(
        "/api/v1/content/upload-cover",
        files={"file": ("failing_cover.png", io.BytesIO(b"X" * 1024), "image/png")}
    )
    assert response.status_code == 413
    final_files = set(settings.covers_dir.glob("*"))
    assert initial_files == final_files


def test_import_from_upload_valid_file(client: TestClient):
    """Prueba que un archivo válido dentro de los límites se procese correctamente."""
    pdf_content = b"%PDF-1.4 dummy content"
    files = [
        ("files", ("book.pdf", io.BytesIO(pdf_content), "application/pdf"))
    ]
    data = {
        "title": "Libro Válido Subido",
        "resource_type": "book",
        "category": "Testing",
        "difficulty": "BEGINNER",
        "structure_strategy": "auto_hierarchical"
    }

    response = client.post("/api/v1/content/import-from-upload", data=data, files=files)
    assert response.status_code == 201
    assert response.json()["title"] == "Libro Válido Subido"


def test_import_from_upload_oversized_file(client: TestClient, monkeypatch):
    """Prueba que un archivo que excede el límite individual se rechace con 413 y limpie temporales."""
    monkeypatch.setattr(ingestion_module, "MAX_UPLOAD_FILE_SIZE", 1024)  # 1 KB limit

    files = [
        ("files", ("huge_course.mp4", io.BytesIO(b"0" * 2048), "video/mp4"))
    ]
    data = {
        "title": "Curso Demasiado Grande",
        "resource_type": "course",
        "category": "Testing",
        "difficulty": "BEGINNER"
    }

    uploads_root = settings.data_dir / "uploads" / "imports"
    response = client.post("/api/v1/content/import-from-upload", data=data, files=files)
    assert response.status_code == 413
    assert "supera el límite" in response.json()["detail"]

    # Verificar que el directorio temporal se limpió
    if uploads_root.exists():
        subdirs = list(uploads_root.iterdir())
        assert len(subdirs) == 0


def test_import_from_upload_oversized_aggregate(client: TestClient, monkeypatch):
    """Prueba que un lote cuyo total excede MAX_TOTAL_IMPORT_SIZE se rechace con 413."""
    monkeypatch.setattr(ingestion_module, "MAX_UPLOAD_FILE_SIZE", 2048)
    monkeypatch.setattr(ingestion_module, "MAX_TOTAL_IMPORT_SIZE", 1500)  # Límite agregado menor

    files = [
        ("files", ("part1.mp4", io.BytesIO(b"1" * 1000), "video/mp4")),
        ("files", ("part2.mp4", io.BytesIO(b"2" * 1000), "video/mp4"))
    ]
    data = {
        "title": "Curso Agregado Grande",
        "resource_type": "course",
        "category": "Testing",
        "difficulty": "BEGINNER"
    }

    uploads_root = settings.data_dir / "uploads" / "imports"
    response = client.post("/api/v1/content/import-from-upload", data=data, files=files)
    assert response.status_code == 413
    assert "límite de 10 GB" in response.json()["detail"] or "límite" in response.json()["detail"]

    # Verificar limpieza
    if uploads_root.exists():
        subdirs = list(uploads_root.iterdir())
        assert len(subdirs) == 0


def test_import_from_upload_partial_write_failure_cleanup(client: TestClient, monkeypatch):
    """
    Prueba que un fallo de escritura/I-O a mitad de transmisión de un archivo
    elimine el archivo parcial corrupto, permita que los archivos válidos
    del lote continúen, y limpie totalmente los directorios temporales.
    """
    pdf_content = b"%PDF-1.4 dummy content with multiple chunks " * 5000  # > 64KB para múltiples chunks

    files = [
        ("files", ("broken_doc.pdf", io.BytesIO(pdf_content), "application/pdf")),
        ("files", ("valid_doc.pdf", io.BytesIO(pdf_content), "application/pdf"))
    ]
    data = {
        "title": "Lote con Archivo Corrupto",
        "resource_type": "book",
        "category": "Testing",
        "difficulty": "BEGINNER",
        "structure_strategy": "auto_hierarchical"
    }

    # Interceptar open para que al escribir broken_doc.pdf escriba un chunk parcial y luego falle
    real_open = open

    def mock_open(file, mode="r", *args, **kwargs):
        handle = real_open(file, mode, *args, **kwargs)
        if "broken_doc.pdf" in str(file) and "w" in mode:
            original_write = handle.write
            written_chunks = 0

            def failing_write(chunk):
                nonlocal written_chunks
                written_chunks += 1
                if written_chunks > 1:
                    raise IOError("Simulated disk error during streaming write")
                return original_write(chunk[:32])

            handle.write = failing_write  # type: ignore[method-assign]
        return handle

    monkeypatch.setattr("builtins.open", mock_open)

    # Interceptar import_resource para comprobar el contenido exacto del directorio temporal
    original_import = ingestion_module.IngestionService.import_resource
    seen_files_in_temp_dir = []

    def spying_import(self, req, background_tasks=None):
        source_dir = Path(req.source_path)
        # Registrar todos los archivos presentes en el directorio temporal antes de que se limpie
        for p in source_dir.rglob("*"):
            if p.is_file():
                seen_files_in_temp_dir.append(p.name)
        return original_import(self, req, background_tasks=background_tasks)

    monkeypatch.setattr(ingestion_module.IngestionService, "import_resource", spying_import)

    uploads_root = settings.data_dir / "uploads" / "imports"
    response = client.post("/api/v1/content/import-from-upload", data=data, files=files)

    assert response.status_code == 201
    assert response.json()["title"] == "Lote con Archivo Corrupto"

    # El directorio temporal de importación solo debe haber recibido el archivo válido
    assert "valid_doc.pdf" in seen_files_in_temp_dir
    assert "broken_doc.pdf" not in seen_files_in_temp_dir

    # El directorio temporal debe haber sido eliminado completamente tras finalizar
    if uploads_root.exists():
        subdirs = list(uploads_root.iterdir())
        assert len(subdirs) == 0

