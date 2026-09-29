# Workflow Template: Event Story Auto-Clear Routine
# Description: Autonomous Scenario Event Routine (Farewell, Cold Heart - treasureraid177): Navigates to event top, detects unread story episodes, fast-skips dialogues, enables Full Auto on combat, dismisses reward popups, and loops until story completion

Name: Event Story Auto-Clear Routine
Description: Autonomous Scenario Event Routine (Farewell, Cold Heart - treasureraid177): Navigates to event top, detects unread story episodes, fast-skips dialogues, enables Full Auto on combat, dismisses reward popups, and loops until story completion
Mode: routine
Quest: https://game.granbluefantasy.jp/#event/treasureraid177
Speed: fast
HumanMotor: true
StopOnCaptcha: true
AutoElixir: true
Runs: 40

navigate https://game.granbluefantasy.jp/#event/treasureraid177
wait_element .prt-main-quest, .cnt-quest.treasureraid, .btn-quest-list, .prt-event-quest
loop_while .btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list.main {
  click .btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list.main
  click .pop-synopsis .btn-scene-skip, .pop-synopsis .btn-usual-ok, .btn-scene-skip, .btn-usual-ok.se-quest-start, .pop-usual .btn-usual-ok
  skip_story_scene
  auto full
  confirm_result
  dismiss_popups
  navigate https://game.granbluefantasy.jp/#event/treasureraid177
  wait_element .prt-main-quest, .cnt-quest.treasureraid, .btn-quest-list, .prt-event-quest
}
navigate https://game.granbluefantasy.jp/#mypage
dismiss_popups
