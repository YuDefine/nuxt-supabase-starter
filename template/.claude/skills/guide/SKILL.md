---
name: guide
description: >-
  Hub skill 地圖：本 repo 實際裝到的 skill 的使用場景、邊界與銜接流程（router，零 context 成本；依 consumer
  manifest 的 modules 分層）。
metadata:
  author: clade
  version: '1.0'
  clade:
    invocation: explicit
    permission_tier: read-only
disable-model-invocation: true
---


# /guide — hub skill 地圖

不確定該用哪個 skill 時打 `/guide`：把使用者的處境對到本 repo 實際裝了的一支 skill，直接交給它；本 skill 不執行任何工作。

# SOP

## Phase 1 -- 確認本 repo 實際裝了哪些 skill

1. READ 讀取當前 repo 的 consumer manifest（`.clade/manifest.json`，legacy `.claude/hub.json`）的 `modules`，記下宣告了哪些 capabilities、framework 與 ecosystem。

## Phase 2 -- 把使用者處境對到一支 skill

1. THINK 先讀取 `rules/skill路由判準.md`，排除 manifest 沒宣告的 module 標記列，再依使用者描述選主流程、症狀入口、user-invoked 或 commit 其中一列。
2. DELEGATE 直接 invoke 選定的 skill；選中 user-invoked 那幾支時，改為告訴使用者要手動打的指令。
