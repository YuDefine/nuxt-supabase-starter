---
name: cli-design
description: >-
  AI 友善的 CLI 設計與稽核（判準取自 Cloudflare `cf` CLI）。
  Use when 新寫 CLI、新增或改動命令與旗標、稽核既有 CLI 對 agent 友不友善。
  NOT for CLI 壞掉找原因（diagnose）、shell script 的 sudo／trap 安全、只是用某支 CLI 完成任務。
metadata:
  author: clade
  version: "1.0"
---


# CLI Design

設計與稽核共用同一份判準：每一項有 ID，設計時逐項滿足，稽核時逐項判定。下文 `<skill 根目錄>` 指本 skill 所在目錄（Claude Code 載入時印出的 `Base directory for this skill`）。

# SOP

## Phase 1 -- 收斂對象與 lane

1. READ 讀取使用者需求與目標 CLI 的原始碼入口、文件與既有 `--help`，判定走 design lane（新 CLI，或新增、改動命令介面）還是 audit lane（稽核既有 CLI），並確認主要使用者（agent、CI、人）與規模（單支 script 或多層命令樹）。
2. READ 讀取 `rules/AI友善CLI設計判準.md`，依其適用條件與已確認的使用者、規模，列出本次適用的判準 ID；design lane 進 Phase 2，audit lane 進 Phase 3。

## Phase 2 -- 產出命令介面規格（design lane）

1. THINK 依已載入判準逐項 ID 設計命令樹、共通旗標、輸出契約、錯誤與退出碼、非互動行為、破壞性操作、可發現性、認證設定與一致性治理；與既有命令衝突時，以已載入判準的詞彙為準並列出遷移方式。
2. WRITE 先讀取 `templates/cli-design-spec.md` 與 `templates/cli-design-spec.example.md`，再依骨架複製結構、參考範例改寫內容，產出規格寫入使用者指定位置（未指定時寫進 scratchpad）。
3. WRITE 若使用者要求實作，依規格實作，完成後以實作出的 CLI 為對象進 Phase 3；未要求實作則進 Phase 5。

## Phase 3 -- 蒐集稽核證據（audit lane）

1. READ 讀取 `rules/稽核探測與判定判準.md`，從原始碼確認 `--help` 會被攔截，以及目標 CLI 不帶引數與遇到看不懂的輸入時做什麼，再依已載入規則決定本次 `--allow`、`--typo` 與 `--depth`。
2. DELEGATE 執行 `uv run <skill 根目錄>/scripts/probe_cli.py [--allow <已確認安全的探測>] [--typo <名稱>] [--depth <N>] -- <CLI 命令與前綴參數>`，取得 help、版本、未知命令、未知旗標、色碼、等待輸入、子命令與旗標清單的 JSON 事實。
3. READ 讀取目標 CLI 原始碼與文件，補齊探測拿不到的判準項（破壞性操作的確認路徑、退出碼對照、錯誤輸出串流、認證優先序）。

## Phase 4 -- 判定並產出稽核報告（audit lane）

1. THINK 依已載入規則逐項 ID 判定 PASS、PARTIAL、FAIL 或 N/A，每格對應一筆探測輸出或原始碼位置，FAIL 與 PARTIAL 寫出修法，再依嚴重度排序。
2. WRITE 先讀取 `templates/cli-audit-report.md` 與 `templates/cli-audit-report.example.md`，再依骨架複製結構、參考範例改寫內容，產出報告寫入使用者指定位置（未指定時寫進 scratchpad）。

## Phase 5 -- 驗證產出

1. READ 回頭檢查產出是否符合已載入規則：規格的每個適用 ID 都有對應設計或 N/A 理由；報告的每格判定都有證據、每個 FAIL 都有修法、未探測項都寫了原因；不符合就回到對應 phase 修正。
