# =========================================================================
# Workflow Template: Daily Favorites Pro Skips
# Description: Universal Daily Automation Routine: Navigates to #quest, executes all uncleared Pro Skips pinned in Favorites, replenishes AP if needed, and returns to #mypage
# =========================================================================

Name: Daily Favorites Pro Skips
Description: Universal Daily Automation Routine: Navigates to #quest, executes all uncleared Pro Skips pinned in Favorites, replenishes AP if needed, and returns to #mypage
Mode: routine
Quest: https://game.granbluefantasy.jp/#quest
Speed: fast
Runs: 1
Supporters: Zeus, Lucifer, Hades, Bahamut
Elixir: true
Berry: true

---
navigate https://game.granbluefantasy.jp/#quest/index
wait_element .prt-noindex-list
pro_skip_favorites
dismiss_popups
navigate https://game.granbluefantasy.jp/#mypage
wait_element .cnt-mypage, .prt-user-info
dismiss_popups
---