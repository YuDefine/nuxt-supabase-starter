<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-self-verification.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Agent Self-Verification

**核心命題**：agent 完成 evidence 收集是**預設職責**，**禁止**把可自動化的驗證（dev login / 截圖 / API round-trip / test / DB query）踢回 user。User handoff 是**最後手段** — 必須主線跑完已知 fallback chain 仍失敗才行。

此規則優先於個別 skill 內嵌的「請 user 確認」捷徑指示；every session always-load。

## 為什麼這條 rule 存在

2026-05 累積 4 條根因同質 pitfall — agent 在「可自動化」邊界內**選擇性放棄**，把成本轉嫁給 user：

- [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]
- [[pitfall-verify-evidence-handoff-instead-of-self-collect]]
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

- 「我現在缺 X，請你...」（X 可 mint / scaffold / agent-browser 取得時）
- 「請取 ADMIN_COOKIE」「請手動 OAuth」「DevTools 複製 cookie」「請貼回 cookie」
- 「截圖無法驗證 X，所以跳過 / 標 deferred」（未走 fallback chain）
- 原文 forward 瀏覽器工具的 error message 當待辦（未先驗 CLI contract / 未跑 `agent-browser doctor --fix` 自救）
- 「blocked on `<ENV_VAR>` — dev 環境未配」（未 grep .env.local 確認就假設缺失）
- 「截圖已拍 / evidence 已補」但未驗證截圖內容是否為預期頁面（拍到登入頁 / 白畫面即違反）
- 「review:ui 項已勾 `[x]`，視為已驗收」但無對應 agent 自拍 evidence 佐證（既有 `[x]` ≠ evidence — 假設 user 有截圖、信任前 session 代勾都算違反；per [[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]）
- 「grep 不到 X，所以 X 不存在」「零命中，確認沒有」「只有 N 個」「無任何 / 沒有任何 X」（未附 known-positive control 就把 negative search 當證據；per 下方 MUST 11）
- 「curl 打過了，302 / 200，登入流程正常」「cookie jar 有存到，session 沒問題」（對**帶登入態**的流程，curl 的狀態碼不是證據；per 下方 MUST 16）
- 「連結已產生 / `href` 對了，所以點下去會登入成功」（讀 artifact 的形狀不等於驗它的行為；per 下方 MUST 16）

### MUST

1. **派 subagent 收 evidence 前**：主線先**嘗試自己跑**。Subagent 只在主線資源會被大量消耗時派；single-shot collection（一張截圖 / 一次 curl）**default** 主線自跑。
2. **撞 baseline functional gap** → 走 [[main-self-collect-fallback-chain]] 四層：
   - (a) 擴 dev-login route allow-list
   - (b) service_role direct DB query 證 data shape（annotation 標 `direct-db-shape`）
   - (c) 主線自起 dev server + agent-browser self-login
   - (d) 派 screenshot-review codex `mode: verify`
3. **寫 `(deferred: ...)` annotation MUST 含 failure trail**：列出 (a)(b)(c)(d) 每層嘗試結果。範例：
   ```text
   （deferred: tried (a) dev-login route 限 E2E user only, edit 後 typecheck fail / (b) service_role 不適用（需驗 RLS 邏輯）/ (c) OAuth callback 撞 redirect URI mismatch / (d) screenshot-review fail with "login required"。剩需 user 親自跑）
   ```
4. **工具呼叫前 verify CLI contract**：對 vendor script / external CLI，呼叫前 grep `Usage:` / `--help` / source 確認 flag / stdin / env var。`Usage:` 出現在 stderr = argv 錯，root cause 在 dispatcher source，**不**是 user 端設定。

   **`--help` 不是天生安全的探測手段。** 對**沒有**解析 `--help`、也**沒有** unknown-flag 檢查的 script，`--help` 等同無參數執行 —— 探測動作本身就是那個危險動作。因此 **MUST 先讀 source 確認它對 unknown flag 的處置**（報錯退出？忽略照跑？）再決定怎麼探測；shim 檔要一路追到實作端（45 行的轉呼叫 shim 看起來人畜無害，危險的是它背後那支實作）。**NEVER** 對這類 script 用 `| head -N` 限制輸出量 —— 那會把它腰斬在中途（per [[checker-contract]] § 上游具副作用時，提前退出命令會把它腰斬）。
5. **verify:ui / verify:e2e evidence 的 fixture MUST 在 seed.sql**：fixture 缺就先寫進 `seed.sql` → `pnpm supabase:sync` → `pnpm db:reset` 再拍。**NEVER** 用 `curl POST` / `$fetch` / form submit 臨時建 ephemeral data 拍截圖 —— 下一次 db:reset 就全部作廢、被迫重建重拍（per [[pitfall-verify-evidence-ephemeral-fixture-washed-by-db-reset]]）。
6. **Worktree .env 驗證（hard rule）**：在 worktree 做 verify channel evidence collection 時，若 item 依賴特定 env var（API key / token / secret），**MUST** 先 `grep -i '<VAR_NAME>' .env.local` 確認存在且有值。**NEVER** 假設 worktree env 缺失而寫 `blocked on <VAR>` — worktree 透過 `wt-env-sync.ts` 或 stash-apply baseline 繼承 main 的 `.env.local`，env var 幾乎一定存在。驗證成本 = 一行 grep，假設成本 = 把 actionable item 降級為 blocker + 浪費 user 時間糾正。（per [[pitfall-worktree-env-assumption-and-unverified-evidence]]）
7. **截圖 + 驗證不可分割（atomic screenshot-then-verify，hard rule）**：`agent-browser screenshot` / Playwright screenshot **MUST** 在同一個 Bash 呼叫內緊接驗證，**NEVER** 分成兩個獨立 tool call（分開 = 中間可被跳過）。驗證至少含 (a) 檔案大小 ≥ 35KB 與 (b) DOM 關鍵字比對，另有 (c) 未被 auth redirect、(d) modal 類 item 的 dialog check、(e) item 描述條件 cross-check。驗證失敗 = 截圖作廢，**MUST** 修根因後重拍，**NEVER** 帶著失敗截圖寫 annotation。auth `fetch __test-login` 回非 200（含 500）→ **STOP 截圖流程**先修 auth。**五層的 canonical bash 與逐項驗法見 [[agent-self-verification.screenshot-evidence]] MUST 7 —— 開始收截圖 evidence 之前 MUST 先讀那一節。**（per [[pitfall-worktree-env-assumption-and-unverified-evidence]] / [[pitfall-verify-item-fake-url-no-interaction]] / [[pitfall-verified-ui-screenshot-content-mismatch-passes-review]]）

8. **review:ui 既有 `[x]` 需 agent 自拍 evidence 佐證（hard rule）**：archive / 收尾前，任何 `[review:ui]` 的既有 `[x]` 若無對應 agent 自拍 screenshot evidence（`screenshots/local/<change>/#<id>-*.png`）→ 一律視為 **false-green**。主線 **MUST** 無視 checkbox state 自拍自驗，**NEVER** 假設 user 手上有截圖、**NEVER** 信任前 session 代勾。「自拍」動作本身是 bug-catcher —— 要拍就得真的開該頁，一開就撞出被 checkbox 掩蓋的 bug。route mapping 的延伸規約見 [[agent-self-verification.screenshot-evidence]] MUST 8。（per [[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]）

9. **UI 改動後 MUST 重拍所有受影響的 verify:ui 截圖（hard rule）**：commit 觸及 `.vue` / `.tsx` / `.jsx` / `.css` / `.scss` 檔後，該 change 的**全部** `[verify:ui]` / `[review:ui]` items 截圖視為 stale（**不只**被標 issue 的那張）。**MUST** 跑 `audit-screenshot-staleness.ts` 確認 0 stale 才能 hand back user 或推 bucket 到 `ready`。此規則**不限 spectra-apply 流程** —— 主線直接修 issue / refactor / 任何 UI 改動都適用。五步重拍流程見 [[agent-self-verification.screenshot-evidence]] MUST 9。（per [[pitfall-issue-fix-refreshes-only-flagged-screenshot-leaves-batch-stale]]）

10. **部署宣稱需交叉核對**：宣稱部署平台 / runtime 時，**MUST** 核對 `.github/workflows/` deploy job + deploy config（`wrangler.toml` / `Dockerfile`）+ `package.json` scripts。**NEVER** 只引單一 `docs/` 文件。

    **開始調查 production 之前先釘 canonical tuple**：讀任何設定 / 查任何 log / 提任何修正**之前**，**MUST** 先確認四項並寫出來——repo、framework、hosting platform、domain。**NEVER** 從當前工作目錄推斷是哪個 production 專案：cwd 只說明你在哪個 checkout 裡，不說明它部署到哪、甚至不說明它有沒有部署。四項有任一項答不出來，就還沒到可以動手的階段。（<consumer-i> 2026-07-14 實證）

11. **Negative search 不成立為證據（hard rule）**：下「零命中 / 不存在 / 只有 N 個」的結論前，**MUST** 先用一個已知會命中的樣本驗過 pattern（known-positive control），並在結論裡寫出「此 pattern 對 `<已知樣本>` 命中」——寫不出來，零命中就不是證據。**NEVER** 把「我 grep 過了」當成 absence 的證明：pattern 寫錯、資料形狀誤判（表格儲存格繼承 / 多種寫法 / 跨行屬性 / 別名 import）、未言明的假設偷偷收窄範圍，三者的輸出**都是零命中**，跟真的不存在外觀完全相同，而換一個工具重跑同一個 pattern 驗不到任何一項。有 structured output（`--json` / `--format json`）時優先用它取代文字 grep；更前一步是先問「有沒有不需要數的判準」（例：gate 已設 `severity: CRITICAL,HIGH`，則輸出的每一條依定義都是 HIGH，根本不必數）。（per [[pitfall-narrow-grep-absence-treated-as-proof]]）

    **時間窗查詢是本條最常被違反的形態**：`docker logs` / `docker events` / `journalctl` 的 `--since` / `--until` 收到**裸** wall clock 字串時，以**主機本地時區**解讀，exit code 恆 0、無 warning。所以**每一次**時間窗查詢都 MUST 做兩件事——(a) 先用寬鬆窗撈到一筆 known-positive control，確認這個查詢真的看得到東西，再收窄；(b) 絕對時間**MUST** 帶時區後綴（`2026-08-05T10:00:00Z`），寫不出時區就改用相對時間（`--since 30m`）。**NEVER** 把裸時間字串的空輸出當成「那段期間沒發生」：時區平移的空輸出與真的沒有，外觀完全相同，而重跑同一條指令兩者都不會變。（per [[pitfall-docker-logs-absolute-time-parsed-as-host-local-timezone]]）

12. **「這個帳號能不能登入 / 能不能管理」MUST 逐層驗，不從單層外推**：回答任何帳號可用性問題前，**MUST** 分別驗證五層並逐層寫出結論——(a) 該人在該環境是 active（未離職 / 未停用）、(b) 登入 provider 與 route 對該帳號開放、(c) platform role 是 active、(d) session 真的建得起來、(e) 登入後的 UI 與 API permission 確實放行。**NEVER** 因為 DB 有一筆 employee row、或某份文件列了那個 email，就宣稱帳號可用——這兩者都只證明 (a) 的一部分，跟 (b)–(e) 沒有任何蘊含關係。（<consumer-a> 2026-07-19 實證）

13. **改工具定義前 MUST 從實際生效的命令反查 source**：要改一個 skill / script / hook 的行為時，**MUST** 先確認「執行時真正被讀到的是哪個檔」——從實際跑的命令、程序的 argv、或該工具自己印出的路徑往回查。**NEVER** 從執行環境推定 source：工具跑在哪台主機、哪個容器、哪個 VM，跟它的定義檔放在哪是兩件無關的事。改錯檔的輸出跟改對檔一樣是「已修改」，只有下次執行才會發現沒生效。（<consumer-a> 2026-07-25 實證：目標跑在 Proxmox VM 上，於是把主機管理 skill 當成更新目標，實際生效的是另一支 GUI bridge skill）

14. **判定外部 server / daemon 是否存活 MUST 對齊自己這條連線**：MCP server、dev server、tunnel 這類長駐程序報連線錯誤（`Transport closed` 等）時，**MUST** 用 process tree 確認「當前 session 的 PID 與它的直接子程序」，**NEVER** 因為看到**同名**程序還活著就判定 server 正常——別的 session 開的同名程序跟你這條連線沒有關係。修復時同樣 **MUST** 用不終止其他 session 的方式（版本化安裝 + 隔離 cache dir）。同一個 stdio MCP 的查詢**預設串行**，不要開沒必要的並行 outstanding call。（<consumer-b> 實證）

15. **收尾前 MUST 核對 receipt 齊全，不是逐項查（hard rule）**：change 收尾 / archive / hand back user 前，**MUST** 跑

    ```bash
    node --experimental-strip-types ~/offline/clade/vendor/scripts/audit-evidence-completeness.ts --repo <repo> --change <change>
    ```

    並取得 exit 0。exit 1 代表有**已勾**的 item 沒有對應 evidence receipt：**MUST** 補收 evidence（`evidence-store --write`），或在該 item 標 `(deferred: ...)` 附逐層 failure trail（格式同上方 MUST 3）。**NEVER** 為了讓它變綠去改 checkbox——那是把 false-green 從「沒被發現」變成「主動製造」。

    **NEVER** 用逐項 `evidence-store --has-evidence` 查過就當全項齊全。逐項查回答得了「這一項有沒有」，回答不了「哪些項還缺」——而收尾要問的正是後者，漏掉的永遠是沒被查到的那一項。這條與 MUST 8 是同一個 false-green 的兩端：MUST 8 管單項的 checkbox 不可信，本條管整批的「都驗完了」不可信。

16. **驗收對象需要登入態時，MUST 用真瀏覽器走到底並斷言登入後狀態（hard rule）**：只要被驗的流程**需要 session 才會顯示正確結果**（登入後頁面、帶權限的 API 經瀏覽器呼叫、任何「登入 → 跳轉 → 落地頁」鏈路），**MUST** 用真瀏覽器點完整條鏈路，並斷言**登入後**的 DOM 狀態——不是斷言狀態碼、不是斷言 `href` 字串。可觀察的最小斷言組：落地頁 `location.href` 是預期路徑、`document.querySelector('input[type=password]')` 為 `null`、以及一個只有登入後才存在的元素。

    ```bash
    agent-browser open '<login-url>'
    agent-browser eval "JSON.stringify({url: location.href, hasLoginForm: !!document.querySelector('input[type=password]')})"
    ```

    **NEVER** 拿 curl 的狀態碼當帶認證流程的證據。curl **完全不理會** cookie 的 `Secure` 屬性——`-c jar` 照存、`-b jar` 照送，不看 scheme；瀏覽器只在 secure context（`https://`，或 `localhost` / `127.0.0.1` 的明文豁免）儲存 `Secure` cookie。所以經 plain-HTTP origin 登入時，「302 正確 → redirect target 正確 → 落地頁 200」三個訊號**全部正常**，而瀏覽器早在第二步就把 cookie 靜默丟棄，使用者拿到的是未登入畫面。同型差異也存在於 `SameSite` 與 secure-context-only 的 Web API——curl 一律不模擬。

    **NEVER** 用「開過瀏覽器」抵這條：同一輪實測開了瀏覽器但只讀 `href` 字串沒點下去，一樣沒驗到。**檢查 artifact 的形狀不等於檢查它的行為。**

    非 localhost origin 要能登入，該 origin 自己**必須**是真 HTTPS（例：tailnet 的 `tailscale cert` + MagicDNS）。兩者皆無時 **NEVER** 退回 plain-HTTP proxy 產生登入連結——改回報「需 HTTPS 才能登入」並說明原因。（per [[pitfall-plain-http-proxy-cannot-carry-secure-session]]）

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

`audit-evidence-completeness`（MUST 15 的機械層）：`vendor/scripts/audit-evidence-completeness.ts`，遵守 [[checker-contract]] § REQUIRED output contract 與 § Exit code 契約——`0` = 全齊或無已勾 item、`1` = 有缺口、`2` = repo / change / tasks.md 讀不到。它只核對**已勾** item；未勾的計入 `skipped`，不算缺口。

## 違反時的回報方式

```text
[agent-self-verification] Hard rule violation
修正：黑名單句型 → 走 fallback chain 自跑；`(deferred:)` 缺 trail → 補 (a)(b)(c)(d) 失敗原因；error 原文 forward → read source / --help 驗 CLI contract
繞過：真需 user 親手做（真機刷卡等）→ 標 `(deferred-user-only: <reason>)`
```
