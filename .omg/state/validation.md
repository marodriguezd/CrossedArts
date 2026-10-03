# Validation Commands & Constraints

## Setup & Environment
Ensure the local python virtual environment is initialized:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## Running Tests
To run all tests:
```bash
PYTHONPATH=. .venv/bin/pytest backend/tests -x -q
```

## Database Migrations
Always generate migrations when database models are modified:
```bash
PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini revision --autogenerate -m "description"
PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini upgrade head
```

## Known Constraints
1. **SQLite 999 parameter limit:** Batch any deleted or updated lists of records in chunks of 500.
2. **Settings Isolation in Tests:** Wrap tests dynamically updating configurations in `try...finally` blocks to prevent configuration state leakage.
3. **No direct imports of SQL functions:** Do not import `coalesce`, `sum`, etc. directly from `sqlalchemy`. Access them through `func.*`.
