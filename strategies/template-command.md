# Granblue Fantasy App Execution & Template Commands

Concise reference for all commands to run, automate, test, and manage workflow templates.

---

## 1. Browser & Account Setup

| Command | Description |
| :--- | :--- |
| `npm run launch:chrome` | Launches browser with visible GUI window on CDP port `9222` |
| `npm run launch:chrome:headless` | Launches browser silently in background (`--headless=new`) |
| `bun run account:setup acc1` | Interactive desktop login & session verification |
| `bun run account:setup acc1 --headless` | Starts remote interactive cockpit on port 3001 for VPS login |
| `bun run account:setup acc1 --midship "<val>"` | Instantly injects session cookie token without opening browser |
| `bun run sync acc1 --remote http://<VPS>:3001` | 1-command session sync from local PC to remote VPS |
| `npm run solve-captcha [code]` | Displays active CAPTCHA image and submits text response |

---

## 2. Universal Workflow CLI

### General Syntax
```bash
npm run workflow [account] [template] [runs] [flags]
# or
npm run acc1 <template-name> [runs] [--windowed]
```

### Flags & Options
| Flag | Description |
| :--- | :--- |
| `--windowed` / `--headful` | Runs with visible browser window (default is headless) |
| `--headless` | Explicitly runs in headless mode |
| `--dry-run [template]` | Previews compiled step pipeline without sending inputs |
| `--validate [template]` | Validates template syntax against Zod schema |

---

## 3. Guild Wars (GW) Automation

| Command | Target | Preset / Behavior |
| :--- | :--- | :--- |
| `bun run gw-meat-light` | EX+ Meat (0-Button) | Headless 0b Quick Summon + Normal Attack |
| `bun run gw-meat-light:headless` | EX+ Meat | Explicit headless mode |
| `bun run gw-meat:windowed` | EX+ Meat | Visible browser window |
| `bun run gw-meat-swarm` | EX+ Meat (Multi-Acc) | Parallel multi-account swarm farming |
| `bun run gw-nm95-light` | NM95 Boss (Light 1T) | Light Florence + Nehan 1-Turn burst (`acc1`) |
| `bun run gw-nm95-light:windowed` | NM95 Boss | Windowed mode for NM95 burst |
| `bun run acc1 gw-nm95-light 50` | NM95 Boss | Runs exact 50 battles on `acc1` |

---

## 4. Gold Bar (GB) Raid Farming

| Command | Raid | Slot / Strategy |
| :--- | :--- | :--- |
| `bun run gb-pbhl` | Proto Bahamut HL | Slot 4 assist search, 1.48M pt threshold |
| `bun run gb-akasha` | Akasha HL | Slot 3 assist search, 1.48M pt threshold |
| `bun run gb-go` | Grand Order HL | Slot 2 assist search, 1.48M pt threshold |
| `bun run gb-farm` | Multi-Raid Rotator | Auto-rotates PBHL -> Akasha -> GO HL |
| `bun run acc1 gb-pbhl-fast` | PBHL 0-Button | Fast 0-button burst setup |

---

## 5. Leech Raid Fast Burst Automation (`leech`)

Designed for fast participation/leech drops rather than honor thresholds across all 6 Magna 3 (Omega Rebirth) elements. Targets dying raids (`HP <= 20%`, `players >= 3`) with matching Primal supporter summons for rapid clear, fast repetition, and automatic assist recovery when 3 pending battles are reached.

| Command | Raid | Slot / Primal Supporter / Strategy |
| :--- | :--- | :--- |
| `bun run leech` | Default Leech | Runs Colossus Ira fast leech loop (`acc1`) |
| `bun run leech:colossus` | Colossus Ira (Fire) | Assist Slot 1 (`#quest/assist`), **Varuna** support, `HP <= 20%` & `players >= 3` |
| `bun run leech:tiamat` | Tiamat Aura (Wind) | Assist Slot 1 (`#quest/assist`), **Agni** support, `HP <= 20%` & `players >= 3` |
| `bun run leech:leviathan` | Leviathan Mare (Water) | Assist Slot 1 (`#quest/assist`), **Titan** support, `HP <= 20%` & `players >= 3` |
| `bun run leech:yggdrasil` | Yggdrasil Arbos (Earth) | Assist Slot 1 (`#quest/assist`), **Zephyrus** support, `HP <= 20%` & `players >= 3` |
| `bun run leech:luminiera` | Luminiera Credo (Light) | Assist Slot 1 (`#quest/assist`), **Hades** support, `HP <= 20%` & `players >= 3` |
| `bun run leech:celeste` | Celeste Ater (Dark) | Assist Slot 1 (`#quest/assist`), **Zeus** support, `HP <= 20%` & `players >= 3` |
| `bun run leech:colossus:windowed` | Colossus Ira | Runs Colossus Ira burst in visible GUI browser window |
| `bun run leech acc2 leech-leviathan-mare 50` | Leviathan Mare | Runs 50 leech cycles on `acc2` |

---

## 6. Daily Skips & Special Events

| Command | Mode | Description |
| :--- | :--- | :--- |
| `bun run daily` | All Pro Skips | Clears all daily Pro Skips pinned in Favorites |
| `bun run daily:acc1` | Account 1 | Daily routine on Account 1 |
| `bun run daily:acc2` | Account 2 | Daily routine on Account 2 |
| `bun run daily:all` | Swarm | Daily routine across all accounts sequentially |
| `bun run arcarum-theworld` | Sandbox | Auto-farms Arcarum "The World" boss |
| `bun run rotb` | RotB | Rise of the Beasts raid rotator |
| `bun run rotb:baihu` | RotB Baihu | Runs Baihu battles continuously |
| `bun run rotb:earth:loop` | RotB Extreme | Infinite Earth Extreme raid loop |

---

## 7. Template Validation & Development

All templates are standardized as canonical JSON in `templates/*.json`.

| Command | Purpose |
| :--- | :--- |
| `bun run workflow:validate` | Validates all 22 templates in `templates/` directory |
| `bun src/cli/run-workflow.ts --validate otkraid-colossus-ira` | Validates single template schema |
| `bun src/cli/run-workflow.ts --dry-run otkraid-colossus-ira` | Prints compiled step-by-step pipeline |

---

## 8. Testing & Quality Assurance

| Command | Scope |
| :--- | :--- |
| `bun run test` | Runs entire unified test suite (22 suites) |
| `bun run test:templates` | Template schema, boundaries, & negative test suite |
| `bun run test:parser` | Template parser & schema verification |
| `bun run test:engine` | Universal engine mock & telemetry tests |
| `bun run test:evaluator` | Parallel condition checks, multi-slot concurrency & LRU cache tests |

---

## 9. Background Daemon & Remote Gateway

| Command | Port / Access | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `:3000` / `:9222` | Starts Fastify daemon with live WebSocket screencast |
| `npm start` | `:3000` | Starts compiled production daemon |
| **Mobile Companion UI** | `http://localhost:3000/?token=<AUTH_TOKEN>` | Remote screencast & status dashboard |
