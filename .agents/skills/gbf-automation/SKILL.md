---
name: gbf-automation
description: Comprehensive operating guide for the Granblue Fantasy Remote Controller and automation system, enforcing Bun as the primary runtime, CLI workflows, multi-account CDP conventions, and daily routines.
---

# Granblue Fantasy Remote Controller & Automation Guide

This guide establishes the architectural standards, runtime environment, and operational runbooks for the `gbf-remote-controller` codebase.

---

## 1. Runtime Standardization: Bun vs. Node/npm

### Why Bun is Strictly Superior for this Repository:
1. **Startup & Execution Latency**:
   - Automated farming routines, cron schedules, and CLI workflows repeatedly invoke scripts.
   - **Node.js + tsx**: Requires spawning a Node process + an esbuild worker, taking **600ms – 1,200ms** startup overhead per invocation on Windows NTFS.
   - **Bun**: Built-in Zig/C++ TypeScript runtime boots in **30ms – 50ms** (over 15x faster), eliminating CLI lag.
2. **Native TypeScript Execution**:
   - Bun parses, transpiles, and runs `.ts` and `.json` files natively with zero external dependencies.
3. **Memory & Resource Efficiency**:
   - Bun's base runtime consumes ~30MB memory vs ~90MB+ for Node + tsx.
4. **WebSocket & CDP Compatibility**:
   - `puppeteer-core` connects seamlessly via Bun to Chrome/SRWare Iron CDP endpoints (`ws://127.0.0.1:9222`) with full protocol fidelity and zero socket dropped frames.
5. **Fast Package Management**:
   - `bun install` resolves dependencies orders of magnitude faster than `npm install`, maintaining deterministic locks via `bun.lock`.

### Standardized Commands:
| Action | Primary (Bun) | Node Fallback |
| :--- | :--- | :--- |
| **Run Daily Routine** | `bun run daily` | `npm run daily` |
| **Daily Multi-Account**| `bun run daily:all` | `npm run daily:all` |
| **Daily Windowed** | `bun run daily:windowed` | `npm run daily:windowed` |
| **Fate Episodes** | `bun run fate` | `npm run fate` |
| **Event Story / Clear** | `bun run event` / `bun run event:all` | `bun src/cli/run-clear-event.ts ...` |
| **Custom Script** | `bun src/cli/run-workflow.ts acc1 <template> <runs>` | `tsx src/cli/run-workflow.ts ...` |
| **Run All Tests** | `bun run test` | `npm run test:node` |
| **Template Validation**| `bun run workflow:validate` | `npm run workflow:validate` |
| **Install Packages** | `bun install` | `npm install` |
| **Build Types** | `bun run build` | `npm run build` |

---

## 2. Multi-Account & CDP Architecture

Accounts are registered in [accounts.config.json](file:///c:/laragon/www/gbf/accounts.config.json):

```json
[
  {
    "id": "acc1",
    "name": "acc1",
    "enabled": true,
    "service": "mobage",
    "cdpPort": 9222,
    "profileDir": "C:/Users/YOUR_USER/.gbf-profiles/acc1"
  },
  {
    "id": "acc2",
    "name": "acc2",
    "enabled": true,
    "service": "mobage",
    "cdpPort": 9223,
    "profileDir": "C:/Users/YOUR_USER/.gbf-profiles/acc2"
  }
]
```

### Key Principles:
- **Port Isolation**: Each account runs its dedicated CDP port (default `9222` for `acc1`, `9223` for `acc2`).
- **Profile Isolation**: Each account maintains its isolated Chrome profile directory in `~/.gbf-profiles/<account>`, preventing cookie collisions.
- **Headless Execution**: Automation defaults to `--headless=new` (configured via `.env` or `--headless`). To visually inspect or assist, append `--windowed` or run `bun run account:setup <account>`.

---

## 3. In-Game Interaction & Anti-Crash Patterns

### 1. Robust In-Page Dispatch (Never Blind `ElementHandle.click()`):
Granblue Fantasy uses dynamic Zepto/jQuery DOM overlays and mobile viewport canvas layers. Native Puppeteer `ElementHandle.click()` calculates `clickablePoint()`, which throws `Error: Node is either not clickable or not an Element` when elements are animating, off-screen, or have zero bounding box.

**Always use in-page DOM dispatch**:
```ts
await page.evaluate(() => {
  const btn = document.querySelector('#start, .btn-start, [data-location-href="start"]') as HTMLElement;
  if (btn) {
    const $ = (window as any).$ || (window as any).Zepto;
    if ($) $(btn).trigger('tap');
    btn.click();
  }
});
```

### 2. Autonomous Title & Authentication Flow:
When an account's session expires or redirects to `#top` / `#authentication`:
1. `AccountAuthManager` safely clicks `#login-auth` (`.btn-login`).
2. On `#authentication`, selects the target platform (`.btn-auth-platform[data-platform="mobage"]`) and clicks `.btn-ok`.
3. Intercepts any opened OAuth redirect popup (`connect.mobage.jp`), triggers the `閉じる` (`.btn-close`) button to fire JSSDK `postMessage`, and verifies `#mypage` / `#profile`.

### 3. Reconnect Watchdog:
Upon network disconnect or browser restart, `CdpConnectionManager` automatically triggers `reconnect()`. Listeners re-bind the active page reference on `SentinelWatchdog` and `UniversalWorkflowEngine` to eliminate `Execution context was destroyed` or `detached Frame` errors.

---

## 4. Key Workflows

### Universal Daily Routine (`daily-universal`):
Runs all daily chores sequentially with zero user intervention:
- **Pro Skips**: Hard+, Omega, Omega (Impossible), Regalia, Angel Halo, Primarch Trials.
- **Rupie Gacha**: Daily 100-Draw Rupie Gacha (`#gacha/index/rupie`).
- **Skyscope**: Collects daily mission rewards (`#mission`).
- **Casino Exchange**: Exchanges maximum daily capacity for Half-Elixirs & Soul Berries (`#casino/exchange`).

```bash
# Run universal daily for primary account (acc1):
bun run daily

# Run universal daily across all registered accounts sequentially:
bun run daily:all

# Run for specific secondary account:
bun run daily:acc2

# Run in visual windowed mode:
bun run daily:windowed
```

### Fate Stories Auto-Farmer (`fate-stories`):
Loops through unread character fate episodes, fast-skips dialogues, enables Full Auto on combat, claims crystal rewards, and returns to `#mypage`:

```bash
# Farm unread fate episodes (default 5 episodes):
bun run fate

# Farm specific number of episodes (e.g. 10):
bun run fate:10
```

### Scenario Events Auto-Clear (`clear-event`, `event`):
Automates monthly scenario events (`#event/treasureraid<ID>`, e.g., "Farewell, Cold Heart" `#event/treasureraid177`):
- **Story Auto-Clear**: Automatically locates current `.ico-current` episode card, fast-skips dialogue cutscenes (`.btn-skip` -> `.btn-scene-skip`), engages story combat with Full Auto, dismisses reward modals, and loops through all 6 chapters & ending.
- **Challenge Quest**: 1-time clear of event challenge quest for Blue Sky Crystals and event trophy.
- **Daily Maniac**: Clears daily 2/2 Maniac solo battles for high-yield tokens and guaranteed Nightmare spawns.
- **Nightmare (HELL)**: Instant 1-click skips when skip is unlocked, or Full Auto battle.
- **Token Gacha**: Automatically draws Senka tokens and resets Boxes 1-4 when key SSR is pulled.

```bash
# Clear all unread story episodes (defaults to active event):
bun run event

# Run in windowed mode:
bun run event:windowed

# Complete full event pipeline (Story -> Challenge -> Maniac -> HELL -> Gacha):
bun run event:all

# Individual event tasks:
bun run event:challenge
bun run event:maniac
bun run event:nightmare
bun run event:gacha
```

### Raid & Combat Farming:
```bash
# Farm Proto Bahamut HL for blue chests / Gold Bars:
bun run pbhl

# Farm Akasha HL:
bun run gb-akasha

# Farm Grand Order HL:
bun run gb-go

# Multi-Raid Rotator (PBHL + Akasha + GOHL):
bun run gb-farm

# Guild Wars EX+ Meat:
bun run gw-meat-light
```
