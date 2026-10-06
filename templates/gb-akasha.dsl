# =========================================================================
# Workflow Template: GB Farm - Akasha HL
# Description: Akasha Gold Bar rotation: Summon Hades -> Quick Call -> C2S1 -> C3S1 -> Attack -> Reload -> Attack -> Honor Guard Loop
# =========================================================================

Name: GB Farm - Akasha HL
Description: Akasha Gold Bar rotation: Summon Hades -> Quick Call -> C2S1 -> C3S1 -> Attack -> Reload -> Attack -> Honor Guard Loop
Mode: combat
Quest: https://game.granbluefantasy.jp/#quest/assist
Speed: turbo
Runs: 500
Supporters: Hades, Bahamut
Slots: 3
TargetScore: 1430000
LogPath: logs/gb-akasha.md
Elixir: false
Berry: true

---
summon hades
quick_call
c2s1
c3s1
attack
reload
attack
repeat 10 {
  reload
  exit_if_score 1430000
  attack
}
reload
confirm_result
---