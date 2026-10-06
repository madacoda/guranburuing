# =========================================================================
# Workflow Template: Arcarum Sandbox - The World
# Description: High-speed The World battle loop (Zone Mundus): Quick Call -> MC & Frontline Skills -> Attack -> Wait & Reload (Animation Skip) -> Multi-Turn Fast Attack/Reload Loop -> Confirm Result
# =========================================================================

Name: Arcarum Sandbox - The World
Description: High-speed The World battle loop (Zone Mundus): Quick Call -> MC & Frontline Skills -> Attack -> Wait & Reload (Animation Skip) -> Multi-Turn Fast Attack/Reload Loop -> Confirm Result
Quest: https://game.granbluefantasy.jp/#replicard/supporter/10/10/16/819131/25/0/25085
Speed: fast
Runs: 500
Elixir: true
Berry: true

---
quick_call
c1s1
c1s2
c2s1
c3s1
c4s1
attack 350
reload
repeat 15 {
  attack
  reload
}
confirm_result
