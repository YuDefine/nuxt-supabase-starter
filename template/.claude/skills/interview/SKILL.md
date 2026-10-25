---
name: interview
description: Use when 使用者想先討論需求、做需求訪談、「先聊清楚再做」，或 work-route 判不出需求分流、進行中的 package 要停下來討論。只在對話問答，產出確認過的訪談交棒摘要，確認後交 work-route 或 presale。NOT for 實作前 owner 卡住的選擇題（clarify）、只要重述理解（rs）、新客戶規格書與報價本身（presale）。
license: MIT
metadata: {"author":"clade","version":"1.0","clade":{"permission_tier":"read-only"}}
---


# interview（需求訪談）

和使用者一起把需求談清楚，談到 work-route 能直接分流、開 package、交 owner 而不必重問。本 skill 全程唯讀：**NEVER** 寫 repo 檔、開 package、鑄 work id、開 worktree；落地一律交棒後由 work-route 做。

路徑相對本 skill 根：Claude `.claude/skills/interview/`、Codex `.agents/skills/interview/`；work-route 在同層 `../work-route/`。

# SOP

## Phase 1 -- 定位訪談脈絡

1. READ 判入口：work-route `SKILL.md` T 表的 T1 成立（不能向使用者詢問）時不訪談，照 T1 處置後停止；帶著 work id 從 work-route 進來 → 讀該 package `plan.md` 的 Scope、Decisions、Open work，只談要停下來討論的那一塊；否則為全新訪談。
2. READ 唯讀查脈絡：與主題相關的 `specs/truth/**`；lifecycle repo 跑 `flow plan list`，讀 Scope 與主題重疊的每一份 `plan.md` 的 Scope 與 Decisions。既有 artifact 已回答的事實記成已知，不再問。
3. READ 讀取 `../work-route/rules/需求分流判準.md` Rule 2 與 `../work-route/rules/工作種類與必要產物.md` Rule 1，列出要判出分流列與 `work_kind` 必須答得出的分流事實。

## Phase 2 -- 逐題訪談

1. THINK 本次訪談尚未載入時讀取 `rules/訪談提問與收斂判準.md`，對照已知事實與分流事實，挑影響最大的下一個缺口。
2. WRITE 依已載入規則問一題；等使用者回答，不自行假設答案。
3. THINK 吸收回答，更新已知事實、推測與未決題；未過已載入規則的收斂 gate 就回 step 1。

## Phase 3 -- 摘要並取得確認

1. WRITE 先讀取 `templates/訪談交棒摘要.md` 與 `templates/訪談交棒摘要.example.md`，在對話輸出摘要；推測與已確認事實分開標示。
2. READ 讀取使用者的確認或修正；有修正就更新摘要再請確認。使用者明確確認前停在此處，不交棒。

## Phase 4 -- 交棒

1. THINK 依下表決定出口：

評估：first-match；以上皆非 → I*

| id | predicate | 出口 |
| --- | --- | --- |
| I1 | 使用者明說不落地（只想聊聊、評估看看）；「先討論一下」不算 | 結束；摘要留在對話 |
| I2 | 本次帶著 work id 從 work-route 進來 | 回 work-route 同一 work id 的原續跑位置；摘要的新決策交它寫進該 `plan.md` § Decisions |
| I3 | 新客戶、尚未簽約，要規格書、Milestone 或報價 | 交 presale；摘要當 `intake/` 素材 |
| I4 | cwd 是已 onboard 的 repo | 交 work-route；摘要當它 Phase 1 的已確認範圍 |
| I* | 以上皆非 | 問使用者這份需求要落在哪個 repo，或要不要走 presale |

2. DELEGATE 依出口讀取目標 skill 的 `SKILL.md`，把確認版摘要原文帶入並由同一 agent 接續執行；不要求使用者另打 slash command。
