<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Skill 關係 / Scope 排除

## 無人值守只有一條路：runner

```bash
cd ~/offline/<consumer> && \
  ~/offline/clade/plugins/hub-core/skills/work-loop/runner.sh --max-rounds 20
```

它每輪起新 process、context 不累積，`--unattended` 由它自己帶（見 [run-modes.md](run-modes.md)）。
主線起它時要配齊的 cache-keepalive heartbeat 與 per-round Monitor 見 SKILL.md § 起 runner 的形狀與收尾契約 (d)(e)。

**本 skill 不走 cron / cloud routine**，也**不**教人建。2026-08-05 定案：唯一使用者不使用
`/schedule`，而留著一份沒人跑的排程設定只會讓讀者以為那是預期路徑。要週期性觸發就把
`runner.sh` 交給你自己的排程器（`--max-rounds` 控制單次上限，Step 0 互斥鎖擋重疊）。

**重疊怎麼辦**：單輪 dispatch 可能 > 2h。後到的輪次會被 Step 0 的互斥鎖直接結束，不需要
為此拉長間隔；但若觀察到連續多輪都被鎖擋，代表工作規模 > 觸發頻率，拉長間隔更省。

## 與其他 skill 的關係

| Skill | 本 skill 如何用它 / 邊界 |
| --- | --- |
| handoff-scan.ts | Step 2 + Step 5 re-scan 的唯一狀態來源 |
| /spectra-apply | spectra source 的 `feedbackGiven` / `readyForEvidence` / `applyInProgress` dispatch（透過 /wt） |
| /spectra-archive | `done` / `awaitArchiveWalkthrough` / `ready(0)` dispatch（直接，免 worktree） |
| /wt | worktree 建立 + dispatch subagent |
| /handoff | 不直接調用（本 skill 自動化 handoff Mode B 的「盤點 → 推薦 → 執行」，unattended 下把 AskUserQuestion 換成 packaging） |
| **/goal** | **attended 版姊妹**：user 在場、要逐項拍板 dispatch 優先序（見 [[goal-mode]]）。想逐項拍板 → 用 /goal 不用本 skill |
| **/loop**（內建） | interval 盲跑某 prompt/命令、stateless 無 verifier。「每 N 分鐘重跑 X」→ /loop；「狀態驅動推進待辦」→ 本 skill |

## 不做

- ❌ 自動建 spectra change（`/spectra-propose`）— 創建工作是 user 的職責。規模需開 change 的
  待辦 → packaging 成決策題，內容註明建議 propose
- ❌ Cross-consumer 編排 — per-consumer 各自一個 loop
- ❌ 不可逆動作 — prod 部署 / 刪 branch / tag / 遠端資料 / 花錢的 API / 任何 `--force`
  （publish 與 propagate **不在**此列，見 [guardrails.md](guardrails.md) 護欄 19）
- ❌ `--unattended` / runner 下呼叫 `AskUserQuestion` — 走 packaging，per SKILL.md Step 0 Iron Law

**tech-debt 是合法工作來源**（合併前的 `/change-loop` 曾把它列在「不做」）——`docs/tech-debt.md`
的 open entry 從 Step 2 的 `techDebtHygiene.raw` 進 candidate list，與 HANDOFF 條目同級。
