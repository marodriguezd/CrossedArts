# Agent Customization & Workspace Rules

This file registers the agent customizations for the DomestiK repository.

## Custom Workspace Skills

The custom workspace rules, guidelines, and auto-improvement instructions are defined in:
- [SKILL.md](../SKILL.md)

This skill is registered inside `.agents/skills.json` and loaded automatically by the agent configuration to customize agent behavior and preserve project-specific lessons.

## Loaded Skills

- **domestik-customizations**: Defined in `SKILL.md` (root). Registers virtualenv, pytest, and database migration (Alembic) discipline rules.

## Current Codebase Status & Next Steps

A comprehensive internal audit was conducted on 2026-06-22, identifying 10 critical flaws, performance bottlenecks, and security vulnerabilities. Before implementing any new features or modifying the codebase, agents MUST read and follow the remediation roadmap:
- Refer to [PLAN.md](file:///home/marodriguezd/Github/DomestiK/PLAN.md) for detailed before/after code refactoring examples for all 10 issues.
- Refer to [plan.html](file:///home/marodriguezd/Github/DomestiK/plan.html) for an interactive, styled dashboard of categories and severities.
- Follow the Phase 1, Phase 2, and Phase 3 roadmap outlined in the project root's [SKILL.md](file:///home/marodriguezd/Github/DomestiK/SKILL.md).
