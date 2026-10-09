# Contributing to Granblue Fantasy Automation Suite

Thank you for your interest in contributing! We hold this project to **Gold Industry Standards** in code hygiene, security, and performance.

---

## 1. Development Prerequisites

- **Bun Runtime**: v1.2.0 or higher ([bun.sh](https://bun.sh))
- **Chromium-based Browser**: Google Chrome, SRWare Iron, or Chromium
- **Git**: Configured with proper author name and email

---

## 2. Local Setup & Workflow

1. **Fork & Clone**:
   ```bash
   git clone https://github.com/<your-username>/guranburuing.git
   cd guranburuing
   ```

2. **Install Dependencies**:
   ```bash
   bun install
   ```

3. **Initialize Configuration**:
   ```bash
   cp .env.example .env
   cp accounts.config.example.json accounts.config.json
   ```
   *(Never stage or commit `.env` or `accounts.config.json`)*

4. **Create a Dedicated Branch**:
   ```bash
   git checkout -b feat/your-feature-name
   # or: git checkout -b fix/issue-description
   ```

---

## 3. Commit Message Standards (Conventional Commits)

All commits must follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope>): <short imperative summary>

[optional body explaining motivation and technical approach]

[optional footer(s), e.g. Closes #123]
```

### Allowed Types:
- `feat`: A new feature or capability
- `fix`: A bug fix
- `perf`: A code change that improves performance
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `docs`: Documentation-only changes
- `chore`: Changes to build scripts, dependencies, or auxiliary tools

---

## 4. Mandatory Pre-Flight Verification Gates

Before pushing or opening a Pull Request, you **must** run the unified verification suite locally:

```bash
bun run verify
```

This command executes all mandatory gates:
1. **Security & Hygiene Audit**: `bun scripts/verify-hygiene.ts` (ensures 0 leaked secrets or personal directories).
2. **Template Schema & DSL Validation**: `bun run workflow:validate` (ensures 100% Zod compliance).
3. **Unified Test Suite**: `bun tests/run-all.ts` (33/33 test suites passing).
4. **TypeScript Build**: `bun run build` (zero type errors).

---

## 5. Submitting a Pull Request

1. Push your branch to your fork.
2. Open a Pull Request targeting the `main` branch.
3. Fill out the provided **Pull Request Template** thoroughly.
4. Ensure all GitHub Actions CI and Security checks pass.
