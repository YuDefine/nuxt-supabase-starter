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
    'capabilities/**/hooks/**',
    'capabilities/**/skills/**',
    'server/api/auth/**',
    'packages/*/server/api/auth/**',
  ]
---
<!-- Clade native rule; source: rules/core/agent-self-verification.claim-cross-check.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# Agent Self-Verification — 宣稱交叉核對（MUST 1 / 4 / 10 / 12 / 13 / 14）

> [[agent-self-verification]] 的 path-scoped sibling；常駐層的條款不因本檔沒載入而不存在。

## MUST（編號沿用 [[agent-self-verification]] § MUST，NEVER 重編）

1. **派 subagent 收 evidence 前**：主線先**嘗試自己跑**。Subagent 只在主線資源會被大量消耗時派；single-shot collection（一張截圖 / 一次 curl）**default** 主線自跑。
4. **工具呼叫前 verify CLI contract**：對 vendor script / external CLI，呼叫前 grep `Usage:` / `--help` / source 確認 flag / stdin / env var。`Usage:` 出現在 stderr = argv 錯，root cause 在 dispatcher source，**不**是 user 端設定。

   **`--help` 不是天生安全的探測手段**：對不解析 `--help` 也不擋 unknown flag 的 script，它等同無參數執行。**MUST 先讀 source 確認它對 unknown flag 的處置**（shim 要追到實作端）再探測；**NEVER** 對這類 script 用 `| head -N` 限制輸出量（per [[checker-contract]] § 上游具副作用時，提前退出命令會把它腰斬）。
10. **部署宣稱需交叉核對**：宣稱部署平台 / runtime 時，**MUST** 核對 `.github/workflows/` deploy job + deploy config（`wrangler.toml` / `Dockerfile`）+ `package.json` scripts。**NEVER** 只引單一 `docs/` 文件。

    **開始調查 production 之前先釘 canonical tuple**：讀任何設定 / 查任何 log / 提任何修正**之前**，**MUST** 先確認四項並寫出來——repo、framework、hosting platform、domain。**NEVER** 從當前工作目錄推斷是哪個 production 專案。四項有任一項答不出來就還不能動手。


12. **「這個帳號能不能登入 / 能不能管理」MUST 逐層驗，不從單層外推**：回答任何帳號可用性問題前，**MUST** 分別驗證五層並逐層寫出結論——(a) 該人在該環境是 active（未離職 / 未停用）、(b) 登入 provider 與 route 對該帳號開放、(c) platform role 是 active、(d) session 真的建得起來、(e) 登入後的 UI 與 API permission 確實放行。**NEVER** 因為 DB 有一筆 employee row、或某份文件列了那個 email，就宣稱帳號可用。

13. **改工具定義前 MUST 從實際生效的命令反查 source**：要改一個 skill / script / hook 的行為時，**MUST** 先確認「執行時真正被讀到的是哪個檔」——從實際跑的命令、程序的 argv、或該工具自己印出的路徑往回查。**NEVER** 從執行環境（主機、容器、VM）推定 source。

14. **判定外部 server / daemon 是否存活 MUST 對齊自己這條連線**：MCP server、dev server、tunnel 這類長駐程序報連線錯誤（`Transport closed` 等）時，**MUST** 用 process tree 確認「當前 session 的 PID 與它的直接子程序」，**NEVER** 因為看到**同名**程序還活著就判定 server 正常。修復時同樣 **MUST** 用不終止其他 session 的方式（版本化安裝 + 隔離 cache dir）。同一個 stdio MCP 的查詢**預設串行**，不要開沒必要的並行 outstanding call。


## Audit signal

MUST 15 的機械層：`flow plan check-close <work_id>`（`vendor/scripts/flow/plan-gates.ts::checkAcceptanceClose`）——`0` = 可結案、`1` = 有 finding（每條帶穩定 `code`：`acceptance-verdict-missing`／`-not-passed`／`-stale`、`acceptance-human-receipt-missing`／`-not-pass`／`-stale`）。它逐條核對 plan 的 acceptance 場景有沒有**新鮮**判決，不看 checkbox。
