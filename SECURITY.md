# Security Policy

## Supported Versions

Only the latest release on the `main` branch receives active security updates and patches.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## Threat Model & Security Architecture

The Granblue Fantasy Remote Controller & Automation Suite interfaces directly with live browser sessions and manages local configuration files. Our core security architecture adheres to the following principles:

1. **Zero Cloud Secret Persistence**:
   - Credentials (`accounts.config.json`), session tokens, and environment parameters (`.env`) are strictly local and must **never** be committed to version control.
   - The repository enforces strict `.gitignore` patterns and pre-commit verification scripts (`bun scripts/verify-hygiene.ts`).

2. **Physical Process & Profile Isolation**:
   - Each account operates within its own physically isolated Chromium `--user-data-dir` to prevent cross-account session contamination and cookie leakage.

3. **Gateway Access Controls**:
   - The remote WebSocket and HTTP companion server enforces Bearer token authentication (RFC 6750) on all incoming connections.
   - Unauthorized attempts (HTTP 401 / WS 1008 Policy Violation) terminate immediately without exposing server state.

---

## Reporting a Vulnerability

If you discover a potential security vulnerability or credential leak within this repository, **please do not disclose it publicly via GitHub Issues or Discussions.**

### How to Report

1. Open a **Private Security Advisory** on GitHub:
   - Navigate to the **Security** tab of the repository.
   - Select **Advisories** -> **Report a vulnerability**.
2. Or contact the maintainer directly via GitHub profile: [@madacoda](https://github.com/madacoda).

### What to Include

Please provide:
- A detailed description of the vulnerability.
- Steps to reproduce or proof-of-concept (PoC) code.
- Potential impact and affected components (e.g. WebSocket gateway, CDP connector, CLI).
- Any proposed remediations.

### Response Timeline

- **Initial Acknowledgement**: Within 48 hours.
- **Triage & Assessment**: Within 5 business days.
- **Patch Release & Advisory Publication**: Coordinated with the reporter upon resolution.
