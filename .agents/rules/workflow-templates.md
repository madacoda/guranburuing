# Workflow Template Architecture & User Sovereignty

This repository (`guranburuing`) treats all template files in `templates/*.json` as **User-Owned Strategy Configurations**.

## Core Architectural Rules:

1. **User Ownership of Workflow Templates**:
   - Files in `templates/*.json` (and their DSL counterparts) belong to the user.
   - The user may freely add, remove, reorder, or customize skills, summons, attacks, waits, and options to match their in-game party, grid, and strategy.
   - **The AI MUST NEVER overwrite, alter, or revert user templates** unless the user explicitly requests changes in their prompt.

2. **Schema-Driven Validation, Never Hardcoded Step Constraints**:
   - Tests in `tests/` MUST validate templates based strictly on the JSON Schema (`validateWorkflowTemplate(template).valid === true`) and bidirectional DSL round-trip fidelity.
   - Tests MUST NEVER assert hardcoded step counts, specific character skill sequences, or specific step orders on user templates.
   - If a test requires validating a specific execution flow or regression scenario, it MUST use an internal test fixture (mock template object), NEVER the user's live strategy file.

3. **Dynamic Universal Engine Execution**:
   - `UniversalWorkflowEngine` must dynamically execute ANY valid sequence of steps defined by the user.
   - If a template includes `confirm_result` in its pipeline, the engine respects it and must not run redundant finisher turns or duplicate conclusion handlers.
   - The engine must gracefully skip unavailable skills/summons when on cooldown without throwing fatal errors.

4. **Zero Duplicate Workflows Under Different Names**:
   - Each workflow template file on disk must define a distinct, unique automation pipeline.
   - For backwards compatibility or alternate aliases, register them in `CANONICAL_ALIASES` inside `TemplateParser` instead of duplicating files on disk.
   - Replicard Sandbox and Raid Leech templates must declare explicit `sector`, `targetEnemy`, and `element` metadata to guarantee distinct workflow identity.
   - Enforced automatically via `Gate 5` in `bun run workflow:validate` and `tests/test-duplicate-workflows.ts`.
