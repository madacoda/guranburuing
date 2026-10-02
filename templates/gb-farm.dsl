# =========================================================================
# Workflow Template: GB Farm - Multi-Raid Rotator
# Description: Multi-Raid Gold Bar rotation across PBHL (Slot 4), Akasha (Slot 3), and Grand Order HL (Slot 2): Quick Call -> C4S3 -> C4S2 -> C3S1 -> C2S1 -> Attack -> Reload -> Summon 2 -> Attack -> Loop Reload+Attack until honor reached
# =========================================================================

Name: GB Farm - Multi-Raid Rotator
Description: Multi-Raid Gold Bar rotation across PBHL (Slot 4), Akasha (Slot 3), and Grand Order HL (Slot 2): Quick Call -> C4S3 -> C4S2 -> C3S1 -> C2S1 -> Attack -> Reload -> Summon 2 -> Attack -> Loop Reload+Attack until honor reached
Mode: combat
Quest: https://game.granbluefantasy.jp/#quest/assist
Speed: fast
Runs: 500
Supporters: Hades, Bahamut, Zeus, Lucifer, Kaguya
Slots: 4, 3, 2
TargetScore: 1680000
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
  exit_if_score 1480000
  attack
}
reload
confirm_result
---