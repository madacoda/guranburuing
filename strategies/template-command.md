# Granblue Fantasy App Execution & Template Commands

Concise reference for all commands to run, automate, test, and manage workflow templates.

---

## 1. Browser & Account Setup

| Command | Description |
| :--- | :--- |
| `npm run launch:chrome` | Launches browser with visible GUI window on CDP port `9222` |
| `npm run launch:chrome:headless` | Launches browser silently in background (`--headless=new`) |
| `npm run account:setup` | Interactive login & session verification for accounts |
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
| `--export-dsl <template>` | Converts JSON template into shorthand `.dsl` format |
| `--export-json <template>` | Compiles `.dsl` format into executable `.json` |

---

## 3. Guild Wars (GW) Automation

| Command | Target | Preset / Behavior |
| :--- | :--- | :--- |
| `npm run gw-meat-light` | EX+ Meat (0-Button) | Headless 0b Quick Summon + Normal Attack |
| `npm run gw-meat-light:headless` | EX+ Meat | Explicit headless mode |
| `npm run gw-meat:windowed` | EX+ Meat | Visible browser window |
| `npm run gw-meat-swarm` | EX+ Meat (Multi-Acc) | Parallel multi-account swarm farming |
| `npm run gw-nm95-light` | NM95 Boss (Light 1T) | Light Florence + Nehan 1-Turn burst (`acc1`) |
| `npm run gw-nm95-light:windowed` | NM95 Boss | Windowed mode for NM95 burst |
| `npm run acc1 gw-nm95-light 50` | NM95 Boss | Runs exact 50 battles on `acc1` |

---

## 4. Gold Bar (GB) Raid Farming

| Command | Raid | Slot / Strategy |
| :--- | :--- | :--- |
| `npm run gb-pbhl` | Proto Bahamut HL | Slot 4 assist search, 1.48M pt threshold |
| `npm run gb-akasha` | Akasha HL | Slot 3 assist search, 1.48M pt threshold |
| `npm run gb-go` | Grand Order HL | Slot 2 assist search, 1.48M pt threshold |
| `npm run gb-farm` | Multi-Raid Rotator | Auto-rotates PBHL -> Akasha -> GO HL |
| `npm run acc1 gb-pbhl-fast` | PBHL 0-Button | Fast 0-button burst setup |

---

## 5. Daily Skips & Special Events

| Command | Mode | Description |
| :--- | :--- | :--- |
| `npm run daily` | All Pro Skips | Clears all daily Pro Skips pinned in Favorites |
| `npm run daily:magna` | Magna Pro | Skips standard Omega raids (Tiamat, Colossus, etc.) |
| `npm run daily:hard` | Hard+ Pro | Skips Island Hard+ raids |
| `npm run arcarum-theworld` | Sandbox | Auto-farms Arcarum "The World" boss |
| `npm run rotb` | RotB | Rise of the Beasts raid rotator |
| `npm run rotb:baihu 30` | RotB Baihu | Runs 30 Baihu battles |
| `npm run rotb:earth:loop` | RotB Extreme | Infinite Earth Extreme raid loop |

---

## 6. Template Validation & Development

| Command | Purpose |
| :--- | :--- |
| `npm run workflow:validate` | Validates all templates in `templates/` directory |
| `npx tsx src/cli/run-workflow.ts --validate gw-nm95-light` | Validates single template |
| `npx tsx src/cli/run-workflow.ts --dry-run gw-nm95-light` | Prints compiled step-by-step pipeline |
| `npx tsx src/cli/run-workflow.ts --export-dsl gw-nm95-light` | Generates `templates/gw-nm95-light.dsl` |

---

## 7. Testing & Quality Assurance

| Command | Scope |
| :--- | :--- |
| `npm test` | Runs entire unified test suite (7 suites) |
| `npm run test:templates` | Template schema, boundaries, & negative test suite |
| `npm run test:parser` | DSL compiler & round-trip serializer |
| `npm run test:engine` | Universal engine mock & telemetry tests |

---

## 8. Background Daemon & Remote Gateway

| Command | Port / Access | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `:3000` / `:9222` | Starts Fastify daemon with live WebSocket screencast |
| `npm start` | `:3000` | Starts compiled production daemon |
| **Mobile Companion UI** | `http://localhost:3000/?token=<AUTH_TOKEN>` | Remote screencast & status dashboard |
