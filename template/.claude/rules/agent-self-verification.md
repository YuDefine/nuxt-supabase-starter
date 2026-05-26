<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-self-verification.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Agent Self-Verification

**核心命題**：agent 完成 evidence 收集是**預設職責**，**禁止**把可自動化的驗證（dev login、cookie mint、截圖、API round-trip、test run、DB query）踢回 user。User handoff 是**最後手段** — 必須在主線跑完已知 fallback chain 後仍失敗才行。

此規則優先於個別 skill 內嵌的「請 user 確認」捷徑指示。Cross-cutting hard rule，每個 session always-load。

## 為什麼這條 rule 存在

2026-05-{23,24,26} 累積 4 條獨立 pitfall，根因同質：

| Pitfall | 反模式 |
| --- | --- |
| [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]] | sonnet wrapper 自我合理化（「截圖無法驗 hover state，所以跳過」），不走 fallback chain |
| [[pitfall-verify-evidence-handoff-instead-of-self-collect]] | subagent 撞 baseline functional gap → 寫 `deferred` 推主線；主線直接 forward 給 user 而非自己再跑一輪 |
| [[pitfall-codex-dispatch-screenshot-verify-prewarm-wrong-cli]] | dispatcher 對 `browser-harness` 用錯 CLI flag，error message 誤導 user 去 Chrome 設定，實際根因在 dispatcher source |
| [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]] | agent 跳過 dev-login scaffold cookbook，直接問 user 取 cookie / 走 Google OAuth + DevTools 複製 |

共同失敗模式：agent 在「可自動化」邊界內**選擇性放棄**，把成本轉嫁給 user。

## Hard rule

### NEVER

對下列場景**禁止**直接 handoff user：

1. **缺 session cookie** → 走 [[manual-review.backend]] § Dev-login route missing → scaffold-first hard rule 的 detection 路徑與 scaffold 流程（**不**問 user 取 cookie / Google OAuth + DevTools 複製）
2. **缺 visual evidence** → 走 [[manual-review.backend]] § `[verify:ui]` channel 的 dispatch path（主線直派 codex GPT-5.5 low；**禁止** `Agent` tool with `subagent_type: screenshot-review` — sonnet wrapper 反覆無法 enforce identity check）
3. **撞 baseline functional gap**（route 存在但 allow-list 不收 fixture user / role 不符 / seed identifier 對不上）→ 走 [[main-self-collect-fallback-chain]] (a)(b)(c)(d) 四層，**全失敗**才寫 `deferred` annotation
4. **工具呼叫 error**（CLI flag 錯、env 缺、process exit non-zero）→ 先 read source code 確認 CLI contract，**不**把 error message 原文 forward 給 user（往往誤導）

### NEVER（句型黑名單）

下列句型出現在 agent output 即視為違反本 rule，必須改寫：

- 「我現在缺 X，請你...」（X 可 mint / scaffold / browser-harness 取得時）
- 「請取 ADMIN_COOKIE」「請手動 OAuth」「DevTools 複製 cookie」「請貼回 cookie」
- 「截圖無法驗證 X，所以跳過 / 標 deferred」（未走 fallback chain）
- 「user 可能需要在 chrome://inspect 點 Allow」（原文 forward 工具 error message，未先驗 CLI contract）

### MUST

1. **派 subagent 收 evidence 前**：主線先**嘗試自己跑**。Subagent 只在「主線資源（context / token / CDP socket）會被 agent 自動化大量消耗」時派。 Single-shot evidence collection（一張截圖、一次 curl round-trip）**default** 主線自跑。
2. **撞 baseline functional gap** → 走 [[main-self-collect-fallback-chain]] 四層：
   - (a) 擴 dev-login route allow-list
   - (b) service_role direct DB query 證 data shape（annotation 標 `direct-db-shape`）
   - (c) 主線自起 dev server + browser-harness self-login
   - (d) 派 screenshot-review codex `mode: verify`
3. **寫 `(deferred: ...)` annotation MUST 含 failure trail**：列出 (a)(b)(c)(d) 每層嘗試結果，user 才知道不要叫 Claude 重試同 path。範例：
   ```text
   （deferred: tried (a) dev-login route 限 E2E user only, edit 後 typecheck fail / (b) service_role 不適用（需驗 RLS 邏輯）/ (c) OAuth callback 撞 redirect URI mismatch / (d) screenshot-review fail with "login required"。剩需 user 親自跑）
   ```
4. **工具呼叫前 verify CLI contract**：對自家 vendor script / external CLI，呼叫前 grep `Usage:` / `--help` / source 確認 flag / stdin / env var。觀察到 `Usage:` 出現在 stderr 表示 argv 錯，**不**是 user 該去 Chrome 設定；root cause 找 dispatcher source。

## 派工前的主線預檢責任

派 subagent / codex / screenshot-review 前，主線 **MUST**：

1. **Read tasks / brief 抽具體 path**（檔案、URL、expected DOM、screenshot path）
2. **Pre-verify baseline**：依 [[manual-review.backend]] § Pre-verify baseline 假設 (hard rule) 確認 dev-login route / fixture / seed 存在
3. **若 baseline functional gap**：先跑 [[main-self-collect-fallback-chain]] 至少 (a) 一輪確認 mint 可成功，**再**派 subagent
4. **失敗模式預設**：subagent 回報 `deferred` 不代表終局；主線收到後 **MUST** 再跑一輪 fallback chain（subagent 可能漏跑某層），仍失敗才 handoff user

## 為什麼派 subagent 不是 default

- subagent 不享有主線的 working context（檔案 read 紀錄、變數定義、上下文推理），cold start 容易做出 lazy decision
- subagent 對「自己合理化跳過」幾乎無自律機制（per [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）
- 主線自跑可即時觀察 intermediate state，遇到問題立刻調整；subagent 是 batch 模式

→ 「派 subagent」應視為**主線確定無法獨自完成**時才用，不是 default。

## Cross-ref（規約落地真相層）

| 主題 | 真相層 |
| --- | --- |
| Verify channel baseline / Dev-login scaffold | [[manual-review.backend]] § Pre-verify baseline 假設 + § Dev-login route missing → scaffold-first |
| Screenshot-review verify mode dispatch | [[agent-routing]] § Routing Table `screenshot-review verify mode` + [[agent-routing.codex-watch-protocol]] § screenshot-review Verify Mode Dispatch |
| `[verify:e2e]` / `[verify:api]` / `[verify:ui]` annotation 格式 | [[manual-review.backend]] § 標準流程 |
| Self-collect fallback chain (a)(b)(c)(d) | [[main-self-collect-fallback-chain]]（cookbook） |
| review-gui 補 evidence prompt 是 fallback 不是 default | [[manual-review]] § review-gui 補 evidence prompt 路徑分類（pending TD-161） |
| Review-gui surface SoP（呼叫 review-gui 的 agent / wrapper） | [[review-gui-surface]] |

## Audit signal（pending）

`vendor/scripts/spectra-apply-audit.mjs` 新 signal `verify-evidence-deferred-without-self-collect-attempt`：

- 掃 archive 階段 tasks.md 的 `[verify:*]` item annotation
- 偵測 `（deferred: ...）` 內**未列**已嘗試的 (a)(b)(c)(d) failure trail → emit warning signal
- Signal 落入 improvement-digest 候選清單

對應 TD: TD-161（accepted, pending implementation）。

## 違反時的回報方式

```text
[agent-self-verification] Hard rule violation

問題：output 含黑名單句型 / 未走 fallback chain 就 `deferred` / 工具 error 原文 forward

修正方式：
  - 句型黑名單命中 → 改走對應 fallback chain 自跑
  - `(deferred: ...)` 沒 failure trail → 補列 (a)(b)(c)(d) 每層失敗原因
  - 工具 error 原文 forward → STOP，read tool source / --help 確認 CLI contract

繞過：
  - 若該驗證**真的**需要 user 親手做（真機刷卡 / production 授權 / 視覺主觀判斷） → annotation 標 `(deferred-user-only: <reason>)`，**不**用通用 `deferred`
```
