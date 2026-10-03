# Testing Memory & Conventions

## 1. Virtualenv and Pytest Usage
* **Conventions:** DomestiK uses a local virtual environment named `.venv` in the repository root. Commands and tests must be run using this virtual environment's binaries to prevent package version mismatch issues.
* **Commands:**
  * Run all tests: `PYTHONPATH=. .venv/bin/pytest backend/tests -x -q`
  * Run a specific test file: `PYTHONPATH=. .venv/bin/pytest backend/tests/test_session.py`

## 2. Settings Singleton Testing & Isolation
* **Trap:** Modifying class-level global settings inside tests leaks into subsequent tests, causing flaky test suites.
* **Rule:** Wrap any tests that modify settings attributes in a `try...finally` block. Capture the original settings at the start and restore them in the `finally` block.
* **Isolation Rule:** In unit tests validating default setting fallbacks, always instantiate a fresh configuration object passing `_env_file=None` (e.g. `s = DomestiKSettings(_env_file=None)`) rather than importing the global pre-instantiated singleton.

## 3. Test Fleet Architecture
* **Shared Fixtures (`conftest.py`):**
  * `db` — Fresh in-memory SQLite session (`StaticPool` for thread safety).
  * `client` — FastAPI `TestClient` with `get_db` dependency override.
  * `sample_course` / `sample_book` — Pre-seeded ORM objects for tests.
  * `tmp_data_dir` — Temporary directory for filesystem tests.
* **Patterns:**
  * Service-layer tests use the `db` fixture directly.
  * API integration tests use the `client` fixture (TestClient).
  * `services_direct` tests use `monkeypatch` to replace `_get_session` with a `_NoCloseSession` wrapper to prevent detaching ORM objects.
