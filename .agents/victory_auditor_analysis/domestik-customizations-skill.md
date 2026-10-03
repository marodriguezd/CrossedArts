---
name: domestik-customizations
description: Custom workspace rules, guidelines, and auto-improvement instructions for DomestiK.
---

# DomestiK Workspace Customization Skill

This file serves as a persistent guide and rulebook for all AI agents working on the **DomestiK** repository. It contains guidelines for code layout, testing protocols, database migration discipline, and instructions for how future agents should auto-improve and extend this guide when new patterns or pitfalls are discovered.

---

## Guidelines for Auto-Improvement

To maintain high development quality and prevent recurring issues, agents must update this document whenever new lessons, constraints, or guidelines are discovered.

### Criteria for Adding a Rule
An agent should append a new rule or update an existing one when:
1. **Recurring Failures:** A specific bug pattern or configuration error is found and fixed more than once.
2. **Hidden Divergence:** A gap is identified between the test environment and the production/development runtime environment (e.g., missing migrations).
3. **Workflow Friction:** A specific command structure or environment variable configuration is required for tools (e.g., `PYTHONPATH` settings) but is not documented.
4. **Codebase Specifics:** Project-specific patterns, conventions, or design decisions are established that future agents must follow to ensure consistency.

### Step-by-Step Editing Process for Agents
When updating this file, future agents must follow this exact protocol:
1. **Read Entire File:** Read the existing `SKILL.md` first to understand the context and avoid duplicate rules.
2. **Preserve Frontmatter:** Keep the YAML frontmatter section at the top of the file exactly as it is.
3. **Draft the Rule:** Formulate the new rule with a clear title, description, and concrete, actionable steps or commands.
4. **Append to Lessons & Rules:** Locate the `## Learnt Lessons & Rules` section and append the new rule at the bottom. Do not delete or overwrite existing rules unless they are outdated or incorrect.
5. **Verify Formatting:** Ensure the markdown is clean, properly formatted, and easy for future agents to parse.
6. **Commit and Document:** Explain the new rule in the handoff report and commit message.

---

## Learnt Lessons & Rules

### 1. Virtualenv and Pytest Usage
* **Description:** DomestiK uses a local virtual environment named `.venv` in the repository root. Commands and tests must be run using this virtual environment's binaries to prevent package version mismatch issues.
* **Context:** Running tests or scripts with global Python installations can fail due to missing dependencies. Setting the `PYTHONPATH` is also required so that modules in `backend/` and `frontend/` can resolve correctly.
* **Actionable Commands:**
  - Run all tests:
    ```bash
    PYTHONPATH=. .venv/bin/pytest backend/tests
    ```
  - Run a specific test file:
    ```bash
    PYTHONPATH=. .venv/bin/pytest backend/tests/test_session.py
    ```

### 2. Database Migration Discipline (Alembic)
* **Description:** DomestiK uses Alembic for tracking database schema changes on the SQLite database (`domestik.db`). However, the test suite (`backend/tests/conftest.py`) initializes a clean, in-memory SQLite database and creates tables directly using SQLAlchemy metadata (`Base.metadata.create_all`).
* **Critical Trap:** Because tests create tables on-the-fly from Python classes, the test suite will pass even if you modify a database model and forget to generate an Alembic migration. If this happens, the physical database will not be updated, and the application will fail in production/development.
* **Actionable Commands:**
  - After modifying any database model (classes inheriting from SQLModel/SQLAlchemy `Base`), always generate a new migration:
    ```bash
    PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini revision --autogenerate -m "describe_your_changes_here"
    ```
  - Apply migrations to the local database file:
    ```bash
    PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini upgrade head
    ```
  - Check the migration history:
    ```bash
    PYTHONPATH=. .venv/bin/alembic -c backend/alembic.ini history
    ```
