---
description: Routing Table 的取證層——Cursor readonly sandbox 為什麼擋掉每一個 mutation dispatch（含兩句最常見的開脫與 Red Flags）、grok 擴權的取證狀態、以及「拿數字當降檔理由」的三個陷阱（aggregate 跑分、配額權重 5:2.5:1、class-conditional 差距）。改 Routing Table 任一列、動 pi-routing-*.ts / pi-dispatch.ts，或要拿任何數字支持一次降檔／轉列時 path-scoped 載入；判準本身在 [[agent-routing.routing-table]]，本檔只承載理由與實證
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!-- Clade native rule; source: rules/core/agent-routing.routing-table-rationale.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Agent Routing — Routing Table 的取證層

> 本檔是原 `agent-routing.md` Routing Table 節前言的下推全文。**判準留在 [[agent-routing.routing-table]]**（哪些 model 合法、
> 六維 effort、`--route` / `--tier-basis` / `--table-row` 的 MUST），這裡只放它們的理由與實證——
> 那些內容每一份 always-load 都要付 bytes，而它們發作的時刻是「你正在改這張表」或
> 「你正要拿一個數字去支持降檔」，兩者都是 path-scoped 抓得到的。

## Cursor sandbox 與 mutation

判準（**任何 workspace mutation dispatch NEVER 選 `*-cursor`**）在 [[agent-routing.routing-table]] § Pi 派工的 workspace capability 與路徑可見性。
機制：`buildCursorSandboxArgv()` 對 root、cwd 與額外 bind 全用 `--ro-bind`；`pi-dispatch.ts` 在
Cursor admission fail closed，mutation chain 計算時直接跳過所有 `*-cursor`，capability 無法判定時
也不猜成 readonly。

即使 brief 的所有檔案都在 cwd 內、linked common gitdir 也已可見，答案仍相同：

| 開脫句 | 現實 |
| --- | --- |
| 「多掛主 gitdir」 | 只解 linked worktree 的 Git visibility，不會把任何 readonly bind 變 writable。 |
| 「這次 mutation 完全在 cwd 內」 | cwd 本身也是 `--ro-bind`；路徑在可見集合內與 carrier 有寫權是兩件事。 |

**Red Flags**：發現自己把錯誤讀成「mount 缺一條」、準備加 writable bind、或準備先派 Cursor 等
EROFS 再 fallback → 停；回到 `workspace_access` 分類，讓 dispatcher 在派工前排除 carrier。

實證邊界見 `docs/pitfalls/2026-08-30-cursor-readonly-sandbox-cannot-carry-worktree-mutation.md`。
`*-cursor` 讀不到 cwd 以外路徑（空 tmpfs `$HOME` / `/tmp`，回傳與真結果同形的全 missing 表）的
成因與實測在 `docs/archives/tech-debt-closed-2026-08.md` § TD-541。

## grok 擴權的取證狀態

> 2026-09-24 起 Grok 4.7 xhigh 已由 Charles 逐列拍板進入 `web-search`／`mechanical-fanout`／
> `read-heavy-scan`／`notion-ops`／`version-upgrade-research` 的鏈與 delegate-sub 鏈首——那是**政策決定**，
> 不是本節取證的結論。本節以下保留為當時（luna 仍在表上）的取證狀態紀錄。

**現行判準**：Grok 在哪一格、第幾跳，一律照 [[agent-routing.routing-table]]。**NEVER** 拿本節的
n=1 取證去主張把 Grok 推進表上沒有它的列——要轉列先補 TD-509 列的 reps，再改表。

## 拿數字當降檔理由的三個陷阱

- **NEVER 拿 aggregate 跑分推導 routing boundary**：要看的是**這一類工作**的差距，不是總分。
  **同一個陷阱適用於 effort 檔位之間**——「low 跟 high 在通用題上差不多」對安全類 /
  高漏報成本類零證據力。
- ⚠️ **配額權重 UNKNOWN**：**NEVER** 把 5:2.5:1 當成已證實的配額比寫進任何計算——那是 API 價格與
  purchased-credit rate card，**訂閱內含配額**的 per-model debit multiplier 官方未公布。
  **降檔究竟省多少配額目前無法量化**。
- 跑分數字組與 benchmark 性質見 `docs/rule-rationale/agent-routing.md` § model 檔位的量測依據。
  **NEVER 拿本規約的 rationale 推翻本規約的字面**（該句已登記在 `registry/rule-invariants.json`）。

## GPT 退場與 Sonnet 5.5 接手（2026-09-29）

取證全文在 `specs/plans/W-2026-09-29-routing-table-gpt-6-sol-sonnet-5-5-effort/plan.md` § 證據；這裡只留會被下一次改表誤讀的三點：

- **Sonnet 與 Opus 同一個額度池**：上游 usage API 只回 `five_hour`／`seven_day`，沒有 Sonnet 分池窗；per-model debit 倍率同樣 UNKNOWN（見上節）。所以 Sonnet 接手省的是「同池內的消耗速率」，**NEVER** 讀成「另開一池」，也 **NEVER** 拿 API 價差（Sonnet 5.5 是 Opus 5.5 的一半）推算訂閱配額節省。
- **`high` 不是跑分結論**：官方「agentic coding 從 `medium` 起跳」是 aggregate eval，本檔第一個陷阱禁用它；選 `high` 的理由是它為 Sonnet 5.5 的 API 預設，且接手的是原 Sol xhigh 的列、低 effort 較常未驗證即回報。要降 `medium` 先補同 brief ≥5 reps 的對照。
- **`dispatch-fallback` 不換 Sonnet**：倍率 UNKNOWN、無品質對照、Sonnet 低 effort 較常未驗證即回報，而鏈尾載體的輸出沒有下游語意 gate。
