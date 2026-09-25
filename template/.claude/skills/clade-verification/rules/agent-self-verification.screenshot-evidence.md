---
description: 收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對
paths: ['screenshots/**', 'openspec/changes/**/tasks.md', 'app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'layouts/**/*.vue', 'packages/*/layouts/**/*.vue', 'e2e/**', 'packages/*/e2e/**', 'playwright.config.*', 'packages/**/app/**/*.vue']
---
<!-- Clade native rule; source: rules/core/agent-self-verification.screenshot-evidence.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and MUST come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and MUST NOT be silently replaced by a neighbouring runtime.



# Agent Self-Verification — 視覺 evidence 收集

> [[agent-self-verification]] 的 MUST 2 / 3 / 5 / 6 / 7 / 8 / 9 / 15 / 16 執行細節；衝突時以主檔為準。具體命令由 target adapter 提供，缺 verified carrier 時保持 blocked 並照 MUST 3 寫 failure trail。

## NEVER — 禁止直接 handoff user 的三個 verify-channel 場景

1. **缺 session cookie** → 走 [[manual-review.backend]] § Dev-login route missing → scaffold-first hard rule 的 detection 路徑與 scaffold 流程（**不**問 user 取 cookie / Google OAuth + DevTools 複製）
2. **缺 visual evidence** → 走 [[manual-review.backend]] § `[verify:ui]` channel 的 dispatch path；具體 dispatch carrier、model 與 capability check 由所選 target adapter 提供，未驗證時保持 blocked。
3. **撞 baseline functional gap**（allow-list 不收 fixture user / role 不符 / seed identifier 對不上）→ 見下方 MUST 2

## NEVER（句型黑名單 — verify-channel 那一半）

下列句型出現在 output 即違反 [[agent-self-verification]]，必須改寫（量測紀律的三條在主檔）：

- 「我現在缺 X，請你...」（X 可 mint / scaffold / approved browser carrier 取得時）
- 「請取 ADMIN_COOKIE」「請手動 OAuth」「DevTools 複製 cookie」「請貼回 cookie」
- 「截圖無法驗證 X，所以跳過 / 標 deferred」（未走 fallback chain）
- 原文 forward 瀏覽器工具的 error message 當待辦（未先驗 CLI contract / 未跑 `approved browser carrier doctor --fix` 自救）
- 「blocked on `<ENV_VAR>` — dev 環境未配」（未 grep .env.local 確認就假設缺失）
- 「截圖已拍 / evidence 已補」但未驗證截圖內容是否為預期頁面（拍到登入頁 / 白畫面即違反）
- 「review:ui 項已勾 `[x]`，視為已驗收」但無對應 agent 自拍 evidence 佐證（既有 `[x]` ≠ evidence — 假設 user 有截圖、信任前 session 代勾都算違反；per [[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]）

## MUST 2 — 撞 baseline functional gap 走四層 fallback chain

走 [[main-self-collect-fallback-chain]] 四層，**全失敗**才寫 `deferred`：
   - (a) 擴 dev-login route allow-list
   - (b) service_role direct DB query 證 data shape（annotation 標 `direct-db-shape`）
   - (c) 主線自起 dev server + 依環境使用已驗證的 browser carrier 完成 self-login
   - (d) 依 target adapter 的 verified visual-verifier path 執行 `mode: verify`

## 派工前的主線預檢責任

Reviewer 的 model 選擇依 [[agent-routing]] 當前 Routing Table 與對應 adapter。**NEVER 在本檔複寫該列的 model 選擇**；缺合格執行者時保持驗收未完成。

派 subagent / codex / visual verifier 前，主線 **MUST**：

1. **Read tasks / brief 抽具體 path**（檔案 / URL / DOM）
2. **Pre-verify baseline**：依 [[manual-review.backend]] § Pre-verify baseline 假設確認 dev-login route / fixture / seed 存在
3. **若 baseline functional gap**：先跑 [[main-self-collect-fallback-chain]] 至少 (a) 一輪驗 mint 成功，**再**派 subagent
4. **失敗模式預設**：subagent 回報 `deferred` 不代表終局；主線 **MUST** 再跑一輪 fallback chain，仍失敗才 handoff user

## MUST 3 — `(deferred: ...)` annotation 的 failure trail 格式

逐層列出 (a)(b)(c)(d) 的嘗試結果。範例：

```text
（deferred: tried (a) dev-login route 限 E2E user only, edit 後 typecheck fail / (b) service_role 不適用（需驗 RLS 邏輯）/ (c) OAuth callback 撞 redirect URI mismatch / (d) target visual verifier fail with "login required"。剩需 user 親自跑）
```

## MUST 5 — verify:ui / verify:e2e evidence 的 fixture MUST 在 seed.sql

Step 8a evidence collection 發現 seed 缺 fixture（verify item 引用的 entity ID 在 `seed.sql` 不存在）時，**MUST** 先把 fixture INSERT 寫進 `seed.sql` → `pnpm supabase:sync` → `pnpm db:reset` → 再拍截圖。

**NEVER** 用 `curl POST` / `$fetch` / browser form submit 臨時建 ephemeral data 拍截圖（db:reset 後消失；[[pitfall-verify-evidence-ephemeral-fixture-washed-by-db-reset]]）。

## MUST 6 — Worktree .env 驗證

在 worktree 做 verify channel evidence collection 時，若 item 依賴特定 env var（API key / token / secret），**MUST** 先 `grep -i '<VAR_NAME>' .env.local` 確認存在且有值。

**NEVER** 假設 worktree env 缺失而寫 `blocked on <VAR>`——worktree 經 `wt-env-sync.ts` 繼承 main 的 `.env.local`（[[pitfall-worktree-env-assumption-and-unverified-evidence]]）。

## MUST 7 — 截圖 + 驗證不可分割（atomic screenshot-then-verify）

target adapter 的 capture 與 verification **MUST** 在同一個 operation round 內緊接完成，**NEVER** 分成兩個獨立 tool call。驗證失敗 = 截圖作廢，**MUST** 修根因後重拍，**NEVER** 帶著失敗截圖寫 annotation。

**Canonical operation contract（target adapter supplies commands）**：

1. 在同一 operation round 內建立 temporary capture。
2. 驗證檔案非空且達到 adapter 的 artifact threshold。
3. 驗證 DOM / final URL / auth state，並做 item-description cross-check；dialog item 另驗 dialog。
4. 任一驗證失敗即丟棄 temporary capture、修根因、重新執行整輪。
5. 只有所有檢查通過才 atomic replace canonical screenshot 並寫 evidence annotation。

## MUST 8 — review:ui 既有 `[x]` 需 agent 自拍 evidence 佐證

archive / 收尾前，任何 `[review:ui]` 的既有 `[x]` 若無對應 agent 自拍 screenshot evidence（`screenshots/local/<change>/#<id>-*.png`）→ 一律視為 **false-green**。主線 **MUST** 無視 checkbox state，自起 dev server + 依環境自拍自驗（依 target adapter 的 browser carrier；跨 session 也自足），**NEVER** 假設 user 手上有截圖、**NEVER** 信任前 session 代勾。

延伸：任何「page route → 內容」mapping（`startsWith('/route')` 類）**MUST** 對照 `app/pages` 實際產生的路由驗證，**NEVER** 憑功能語意臆想 prefix（[[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]）。


## MUST 9 — UI 改動後 MUST 重拍所有受影響的 verify:ui 截圖

commit 觸及 `.vue` / `.tsx` / `.jsx` / `.css` / `.scss` 檔後，該 change 的**全部** `[verify:ui]` / `[review:ui]` items 截圖視為 stale（不只被標 issue 的那張）。**MUST** 跑 `audit-screenshot-staleness.ts` 確認 0 stale，有 stale 全部重拍後才能 hand back user。適用任何 UI 改動，不限特定流程。

**Canonical pattern**：

```bash
# 1. 跑 staleness audit
node vendor/scripts/audit-screenshot-staleness.ts \
  --repo <consumer-path> --active-only 2>&1
# 2. 對每個 STALE item 依 target adapter 重拍
# 3. 刪 LEGACY 無 #N 前綴舊圖
# 4. 重跑 audit 確認 0 STALE
# 5. 更新 (verified-ui:) annotation timestamps
```

**NEVER** 只重拍被標 `（issue:）` 的那張 — 同次 code 改動影響的 sibling items 截圖同樣過時。（per [[pitfall-issue-fix-refreshes-only-flagged-screenshot-leaves-batch-stale]]）

## MUST 15 — 收尾前核對 receipt 齊全

plan 收尾 / close / hand back user 前，**MUST** 跑

```bash
node ~/offline/clade/vendor/scripts/flow/flow.ts plan check-close <work_id>
```

並取得 exit 0。exit 1 的每條 finding 都帶 `code`：`acceptance-verdict-missing`／`-stale` 代表機器場景沒跑或跑的是上一版——**MUST** 重跑 acceptance 指令、把 cucumber JSON 留在 `evidence/`；`acceptance-human-receipt-missing`／`-stale` 代表 `@human` 場景沒有新鮮人判——那是 `ui-judgement` 卡（`flow gates`），**MUST** 先把 evidence 收齊讓卡出現，**NEVER** 自己寫 `flow receipt` 代判。**NEVER** 為了讓它變綠去改 feature 檔或 checkbox——那是把 false-green 從「沒被發現」變成「主動製造」。

**NEVER** 用逐項查過就當全項齊全——逐項查回答不了「哪些項還缺」。

## MUST 16 — 驗收對象需要登入態時，MUST 用真瀏覽器走到底並斷言登入後狀態

只要被驗的流程**需要 session 才會顯示正確結果**（登入後頁面、帶權限的 API 經瀏覽器呼叫、任何「登入 → 跳轉 → 落地頁」鏈路），**MUST** 用真瀏覽器點完整條鏈路，並斷言**登入後**的 DOM 狀態——不是斷言狀態碼、不是斷言 `href` 字串。可觀察的最小斷言組：落地頁 `location.href` 是預期路徑、`document.querySelector('input[type=password]')` 為 `null`、以及一個只有登入後才存在的元素。

Target adapter MUST provide the native browser operation for the authenticated flow and evaluate the post-login URL, login-form absence, and a logged-in-only element. **NEVER** infer authenticated behavior from a status code or artifact shape.

**NEVER** 拿 curl 的狀態碼當帶認證流程的證據：curl 不理會 cookie 的 `Secure` / `SameSite`，plain-HTTP 登入時 302 → 200 全部正常，瀏覽器卻已丟棄 cookie。**NEVER** 用「開過瀏覽器但只讀 `href`」抵這條。

非 localhost origin 要能登入，該 origin 自己**必須**是真 HTTPS（例：tailnet 的 `tailscale cert` + MagicDNS）。兩者皆無時 **NEVER** 退回 plain-HTTP proxy 產生登入連結——改回報「需 HTTPS 才能登入」並說明原因。（per [[pitfall-plain-http-proxy-cannot-carry-secure-session]]）

## Browser Worktree Verify Auth（hard rule；自 [[proactive-skills]] 下推）

開 auth-protected URL 前 **MUST** 完成 pre-auth（port 3000 singleton + `__test-login?role=admin&email=...`），**NEVER** 截到空白頁後才開始診斷 auth。

**載體**：由 selected runtime 的 browser adapter 開同一個 `__test-login` URL；若沒有已驗證的 browser adapter，保持 blocked。完整 cookbook 見對應 runtime adapter 的 auth reference。Pitfall ref: `docs/pitfalls/2026-06-24-browser-auth-blank-page-on-alt-port.md`。
