# 互斥鎖 —— budget 計數器窗口與 TD-424 的析取判準


SKILL.md Step 0 § 互斥鎖 的 exit 表、Iron Law、rationalization table 與 Red Flag **留在主檔**——
那些在「正要手寫一個鎖檔」的那一刻必須已經在 context 裡。本檔收的是**改判準時**才需要的成因。

## `continued` 與 `took-over` 讀錯的代價

**`continued` 是 runner 模式的常態**（第 2 輪起每一輪都回它）：同一個 `runner.sh` pid 的上一輪殘鎖，`sessionId` 與 `acquiredAt` 都由 script 保留。**NEVER 把 `continued` 讀成 `took-over`**——讀成 `took-over`（換新 `sessionId`／`acquiredAt`）的話，runner 下 `subagentsSpawned` 每輪歸零、`lock timestamp` 每輪重設，`>= 15` 與 `≥6h` 兩條**在無人值守下永遠不可能成立**，攔 runaway 只剩 `--max-rounds` / no-progress 2 輪 / 連續失敗 2 輪。判準寫在檔上但不會觸發，與判準不存在的差別只在讀的人以為有防線

## 歸零掛在哪裡

**NEVER 把歸零改掛在 `runner.sh` 起跑。** 兩條理由：in-session `/loop` 沒有 `runner.sh`，掛那裡會讓同一條停止條件在兩種 run mode 語義分裂；且 `runner.sh` 的分工是「不碰 state 內容、連續性全由 child 承擔」，歸零屬於 state 內容。鎖的 acquire 已經是「一次 run」的天然邊界，用它不必另外定義窗口。

## 析取判準（TD-424）

判準是**析取**——`heartbeat 在 45min 窗口內` **或** `pid 存活`，任一成立即為 active。只看 `$$` 的合取判準在 in-session 模式下恆判 stale，鎖形同虛設（[[TD-424]]）。

## 釋放與 orphan quarantine（主檔 Step 0 § 互斥鎖 的理由）

> 主檔 pointer：Step 0 § 互斥鎖 的「釋放」bullet 指向本節。判準本體在主檔，本節只放理由與證據，不複述判準；判準的增修只落主檔。

- **釋放為什麼等 attended reconciliation**：runner 保留持久 lock 檔供診斷，但 heartbeat/pid lease 仍可能在 process 退出後失效；`orphan-quarantine.json` 的 startup gate 才是禁止自動 retry 的機械保證。
- **歸零為什麼綁 `acquire` 的回傳**：這讓 Step 6.2 budget proxy 的兩半（`subagentsSpawned` 與 `lock timestamp`）字面共用同一個窗口定義。把續跑讀成新 run，兩半同時變成死碼；反過來每輪都累加，budget proxy 退化成跨 run 單調計數（門檻一旦跨過就永遠為真，[[TD-424]] 同型）。成因、TD-424 的析取判準、以及「為什麼歸零不能掛在 `runner.sh` 起跑」見本檔前文。
