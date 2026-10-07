---
name: verification
description: "Use for verification setup or maintenance. Not for product implementation or acceptance."
---

<!-- clade-skill-scope: both -->

# Verification infrastructure

`verification` 是 consumer verification infrastructure 的統一入口：create 建立 `verify-<app>` skill 與 feature map 並實證一次閉環，maintain 對帳既有 feature map 並 live re-prove；只維護 verification infrastructure，不宣告產品驗收。

改編自 Lauren Tan 的 pstack `create-verification-skill`／`maintain-verification-skill`，授權見 `references/UPSTREAM.md`。

# SOP

## Phase 1 -- 判定 mode 與定位 target

1. READ 找 `<skills-root>/verify-*/SKILL.md`（`<skills-root>` 依 runtime：Claude `.claude/skills/`、Codex `.agents/skills/`；找不到該目錄就回報標準未送達，不猜一個）。
2. THINK 零個 → create（Phase 2）；一個且要更新或重跑 → maintain（Phase 5）；多個 → 請使用者指定，不靠名稱相似度猜。只收集 UI 截圖交 `/review` screenshot；implementation 與規格對帳讀 `specs/truth/**` 與該 work 的 carrier 自行對帳，動到規格回交 truth owner skill。

## Phase 2 -- create：訪談 repo

1. THINK 先讀取 `rules/repo訪談六欄判準.md`，從 repo 與實跑結果回答 Surface／Launch／Doctor／Drive／Observe／Isolate；不能 build 或 launch 就停下回報 baseline blocker。

## Phase 3 -- create：產生 verify skill 與 feature map

1. WRITE 先讀取 `rules/verify-skill產出判準.md`、`templates/verify-app.md` 與 `templates/verify-app.example.md`，在 canonical 位置寫 `<skills-root>/verify-<app>/SKILL.md`。
2. WRITE 先讀取 `rules/feature-map結構判準.md`、`templates/verification-map-README.md`、`templates/verification-map-README.example.md`、`templates/verification-feature.md` 與 `templates/verification-feature.example.md`，寫 `features/README.md` 與最重要的 3–5 個 feature。

## Phase 4 -- create：驗結構並實跑一次閉環

1. DELEGATE 執行 `node <skills-root>/verification/scripts/check-feature-map.mjs <skills-root>/verify-<app>`，exit 0 才往下；結構紅時只修 verification skill，不改產品 code 來迎合文件。
2. DELEGATE 實跑一次完整閉環 Launch → Doctor → Drive one mapped feature → Capture evidence → Cleanup；失敗 iteration 也 cleanup，最後確認 evidence 在 cleanup 後仍存在。
3. WRITE 先讀取 `rules/create完成證據判準.md`，逐格勾完成證據，交代 target、已實跑 feature、evidence path、unreachable prerequisites，並指出後續用 `/verification maintain`。

## Phase 5 -- maintain：驗索引與 source wave

1. DELEGATE 執行同一支 `node <skills-root>/verification/scripts/check-feature-map.mjs <skills-root>/verify-<app>`，修 missing／extra／duplicate／dead index entry；同時先讀取 `rules/維護編輯範圍判準.md` 確認可改範圍。
2. DELEGATE 先讀取 `rules/source-wave與對帳判準.md`，依 clade routing threshold 以 read-heavy prescan 收集每個 feature 的 source evidence，再依規則對帳。

## Phase 6 -- maintain：live pass、triage 與 re-prove

1. DELEGATE 先讀取 `rules/live-pass紀律判準.md`，依 target 的 Launch model 逐 feature drive。
2. THINK 依 `rules/維護編輯範圍判準.md` 把每個落差判成 doc drift／harness gap／product gap；修正後重跑受影響 feature。

## Phase 7 -- maintain：依 outcome 交付

1. THINK 先讀取 `rules/維護outcome判準.md`，選 clean／changed／blocked 其一並照其 Git／PR 行為收尾。
2. WRITE 先讀取 `templates/verification-maintenance-report.json` 與 `templates/verification-maintenance-report.example.json`，在 stdout 結尾輸出機讀報告。
