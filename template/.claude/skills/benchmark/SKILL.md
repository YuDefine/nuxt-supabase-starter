---
name: benchmark
description: "Use when 要產出、查核或依據一個量測出來的效能數字：報 speedup／regression、挑 library 或設定、凍結 benchmark harness、對單一指標做 hillclimb。NOT for 找出變慢的原因（/diagnose）、估工時或交期（/estimate-hours）、CI runner 規格與排隊（/ci-runners、/delivery-capacity）。"
---


# benchmark

數字出口之前，先查它量到的是不是你以為的那件事；要逼近目標時，一次只改一件、量完才決定留不留。改編自 pstack 的 `benchmark-checklist`、`principle-explain-the-number` 與 hillclimb／perf-issue playbook，授權見 `references/UPSTREAM.md`。

# SOP

## Phase 1 -- 先寫主張再量

1. THINK 先寫下要出口的那句主張（含數字、單位、資料規模，例如「60k 筆匯出 p50 快 30%」）、什麼結果會改變決定、noise floor；run-to-run 的擴散比預期效果大就先停，不繼續量。
2. READ 讀取量測腳本或指令，記下它計時什麼、數什麼、忽略什麼；跑 `uptime` 與 `nproc` 看機器忙不忙，忙又停不掉就在 Phase 2 交錯兩側並在報告寫明。
3. THINK 使用者明說「只要抓個大概」且只量一次時，只做七問的第 4、7 問並寫明單次；任何選項之間的比較（挑 library、runtime、設定）一律不算大概，走完整 Phase 2。

## Phase 2 -- 逐側調到 production 設定並量

1. READ 讀取 `rules/量測七問.md`，逐問用跑出來的證據回答；limiter 要靠不報告的 profile 跑、第 2 問要把每一側調到 production 設定再量。
2. DELEGATE 兩側各量至少 5 次並交錯（A、B、A、B…），把兩組數字依序交給 `node <本 skill 根目錄>/scripts/summarize-runs.mjs --a <數字,逗號分隔> --b <數字,逗號分隔>`（指標越大越好時加 `--higher-is-better`），讀 stdout 的 `route=` 分流：

評估：first-match；以上皆非 → R*
| id | `route` | 動作 |
| --- | --- | --- |
| R1 | `need-more-runs` | 補跑到每側 ≥ 5 次再判，**NEVER** 用不足次數的數字下結論 |
| R2 | `no-measurable-difference` | 結論寫「沒有可量測差異」，附 script 印的 median 與 range |
| R3 | `faster` 或 `slower` | 該方向成立；仍要通過七問其餘各問才能寫進報告 |
| R* | 其他值、欄位缺、exit 2 | STOP，回報 script 原始輸出，**NEVER** 憑印象判方向 |

3. THINK 差距很接近且 script 判不出時，用 rank-sum 檢定或 harness 自帶的統計判斷；這一步是 agent 判斷，script 刻意不做。

## Phase 3 -- 出報告

1. THINK 先選 verdict：faster／slower／no measurable difference／inconclusive；宣稱有差異卻說不出 limiter、有一側沒調到 production 設定、或第 4／7 問查不了時，一律寫 inconclusive 並寫明缺口。
2. WRITE 先讀取 `templates/benchmark-report.md` 與 `templates/benchmark-report.example.md`，再依骨架複製結構、參考範例改寫數字、單位、跑數、range 與 limiter，完成結論先行的量測報告；PR 描述只放一個主數字，細節放連結檔。

## Phase 4 -- 持續逼近單一指標（hillclimb，可選）

1. THINK 只在「持續逼近單一指標的目標」時走本 Phase；一次性修復不走，回 Phase 1–3。
2. READ 讀取 `rules/hillclimb迴圈與停止條件.md`，先凍結 harness 並證明它分得出差異，再定指標、方向與含次數下限的停止條件。
3. WRITE 先讀取 `templates/decision-log.txt` 與 `templates/decision-log.example.txt`，再依骨架複製欄位、參考範例改寫，在 repo 之外開這個 hillclimb 的決策紀錄，每個嘗試一列，保留與回退都記。
4. DELEGATE 每輪一個假設、一次改動，凍結 harness 量前後，依 Phase 2 第 2 步取 `route=` 判指標有沒有越過 noise，並依 rule 的決策表決定保留或回退；結束時回報指標與目標、baseline 到最終的百分比、保留與回退次數、每個保留的修正一行、決策紀錄路徑、下一個最想試的點子。

## 相鄰 skill

| 場景 | 用 |
| --- | --- |
| 找出變慢或壞掉的原因 | `diagnose`（變慢的原因歸它；數字能不能信歸本 skill） |
| 工作量、交期 | `estimate-hours` |
| CI runner 規格、排隊、容量 | `ci-runners`、`delivery-capacity` |
