# =========================================================================
# Workflow Template: Fate Stories Auto-Farmer
# Description: Universal Fate Episode Automation Routine: Navigates to #quest/fate, selects unread character fate episodes, fast-skips dialogues, handles combat with Full Auto, collects rewards, and loops N times
# =========================================================================

Name: Fate Stories Auto-Farmer
Description: Universal Fate Episode Automation Routine: Navigates to #quest/fate, selects unread character fate episodes, fast-skips dialogues, handles combat with Full Auto, collects rewards, and loops N times
Mode: routine
Quest: https://game.granbluefantasy.jp/#quest/fate
Speed: fast
Runs: 5
Supporters: Zeus, Lucifer, Hades, Bahamut
Elixir: true
Berry: true

---
navigate https://game.granbluefantasy.jp/#quest/fate
wait_element .btn-quest-list.fate, .prt-list-contents, .cnt-quest-scene, .prt-null-quest, .prt-no-quest
loop_while .prt-fate-list .btn-quest-list.fate, .btn-quest-list.fate, .prt-fate-list .prt-list-contents:not(.is-cleared) {
  click .prt-fate-list .btn-quest-list.fate, .btn-quest-list.fate, .prt-list-contents:not(.is-cleared)
  click .pop-synopsis .btn-scene-skip, .pop-synopsis .btn-usual-ok, .btn-usual-ok.se-quest-start, .pop-usual .btn-usual-ok
  skip_story_scene
  full_auto
  confirm_result
  dismiss_popups
  navigate https://game.granbluefantasy.jp/#quest/fate
  wait_element .btn-quest-list.fate, .prt-list-contents, .cnt-quest-scene, .prt-null-quest, .prt-no-quest
}
navigate https://game.granbluefantasy.jp/#mypage
dismiss_popups
---