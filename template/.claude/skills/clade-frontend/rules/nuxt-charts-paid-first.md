---
description: Nuxt 專案做圖表、dashboard、KPI／統計卡、狀態頁、定價表、帳號頁類 UI 時，先載入 nuxt-charts skill 用 fleet 已購的 Full Access block／template，再交其他 UI skill
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'layouts/**/*.vue', 'packages/*/layouts/**/*.vue', 'layers/*/app/**/*.vue']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/nuxt-charts-paid-first.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Nuxt Charts 付費資產優先

fleet 持有 Nuxt Charts Commercial License（All Access）：nuxtcharts.com 的全部 block（2026-10-23 共 135 個）與 template 都已付費，全收在 PRIVATE 鏡像 `YuDefine/nuxt-charts-assets`。`impeccable`、`nuxt-ui`、`dataviz` 不知道這份授權，照它們的 SOP 會直接從 Nuxt UI 元件或從零畫。

- **MUST**：新增或重做圖表、dashboard、總覽／監控頁、KPI／統計卡、狀態頁、行事曆、定價表、帳號／使用者頁、onboarding、檔案上傳或 heatmap 時，**每一類**都在任何 UI skill 出設計、寫元件之前，先叫用 `nuxt-charts` skill 跑完它的 Phase 1–2（版本判定、從鏡像查 block 與 template；版本不對而停下時也要先唯讀查完）。查到可用的 block／template 就以它為底，impeccable／nuxt-ui／dataviz 只負責之後的修改與審查：它們的 SOP 要求從零設計版面或自訂調色盤時，以 `nuxt-charts` 選定的底稿與它的 `rules/圖表配色與無障礙判準.md` 為準。
- 例外：畫面裡**不畫圖**（定價表、帳號頁、onboarding、檔案上傳、純 KPI 卡片等）且專案還沒裝 `nuxt-charts` 時，只照 Phase 2 從鏡像查 block 與 template 當版面底稿，**NEVER** 為此安裝 `nuxt-charts` 套件；要畫圖才照 Phase 1 裝 v3。
- **NEVER** 只讀 nuxtcharts.com 的公開 docs 就手刻這類 UI；自組只在 `nuxt-charts` skill 判定「沒有合用的」之後，並照該 skill 寫來源註記。
- 專案沒有 `nuxt-charts` skill 投影（`.claude/skills/nuxt-charts/` 不存在）時，停下回報「缺 nuxt-charts 投影」，不要改用其他 skill 繞過。
