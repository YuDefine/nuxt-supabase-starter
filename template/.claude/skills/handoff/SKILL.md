---
name: handoff
description: Session 交接。Use when `/handoff` 要登記進度，或在支援的 runtime 交給 successor。NOT for 單純 commit 收尾（走 `/commit`）。
license: MIT
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: action
---


# /handoff

> Runtime host-specific relay/fanout restrictions and launcher/tool bindings are supplied by the selected runtime adapter. The shared rules below define durable handoff semantics and fail-closed boundaries.

Session 交接管理：`park`／`relay`／`fanout`／`next` 四種模式，判準都在 `rules/`，照下列 SOP 在命中時讀。

## User Input

```text
$ARGUMENTS
```

# SOP

## Phase 1 -- 判定 runtime 邊界、延續價值與交接模式（Codex boundary／Step 0.1／Step 0／Step 0.5／Step 1）

1. READ 每次進入 `/handoff`，讀取 `rules/模式偵測與park閘判準.md`：先過 Step 0.1 value-first gate（判準在 `rules/價值優先延續判準.md`），解析 `$ARGUMENTS`，裸 `/handoff` 再過 Step 0.5 context 預算 gate 與 Step 1 兩層判定，落到 `park`／`relay`／`fanout`／`next` 其一；落到 `park` 的裸呼叫 MUST 先過 park gate。
2. READ 若模式是 `relay`，讀取 `rules/relay接力判準.md` 全文並照順序執行（共用底座入口 `rules/派工前置與身分分流判準.md`，其餘共用段由 rules 內連結用到才讀）；若是 `fanout`，讀取 `rules/fanout派工判準.md` 全文照做（同樣先讀 `rules/派工前置與身分分流判準.md`）。共用底座依用到才讀：`rules/durable-brief撰寫判準.md`（寫 brief）、`rules/派工helper與launcher判準.md`（呼叫 helper、選 launcher）、`rules/runtime清理與parent-worktree判準.md`（寫 brief 前判 parent worktree 去留與誰接手、收尾清理）、`rules/派工收工訊息判準.md`（收工訊息）、`rules/worker殘工回報判準.md`（worker 回報殘工）。完成後跳到 Phase 5。

## Phase 2 -- 解析 main worktree 的全局寫入路徑（Step 1.5；park／next 共用）

1. READ 若模式是 `park` 或 `next`，讀取 `rules/路徑解析判準.md`，解析 `$MAIN_WT_PATH`；之後所有 `HANDOFF.md`／`ROADMAP.md` 寫入都用它的絕對路徑。

## Phase 3 -- 登記 park 交接（僅 park）

1. READ 若模式是 `park`，讀取 `rules/park登記與HANDOFF寫回判準.md`，照 park 步驟與 HANDOFF 寫回契約登記；之後直接到 Phase 4 的 Step 3。

## Phase 4 -- 完成 next 盤點、推薦並收斂 worktree 與 stash（2B.0–2B.5／Step 3）

1. READ 若模式是 `next`，讀取 `rules/next盤點與推薦判準.md`，依 2B.0→2B.1 執行（盤點細節在 `rules/next掃描步驟判準.md`）；走到 2B.1.5 時 MUST 先讀取 `rules/worktree與stash收斂判準.md`，在此跑完 Step 3（3.1→3.3→3.5；3.5.1 僅 maintenance 才進，查表細節在 `rules/worktree與stash稽核判準.md`），再接 2B.1.7→2B.1.8→2B.1.9→2B.2→2B.2.5→2B.3→2B.4→2B.4.5→2B.5（2B.3–2B.5 在 `rules/next派工與推薦訊息判準.md`；2B.4.5 用的是 2B.1.5 那次 Step 3.1 的結果）。Step 3 跑過就不在 2B.5 之後重跑。
2. READ 若模式是 `park`，Phase 3 完成後讀取 `rules/worktree與stash收斂判準.md` 跑 Step 3／3.5（細節在 `rules/worktree與stash稽核判準.md`；3.5.1 僅 maintenance 才進）。

## Phase 5 -- 收工並輸出收工訊息（Output contract）

1. READ 每種模式收工前，讀取 `rules/收工訊息與銜接判準.md`，先跑 worktree backlog 檢查，再依模式成功條件輸出完成訊息；失敗或 blocked 明說卡點，不假裝完成。


# Runtime adapter: Claude

Claude Code native question handling uses `AskUserQuestion`; session work inventory uses `TaskList`. Background successor execution uses the canonical Herdr helper through `Task`/`Agent` only for bounded execution, with `TaskOutput`/`TaskStop` and the single inert `ScheduleWakeup` keepalive. These Claude tool names are adapter details; they do not authorize mutation or replace durable handoff receipts.
