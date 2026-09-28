# Daily Quest Automation Workflow (Pro Skips)

## 1. Overview
Granblue Fantasy features daily "Pro Skip" quests (**Hard Pro**, **Magna Pro**, **Manacura Pro**, **Angel Halo Pro**) that instantly consume AP and simulate multiple quest clears in a single click, yielding all daily materials, magnas, and EXP.

This workflow explains how to automatically execute daily Pro Skips either via:
1. **Direct Terminal Command (1-Click CLI)** — for instant automated execution on your desktop.
2. **Mobile Companion PWA (Remote Control)** — for triggering and monitoring from your phone while away from home.

---

## 2. Prerequisites: Launching Chrome with CDP

Because modern Google Chrome (v136+) enforces strict security sandboxing, Chrome must be launched with remote debugging enabled using the project launcher:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launch-gbf-chrome.ps1
```

- This automatically initializes a dedicated profile cloned from your designated Chromium profile.
- It binds Chrome DevTools Protocol to **port 9222**.
- Chrome opens with Granblue Fantasy loaded at `#mypage`.

---

## 3. Method A: Direct CLI Execution (Fastest)

To run the daily skips directly from your terminal:

### Run All Dailies (Magna Pro + Hard Pro):
```bash
bun run daily
# or: npm run daily
```

### Run Magna Pro Skip Only:
```bash
bun run daily:magna
# or: npm run daily:magna
```

### Run Hard Pro Skip Only:
```bash
bun run daily:hard
# or: npm run daily:hard
```

### What happens automatically under the hood:
1. **Safety Assert**: `SentinelWatchdog` checks for any active CAPTCHA or verification challenge.
2. **Navigation**: Page navigates smoothly to `#quest/extra`.
3. **Status Check**: Checks if today's skip is already done (`0/1` or `1/1`).
4. **AP Replenishment**: If AP is insufficient, automatically opens the AP recovery dialog, selects Half-Elixir, and confirms item use.
5. **Human Motor Action**: Uses natural cubic Bézier mouse movement with 2D Gaussian jitter to click the Pro Skip button and confirm dialogs.
6. **Pop-up Dismissal Loop**: Automatically closes sequential pop-ups (Loot summary, EXP, Level Up, Rank Up, Inventory notices).
7. **Clean Return**: Returns to `#mypage` in a clean, idle state.

---

## 4. Method B: Remote Control via Mobile Companion PWA

If you are away from your PC and want to trigger dailies from your phone:

### Step 1: Start the Remote Gateway Daemon on Desktop
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1
# or:
bun run start
```
The server will boot and display:
```
[Gateway] Fastify server running on http://0.0.0.0:3000
```

### Step 2: Open Mobile Companion
On your phone (connected via local Wi-Fi or Tailscale VPN), open:
```
http://<YOUR_PC_IP>:3000/?token=your-secure-random-bearer-token
```
*(Tip: Tap **Share** -> **Add to Home Screen** on your phone to run it as a fullscreen app).*

### Step 3: Trigger Daily Pro Skips
1. Look at the live stream window at the top of your mobile screen.
2. Under **Daily Pro Skips**, tap:
   - **⚡ Magna Pro** to run Magna Pro.
   - **⚔️ Hard Pro** to run Hard Pro.
   - **🌟 All Skips** to run both sequentially.
3. The status badge will switch to `STATUS: BUSY` (Async Mutex prevents accidental double-clicking).
4. Watch the desktop browser execute the skips in real-time through the low-latency WebP/JPEG screencast.
5. Once finished, the status badge returns to `SENTINEL: ARMED`.

---

## 5. Emergency Stop & CAPTCHA Safety

- If a CAPTCHA appears at any point, the Sentinel Watchdog immediately hard-freezes all actions, prevents any clicks, plays an audible emergency alarm on your phone, and dispatches a screenshot alert to Telegram/Discord.
- If you ever need to halt automation immediately, tap the red **🛑 EMERGENCY STOP ALL AUTOMATION** button on your companion. The browser will immediately abort and redirect to `#mypage`.


---

## 6. Daily Quests Matrix & Architecture (Dynamic Favorites Auto-Skip)

### 6.1 Core Mechanism: `.prt-noindex-list` on `#quest`
In Granblue Fantasy, daily quests pinned by the player appear in the favorites container on `https://game.granbluefantasy.jp/#quest`:
- **Parent Container**: `.prt-noindex-list`
- **List Items**: `.prt-list-contents`
- **Pro Skip Filter**: `[data-pro-quest-skip="true"]`

#### How the Dynamic Queue Works:
1. All pinned quests with available Pro Skips are positioned at the top of `.prt-noindex-list` with `data-pro-quest-skip="true"`.
2. The engine targets the **first available quest** matching `.prt-noindex-list .prt-list-contents [data-pro-quest-skip="true"]`.
3. Clicking the card directly opens the Pro Skip confirmation modal (`.pop-pro-quest-skip .btn-usual-ok, .btn-usual-ok[data-chapter-name*="Pro"], .btn-usual-ok[data-type="28"]`).
4. Once cleared, GBF automatically removes the finished quest from `.prt-noindex-list`.
5. The next Pro Skip quest immediately moves up into position #1.
6. The engine repeats this cycle until no cards with `data-pro-quest-skip="true"` remain in `.prt-noindex-list`, then safely returns to `#mypage`.

---

### 6.2 Identified Daily Pro Skip Targets

#### Daily Target 01: Omega (Impossible) — Tiamat Omega (Impossible) Pro
- **Quest Name**: `Tiamat Omega (Impossible)` / `Omega (Impossible)`
- **Pro Chapter ID (`data-pro-chapter-id`)**: `30546`
- **Pro Quest ID (`data-quest-id`)**: `305461`
- **AP Cost**: `180 AP` (batch clears all 6 Magna HL battles)
- **Modal Confirmation**:
  ```html
  <div class="btn-usual-ok" data-quest-id="305461" data-type="28" data-ap="180" data-chapter-id="30546" data-chapter-name="Omega (Impossible) Pro" data-is-pair-quest="false" data-is-use-treasure="true" data-is-stock-max="false"></div>
  ```

#### Daily Target 02: Shiva (Impossible) — Regalia Pro (Magna 2 Pro)
- **Quest Name**: `Shiva (Impossible)`
- **Pro Chapter ID (`data-pro-chapter-id`)**: `30556`
- **Pro Quest ID (`data-quest-id`)**: `305561`
- **AP Cost**: `270 AP` (batch clears all 6 Regalia / M2 raids 3 times)
- **Modal Header**: `Regalia Pro`
- **Modal Confirmation**:
  ```html
  <div class="btn-usual-ok" data-quest-id="305561" data-type="28" data-ap="270" data-chapter-id="30556" data-chapter-name="Regalia Pro" data-is-pair-quest="true" data-is-use-treasure="true" data-is-stock-max="false"></div>
  ```

#### Daily Target 03: Athena Showdown — Summon / Genesis Pro
- **Quest Name**: `Athena Showdown`
- **Pro Chapter ID (`data-pro-chapter-id`)**: `30547`
- **Pro Quest ID (`data-quest-id`)**: `301071`
- **AP Cost**: `180 AP` (batch clears all Tier 1 Summon battles)

#### Daily Target 04: Level 75 Ifrit — Manacura Pro (Showdown Pro)
- **Quest Name**: `Level 75 Ifrit`
- **Pro Chapter ID (`data-pro-chapter-id`)**: `10395`
- **Pro Quest ID (`data-quest-id`)**: `500611`
- **AP Cost**: `90 AP` (batch clears all 6 Showdown battles)

#### Daily Target 05: Level 80 Xeno Ifrit — Xeno Pro
- **Quest Name**: `Level 80 Xeno Ifrit`
- **Pro Chapter ID (`data-pro-chapter-id`)**: `10399`
- **AP Cost**: `180 AP` (batch clears all 6 Xeno clashes)

#### Daily Target 06: Level 80 Michael — Primarch Pro
- **Quest Name**: `Level 80 Michael`
- **Pro Chapter ID (`data-pro-chapter-id`)**: `10408`
- **AP Cost**: `80 AP` (batch clears all 4 Primarch trials)

#### Daily Target 07: Six-Dragon Advent — Six Dragons Pro
- **Quest Name**: `Six-Dragon Advent: Vermillion`
- **Pro Chapter ID (`data-pro-chapter-id`)**: `10411`
- **AP Cost**: `480 AP` (batch clears all 6 Six Dragon trials)

---

### 6.3 Execution State Machine Flow
1. **Navigate to Route**: Ensure page is at `https://game.granbluefantasy.jp/#quest`.
2. **Scan Queue**: Query `.prt-noindex-list .prt-list-contents [data-pro-quest-skip="true"]`.
   - If empty: All daily Pro Skips in favorites are completed (`ALREADY_CLEARED`) $\rightarrow$ Return to `#mypage`.
3. **Inspect Target Metadata**:
   - Extract `data-quest-name`, `data-pro-chapter-id`, and `data-limited_count`.
4. **Click Card Directly**:
   - Natural cubic Bézier mouse path to card center with Gaussian jitter.
5. **Dismiss Synopsis Modal** (if present):
   - Some raids show `.pop-synopsis` $\rightarrow$ click `.btn-usual-ok`.
6. **Confirm Pro Skip**:
   - Wait for `.pop-pro-quest-skip .btn-usual-ok, .btn-usual-ok[data-chapter-name*="Pro"]`.
   - Read AP cost and confirm skip.
7. **AP Recovery Handling**:
   - If AP is deficient, automatically select Half-Elixir and confirm item use.
8. **Dismiss Rewards Loop**:
   - Sequentially close all reward summary, EXP, and rank dialogs (`dismissAllPopups(5)`).
9. **Dynamic Shift & Repeat**:
   - Allow GBF to remove cleared card from `.prt-noindex-list`.
   - Next pro skip becomes position #1 $\rightarrow$ repeat step 2.
10. **Clean Exit**:
    - Redirect to `https://game.granbluefantasy.jp/#mypage`.
