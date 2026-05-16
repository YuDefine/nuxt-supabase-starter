<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# Proactive Skill Orchestra

所有 Spectra sub-skill 與 Design skill 應在適當情境下**主動調用**，不需使用者手動指定。此規則優先於個別 SKILL.md 的指示。

> 本檔是 trigger 主規則（無 frontmatter，每個 session 必載入）。詳細場景規約拆到 path-scoped reference：
>
> - 動 UI 檔（`app/**/*.vue` / `components/**` / `pages/**` / `layouts/**`）或寫 design artifact：[`proactive-skills.design-checkpoint.md`](./proactive-skills.design-checkpoint.md)
> - 寫 / 改 `openspec/changes/**` / `HANDOFF.md` / `docs/tech-debt.md` / `openspec/ROADMAP.md`：[`proactive-skills.ingest-triggers.md`](./proactive-skills.ingest-triggers.md)

## 原則

1. **診斷驅動**——先理解問題再選工具，不盲目跑所有 skill
2. **內建而非附加**——Design 是實作的一部分，不是完成後的美化步驟
3. **來源無關**——不論規格書來自 Notion、文件、對話或 plan file，流程一致
4. **自主但透明**——主動調用 skill 時簡要告知使用者正在做什麼

## Spectra Sub-skill 自主觸發

### Intake 階段

| 情境                                           | 觸發                                    | 說明                             |
| ---------------------------------------------- | --------------------------------------- | -------------------------------- |
| 收到需求，需求模糊或有多種解讀                 | `spectra-discuss`                       | 先討論釐清，再 propose           |
| 收到需求，需求明確                             | `spectra-propose`                       | 直接建立 change                  |
| 需求來源是外部文件（Notion URL、PDF、貼文）    | 先讀取內容 → `spectra-propose`          | 提取結構化需求後建立 change      |
| Proposal 建立完成                              | `spectra-analyze`                       | 自動檢查一致性（不等使用者要求） |
| Analyze 發現 Critical/Warning                  | 修復 → 再 `spectra-analyze`（max 2 輪） | 迴圈直到通過                     |
| Artifacts 有模糊用詞（TBD、矛盾、缺 scenario） | `spectra-clarify`                       | 逐項澄清                         |

### Implementation 階段

| 情境                         | 觸發              | 說明                       |
| ---------------------------- | ----------------- | -------------------------- |
| 準備開始或繼續實作           | `spectra-apply`   | 按 tasks 執行              |
| 實作中遇到非預期錯誤         | `spectra-debug`   | 四階段系統性排查           |
| 實作中發現 spec 有誤或過時   | `spectra-ingest`  | 更新 artifacts，不停下實作 |
| 架構決策點（多種做法都可行） | `spectra-discuss` | 記錄決策到 artifacts       |
| 需要確認現有規格內容         | `spectra-ask`     | 查詢而非猜測               |

### Completion 階段

| 情境                                                  | 觸發              | 說明                                  |
| ----------------------------------------------------- | ----------------- | ------------------------------------- |
| 所有 tasks 完成 + 人工檢查通過                        | `spectra-archive` | 最終歸檔                              |
| Archive 完成 + change 有 UI（design review findings） | `design-retro`    | 分析 findings、識別重複模式、建議改善 |
| Findings 累積達 5 的倍數（5、10、15…）                | `design-retro`    | 週期性全量分析                        |

### Sub-skill 禁用清單（永不觸發）

| Sub-skill        | 規則                | 替代方式                                                              |
| ---------------- | ------------------- | --------------------------------------------------------------------- |
| `spectra-commit` | **NEVER** 主動觸發  | 走 `rules/core/commit.md` 規範的標準 commit 工序（含 hooks / 訊息格式） |

**原因**：spectra-commit 是 spectra CLI 上游帶來的薄殼，本治理範圍下 commit 必須統一走 `rules/core/commit.md`。Claude 偵測到使用者要 commit Spectra change 的相關檔案時，**MUST** 直接走標準 git / `/commit` 流程，**NEVER** 改派 spectra-commit。

## Scope Discipline

所有 spectra / design workflow 都受以下規則約束：

- 範圍外檔案不要順手改
- 途中發現其他問題：**不修，但必登記**
- 未知變更先回報，不得自行清場
- 不得在 subagent 內執行 `git reset --hard` / `git checkout --` / `git clean`

登記出口：

- 技術債 → `docs/tech-debt.md` + `@followup[TD-NNN]`
- 當前 session 未完 → `HANDOFF.md`
- 未來工作 → `openspec/ROADMAP.md`
- change 漏項 → `spectra-ingest`
- 架構決策 → `docs/decisions/**`

## Handoff Hygiene

符合以下情況，**MUST** 建立或更新 `HANDOFF.md`：

- session 結束時仍有 active change
- 有未 commit 的 WIP
- 有 blocker 需要下一個 session 接手
- 工作移交給其他 agent / runtime

`HANDOFF.md` 應至少記錄：

- 正在做什麼（change / task / 檔案）
- 卡在哪裡
- 下一步按優先序怎麼走
- 哪些項目仍**尚未被接手**

一旦下一個 session 接手：

1. 先建立 claim
2. 再從 `HANDOFF.md` 移除對應項目
3. 若已空，刪除 `HANDOFF.md`

## Manual Review

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

**MUST** 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作就是引導使用者跑 `pnpm review:ui`**——本地 GUI、不燒 chat token、自動依 `#N` / `#N.M` 檔名配對截圖、可鍵盤完成 OK / Issue / SKIP，並 conflict-aware 寫回 tasks.md。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框走人工檢查——那是 `pnpm review:ui` 不可用時的 fallback，不是 default path。

正確流程：

1. **首選（DEFAULT）**：tasks.md 仍有 `## 人工檢查` 未勾項 → 主線回「請在**該 change 所在的 worktree root** 執行 `pnpm review:ui` 開本地 GUI 驗收」（**MUST** 給絕對路徑，例 `cd /Users/charles/offline/perno-wt/<slug>`，不要寫成「consumer repo root」這種對 worktree workflow 會誤導的措辭——main worktree 沒有該 change 的 `openspec/changes/<name>/` 與 `screenshots/local/<name>/`，跑了會看不到任何項目），等使用者跑完 GUI 流程回報後繼續
2. **Fallback**（GUI 不可用時）：截圖 → 逐項展示 → 使用者回覆 OK / 問題 / skip → 依答覆更新 checkbox

GUI 不可用的具體情境（觸發 fallback 的條件）：

- Consumer 沒有 `pnpm review:ui` script（先建議跑 `pnpm hub:check` 或從 clade propagate 補上）
- 使用者明確說「不要開 GUI，直接在 chat 走」
- Pure backend change 完全無 UI 證據需求，且只剩 1–2 項 yes/no 確認

### Inline Review-GUI Deep-Link（hard rule）

引導使用者跑 `pnpm review:ui` 時，**MUST** 在 chat 訊息中**直接給出 review-gui 本身的 deep-link URL**，讓使用者啟動 GUI 後可以一鍵跳到該 change 頁面，不必再從左側 list 點選。

review-gui SPA 路由規約：

```
http://127.0.0.1:5174/review/<change-name>
```

- port `5174` 是 `vendor/scripts/review-gui.mts` `DEFAULT_PORT` (見 review-gui.mts:21)；找不到 port 時會 fallback 到 5174-5194 之間
- host 預設 bind `127.0.0.1`（見 review-gui.mts:4452）。**MUST** 用 `127.0.0.1` 不要用 `localhost` — 某些 user 端 `/etc/hosts` / DNS 配置 `localhost` 不解析到 `127.0.0.1`，會出現「無法存取」
- `<change-name>` 一字不差等於 `openspec/changes/<change-name>/` 的目錄名
- 例：`http://localhost:5174/review/ehr-performance-evaluation-m1`

#### 訊息格式（必須照這個 shape）

```
請在該 change 所在的 worktree root 執行 `pnpm review:ui` 開本地 GUI 驗收：

  cd <change-worktree-absolute-path>
  pnpm review:ui

GUI 啟動後直接打開：

  http://127.0.0.1:5174/review/<change-name>

GUI 會自動：
- 配對 `screenshots/local/<change-name>/#<N>-*.png` 到對應 item
- conflict-aware 寫回 tasks.md
- 對 `[verify:e2e]` / `[verify:api]` automatic-only items 自動勾 `[x]`
- 對 `[verify:ui]` / `[review:ui]` items 顯示 evidence + OK / Issue / Skip 按鈕

完成後回報，我繼續下一步。
```

#### cwd 必須是 change 所在的 worktree（不是 main repo）

per [[worktree-default]] §1，會寫 tracked code 的 spectra-apply 跑在 isolated worktree。Change 的 `openspec/changes/<name>/tasks.md` 與 `screenshots/local/<name>/` 只存在於這個 worktree，main repo（`~/offline/<consumer>/`）的對應目錄看不到。

**MUST**：

- 給使用者**完整絕對路徑**（從 `git rev-parse --git-dir` 解出 `.git/worktrees/<slug>` 父目錄的工作樹路徑，或從 `node scripts/wt-helper.mjs list --json` 抓對應 slug 的 `path`）
- 訊息開頭明寫「該 change 所在的 worktree root」，不要寫「consumer repo root」「專案根目錄」這類對 worktree workflow 模糊的措辭

**NEVER**：

- 寫「consumer repo root」當預設措辭——使用者開新 terminal 時常會落在 main worktree，跑了會空畫面
- 假設使用者已經在對的 cwd——絕對路徑寫進訊息成本極低、收益明顯

#### 不該列的東西

- **NEVER** 列 dev server URL（`http://localhost:3040/admin/...`）當「先 sanity check 用」—— review-gui 內部已經自帶 final-state screenshot + evidence，user 不需要自己再開分頁去看 dev server；列那一堆 URL 反而把 chat 變成 dev server route 列表，模糊掉 review-gui 是真正的驗收入口
- **NEVER** 把 review-gui deep-link 寫成 `/review/<change-name>` 不加 host — 使用者拿到 path 還要自己 prepend `http://localhost:5174` 才能用
- **NEVER** 把 port 寫成 placeholder `<port>` — 直接寫 `5174`（fallback 由 GUI startup banner 告知 user，主線不負責猜）
- **NEVER** 在訊息末尾加「需要的話可以參考」「也可以打開 dev server 看」這類弱措辭——review-gui 就是入口，不需要替代方案

#### Counter-examples

- ❌ 「請跑 `pnpm review:ui`」結束（沒給 deep-link，user 要從 GUI list 自己找 change）
- ❌ 「URL 在 GUI 裡」推給 GUI 顯示
- ❌ 列一堆 `http://localhost:3040/admin/X` dev server URL（user 要看的是 review-gui，不是 dev server）
- ❌ 寫 `/review/<change-name>` 不加 `http://localhost:5174`

#### 例外：fallback 模式

只有當 `pnpm review:ui` 不可用（consumer 沒這 script / user 明確拒絕 GUI / pure backend 完全無 UI 證據），才轉走 chat-based 逐項展示，那時才會用到 dev server URL 給 user。預設路徑（DEFAULT path）只給 review-gui deep-link。

靜態 screenshot review 是證據，不等同於使用者驗收。詳細 marker / flow / kind 分類見 `manual-review.md` 與其 reference 檔。

## Review Tiers

依變更風險決定 review 強度：

- Tier 1：小型低風險變更 → self-review
- Tier 2：中型以上功能變更 → `spectra-audit` + code review
- Tier 3：migration / auth / permission / raw SQL / security-critical → 更嚴格 review

不要因為 diff 短就把高風險變更降級。

## Screenshot Strategy

截圖工具選擇原則：

- 一次性探索、人工檢查、設計驗收 → `browser-harness` 優先（CDP 連使用者已開的 Chrome，繼承登入 cookie）
- 響應式、多 viewport、跨瀏覽器、多分頁、要沉澱回歸 → Playwright

同一組截圖重拍到第 3 次，應考慮沉澱為 Playwright spec。

## Knowledge And Decisions

碰到非直覺問題或 workaround，任務結束時應評估沉澱到 `docs/solutions/**`。
做出跨任務的技術取捨時，應評估寫 ADR 到 `docs/decisions/**`。
