# Project Runtime Standards: Bun

This repository (`gbf-remote-controller`) strictly standardizes on **Bun** as the primary runtime and package manager.

## Core Rules:
1. **Always Use `bun`**:
   - Run CLI commands using `bun run <script>` or `bun <path/to/file.ts>` (e.g. `bun run daily:universal`, `bun run test`, `bun src/cli/run-workflow.ts`).
   - Do NOT invoke `npx tsx` or `npm run` unless explicitly debugging Node.js compatibility.
2. **Package Management**:
   - Use `bun install` and `bun add <pkg>` / `bun add -d <pkg>`.
   - Maintain `bun.lock` as the single source of truth for dependencies.
3. **Execution Latency**:
   - Bun's native TypeScript runtime starts in <50ms (compared to 600-1200ms for Node + tsx on Windows), making CLI routines, cron timers, and test suites significantly faster and more resource-efficient.
4. **CDP & Browser Interaction**:
   - Puppeteer-core WebSocket connections to Chrome/SRWare Iron CDP (ports 9222, 9223) run natively under Bun with full feature parity.
   - In-game element interaction should always prioritize in-page DOM/Zepto dispatch (`page.evaluate(...)`) over Puppeteer's native `ElementHandle.click()` on dynamic overlays to prevent `Node is either not clickable or not an Element` layout race conditions.
