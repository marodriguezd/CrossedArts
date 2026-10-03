# Agent Customization & Workspace Rules

This file registers the agent customizations for the DomestiK repository.

## Custom Workspace Skills

The custom workspace rules, guidelines, and auto-improvement instructions are defined in:
- [SKILL.md](../SKILL.md)

This skill is registered inside `.agents/skills.json` and loaded automatically by the agent configuration to customize agent behavior and preserve project-specific lessons.

## Loaded Skills

- **domestik-customizations**: Defined in `SKILL.md` (root). Registers virtualenv, pytest, and database migration (Alembic) discipline rules.
