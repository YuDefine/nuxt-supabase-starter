<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.md
Edit at: <clade-central-repo>
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

1. **首選（DEFAULT）**：tasks.md 仍有 `## 人工檢查` 未勾項 → 主線回「從 **clade home**（`~/offline/clade`）執行 `pnpm review:ui` 開本地 GUI 驗收」（review-gui 讀 `consumers.local` 自動聚合所有 consumer + 各 consumer 的 worktree，每條帶 `<consumer>__<wt-slug>` rootId namespace；consumer 端直接跑 `pnpm review:ui` 會被 clade-only guard 擋下並提示改去 clade home），等使用者跑完 GUI 流程回報後繼續
2. **Fallback**（GUI 不可用時）：截圖 → 逐項展示 → 使用者回覆 OK / 問題 / skip → 依答覆更新 checkbox

GUI 不可用的具體情境（觸發 fallback 的條件）：

- 使用者 clade home 不存在 / 不可達（極少見；clade central repo 是中央倉一定要 clone）
- 使用者明確說「不要開 GUI，直接在 chat 走」
- Pure backend change 完全無 UI 證據需求，且只剩 1–2 項 yes/no 確認

### `[discuss]` items 不在 review:ui 主流程

`[discuss]` items（production 授權 / 商業判斷 / production 觀察類）**MUST** 由 `/spectra-archive` Step 2.5 walkthrough 接管，**NEVER** 在 review:ui 引導流程內處理。理由：trigger 條件是外部 signal（deploy / soak / 商業決策），Claude 提前分析只能回「等外部 signal」、tasks.md 無更新、change 永遠卡在 review:ui pending state。

review-gui home page 對純 D-only pending（I=0、V=0、evidenceMissing=0、只剩 `[discuss]`）的 change 會自動歸到「🗓 等 archive walkthrough」群、**無**接手 prompt 按鈕。引導使用者的對應動作：

- 該 change 落「🗓 等 archive walkthrough」群 → 直接告知「跑 `/spectra-archive <change>` 觸發 Step 2.5 walkthrough，Claude 會主動準備證據與你討論」
- 該 change 落「🤖 等 Claude 接手」群（仍含 I 或 V）→ 接手 prompt 仍可用，但 prompt 對 (D) 部分**只列 walkthrough trigger，不分析、不寫 (claude-discussed:) annotation**；(D) 仍由 archive walkthrough 接管

詳細 scope rule 見 [`manual-review.md`](./manual-review.md) § Item Kind Marker `[discuss]` 段。

### Inline Review-GUI Deep-Link（hard rule）

引導使用者跑 `pnpm review:ui` 時，**MUST** 在 chat 訊息中**直接給出 review-gui 本身的 deep-link URL**，讓使用者啟動 GUI 後可以一鍵跳到該 change 頁面，不必再從左側 list 點選。

review-gui SPA 路由規約（依 mode 不同；clade-home flow 為預設）：

```
# cross-consumer mode（從 clade home 跑 `pnpm review:ui` — 預設、本檔下方規範路徑）
http://127.0.0.1:5174/review/<consumer-id>:<change-name>

# single mode（從單一 consumer 跑，已被 review-gui.mts `preflightCladeOnly` guard 擋下；fallback only）
http://127.0.0.1:5174/review/<change-name>
```

- port `5174` 是 `vendor/scripts/review-gui.mts` `DEFAULT_PORT` (見 review-gui.mts:21)；找不到 port 時會 fallback 到 5174-5194 之間
- host 預設 bind `127.0.0.1`（見 review-gui.mts:4452）。**MUST** 用 `127.0.0.1` 不要用 `localhost` — 某些 user 端 `/etc/hosts` / DNS 配置 `localhost` 不解析到 `127.0.0.1`，會出現「無法存取」
- **Cross-consumer mode 必要 `<consumer-id>:` prefix**（hard rule）：review-gui.mts `decodeChangeKeyParam(param, 'cross')` 期待 URL `:change` segment 為 `<consumer-id>:<change-name>` 複合 key（見 review-gui.mts:2041）；沒 prefix 時 `ensureChangeRoute` fallback 到 clade mainEntry（line 2622），clade 自己沒對應 change → API 回 404。`<consumer-id>` 從 `~/offline/clade/registry/consumers.json` 對應 entry 的 `consumer_id` 欄位（如 `<consumer-a>` / `<consumer-b>` / `co-purchase` — 跟 directory name 通常一致但以 registry 為準）
- `<change-name>` 一字不差等於 `openspec/changes/<change-name>/` 的目錄名
- 例（cross mode）：`http://127.0.0.1:5174/review/<consumer-a>:ehr-performance-evaluation-m1`

#### 訊息格式（必須照這個 shape）

```
請在 clade home（`~/offline/clade`）執行 `pnpm review:ui` 開本地 GUI 驗收（review-gui 會自動聚合所有 consumer + 各自的 worktree change）：

  cd ~/offline/clade
  pnpm review:ui

GUI 啟動後直接打開：

  http://127.0.0.1:5174/review/<consumer-id>:<change-name>
  # 例 co-purchase 的 mvp-financial-layer-bootstrap：
  # http://127.0.0.1:5174/review/co-purchase:mvp-financial-layer-bootstrap

GUI 會自動：
- 配對 `screenshots/local/<change-name>/#<N>-*.png` 到對應 item
- conflict-aware 寫回 tasks.md
- 對 `[verify:e2e]` / `[verify:api]` automatic-only items 自動勾 `[x]`
- 對 `[verify:ui]` / `[review:ui]` items 顯示 evidence + OK / Issue / Skip 按鈕

完成後回報，我繼續下一步。
```

#### cwd：clade home（review-gui 集中聚合所有 consumer + worktree）

review-gui (`vendor/scripts/review-gui.mts` `listSourceRoots`) 從 clade home 啟動時偵測 `vendor/scripts/review-gui.mts` + `consumers.local` 雙標記 → 進 cross-consumer mode：讀 `consumers.local`，對每個 consumer 跑 `git worktree list --porcelain`，把所有 consumer × main + worktree 的 active change 聚合到同一個 UI；每條帶 `<consumer>__<wt-slug>` rootId namespace 不撞、screenshot API 用同 namespace 隔離。從 **clade home** 跑一次就涵蓋所有 consumer 的所有待 review change。

Consumer 端直接跑 `pnpm review:ui` 被 review-gui.mts `preflightCladeOnly` guard 擋下、退出 exit 2 + 提示改去 clade home。

**MUST**：

- 預設使用者從 clade home（`~/offline/clade`）跑 `pnpm review:ui`
- 訊息**MUST**包含 `cd ~/offline/clade`——consumer 端跑會被 guard 擋下，明確 cd 一次省去誤導

**NEVER**：

- 寫「請在 consumer root 執行」當預設措辭——consumer 端已被 clade-only guard 擋下
- 寫「請在 worktree root 執行」——worktree 也屬於 consumer 範圍，會被 guard 擋下；worktree 的 change 從 clade home 啟動的 GUI 已自動聚合

#### 不該列的東西

- **NEVER** 列 dev server URL（`http://localhost:3040/admin/...`）當「先 sanity check 用」—— review-gui 內部已經自帶 final-state screenshot + evidence，user 不需要自己再開分頁去看 dev server；列那一堆 URL 反而把 chat 變成 dev server route 列表，模糊掉 review-gui 是真正的驗收入口
- **NEVER** 把 review-gui deep-link 寫成 `/review/<change-name>` 不加 host — 使用者拿到 path 還要自己 prepend `http://127.0.0.1:5174` 才能用
- **NEVER** 把 port 寫成 placeholder `<port>` — 直接寫 `5174`（fallback 由 GUI startup banner 告知 user，主線不負責猜）
- **NEVER** 在訊息末尾加「需要的話可以參考」「也可以打開 dev server 看」這類弱措辭——review-gui 就是入口，不需要替代方案

#### Counter-examples

- ❌ 「請跑 `pnpm review:ui`」結束（沒給 deep-link，user 要從 GUI list 自己找 change）
- ❌ 「URL 在 GUI 裡」推給 GUI 顯示
- ❌ 列一堆 `http://localhost:3040/admin/X` dev server URL（user 要看的是 review-gui，不是 dev server）
- ❌ 寫 `/review/<change-name>` 不加 `http://127.0.0.1:5174`

#### 例外：fallback 模式

只有當 `pnpm review:ui` 不可用（clade home 不存在 / user 明確拒絕 GUI / pure backend 完全無 UI 證據），才轉走 chat-based 逐項展示，那時才會用到 dev server URL 給 user。預設路徑（DEFAULT path）只給 review-gui deep-link。

靜態 screenshot review 是證據，不等同於使用者驗收。詳細 marker / flow / kind 分類見 `manual-review.md` 與其 reference 檔。

### Dev Server Auto-Spawn（agent 自起，不要叫 user cd）

當 review-gui 顯示某 item 的 screenshot 不存在 / outdated，或 user 想開瀏覽器親自操作 sanity check 時，**agent 自己起 dev server**，禁止叫使用者「請 cd 到 worktree 跑 `pnpm dev`」。

行為依該 consumer 的 OAuth port-pin 屬性分流（讀 [`consumer-meta.md`](./consumer-meta.md) snapshot 的 `auth.portPinned` 欄位）：

| Consumer 屬性 | 啟動方式 | 衝突處理 |
|---|---|---|
| `auth.portPinned = true` + `dev.leaseMode = strict` | **MUST** 走 [`vendor/scripts/dev-singleton.mjs`](../../vendor/scripts/dev-singleton.mjs) wrapper，鎖在 manifest 宣告的固定 port | cwd-mismatch → **refuse**（需 user 顯式 `--takeover`），參照 [`verification-lease.md`](./verification-lease.md) |
| `auth.portPinned = true` + `dev.leaseMode = advisory` | 同上，但 advisory | cwd-mismatch → warn + reuse |
| `auth.portPinned = false`（無 OAuth pin） | 走 scan-free-port 邏輯（下方 MUST） | 一 worktree 一 port，不互搶 |
| 無 `.claude/consumer-meta.json`（未採用 manifest） | 沿用既有 scan-free-port 邏輯 | 一 worktree 一 port |

#### Pinned consumer path（`auth.portPinned = true`）

- **MUST** 用 `node vendor/scripts/dev-singleton.mjs --consumer-meta .claude/consumer-meta.json --label "<purpose>" -- pnpm dev`
- **NEVER** 直接 `nuxt dev` / `pnpm dev` 不經 wrapper（會繞過 lease + cwd 檢查）
- spawn 前先讀 `/tmp/<consumer_id>-verification-lease.json`，若有別人 hold → wrapper 自動印衝突訊息 + exit 1，agent **MUST** 把訊息原樣呈給 user，**NEVER** 自行 `--takeover`
- 若 consumer 採用 [`vendor/snippets/dev-auth/`](../../vendor/snippets/dev-auth/) cookbook（dev-only signin endpoint，繞過 OAuth），manifest 的 `auth.devSigninEnabled` 變 `true` → port-pin 約束放寬，可改走下方 scan-free-port 邏輯

#### Non-pinned consumer path（`auth.portPinned = false` 或未採用 manifest）

##### MUST

- **解析 sourceRoot**：review-gui `/api/changes` response 已帶該 change 對應的 working tree absolute path（main 或 `wt/<slug>`）；直接用作 `Bash(cwd=...)`
- **掃 free port**：`lsof -iTCP:<port> -sTCP:LISTEN -t` 從 3001 掃到 3050 找第一個 free 的；**禁止**用 3000（使用者慣用，留給 user 自己的 dev server）
- **背景啟動**：`Bash(cwd=<sourceRoot>, run_in_background=true)` 跑 `pnpm dev --port <N>`；stderr/stdout 自然導向 background output（不必額外 redirect）
- **回報 user**：URL（`http://127.0.0.1:<N>`）、background shell ID、以及一條 kill 指令（`lsof -ti:<N> | xargs kill`）
- **Lifecycle**：一個 worktree 同時只開 1 個 dev server（spawn 前先 `lsof` 該 worktree 對應 port 是否已被自己開過）；不同 worktree 可並行（各自選不同 free port）；session 結束或 user 喊停時主動 kill

##### 訊息格式

```
Dev server 已啟動於 worktree `<slug>` (port <N>)：

  http://127.0.0.1:<N>

shellId: <bg-id>
停止：`lsof -ti:<N> | xargs kill`
```

#### Consumer 政策參照

consumer 若有 local rule 明確禁止 agent 自起（base infra 共享風險、上游頻寬限制等），fallback 給 user 一條一行指令：

```
請執行（agent 因 `<local-rule-path>` 不能自起）：

  ( cd <sourceRoot> && pnpm dev --port <N> )
```

例外查詢：consumer `.claude/rules/local/` 下若有 `no-auto-dev-server*.md` / `dev-server-policy*.md` 之類檔案，啟動前先讀過。

#### Worktree 環境檔 bootstrap

開新 worktree 後，第一次 `dev:agent` 通常會因 gitignored env file（`.env.local`、`.env.<client-a>` 等）缺漏失敗。**MUST** 在 worktree 啟動前跑：

```bash
node vendor/scripts/wt-env-bootstrap.mjs --consumer-meta .claude/consumer-meta.json
```

它會依 `dev.envSyncPolicy.filesToCopy` 從 main worktree 拷貝必要檔。Consumer 自家 wt-helper 應該在 `worktree add` 後自動 invoke 一次。

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
