---
description: Environment commands, pytest execution, and configuration settings isolation.
globs:
  - "backend/tests/**"
  - "pyproject.toml"
---

# Testing Rules

- **Venv Execution:** Run pytest and Alembic commands using the local `.venv` binaries with `PYTHONPATH=.` set.
- **Settings Isolation:** Wrap tests altering settings properties in `try...finally` blocks to revert them. For testing defaults, instantiate settings with `_env_file=None` instead of using the global singleton.
- **FastAPI / SQLAlchemy Fixtures:** Use shared `db` and `client` fixtures from `conftest.py`. Service-layer tests should use the `db` fixture directly.
