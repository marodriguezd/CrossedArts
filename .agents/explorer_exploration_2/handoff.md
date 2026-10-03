# Handoff Report — Video Streaming API Endpoint Analysis

## 1. Observation

- **Video Streaming Endpoint Route & Registration**:
  - Found in `backend/app/api/media.py` starting at line 38:
    ```python
    @router.get("/{media_id}/stream")
    def stream_media(
        media_id: uuid.UUID, 
        db: Session = Depends(get_db)
    ):
    ```
  - Router prefix in `backend/app/api/media.py` line 17:
    ```python
    router = APIRouter(prefix="/media", tags=["Media"])
    ```
  - Router registration in `backend/app/api/router.py` lines 8, 16, and 24:
    ```python
    from backend.app.api.media import router as media_router
    api_router = APIRouter(prefix="/api/v1")
    api_router.include_router(media_router)
    ```
  - This establishes the full path of the video streaming endpoint as: `/api/v1/media/{media_id}/stream`.

- **Endpoint Implementation Logic**:
  - Located in `backend/app/api/media.py` lines 47-63:
    ```python
    asset = db.get(MediaAsset, media_id)
    if not asset:
        raise get_http_exception("MEDIA_NOT_FOUND", f"El archivo de medios con ID {media_id} no existe.")

    path = asset.file_path
    from backend.app.core.security import is_safe_path
    if not is_safe_path(path):
        raise get_http_exception("FORBIDDEN_PATH", "Acceso denegado a la ruta del archivo especificado.")

    if not os.path.exists(path):
        raise get_http_exception("FILE_NOT_FOUND", f"El archivo físico en la ruta {path} no se encuentra disponible.")

    return FileResponse(
        path,
        media_type=asset.mime_type,
        headers={"Accept-Ranges": "bytes"}
    )
    ```

- **FastAPI / Starlette Native Range Requests Handling**:
  - The endpoint returns a `FileResponse` object with `Accept-Ranges: bytes` header.
  - In `backend/requirements.txt` line 1: `fastapi>=0.110.0`, which uses Starlette `>=0.36.0`.
  - The test suite includes a test `test_media_api_streaming_range_requests` in `backend/tests/test_media.py` lines 122-162. When requesting with a `Range` header:
    ```python
    response_range = client.get(f"/api/v1/media/{asset.id}/stream", headers={"Range": "bytes=0-9"})
    assert response_range.status_code == 206
    assert response_range.headers["Content-Range"] == f"bytes 0-9/{len(dummy_content)}"
    assert response_range.content == b"0123456789"
    ```

- **Baseline Test Suite Status**:
  - Run command: `PYTHONPATH=. .venv/bin/pytest backend/tests -x -q`
  - Output: Completed successfully. All 172 tests passed (indicated by 172 dots `........................................................................ [ 41%] ... [ 83%] ... [100%]`).

---

## 2. Logic Chain

1. **Path Mapping**:
   - Starting from `router.py` (prefix `/api/v1`) to `media.py` (prefix `/media` + path `/{media_id}/stream`), the endpoint maps to `GET /api/v1/media/{media_id}/stream`.
2. **Request Validation**:
   - The endpoint queries the database for `MediaAsset` matching `media_id`.
   - Before serving, it ensures path safety via `is_safe_path` (sandboxing to allowed directories like `~/.domestik` and preventing directory traversal / hidden directory access) and checks physical file existence.
3. **Range Headers and Response Generation**:
   - The endpoint delegates response creation to Starlette's `FileResponse`.
   - The explicit inclusion of `headers={"Accept-Ranges": "bytes"}` informs downstream clients (like browsers) that range requests are accepted.
   - Starlette's `FileResponse` runs as an ASGI app. It automatically reads client `Range` headers from the ASGI scope context.
   - If a range is requested (e.g., `Range: bytes=0-9`), it parses the start/end offsets, sets status code `206 Partial Content`, writes `Content-Range: bytes 0-9/36`, sets `Content-Length: 10`, and streams only the requested bytes.
4. **Validation via Tests**:
   - The pytest test suite contains a test case (`test_media_api_streaming_range_requests`) that explicitly queries the endpoint with a range header and asserts a `206` status code with correct slicing.
   - Execution of the test suite demonstrates that the streaming endpoint functions correctly out-of-the-box in the local Python environment.

---

## 3. Caveats

- **Web Server Configuration**:
  - While Starlette/FastAPI handles `Range` headers correctly inside the Python ASGI app, if there is a reverse proxy (e.g., Nginx, Apache) in front of the application in production, the proxy must be configured to pass/preserve the `Range` and `Accept-Ranges` headers.
- **Client Behavior**:
  - Browsers may perform multiple small range requests sequentially to buffer video content. A client aborting a stream mid-way might raise a standard `ConnectionResetError` or `BrokenPipeError` in the ASGI server logs, which is normal for streaming endpoints.

---

## 4. Conclusion

- The media streaming API endpoint is located at `GET /api/v1/media/{media_id}/stream`.
- It relies on FastAPI/Starlette's native `FileResponse` range request handler, passing the necessary `Accept-Ranges: bytes` headers.
- The path is validated for safety (to prevent directory traversal outside authorized paths).
- The baseline test suite is 100% healthy, with all 172 tests passing.

---

## 5. Verification Method

- **Command**:
  ```bash
  PYTHONPATH=. .venv/bin/pytest backend/tests/test_media.py -k test_media_api_streaming_range_requests -v
  ```
- **Inspect**:
  - Run the specific test using the above command to confirm that range request capability tests execute and pass cleanly.
