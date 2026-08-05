<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Routine 設定 / Skill 關係 / Scope 排除

## 兩種無人值守觸發

**優先選 runner**（per SKILL.md Step 0 § 兩種跑法）——它每輪起新 process，context 不累積：

```bash
cd ~/offline/<consumer> && \
  ~/offline/clade/plugins/hub-core/skills/work-loop/runner.sh --max-rounds 20
```

要排程觸發時才建 routine（`/schedule`，user 手動做，本 skill 不自動建）：

```
Name: work-loop-<consumer-id>
Schedule: 0 */2 * * *  (每 2 小時，或 user 調整)
Mode: create_new_session_on_fire
Notifications: push: true

Prompt:
"你是 <consumer-name> 的自動化 work loop。
cd ~/offline/<consumer-path> && 執行 /work-loop --unattended
規則已寫在 skill 內，照做即可。"
```

**Cadence 提醒**：單輪 dispatch 可能 > 2h——重疊由 Step 0 互斥鎖擋（後到的輪次直接結束），
不需為此調長 interval；但若觀察到連續多輪都被鎖擋，代表工作規模 > cadence，把 interval
調成 4–6h 更省 routine fire 成本。

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
| **/schedule**（內建） | 建 routine 的入口（見上）；本 skill 不自動建 routine |

## 不做

- ❌ 自動建 spectra change（`/spectra-propose`）— 創建工作是 user 的職責。規模需開 change 的
  待辦 → packaging 成決策題，內容註明建議 propose
- ❌ Cross-consumer 編排 — per-consumer 各自一個 loop
- ❌ 不可逆動作 — prod 部署 / 刪 branch / tag / 遠端資料 / 花錢的 API / 任何 `--force`
  （publish 與 propagate **不在**此列，見 [guardrails.md](guardrails.md) 護欄 19）
- ❌ `--unattended` / runner 下呼叫 `AskUserQuestion` — 走 packaging，per SKILL.md Step 0 Iron Law

**tech-debt 是合法工作來源**（合併前的 `/change-loop` 曾把它列在「不做」）——`docs/tech-debt.md`
的 open entry 從 Step 2 的 `techDebtHygiene.raw` 進 candidate list，與 HANDOFF 條目同級。
