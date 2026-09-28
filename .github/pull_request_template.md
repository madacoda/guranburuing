## Pull Request Description

### Summary of Changes
<!-- Provide a clear, high-level summary of what was changed and why. -->

### Related Issues
<!-- Reference any related issues (e.g., Closes #123, Fixes #456). -->

---

## Type of Change

- [ ] `feat`: New feature or capability
- [ ] `fix`: Bug fix
- [ ] `perf`: Performance improvement
- [ ] `refactor`: Code restructuring without behavioral changes
- [ ] `test`: New or updated tests
- [ ] `docs`: Documentation updates
- [ ] `chore`: Maintenance, dependencies, or tooling

---

## Pre-Flight Checklist (Gold Industry Standard)

- [ ] **Zero Leaks**: Verified that **no** credentials, `.env`, `accounts.config.json`, cookies, or personal directories are included.
- [ ] **Hygiene Gate**: Ran `bun scripts/verify-hygiene.ts` with 0 violations reported.
- [ ] **Type Safety**: Ran `bun run build` (or `tsc --noEmit`) with zero TypeScript errors.
- [ ] **Workflow Validation**: Ran `bun run workflow:validate` (all templates valid).
- [ ] **Test Coverage**: Ran `bun tests/run-all.ts` with 100% test suites passing.
- [ ] **Conventional Commits**: All commit messages follow the Conventional Commits specification.
