import io
import os
import uuid
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.core.settings import settings


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path: Path, monkeypatch):
    """Configura el entorno de prueba con un directorio de datos temporal."""
    test_home = tmp_path / "test_home"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: test_home)
    settings.ensure_dirs()


def test_upload_cover_file(client: TestClient):
    # 1. Upload a dummy image file
    file_content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    file_name = "test_cover.png"
    
    response = client.post(
        "/api/v1/content/upload-cover",
        files={"file": (file_name, io.BytesIO(file_content), "image/png")}
    )
    assert response.status_code == 200
    data = response.json()
    assert "cover_path" in data
    assert "url" in data
    
    url = data["url"]
    filename = url.split("/")[-1]
    
    # 2. Get the uploaded image
    response_serve = client.get(f"/api/v1/content/cover-image/{filename}")
    assert response_serve.status_code == 200
    assert response_serve.headers["content-type"] == "image/png"
    assert response_serve.content == file_content


def test_upload_cover_local_path_copy(client: TestClient):
    # 1. Create a local valid image inside settings.data_dir
    local_img = settings.data_dir / "my_local_cover.jpg"
    img_content = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x60\x00\x60\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c\x20\x24\x2e\x27\x20\x22\x2c\x23\x1c\x1c\x28\x37\x29\x2c\x30\x31\x34\x34\x34\x1f\x27\x39\x3d\x38\x32\x3c\x2e\x33\x34\x32\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x37\xff\xd9"
    local_img.write_bytes(img_content)
    
    response = client.post(
        "/api/v1/content/upload-cover",
        data={"local_path": str(local_img.resolve()), "strategy": "copy"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "cover_path" in data
    assert "url" in data
    
    url = data["url"]
    filename = url.split("/")[-1]
    
    # Verify the copied file exists in covers_dir
    dest_path = settings.covers_dir / filename
    assert dest_path.is_file()
    assert not dest_path.is_symlink()
    assert dest_path.read_bytes() == img_content


def test_upload_cover_local_path_symlink(client: TestClient):
    local_img = settings.data_dir / "my_symlink_cover.webp"
    img_content = b"RIFF\x14\x00\x00\x00WEBPVP8 \x08\x00\x00\x00\xc0\x01\x00\x00\x00\x00\x00\x00"
    local_img.write_bytes(img_content)
    
    response = client.post(
        "/api/v1/content/upload-cover",
        data={"local_path": str(local_img.resolve()), "strategy": "symlink"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "cover_path" in data
    
    url = data["url"]
    filename = url.split("/")[-1]
    
    dest_path = settings.covers_dir / filename
    assert dest_path.is_symlink()
    assert dest_path.read_bytes() == img_content


def test_upload_cover_invalid_input(client: TestClient):
    # No file or local path
    response = client.post("/api/v1/content/upload-cover")
    assert response.status_code == 400
    assert "Debe proporcionar" in response.json()["detail"]


def test_upload_cover_unsafe_path(client: TestClient):
    # Outside the workspace
    response = client.post(
        "/api/v1/content/upload-cover",
        data={"local_path": "/etc/passwd", "strategy": "copy"}
    )
    assert response.status_code == 400
    assert "Acceso denegado" in response.json()["detail"]


def test_upload_cover_invalid_extension(client: TestClient):
    local_file = settings.data_dir / "malicious.sh"
    local_file.write_text("echo 'hello'")
    
    response = client.post(
        "/api/v1/content/upload-cover",
        data={"local_path": str(local_file.resolve()), "strategy": "copy"}
    )
    assert response.status_code == 400
    assert "Solo se permiten archivos de imagen" in response.json()["detail"]


def test_serve_cover_path_traversal(client: TestClient):
    from backend.app.api.ingestion import serve_cover_image
    from fastapi import HTTPException

    # 1. Test via client: routing matches single segment, so passing '/' or '%2f' results in 404 Not Found at route level.
    response = client.get("/api/v1/content/cover-image/..%2f..%2fetc%2fpasswd")
    assert response.status_code == 404

    # 2. Test the validation logic directly:
    for bad_filename in ["../../etc/passwd", "..\\etc\\passwd", "some/path/img.png"]:
        with pytest.raises(HTTPException) as exc_info:
            serve_cover_image(bad_filename)
        assert exc_info.value.status_code == 400
        assert "Nombre de archivo de portada no válido" in exc_info.value.detail


def test_serve_cover_invalid_extension(client: TestClient):
    response = client.get("/api/v1/content/cover-image/image.sh")
    assert response.status_code == 400
    assert "Extensión de archivo de portada no permitida" in response.json()["detail"]


def test_serve_cover_non_existent(client: TestClient):
    response = client.get("/api/v1/content/cover-image/does_not_exist.png")
    assert response.status_code == 404
    assert "Archivo de portada no encontrado" in response.json()["detail"]
