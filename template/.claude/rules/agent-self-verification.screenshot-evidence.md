---
description: 收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對
paths: ['screenshots/**', 'openspec/changes/**/tasks.md', 'app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'layouts/**/*.vue', 'packages/*/layouts/**/*.vue', 'e2e/**', 'packages/*/e2e/**', 'playwright.config.*', 'packages/**/app/**/*.vue']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-self-verification.screenshot-evidence.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Agent Self-Verification — 視覺 evidence 收集

> 從 [[agent-self-verification]] 抽出（2026-07-31）。那份是 always-load 的 meta rule（NEVER 句型黑名單 + fallback chain + 派工前預檢）；本檔是**真的在收截圖 evidence 時**才用得到的操作層，對應主檔 § Hard rule 的 MUST 5 / 7 / 8 / 9。

主檔的四條一句話 MUST 是契約，本檔是它們的執行細節與 canonical pattern。兩邊衝突時以主檔為準。

## MUST 3 — `(deferred: ...)` annotation 的 failure trail 格式

逐層列出 (a)(b)(c)(d) 的嘗試結果。逐字範例：

```text
（deferred: tried (a) dev-login route 限 E2E user only, edit 後 typecheck fail / (b) service_role 不適用（需驗 RLS 邏輯）/ (c) OAuth callback 撞 redirect URI mismatch / (d) screenshot-review fail with "login required"。剩需 user 親自跑）
```

## MUST 5 — verify:ui / verify:e2e evidence 的 fixture MUST 在 seed.sql

Step 8a evidence collection 發現 seed 缺 fixture（verify item 引用的 entity ID 在 `seed.sql` 不存在）時，**MUST** 先把 fixture INSERT 寫進 `seed.sql` → `pnpm supabase:sync` → `pnpm db:reset` → 再拍截圖。

**NEVER** 用 `curl POST` / `$fetch` / browser form submit 臨時建 ephemeral data 拍截圖 —— ephemeral data 在任何 db:reset 後消失，截圖全部 stale，被迫重建 + 重拍（per [[pitfall-verify-evidence-ephemeral-fixture-washed-by-db-reset]]）。

## MUST 6 — Worktree .env 驗證

在 worktree 做 verify channel evidence collection 時，若 item 依賴特定 env var（API key / token / secret），**MUST** 先 `grep -i '<VAR_NAME>' .env.local` 確認存在且有值。

**NEVER** 假設 worktree env 缺失而寫 `blocked on <VAR>` —— worktree 透過 `wt-env-sync.ts` 或 stash-apply baseline 繼承 main 的 `.env.local`，env var 幾乎一定存在。驗證成本 = 一行 grep，假設成本 = 把 actionable item 降級為 blocker + 浪費 user 時間糾正。（per [[pitfall-worktree-env-assumption-and-unverified-evidence]]）

## MUST 7 — 截圖 + 驗證不可分割（atomic screenshot-then-verify）

`agent-browser screenshot` / Playwright screenshot **MUST** 在同一個 Bash 呼叫內緊接驗證，**NEVER** 分成兩個獨立 tool call（分開 = 中間可被跳過）。驗證失敗 = 截圖作廢，**MUST** 修根因後重拍，**NEVER** 帶著失敗截圖寫 annotation。

**Canonical pattern（agent-browser，直接複製）**：

```bash
SS=<screenshot-dir>
agent-browser --session <s> screenshot "$SS/<item-id>-<name>.png"
# --- 以下驗證 MUST 在同一 Bash call ---
SIZE=$(stat -f%z "$SS/<item-id>-<name>.png" 2>/dev/null || stat -c%s "$SS/<item-id>-<name>.png" 2>/dev/null)
if [ "${SIZE:-0}" -lt 35000 ]; then echo "FAIL: screenshot ${SIZE} bytes — likely login/blank page"; exit 1; fi
agent-browser --session <s> snapshot -i 2>&1 | grep -qE '<expected-heading-or-keyword>' || { echo "FAIL: DOM mismatch"; exit 1; }
echo "PASS: ${SIZE} bytes + DOM verified"
```

**五層驗證（至少做前兩層；(d) 條件觸發、(e) 無條件）**：

- **(a) 檔案大小 ≥ 35KB**（白畫面 / 登入頁通常 < 30KB）— 最低門檻
- **(b) DOM / snapshot 關鍵字**（`snapshot -i | grep '<heading>'`）— 確認頁面是預期內容
- **(c) URL 不含 `/auth/`**（`eval "location.href"` 確認未被 redirect）— 防 auth redirect
- **(d) Dialog-aware check**（verify item 描述含「dialog」「明細」「detail」「審核」「進度」等 modal 相關詞時 **MUST** 做）— `snapshot --full | grep 'dialog'` 確認 DOM 含已開啟的 `dialog` 元素。列表頁本身也含 verify keyword（如「待審核」出現在 status badge），只做 (b) 會 false PASS；(d) 確認 modal 真的開了。（per [[pitfall-verify-item-fake-url-no-interaction]]）
- **(e) Item-description cross-check（MUST，所有 verify:ui 截圖）**：截圖後 **MUST** 從 item 描述抽取具體狀態條件，用 DOM / CSS 驗一致性。不一致 = 截圖作廢 + 修根因 + 重拍，**NEVER** 帶不符截圖寫 annotation。常見條件與驗法：

  | Item 描述條件 | 驗法 |
  | --- | --- |
  | `light mode` / `dark mode` | `eval "document.documentElement.classList.contains('dark') ? 'dark' : 'light'"` 比對 item 要求 |
  | 特定 badge 文字（如「待審核」「在職」） | `snapshot -i \| grep '<badge-text>'` |
  | 特定數值（如「143 秒」「8 小時」） | `snapshot -i \| grep '<value>'` |
  | 特定 tab / 分群 active | `snapshot -i \| grep -E 'aria-selected.*true.*<tab-name>\|active.*<tab-name>'` |
  | 特定元素存在 / 不存在 | `snapshot -i \| grep '<element-text>'` 或 `! grep` |

  **Canonical pattern（加在 (a)-(d) 驗證之後）**：

  ```bash
  # (e) item-description cross-check — 從 item 描述抽條件
  # 例：item 要求 "light mode final-state"
  ACTUAL_MODE=$(agent-browser --session <s> eval "document.documentElement.classList.contains('dark') ? 'dark' : 'light'" 2>&1)
  [ "$ACTUAL_MODE" = "light" ] || { echo "FAIL: item requires light mode but page is $ACTUAL_MODE"; exit 1; }
  echo "PASS: (e) item-description cross-check — mode=$ACTUAL_MODE matches item requirement"
  ```

  （per [[pitfall-verified-ui-screenshot-content-mismatch-passes-review]]：<consumer-a> 2026-07-20 #3.1 要驗 light mode，截圖卻是 dark mode；#3.2 要驗 color mode 切換，截圖卻是 command palette 搜尋——四層 (a)-(d) 全過但圖文完全不符）

**auth 回傳非 200 = 立即停手**：browser 內 `fetch __test-login` / cookie injection 的 HTTP status **MUST** 檢查，非 200（含 500）→ **STOP 截圖流程**，先修 auth，**NEVER** 忽略 status 繼續拍。

**NEVER** 拍完不驗就寫 annotation — 這等於把驗證成本轉嫁 user 且浪費整個 review-gui 來回。（per [[pitfall-worktree-env-assumption-and-unverified-evidence]]，2026-06-29 <consumer-b> 再犯：auth fetch 回 500 被忽略，3 張 login page 當 evidence 交出）

## MUST 8 — review:ui 既有 `[x]` 需 agent 自拍 evidence 佐證

archive / 收尾前，任何 `[review:ui]` 的既有 `[x]` 若無對應 agent 自拍 screenshot evidence（`screenshots/local/<change>/#<id>-*.png`）→ 一律視為 **false-green**。主線 **MUST** 無視 checkbox state，自起 dev server + agent-browser 自拍自驗（跨 session 也自足），**NEVER** 假設 user 手上有截圖、**NEVER** 信任前 session 代勾。

**「自拍」動作本身是 bug-catcher** — 要拍就得真的開該頁 / 操作該流程，一開就撞出被 checkbox 掩蓋的 bug（route 404 / mapping mismatch / 空狀態）。

延伸：任何「page route → 內容」mapping（`QUICK_ACTION_MAP` 的 `startsWith('/route')` 類）**MUST** 對照 `app/pages` 實際產生的路由驗證，**NEVER** 憑功能語意臆想 prefix — 臆想 prefix 對不上真實 route 時 silent fallthrough 到預設，typecheck / lint / 靜態視覺都不報。（per [[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]）

## MUST 9 — UI 改動後 MUST 重拍所有受影響的 verify:ui 截圖

commit 觸及 `.vue` / `.tsx` / `.jsx` / `.css` / `.scss` 檔後，該 change 的**全部** `[verify:ui]` / `[review:ui]` items 截圖視為 stale（不只被標 issue 的那張）。**MUST** 跑 `audit-screenshot-staleness.ts` 確認 0 stale，有 stale 全部重拍後才能 hand back user 或嘗試推 review-gui bucket 到 `ready`。此規則**不限 spectra-apply 流程** — 主線直接修 issue / refactor / 任何 UI 改動都適用。

**Canonical pattern**：

```bash
# 1. 跑 staleness audit
node --experimental-strip-types vendor/scripts/audit-screenshot-staleness.ts \
  --repo <consumer-path> --active-only 2>&1
# 2. 對每個 STALE item 重拍（Playwright / agent-browser）
# 3. 刪 LEGACY 無 #N 前綴舊圖
# 4. 重跑 audit 確認 0 STALE
# 5. 更新 (verified-ui:) annotation timestamps
```

**NEVER** 只重拍被標 `（issue:）` 的那張 — 同次 code 改動影響的 sibling items 截圖同樣過時。（per [[pitfall-issue-fix-refreshes-only-flagged-screenshot-leaves-batch-stale]]；<consumer-a> 2026-07-04 regression 實證：timeline 上色改動後只重拍 #1.1，其餘 7 張 stale → bucket 卡 `readyForEvidence`）

## MUST 15 — 收尾前核對 receipt 齊全

change 收尾 / archive / hand back user 前，**MUST** 跑

```bash
node --experimental-strip-types ~/offline/clade/vendor/scripts/audit-evidence-completeness.ts --repo <repo> --change <change>
```

並取得 exit 0。exit 1 代表有**已勾**的 item 沒有對應 evidence receipt：**MUST** 補收 evidence（`evidence-store --write`），或在該 item 標 `(deferred: ...)` 附逐層 failure trail（格式同 MUST 3）。**NEVER** 為了讓它變綠去改 checkbox——那是把 false-green 從「沒被發現」變成「主動製造」。

**NEVER** 用逐項 `evidence-store --has-evidence` 查過就當全項齊全。逐項查回答得了「這一項有沒有」，回答不了「哪些項還缺」——而收尾要問的正是後者，漏掉的永遠是沒被查到的那一項。這條與 MUST 8 是同一個 false-green 的兩端：MUST 8 管單項的 checkbox 不可信，本條管整批的「都驗完了」不可信。
