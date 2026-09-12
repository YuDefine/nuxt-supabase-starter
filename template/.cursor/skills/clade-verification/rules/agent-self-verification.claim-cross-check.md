---
description: MUST 1 / 4 / 10 / 12 / 13 / 14 的全文——派 subagent 收 evidence 前的主線自跑義務、呼叫外部 CLI 前的 contract 驗證、部署宣稱的三方交叉核對與 canonical tuple、帳號可用性的五層逐層驗、改工具定義前從實際生效命令反查 source、外部 daemon 存活判定要對齊自己這條連線。這六條的觸發都綁得到具體檔案（deploy config／auth 路徑／工具定義檔／agent 定義），故 path-scoped；「任何一次下結論就會發作」的那幾條（MUST 11 / 17 / 18 / 19 / 20）留在 [[agent-self-verification]] 常駐層，本檔不複述
paths:
  [
    '.claude/agents/**',
    '.github/workflows/**',
    'wrangler.{toml,jsonc}',
    'Dockerfile',
    '.mcp.json',
    'vendor/scripts/**',
    'scripts/**',
    'plugins/**/hooks/**',
    'plugins/**/skills/**',
    'server/api/auth/**',
    'packages/*/server/api/auth/**',
  ]
---
<!-- Clade native rule; source: rules/core/agent-self-verification.claim-cross-check.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# Agent Self-Verification — 宣稱交叉核對（MUST 1 / 4 / 10 / 12 / 13 / 14）

> 本檔是 [[agent-self-verification]] 的 path-scoped sibling。§ 證據鑑別力、§ 否定命題 MUST 先做陽性對照、
> § 驗收 gate MUST 收窄、句型黑名單、以及 MUST 11 / 17 / 18 / 19 / 20 留在該檔常駐層——那幾條的觸發是
> 「任何一次下結論、任何一次跑診斷指令」，綁不到檔案。**NEVER** 因為本檔沒載入就當作那幾條不存在。

## MUST（編號沿用 [[agent-self-verification]] § MUST，NEVER 重編）

1. **派 subagent 收 evidence 前**：主線先**嘗試自己跑**。Subagent 只在主線資源會被大量消耗時派；single-shot collection（一張截圖 / 一次 curl）**default** 主線自跑。
4. **工具呼叫前 verify CLI contract**：對 vendor script / external CLI，呼叫前 grep `Usage:` / `--help` / source 確認 flag / stdin / env var。`Usage:` 出現在 stderr = argv 錯，root cause 在 dispatcher source，**不**是 user 端設定。

   **`--help` 不是天生安全的探測手段。** 對**沒有**解析 `--help`、也**沒有** unknown-flag 檢查的 script，`--help` 等同無參數執行 —— 探測動作本身就是那個危險動作。因此 **MUST 先讀 source 確認它對 unknown flag 的處置**（報錯退出？忽略照跑？）再決定怎麼探測；shim 檔要一路追到實作端（45 行的轉呼叫 shim 看起來人畜無害，危險的是它背後那支實作）。**NEVER** 對這類 script 用 `| head -N` 限制輸出量 —— 那會把它腰斬在中途（per [[checker-contract]] § 上游具副作用時，提前退出命令會把它腰斬）。
10. **部署宣稱需交叉核對**：宣稱部署平台 / runtime 時，**MUST** 核對 `.github/workflows/` deploy job + deploy config（`wrangler.toml` / `Dockerfile`）+ `package.json` scripts。**NEVER** 只引單一 `docs/` 文件。

    **開始調查 production 之前先釘 canonical tuple**：讀任何設定 / 查任何 log / 提任何修正**之前**，**MUST** 先確認四項並寫出來——repo、framework、hosting platform、domain。**NEVER** 從當前工作目錄推斷是哪個 production 專案：cwd 只說明你在哪個 checkout 裡，不說明它部署到哪、甚至不說明它有沒有部署。四項有任一項答不出來，就還沒到可以動手的階段。（<consumer-k> 2026-07-14 實證）


12. **「這個帳號能不能登入 / 能不能管理」MUST 逐層驗，不從單層外推**：回答任何帳號可用性問題前，**MUST** 分別驗證五層並逐層寫出結論——(a) 該人在該環境是 active（未離職 / 未停用）、(b) 登入 provider 與 route 對該帳號開放、(c) platform role 是 active、(d) session 真的建得起來、(e) 登入後的 UI 與 API permission 確實放行。**NEVER** 因為 DB 有一筆 employee row、或某份文件列了那個 email，就宣稱帳號可用——這兩者都只證明 (a) 的一部分，跟 (b)–(e) 沒有任何蘊含關係。（<consumer-a> 2026-07-19 實證）

13. **改工具定義前 MUST 從實際生效的命令反查 source**：要改一個 skill / script / hook 的行為時，**MUST** 先確認「執行時真正被讀到的是哪個檔」——從實際跑的命令、程序的 argv、或該工具自己印出的路徑往回查。**NEVER** 從執行環境推定 source：工具跑在哪台主機、哪個容器、哪個 VM，跟它的定義檔放在哪是兩件無關的事。改錯檔的輸出跟改對檔一樣是「已修改」，只有下次執行才會發現沒生效。（實錄見 rationale）

14. **判定外部 server / daemon 是否存活 MUST 對齊自己這條連線**：MCP server、dev server、tunnel 這類長駐程序報連線錯誤（`Transport closed` 等）時，**MUST** 用 process tree 確認「當前 session 的 PID 與它的直接子程序」，**NEVER** 因為看到**同名**程序還活著就判定 server 正常——別的 session 開的同名程序跟你這條連線沒有關係。修復時同樣 **MUST** 用不終止其他 session 的方式（版本化安裝 + 隔離 cache dir）。同一個 stdio MCP 的查詢**預設串行**，不要開沒必要的並行 outstanding call。（<consumer-b> 實證）


## 為什麼派 subagent 不是 default

- 無主線 working context，cold start 易 lazy decision
- 對「自己合理化跳過」無自律（per [[agent-self-verification]]）
- 主線自跑可即時觀察並調整；subagent 是 batch 模式

→ 派 subagent =**主線確定無法獨自完成**時才用，不是 default。

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Verify channel baseline / Dev-login scaffold | [[manual-review.backend]] § Pre-verify baseline 假設 + § Dev-login route missing → scaffold-first |
| Screenshot-review verify mode dispatch | [[agent-routing]] § Routing Table `visual verifier verify mode` + [[agent-routing.pi-watch-protocol]] § visual verifier Verify Mode Dispatch |
| `[verify:e2e]` / `[verify:api]` / `[verify:ui]` annotation 格式 | [[manual-review.backend]] § 標準流程 |
| Self-collect fallback chain (a)(b)(c)(d) | [[main-self-collect-fallback-chain]]（cookbook） |
| review-gui 補 evidence prompt 是 fallback 不是 default | [[manual-review]] § review-gui 補 evidence prompt 路徑分類（pending TD-161） |
| Review-gui surface SoP（呼叫 review-gui 的 agent / wrapper） | [[review-gui-surface]] |

## Audit signal

`verify-evidence-deferred-without-self-collect-attempt` — TD-161 Resolution 留作 first incident 後再評估，script 未建。

`audit-evidence-completeness`（MUST 15 的機械層）：`vendor/scripts/audit-evidence-completeness.ts`，遵守 [[checker-contract]] § REQUIRED output contract 與 § Exit code 契約——`0` = 全齊或無已勾 item、`1` = 有缺口、`2` = repo / change / tasks.md 讀不到。它只核對**已勾** item；未勾的計入 `skipped`，不算缺口。

