---
name: diagnose
description: "Use when 找出 bug 的原因：行為壞掉、丟錯、時好時壞或變慢，要求 debug／查原因。NOT for 已知原因只要記下來（/oops）、新功能或 review、決定工作怎麼開 package（/work-route）。"
---


# diagnose

先建一條會在這個 bug 上變紅的回饋迴圈，再推理原因。改編自 mattpocock/skills 的 `diagnosing-bugs`，授權見 `references/UPSTREAM.md`。

# SOP

## Phase 1 -- 建立會在此 bug 變紅的回饋迴圈

1. READ 讀取使用者描述的症狀、錯誤訊息、重現條件與 log，再讀取 `rules/遮蔽秘密判準.md`；之後展示的每段命令、輸出與 artifact 都先照它遮蔽。
2. DELEGATE 若症狀帶 runtime error 訊息且本 runtime 有 `/oops`，呼叫 `/oops` Mode A 以錯誤訊息與相關套件查經驗庫；命中的 fix recipe 仍要由本 SOP 的迴圈證明修好。
3. THINK 先讀取 `rules/回饋迴圈建構與完成判準.md`，依其建構順序選出並建立一條回饋迴圈，再依同一規則收緊。
4. WRITE 若已載入規則判定只能由人操作才能重現，先讀取 `templates/hitl-loop.sh` 與 `templates/hitl-loop.example.sh`，再依骨架複製 helper 與結構、參考範例改寫步驟與擷取欄位，在 scratchpad 產出這個 bug 專用的 HITL 重現腳本，作為本 Phase 的迴圈命令；這支腳本請使用者在自己的終端機執行，agent 只解析它印出的 `KEY=VALUE`。
5. DELEGATE 實跑該迴圈命令（HITL 腳本由使用者執行，agent 貼出它解析到的 `KEY=VALUE`），貼出遮蔽後的 invocation 與輸出；未達已載入規則的完成條件就回到第 3 步；建不出時依同一規則停下回報，不進 Phase 2。

## Phase 2 -- 重現並縮到最小

1. DELEGATE 重跑迴圈，確認紅燈對應的是使用者描述的症狀而不是附近另一個失敗，且可重複出現或重現率高到可以除錯。
2. THINK 逐一刪減輸入、呼叫端、設定、資料與步驟，每刪一項重跑迴圈，刪掉會轉綠的才留下，直到每個剩餘元素都是 load-bearing。

## Phase 3 -- 列出可證偽假設

1. THINK 先讀取 `rules/假設與觀測判準.md`，列出 3–5 個排序過的假設，每個寫出它的預測。
2. WRITE 把排序後的假設清單給使用者看，使用者在場就照使用者的重排或排除調整；不在場就派一個 fresh-context subagent 只讀清單與迴圈輸出，回報漏掉或排序不合理的假設，依它的意見調整後往下，不等待使用者。

## Phase 4 -- 一次驗一個假設

1. DELEGATE 依已載入規則，對排序最前、尚未排除的假設加一個觀測或改一個變數，重跑迴圈並記下結果是否符合預測；推翻就換下一個，全數推翻就回到 Phase 3 重列。

## Phase 5 -- 先鎖住迴歸再修

1. THINK 先讀取 `rules/迴歸落點與修復判準.md`，判斷迴歸測試的落點與是否存在正確的 seam。
2. WRITE 依已載入規則把最小重現寫成迴歸測試並看它紅，套用修正後看它綠，再對未縮小的原始情境重跑 Phase 1 的迴圈。

## Phase 6 -- 清理並交付

1. READ 依已載入規則的收尾清單逐項確認，每項附上證據。
2. DELEGATE 若根因是其他專案也會踩到的技術坑且本 runtime 有 `/oops`，呼叫 `/oops` Mode B 沉澱。
3. WRITE 回報成立的假設、修正內容、迴歸測試位置（或沒有正確 seam 這項發現）與各項證據。
