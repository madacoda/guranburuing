# =========================================================================
# Workflow Template: Arcarum Sandbox - Athena Militis
# Description: High-speed Athena Militis battle loop (Zone Kalendae): Quick Call -> MC & Frontline Skills -> Attack -> Wait & Reload (Animation Skip) -> Multi-Turn Fast Attack/Reload Loop -> Confirm Result
# =========================================================================

Name: Arcarum Sandbox - Athena Militis
Description: High-speed Athena Militis battle loop (Zone Kalendae): Quick Call -> MC & Frontline Skills -> Attack -> Wait & Reload (Animation Skip) -> Multi-Turn Fast Attack/Reload Loop -> Confirm Result
Quest: https://game.granbluefantasy.jp/#replicard/supporter/6/6/16/815091/25/0/25075
Speed: fast
Runs: 500
Elixir: true
Berry: true

---
quick_call
skill 1 1
skill 1 2
skill 2 1
skill 3 1
skill 4 1
attack
reload
repeat 15 {
  attack
  reload
}
confirm_result
