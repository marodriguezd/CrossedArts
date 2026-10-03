---
description: Database migrations, configurations, joined table inheritance, file uploads, and local directory safety rules.
globs:
  - "backend/**"
---

# Backend Development Rules

- **Database Migrations:** When updating SQLAlchemy/SQLModel models, always run `PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini revision --autogenerate -m "description"` to generate the migration, then apply it with `upgrade head`.
- **Config & Data Paths:** Never use `os.getcwd()` for paths. Always use settings attributes like `settings.data_dir`. All configuration must go through the singleton settings.
- **SQL Functions Import:** Never import `coalesce` or other SQL functions directly from `sqlalchemy`. Use `func.coalesce()`, `func.sum()`, etc.
- **Joined Table Inheritance Counts:** Never run single aggregate count queries over parent and child tables inJoined Table Inheritance hierarchies due to SQLite ambiguous column errors. Use separate queries or scalar subqueries.
- **Upload Sanitization:** Always sanitize upload filenames by parsing components with `PurePosixPath` to exclude `..`, and verify containment in the target directory using `.is_relative_to()`. Run cleanup in a `finally` block.
- **Local Paths Safety:** The `is_safe_path` check must block hidden directory paths (starting with a dot) except `.domestik`.
