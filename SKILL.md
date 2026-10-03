---
name: domestik-customizations
description: Custom workspace rules, guidelines, and auto-improvement instructions for DomestiK.
---

# DomestiK Workspace Customization Skill

This file serves as a entrypoint and instruction set for all AI agents working on the **DomestiK** repository.

Detailed developer memories, project constraints, and conventions have been modularized into:
* Root Memory Index: [MEMORY.md](file:///home/marodriguezd/Github/DomestiK/MEMORY.md)
* Modular Memory Files: Located under [`.omg/memory/`](file:///home/marodriguezd/Github/DomestiK/.omg/memory/)
* Modular Rule Packs: Located under [`.omg/rules/`](file:///home/marodriguezd/Github/DomestiK/.omg/rules/)

---

## Guidelines for Auto-Improvement

To maintain high development quality and prevent recurring issues, agents must update the memory index and specific rule packs whenever new lessons, constraints, or guidelines are discovered.

### Criteria for Adding a Rule
An agent should append a new rule or update an existing one when:
1. **Recurring Failures:** A specific bug pattern or configuration error is found and fixed more than once.
2. **Hidden Divergence:** A gap is identified between the test environment and the production/development runtime environment (e.g., missing migrations).
3. **Workflow Friction:** A specific command structure or environment variable configuration is required for tools (e.g., `PYTHONPATH` settings) but is not documented.
4. **Codebase Specifics:** Project-specific patterns, conventions, or design decisions are established that future agents must follow to ensure consistency.

### Step-by-Step Editing Process for Agents
When updating memory, future agents must follow this exact protocol:
1. **Locate the Correct Scope:** Map the discovered lesson to either `backend`, `frontend`, `testing`, or `performance`.
2. **Update the Topic File:** Edit the corresponding file in `.omg/memory/` and update its respective rule pack in `.omg/rules/`.
3. **Index if Needed:** If creating a new topic, register the new files inside [MEMORY.md](file:///home/marodriguezd/Github/DomestiK/MEMORY.md).
4. **Verify Formatting:** Ensure the markdown is clean and properly formatted.
