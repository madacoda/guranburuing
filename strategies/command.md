# GBF CLI Reference (`/caveman` Edition)

Append `:windowed` or `-w` to any workflow command for visible browser. Default: headless (`acc1`).

---

## 0. Global Syntax & Flags

```bash
bun src/cli/run-workflow.ts [acc] <template> [runs] [flags]
```

| Flag | Short | Default | Effect |
| :--- | :---: | :---: | :--- |
| `--windowed` | `-w` | `false` | Show browser GUI |
| `--headless` | `-h` | `true` | Silent background (`--headless=new`) |
| `--account <id>` | `-a` | `acc1` | Target account (`accounts.config.json`) |
| `--runs <n>` | `-r` | template | Loop count override |
| `--speed <m>` | `-s` | `fast` | `stealth` (860ms) \| `fast` (150ms) \| `turbo` (75ms) |
| `--all-accounts` | — | `false` | Run sequentially across all accounts |

---

## 1. Auth & Session

| Command | Effect |
| :--- | :--- |
| `bun run account:setup [acc]` / `account:login` | Windowed login (port 9222). Add `--headless` for web cockpit (port 3000) |
| `bun run session:copy-local` | Clone local Chrome profile into bot dir |
| `bun run session:export [acc]` | Dump cookies $\rightarrow$ `data/<acc>-cookies.json` |
| `bun run session:import [acc]` / `import` | Inject cookie jar + verify profile |
| `bun run import:clipboard` / `import:midship` | Import cookies from clipboard JSON or `midship` value |
| `bun run session:sync [acc]` / `sync` | Verify cookies + sync local $\rightarrow$ VPS |
| `bun run vps:login` / `vps:browser` | SSH tunnel to remote VPS Chrome mirror (port 9222) |

---

## 2. Browser, Gateway, PM2 & Rust Core

| Command | Effect |
| :--- | :--- |
| `bun run launch:chrome` / `launch:chrome:headless` | Launch Chrome on port 9222 (GUI / headless) |
| `bun run gateway` / `dev` / `dev:node` | Start HTTP/WS gateway (port 3000/3001) |
| `bun run build` / `start` | Compile `tsc` $\rightarrow$ `dist/` / run prod bundle |
| `bun run pm2:start` \| `stop` \| `restart` \| `logs` \| `status` | Manage local PM2 `gbf-controller` |
| `bun run vps:status` \| `stop` \| `start` \| `restart` \| `logs [n]` | Manage remote Linux VPS PM2 daemon |
| `bun run rust:build` \| `rust:test` \| `rust:daemon` \| `rust:bench` | Build/test/run native Rust daemon & CPU governor |

> [!IMPORTANT]
> **Dual-Node Stop Rule**: Stopping jobs/schedulers requires halting **both** local processes and remote VPS (`bun run vps:stop`).

---

## 3. Dailies, Hosting & 21:00 JST Scheduler

| Command | Effect |
| :--- | :--- |
| `bun run daily` (`:acc1` \| `:acc2` \| `:all` \| `:windowed`) | 12 Pro Skips + Rupie Gacha + Skyscope + Casino |
| `bun run daily:favorites` | Pro Skip pinned Favorites (`#quest`) |
| `bun run daily:host` (`:acc1` \| `:acc2` \| `:all` \| `:windowed`) | Host all 16 daily raids (HL + M3 + Six Dragons) |
| `bun run daily:host:hl` (`daily:hostgb`) \| `:m3` \| `:dragons` | Host subset only (HL / Magna 3 / Six Dragons) |
| `bun run daily:scheduler` | 24/7 daemon; fires daily routine at 21:00:15 JST (19:00:15 WIB) |
| `bun run daily:routine` (`--windowed` \| `--no-hosts` \| `--no-skips`) | Run Pro Skips $\rightarrow$ Raid Hosts immediately |
| `bun run farm:human [acc] [--cycles=3] [--gb=18] [--rest=5]` | Human cadence: GB burst $\rightarrow$ M3 leech $\rightarrow$ rest $\rightarrow$ audit |
| `bun run inventory [acc]` / `inventory:cached` | Live or cached Elixir/Berry/GB/Crystal/AAP count |

---

## 4. Replicard Sandbox (Arcarum)

```bash
bun run arcarum                              # Interactive menu
bun run arcarum:help                         # Target list
bun src/cli/run-arcarum.ts acc1 <target> <n> # Direct runner
```

### Zone Mundus (Stage 10)
| Target | Quest ID | CLI (`bun run ...`) | Notes |
| :--- | :---: | :--- | :--- |
| **Zone Mundus Map** | — | `stage10` / `arcarum:stage10` / `arcarum:mundus` | Auto-scans map + defenders |
| **The World** | `819131` | `theworld` / `theworld:smart` / `theworld:bespoke` | Div 16 boss (World Idean) |
| **Ca Ong Militis** | `819151` | `ca-ong` / `ca-ong:smart` | Water Defender (Div 10) |
| **Prometheus Militis** | `819141` | `prometheus` / `prometheus:smart` | Fire Defender (Div 3) |
| **Gilgamesh Militis** | `819161` | `gilgamesh` / `gilgamesh:smart` | Earth Defender (Div 7) |
| **Morrigna Militis** | `819171` | `morrigna` / `morrigna:smart` | Wind Defender (Div 15) |
| **5-Gauge Nodes** | `8190xx` | `arcarum:steve` \| `tide-caller` \| `fire-demon` \| `elephant` \| `princess` \| `dragon-green` | Spawns Militis defenders |
| **Extra 5-Gauge** | — | `arcarum-mundus-dragon-princess-smart` \| `wild-hunt-smart` \| `voltage-rock-smart` \| `love-meeeee-smart` | Smart Full Auto burst |
| **3-Gauge & Heralds** | `819xxx` | `arcarum:herald-water` \| `herald-earth` \| `pincers` \| `winged-cat` | +100% Sephira gauge / fast 3-bar |

### Stage 3 (Zone Goliath)
| Target | CLI (`bun run ...`) | Notes |
| :--- | :--- | :--- |
| **Stage 3 Map / Boss** | `stage3` / `triune` | Map scanner / Goliath Triune boss |
| **Defenders (30 AAP)** | `avarice` (Organ) \| `keeper` (Rib) \| `howler` (Core) | Pink / Green / Yellow defenders |
| **5-Gauge & Herald** | `arcarum:panther` \| `barbarian` \| `despair` \| `goliath-herald` | Spawns defenders / +100% gauge |

### Stage 6, 7 & Staves (Eletio / Faym / Joculator / Kalendae)
| Target | Quest ID | CLI (`bun run ...`) | Notes |
| :--- | :---: | :--- | :--- |
| **Stage 7 Map** | — | `stage7` / `arcarum:stage7` | Auto-targets Lady of Redemption / Maiden |
| **Lady of Redemption** | `816071` | `redemption` / `lady` | Stage 7 Defender |
| **Xeno Cocytus Militis** | `816131` | `cocytus` / `xeno-cocytus` | Stage 7 Div 15 boss |
| **Xeno Ifrit Militis** | `815131` | `ifrit` / `xeno-ifrit` | Stage 6 Div 14 boss |
| **Lilywhite Paragon** | `812111` | `paragon` / `arcarum:lilywhite` | Faym Rib Defender (spawn via `fortress`) |
| **5-Gauge Nodes** | — | `fortress` (Faym) \| `arcarum:maiden` (Stage 7) | Spawns Paragon / Redemption |
| **Athena / Grani Militis**| — | `athena` / `athena:smart` \| `grani` / `grani:smart` / `grani:fast` | Eletio / Faym Militis bosses |

---

## 5. Gold Bar, Magna 3, 6-Man & Revans Raids (`#quest/assist`)

All Tab 1 workflows auto-configure Finder Slot 1 (`autoSetRaid: true`, 0ms pre-check if already set).

### Gold Bar & High-Level Raids
| Command (`bun run ...`) | Raid | Target / Notes |
| :--- | :--- | :--- |
| `pbhl` / `gb-pbhl` / `gb-pbhl-fast` / `gb-pbhl:skill` / `gb-pbhl:reload-skills` | Proto Bahamut HL | 1.50M honors Blue Chest |
| `gb-akasha` | Akasha HL | 1.50M honors (`c4s1` $\rightarrow$ `quick_call` $\rightarrow$ `reload` $\rightarrow$ `c3s1` $\rightarrow$ `c2s1` $\rightarrow$ 2T attack) |
| `gb-go` | Grand Order HL | 1.50M honors 2T burst |
| `gb-farm` | Tri-Raid Rotator | Rotates PBHL $\rightarrow$ Akasha $\rightarrow$ GOHL |
| `theworld:raid` / `world:raid` / `raid-the-world` | The World (HL) | Same 13-step burst pipeline as Akasha |
| `goldbar` / `gb:report` \| `eternitysand` / `sand:report` | Telemetry | Test alerts & print GB / Eternity Sand drop reports |

### Magna 3 (Omega Rebirth) Leech & Farm
| Element / Boss | Leech (`HP <= 20%`) | Adaptive Farm |
| :--- | :--- | :--- |
| **Fire** (Colossus Ira) | `bun run leech:colossus` | `bun run farm:colossus` / `farm:ira` |
| **Wind** (Tiamat Aura) | `bun run leech:tiamat` | `bun run farm:tiamat` / `farm:aura` |
| **Water** (Leviathan Mare) | `bun run leech:leviathan` | `bun run farm:leviathan` / `farm:levi` |
| **Earth** (Yggdrasil Arbos) | `bun run leech:yggdrasil` | `bun run farm:yggdrasil` / `farm:arbos` / `farm:ygg` |
| **Light** (Luminiera Credo) | `bun run leech:luminiera` | `bun run farm:luminiera` / `farm:credo` / `farm:lumi` |
| **Dark** (Celeste Ater) | `bun run leech:celeste` | `bun run farm:celeste` / `farm:ater` |
| **All Elements** | `bun run leech` / `otkraid` | `bun run farm` |

### Endgame 6-Man & Six Dragons
| Raid | Burst (`bun run ...`) | Leech (`bun run ...`) |
| :--- | :--- | :--- |
| **Beelzebub HL** (`305181`) | `bubz` / `beelzebub` / `long-live-the-king` | `leech:bubz` |
| **Lucilius Hard** (`303141`) | `faahl` / `dark-rapture-hard` | `leech:faahl` |
| **Belial HL** (`305191`) | `belial` / `cunning` | `leech:belial` |
| **Lindwurm HL** (`305161`) | `lindwurm` / `empyreal-ascension` | `leech:lindwurm` / `leech:empyreal` |
| **Fediel / Wilnas** | `fediel` \| `wilnas` | `leech:fediel` \| `leech:wilnas` |

### Revans Series (4M Honors Blue Chest)
| Command (`bun run ...`) | Raid / Action | Details |
| :--- | :--- | :--- |
| `siete` / `seofon` / `raid-seofon` | **Seofon HL** (`305411`) | 4M honors, exits if boss HP $\le 12\%$ (10% trigger cutoff) |
| `siete:check` (`:offline` \| `:json`) | Siete Readiness Audit | Checks 100% Fire party, 99T summon lock, $\ge 50\text{k}$ HP, 77.77M omen |
| `siete:setup` / `siete:setup:dry` | Siete Auto-Setup | Configures Fire Siete party & grid |
| `agastia` / `raid-agastia` | **Agastia HL** (`305431`) | 4M honors, Deck 191 Light Kengo 6-Ougi Satellite Cannon cancel |

---

## 6. Guild Wars (Unite & Fight): Meat & NM Grinding

| Phase / Target | Command (`bun run ...`) | Quest / Rotation (`ensureCast` monitored) |
| :--- | :--- | :--- |
| **Dark EX+ Meat** | `gw-meat` / `gw-meat-dark` / `gw-meat:dark` / `meat:dark` (`:acc1` \| `:acc2` \| `:windowed`) | Quest `980651/1/0` (Hades): `tap_ready` $\rightarrow$ `attack` $\rightarrow$ `reload` $\rightarrow$ `confirm_result` |
| **Dark NM95 Burst** | `gw-nm95` / `gw-nm95-dark` / `gw-nm95:dark` / `nm95:dark` (`:acc1` \| `:acc2` \| `:windowed`) | Quest `980681/1/0/10116` (Hades): `c4s3` $\rightarrow$ `c4s2` $\rightarrow$ `quick_call` $\rightarrow$ `reload` $\rightarrow$ `c4s1` $\rightarrow$ `c4s3` on `c1` $\rightarrow$ `c4s4` $\rightarrow$ `c3s1` $\rightarrow$ `c3s2` $\rightarrow$ `c2s1` $\rightarrow$ `attack` $\rightarrow$ `reload` $\rightarrow$ `confirm_result` |
| **Light EX+ Meat** | `gw-meat-light` (`:windowed` \| `:headless`) | Quest `947551/1/0` (Zeus): `tap_ready` $\rightarrow$ `reload` $\rightarrow$ `tap_ready` $\rightarrow$ `reload` |
| **Light NM95 Burst** | `gw-nm95-light` (`:acc1` \| `:acc2` \| `:windowed`) | Quest `947581/1/0/10116` (Zeus): Florence + Nehan 1T burst |
| **Meat Swarm** | `gw-meat:swarm [runs]` / `gw-meat-swarm` | Dual-account parallel EX+ meat farm (`acc1` + `acc2`) |
| **UNF Token Box** | `gacha:unf` | Auto-empties Unite & Fight token drawboxes |

---

## 6b. Events, Dread Barrage, ROTB, Slime & Fates

| Category | Command (`bun run ...`) | Notes |
| :--- | :--- | :--- |
| **Shiny Slime** | `slime` / `shiny-slime` / `farm:slime` | Quest `400151`: Wave 1 `quick_call` $\rightarrow$ `.btn-treasure-footer-back` $\rightarrow$ Wave 2 `c4s3` $\rightarrow$ `reload` (~8.9s/run) |
| **Dread Barrage** | `db:1star`..`db:5star` (`db1`..`db5`) \| `db:unparalleled` \| `db:valiant` \| `db:missions` \| `db:rewards` \| `db:gacha` \| `db:status` \| `db:all` | 1★–5★ OTK/FA, daily hosts, missions, auto token drawbox |
| **Story Events** | `event` (`:all` \| `:sweep` \| `:maniac` \| `:nightmare` / `hell` \| `:challenge` \| `:missions` \| `:gacha` \| `:solo` \| `:raid` / `:raid:vh` / `:raid:hl`) | Cutscene skip, first-clear crystals, HELL skip, raid burst, token boxes |
| **Exo Crucible** | `exo-diablo-125` | Exo Diablo Lv125 farm |
| **Event of the Ten** | `event-of-the-ten` / `event:ten` / `ten` | Quest `981021/3` (Hades): `c4s1` $\rightarrow$ `c4s3` on `c1` $\rightarrow$ `quick_call` $\rightarrow$ `reload` $\rightarrow$ `c2s1` $\rightarrow$ `c3s1` $\rightarrow$ 2T `attack`+`reload` |
| **ROTB** | `rotb` \| `rotb:baihu` \| `rotb:earth` \| `rotb:earth:loop` | Menu, 30x Baihu, 9x Baihu $\rightarrow$ 1x Titan Agon loop |
| **Fate Episodes** | `fate` \| `fate:5` \| `fate:10` \| `fate:20` \| `fate:all` \| `fate:cli` | Auto-skips dialogue & clears battles (`#quest/fate`) |

---

## 7. Generic Workflow Runner & Custom Templates

| Command | Effect |
| :--- | :--- |
| `bun run workflow` / `run-workflow` | Interactive arrow-key template picker (92 templates) |
| `bun run acc1 <template> [runs]` / `acc2 <template> [runs]` | Run any `templates/<name>.json` on `acc1` or `acc2` |
| `bun run templates:sync` | Sync `templates/*.json` $\rightarrow$ `package.json` scripts |
| `bun run workflow:validate` | Validate all 92 templates + DSL parser |

**Raid Filter Knobs (`templates/*.json`)**:
`autoSetRaid: true`, `raidSlot: 1`, `evaluatorStrategy: "honor" | "leech" | "otk_burst" | "farm"`, `minHpPct`, `maxHpPct`, ` exitIfHpPct`, `minPlayers`, `maxPlayers`, `targetScore`.

---

## 8. Discord ChatOps, CAPTCHA & Rich Presence

| Command | Effect |
| :--- | :--- |
| `bun run discord:controller` / `controller` / `vps` | Start 2-way Discord DM bot (`/gbf <cmd>`, preemptive task switch) |
| `bun run solve-captcha <text>` / `captcha <text>` | Inject CAPTCHA answer into game DOM |
| `bun run test:discord` | Test Discord webhook & DM relay |
| `bun run presence` (`:gbf` \| `:work` \| `:trade` \| `:bg` \| `:watch` \| `:clear` \| `:stop`) | Manage Discord Rich Presence status |

**Discord Slash Commands**: `/gbf <preset> [runs]`, `/gbf stop`, `/gbf status`, `/gbf logs`, `/gbf scheduler:on|off`, `/gbf help`.

---

## 9. QA & Pre-Flight Gates

| Command | Effect |
| :--- | :--- |
| `bun run verify` | **Full Gate**: `hygiene` + `workflow:validate` + `build` + all 59 test suites |
| `bun run test` / `test:all` / `test:node` | Run all 59 test suites in parallel (`tests/run-all.ts`) |
| `bun run hygiene` / `audit:secrets` | Scan git index for credentials, personal paths, or leaks |
| `bun run typecheck` | Run `tsc --noEmit` |
| `bun run test:engine` \| `test:daily` \| `test:evaluator` \| `test:templates` \| `test:parser` | Targeted unit test suites |
