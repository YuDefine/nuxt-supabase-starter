---
name: specify
description: >-
  將自然語言功能需求轉成本次迭代的 plan package，產出 `spec.md` 與
  `checklists/requirements.md`；package 路徑與 truth delta 的落點依
  `rules/Feature目錄命名與輸出定位判準.md` 決定。不得改寫舊 plan package，也不得寫入 `specs/truth/**`。
metadata:
  clade:
    invocation: explicit
disable-model-invocation: true
---
<!-- LOCKED: mirrored from Waterball-Software-Academy/aixbdd@903c11836d1190728647794cf73afb0f239aa496 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->
<!-- clade-skill-scope: both -->

# Specify

`specify` 是每次迭代的 plan 起點。它只描述「這次要改什麼」，不直接修改系統 truth。即使本次需求是修改或刪除既有行為，也建立新的 plan package，讓舊 plan 保持歷史，讓 `specs/truth/**` 代表目前系統真相。

# SOP

## Phase 1 -- 建立新的 plan package

1. READ 讀取使用者需求、呼叫者要求、目前 `specs/plans/` 下既有編號與 `specs/truth/**` 的高層現況，確認本次功能主題、範圍、語言要求與明示限制。
2. READ 讀取 `templates/spec.template.md`、`templates/spec.example.md`、`templates/requirements-checklist.md` 與 `templates/requirements-checklist.example.md`，確認 spec 與 checklist 的固定結構。
3. READ 讀取 `rules/Feature目錄命名與輸出定位判準.md`，依該判準決定本次 plan package 的路徑與輸出定位：命中 Rule 3 的 clade lifecycle repo 判準時走 `specs/plans/<work-id>/`（已由 `flow plan open` 鑄出），未命中時走遞增的 `NNN-<slug>`。
4. READ 讀取 `.agents/constitution/CONSTITUTION.md`、`.agents/constitution/shared.md`、`.agents/constitution/skills/specify/spec.md` 與 `.agents/constitution/skills/specify/requirements-checklist.md`，並將其中規則視為高於本地 artifact 規範的約束。
5. WRITE 依步驟 3 決定的路徑建立 plan package 與 `checklists/`，並初始化 `truth-delta.md` 骨架；本 phase 不建立或修改 `specs/truth/**`。
   - 命中 Rule 3 判準時，package 目錄已存在：NEVER 另建目錄、NEVER 建立 `truth-delta.md`、NEVER 覆寫 lifecycle 檔 `plan.md`。本輪的 truth 變更意圖改寫進 `plan.md` 的 `## Truth delta` 表，`state` 一律 `proposed`。

## Phase 2 -- 收斂需求缺口與 clarify 策略

1. THINK 從需求與現有 truth 整理主要使用者目標、核心流程、顯性限制、品質期望、可能的 ADD / MODIFY / DELETE 意圖與可辨識範圍邊界。
2. READ 若需要判斷哪些缺口必須升級為 clarify，讀取 `rules/Clarify升級門檻與提問預算判準.md`。
3. DELEGATE 若缺口會改變使用者故事切分、需求歸戶、主要流程、正式驗收標準，或會高影響修改/刪除既有 truth 行為，呼叫 `/clarify` 先訪談使用者；未收斂前停止，不自行假設答案。

## Phase 3 -- 重建 spec 語意骨架

1. READ 需要切分故事或需求歸戶時，讀取 `rules/使用者故事切分與優先級判準.md` 與 `rules/FR與NFR歸戶到UserStory與全域需求判準.md`。
2. THINK 依已載入規則收斂可獨立驗證的 User Stories、Priority、驗收情境、故事專屬 FR / NFR、全域需求、邊界情況、關鍵實體、成功標準與假設。
3. THINK 對涉及既有 truth 的需求，明確標示它預期是新增、修改或刪除現有系統行為，但不在本 skill 寫入 truth。

## Phase 4 -- 產出 plan artifacts 並自檢

1. WRITE 將 spec 寫入本次 plan package 的 `spec.md`，將 checklist 寫入同 package 的 `checklists/requirements.md`。
2. READ 讀取 `rules/spec完整性與一致性自檢判準.md`，檢查使用者故事、FR / NFR、驗收情境、邊界情況、成功標準、假設與剩餘 clarify 缺口是否一致；若不符合，立即修正。

## Phase 5 -- 交付後續 handoff

1. WRITE 向使用者回報 plan package、spec、checklist、truth delta 落點、本次是否進入 `/clarify`、仍保留的 `NEEDS CLARIFICATION` 或假設，以及此 plan 是否可進入 `/spec-by-example` 或 `/technical-research`。
   - 命中 Rule 3 判準時，truth delta 落點回報成 `plan.md` 的 `## Truth delta` 表，NEVER 回報一個 `truth-delta.md` 路徑；同時回報被省略的 artifact 已在 `plan.md` 的 `## Decisions` 留下理由。
