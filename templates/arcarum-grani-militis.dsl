# =========================================================================
# Workflow Template: Arcarum Sandbox - Grani Militis (Optimal Burst)
# Description: High-speed optimal burst Grani Militis battle loop (Zone Kalendae): Quick Call -> MC Augment/Buffs -> Attack -> Wait 350ms & Reload -> Fast Finish Loop -> Confirm Result
# =========================================================================

Name: Arcarum Sandbox - Grani Militis (Optimal Burst)
Description: High-speed optimal burst Grani Militis battle loop (Zone Kalendae): Quick Call -> MC Augment/Buffs -> Attack -> Wait 350ms & Reload -> Fast Finish Loop -> Confirm Result
Quest: https://game.granbluefantasy.jp/#replicard/supporter/7/7/16/816091/25/0/25076
Speed: fast
Runs: 500
Elixir: true
Berry: true

---
quick_call
skill 1 1
skill 1 2
attack
reload
repeat 5 {
  attack
  reload
}
confirm_result
