# =========================================================================
# Workflow Template: Arcarum Sandbox - Grani Militis (Fast 0-Button / Quick Summon)
# Description: Ultra-fast 0-button / 1-button Grani Militis OTK loop (Zone Kalendae): Quick Call -> Attack -> Wait 350ms & Reload -> Finish Loop -> Confirm Result
# =========================================================================

Name: Arcarum Sandbox - Grani Militis (Fast 0-Button / Quick Summon)
Description: Ultra-fast 0-button / 1-button Grani Militis OTK loop (Zone Kalendae): Quick Call -> Attack -> Wait 350ms & Reload -> Finish Loop -> Confirm Result
Quest: https://game.granbluefantasy.jp/#replicard/supporter/7/7/16/816091/25/0/25076
Speed: turbo
Runs: 500
Elixir: true
Berry: true

---
quick_call
attack
reload
repeat 3 {
  attack
  reload
}
confirm_result
