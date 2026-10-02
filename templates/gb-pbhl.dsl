# =========================================================================
# Workflow Template: GB Farm - Proto Bahamut HL
# Description: PBHL Gold Bar rotation: Quick Call -> C4S3 -> C4S2 -> C3S1 -> C2S1 -> Attack -> Reload -> Summon 2 -> Attack -> Loop Reload+Attack until honor reached
# =========================================================================

Name: GB Farm - Proto Bahamut HL
Description: PBHL Gold Bar rotation: Quick Call -> C4S3 -> C4S2 -> C3S1 -> C2S1 -> Attack -> Reload -> Summon 2 -> Attack -> Loop Reload+Attack until honor reached
Mode: combat
Quest: https://game.granbluefantasy.jp/#quest/assist
Speed: fast
Runs: 1000
Supporters: Hades, Bahamut
Slots: 4
TargetScore: 1800000
Elixir: false
Berry: true

---
quick_call
c4s3
c4s2
c3s1
c2s1
attack
reload
summon 2
attack
repeat 10 {
  reload
  exit_if_score 1800000
  attack
}
reload
confirm_result
---