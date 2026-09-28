# Rise of the Beasts (ROTB) Automation Workflow

## 1. Overview & Objectives

**Rise of the Beasts** (*ROTB / 四象降臨*) is a recurring elemental event featuring four celestial beasts (Suzaku, Seiryu, Genbu, Baihu) and bonus Extreme+ / Shenxian raids (Agni, Zephyrus, Neptune, Titan, Shenxian).

This workflow automates the Earth celestial cycle:
1. **Baihu Extreme Farming (`rotb:baihu`)**: Repeatedly fights Baihu (Earth beast) consuming AP to farm badges, Four Treasures, and unlock Titan Extreme+ stock.
2. **Titan / Shenxian Extreme+ Raid (`rotb:earth`)**: When Baihu is defeated 9 times, Titan unlocks. The bot verifies available stock, selects supporter summons, and defeats Titan before resuming Baihu farming.

---

## 2. Quick Start CLI Commands

Run the ROTB routines from PowerShell:

```bash
# Farm Baihu on repeat (default: 9 runs)
npm run rotb:baihu

# Farm Baihu for a custom number of runs (e.g. 18 runs)
npm run rotb:baihu 18

# Run full cycle (9x Baihu -> 1x Titan)
npm run rotb:earth

# Run 3 full cycles of ROTB Earth
npm run rotb:earth 3
```

---

## 3. Baihu Repeat Routine (`rotb:baihu`)

Direct quest URL: `https://game.granbluefantasy.jp/#quest/supporter/711141/1`

### Execution Sequence:
1. **Safety Assert**: `SentinelWatchdog` checks for CAPTCHA/verification.
2. **Navigation**: Direct hash navigation to `#quest/supporter/711141/1`.
3. **Supporter Selection**: Selects first visible supporter summon (Wind/Omega/Primal).
4. **Party Confirmation**: Clicks Quest Start (`.btn-usual-ok.se-quest-start`).
5. **Combat Burst**: Clicks Quick Summon or Attack.
6. **Animation Skip**: Quick reload (F5) once attack resolves.
7. **Repeat**: Loops until the requested run count is achieved.

---

## 4. Titan Extreme+ Routine (`rotb:earth`)

Direct quest URL: `https://game.granbluefantasy.jp/#quest/supporter/711151/1`

### Cycle Logic:
1. Run Baihu **9 times**.
2. Navigate to Titan Extreme+ (`#quest/supporter/711151/1`).
3. **Stock Check**: Inspects if Titan is available (`Stock: 1` or higher). If unavailable or locked, skips and continues Baihu farming.
4. If available:
   - Selects supporter summon.
   - Confirms party.
   - Activates Full Auto (`.btn-auto`) or executes combat burst.
   - Waits for victory result screen.
   - Dismisses result dialogs and confirms win.
5. Resumes next Baihu cycle.

---

## 5. CAPTCHA & Sentinel Integration

As with all automation in this project, `SentinelWatchdog` guards every step. If Cygames issues an image challenge during rapid ROTB farming:
- The bot halts execution immediately.
- Never closes or refreshes the tab.
- Brings the browser window to the front.
- Emits audible beeps.
- Waits for manual completion by the human operator.
