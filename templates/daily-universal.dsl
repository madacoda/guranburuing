# =========================================================================
# Workflow Template: daily-universal
# Description: Universal Daily Automation Routine across all GBF daily sectors
# =========================================================================

Name: Universal Daily Routine
Description: Executes daily Pro Skips (Hard, Magna, Manacura, Primal, Regalia, Halo, Primarch, Showdown, Clash, Dragon, Eternals, Ennead), Rupie Gacha, Skyscope Missions, and Casino Exchange until all are finished
Mode: routine
Quest: https://game.granbluefantasy.jp/#quest/extra
Speed: fast
Runs: 1
Elixir: true
Berry: true

---
# 1. Extra Quests: Daily Pro Skips
navigate https://game.granbluefantasy.jp/#quest/extra
do_until_finish daily_hard_pro
do_until_finish daily_magna_pro
do_until_finish daily_manacura_pro
do_until_finish daily_primal_pro
do_until_finish daily_regalia_pro
do_until_finish daily_halo_pro
do_until_finish daily_primarch_pro
do_until_finish daily_showdown_pro
do_until_finish daily_clash_pro
do_until_finish daily_dragon_pro
do_until_finish daily_eternals_pro
do_until_finish daily_ennead_pro

# 2. Free Daily Rupie Gacha (100 Summons)
navigate https://game.granbluefantasy.jp/#gacha/normal
do_until_finish daily_rupie

# 3. Skyscope Daily Mission Claims
navigate https://game.granbluefantasy.jp/#mission
do_until_finish daily_skyscope

# 4. Casino Daily Recovery Items Exchange
navigate https://game.granbluefantasy.jp/#casino/exchange
do_until_finish daily_casino

# 5. Clean Final State & Popups Dismissal
dismiss_popups
---
