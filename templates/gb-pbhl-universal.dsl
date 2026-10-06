# =========================================================================
# Workflow Template: GB Farm - Proto Bahamut HL (Universal)
# Description: PBHL Gold Bar 5-turn speed burst with minimum honor guard: C4S3 -> Reload -> Tap Ready -> Reload -> Tap Ready -> Reload -> Tap Ready -> Reload -> Tap Ready -> Summon 2 -> Reload -> Tap Ready -> Repeat if <1.5M -> Done
# =========================================================================

Name: GB Farm - Proto Bahamut HL (Universal)
Description: PBHL Gold Bar 5-turn speed burst with minimum honor guard: C4S3 -> Reload -> Tap Ready -> Reload -> Tap Ready -> Reload -> Tap Ready -> Reload -> Tap Ready -> Summon 2 -> Reload -> Tap Ready -> Repeat if <1.5M -> Done
Mode: combat
Quest: https://game.granbluefantasy.jp/#quest/assist
Speed: fast
Runs: 1000
Supporters: Agni, Bahamut, Shiva, Michael
Slots: 4
TargetScore: 1500000
LogPath: logs/gb-pbhl.md
Elixir: false
Berry: true

---
char 4 skill 3
reload
tap the ready
reload
tap the ready
reload
tap the ready
reload
tap the ready
reload
tap the ready
summon number 2
reload
tap the ready
repeat 15 {
  exit_if_score 1500000
  reload
  tap the ready
}
done
---
