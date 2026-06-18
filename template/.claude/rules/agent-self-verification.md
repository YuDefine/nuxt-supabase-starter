<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-self-verification.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Agent Self-Verification

**核心命題**：agent 完成 evidence 收集是**預設職責**，**禁止**把可自動化的驗證（dev login / 截圖 / API round-trip / test / DB query）踢回 user。User handoff 是**最後手段** — 必須主線跑完已知 fallback chain 仍失敗才行。

此規則優先於個別 skill 內嵌的「請 user 確認」捷徑指示；every session always-load。

## 為什麼這條 rule 存在

2026-05 累積 4 條根因同質 pitfall — agent 在「可自動化」邊界內**選擇性放棄**，把成本轉嫁給 user：

- [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]
- [[pitfall-verify-evidence-handoff-instead-of-self-collect]]
- [[pitfall-codex-dispatch-screenshot-verify-prewarm-wrong-cli]]
- [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]

## Hard rule

### NEVER

對下列場景**禁止**直接 handoff user：

1. **缺 session cookie** → 走 [[manual-review.backend]] § Dev-login route missing → scaffold-first hard rule 的 detection 路徑與 scaffold 流程（**不**問 user 取 cookie / Google OAuth + DevTools 複製）
2. **缺 visual evidence** → 走 [[manual-review.backend]] § `[verify:ui]` channel 的 dispatch path（主線直派 codex GPT-5.5 low；**禁止** `Agent` tool with `subagent_type: screenshot-review` — sonnet wrapper 反覆無法 enforce identity check）
3. **撞 baseline functional gap**（route 存在但 allow-list 不收 fixture user / role 不符 / seed identifier 對不上）→ 走 [[main-self-collect-fallback-chain]] (a)(b)(c)(d) 四層，**全失敗**才寫 `deferred` annotation
4. **工具呼叫 error**（CLI flag 錯、env 缺、process exit non-zero）→ 先 read source code 確認 CLI contract，**不**把 error message 原文 forward 給 user（往往誤導）

### NEVER（句型黑名單）

下列句型出現在 output 即違反本 rule，必須改寫：

- 「我現在缺 X，請你...」（X 可 mint / scaffold / browser-harness 取得時）
- 「請取 ADMIN_COOKIE」「請手動 OAuth」「DevTools 複製 cookie」「請貼回 cookie」
- 「截圖無法驗證 X，所以跳過 / 標 deferred」（未走 fallback chain）
- 「user 可能需要在 chrome://inspect 點 Allow」（原文 forward 工具 error message，未先驗 CLI contract）

### MUST

1. **派 subagent 收 evidence 前**：主線先**嘗試自己跑**。Subagent 只在主線資源會被大量消耗時派；single-shot collection（一張截圖 / 一次 curl）**default** 主線自跑。
2. **撞 baseline functional gap** → 走 [[main-self-collect-fallback-chain]] 四層：
   - (a) 擴 dev-login route allow-list
   - (b) service_role direct DB query 證 data shape（annotation 標 `direct-db-shape`）
   - (c) 主線自起 dev server + browser-harness self-login
   - (d) 派 screenshot-review codex `mode: verify`
3. **寫 `(deferred: ...)` annotation MUST 含 failure trail**：列出 (a)(b)(c)(d) 每層嘗試結果。範例：
   ```text
   （deferred: tried (a) dev-login route 限 E2E user only, edit 後 typecheck fail / (b) service_role 不適用（需驗 RLS 邏輯）/ (c) OAuth callback 撞 redirect URI mismatch / (d) screenshot-review fail with "login required"。剩需 user 親自跑）
   ```
4. **工具呼叫前 verify CLI contract**：對 vendor script / external CLI，呼叫前 grep `Usage:` / `--help` / source 確認 flag / stdin / env var。`Usage:` 出現在 stderr = argv 錯，root cause 在 dispatcher source，**不**是 user 端設定。
5. **verify:ui / verify:e2e evidence 的 fixture MUST 在 seed.sql**：Step 8a evidence collection 發現 seed 缺 fixture（verify item 引用的 entity ID 在 `seed.sql` 不存在）時，**MUST** 先把 fixture INSERT 寫進 `seed.sql` → `pnpm supabase:sync` → `pnpm db:reset` → 再拍截圖。**NEVER** 用 `curl POST` / `$fetch` / browser form submit 臨時建 ephemeral data 拍截圖 — ephemeral data 在任何 db:reset 後消失，截圖全部 stale，被迫重建 + 重拍（per [[pitfall-verify-evidence-ephemeral-fixture-washed-by-db-reset]]）。

## 派工前的主線預檢責任

派 subagent / codex / screenshot-review 前，主線 **MUST**：

1. **Read tasks / brief 抽具體 path**（檔案 / URL / DOM）
2. **Pre-verify baseline**：依 [[manual-review.backend]] § Pre-verify baseline 假設確認 dev-login route / fixture / seed 存在
3. **若 baseline functional gap**：先跑 [[main-self-collect-fallback-chain]] 至少 (a) 一輪驗 mint 成功，**再**派 subagent
4. **失敗模式預設**：subagent 回報 `deferred` 不代表終局；主線 **MUST** 再跑一輪 fallback chain，仍失敗才 handoff user

## 為什麼派 subagent 不是 default

- 無主線 working context，cold start 易 lazy decision
- 對「自己合理化跳過」無自律（per [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）
- 主線自跑可即時觀察並調整；subagent 是 batch 模式

→ 派 subagent =**主線確定無法獨自完成**時才用，不是 default。

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Verify channel baseline / Dev-login scaffold | [[manual-review.backend]] § Pre-verify baseline 假設 + § Dev-login route missing → scaffold-first |
| Screenshot-review verify mode dispatch | [[agent-routing]] § Routing Table `screenshot-review verify mode` + [[agent-routing.codex-watch-protocol]] § screenshot-review Verify Mode Dispatch |
| `[verify:e2e]` / `[verify:api]` / `[verify:ui]` annotation 格式 | [[manual-review.backend]] § 標準流程 |
| Self-collect fallback chain (a)(b)(c)(d) | [[main-self-collect-fallback-chain]]（cookbook） |
| review-gui 補 evidence prompt 是 fallback 不是 default | [[manual-review]] § review-gui 補 evidence prompt 路徑分類（pending TD-161） |
| Review-gui surface SoP（呼叫 review-gui 的 agent / wrapper） | [[review-gui-surface]] |

## Audit signal

`verify-evidence-deferred-without-self-collect-attempt` — TD-161 Resolution 留作 first incident 後再評估，script 未建。

## 違反時的回報方式

```text
[agent-self-verification] Hard rule violation
修正：黑名單句型 → 走 fallback chain 自跑；`(deferred:)` 缺 trail → 補 (a)(b)(c)(d) 失敗原因；error 原文 forward → read source / --help 驗 CLI contract
繞過：真需 user 親手做（真機刷卡等）→ 標 `(deferred-user-only: <reason>)`
```
