---
name: "clade-project-standards"
description: "Cross-cutting project behavior and integrity rules. Use when work changes project behavior but no more specific clade skill applies."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/self-maintenance.md`：自我維運標準——新增或修改無人值守的制度（systemd unit／timer、排程 workflow）時，四件事必備：訊號、有界自動修復、狀態轉變才發的通知、被下一層看守的定期檢測；成熟度 experimental→validating→stable 由 ledger 算；且碰 `**/*.service`、`**/*.timer`、`.github/workflows/**`

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
