<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/change-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Routine 設定 / Skill 關係 / Scope 排除

> 本檔從 SKILL.md § Routine 設定指引 / § 與其他 skill 的關係 / § 不做 搬移，原文逐字保留。

## Routine 設定指引

Per-consumer routine，用 `/schedule` 建立：

```
Name: change-loop-<consumer-id>
Schedule: 0 */2 * * *  (每 2 小時，或 user 調整)
Mode: create_new_session_on_fire
Notifications: push: true

Prompt:
"你是 <consumer-name> 的自動化 change loop。
cd ~/offline/<consumer-path> && 執行 /change-loop --unattended
規則已寫在 skill 內，照做即可。"
```

建 routine 是 user 手動做的事（`/schedule` skill），本 skill 不自動建。

**Cadence 提醒**：單輪 applyInProgress dispatch 可能 > 2h——重疊由 Step 0 互斥鎖擋（後到的輪次直接結束），不需為此調長 interval；但若觀察到連續多輪都被鎖擋，代表 change 規模 > cadence，把 interval 調成 4-6h 更省 routine fire 成本。

## 與其他 skill 的關係

| Skill | 本 skill 如何用它 / 邊界 |
| --- | --- |
| handoff-scan.ts | Step 1 + Step 4 scan state |
| /spectra-apply | 3a/3b/3f dispatch（透過 /wt） |
| /spectra-archive | 3z/3c/3d dispatch（直接，免 worktree） |
| /wt | worktree 建立 + dispatch subagent |
| /handoff | 不直接調用（本 skill 取代 handoff Mode B 的「推薦 + 等 user 選」環節，改為自動執行） |
| **/goal** | **attended 版姊妹**：user 在場、可 request_user_input、先讓 user 選 dispatch 優先序（見 [[goal-mode]] § 與 change-loop 的差異）。user 在電腦前想逐項拍板 → 用 /goal 不用本 skill |
| **/loop**（內建） | interval 盲跑某 prompt/命令、stateless 無 verifier。「每 N 分鐘重跑 X」→ /loop；「狀態驅動推進 spectra change」→ 本 skill |
| **/schedule**（內建） | 建 routine 的入口（見 § Routine 設定指引）；本 skill 不自動建 routine |

## 不做

- ❌ 自動建 spectra change（`/spectra-propose`）— 創建工作是 user 的職責（turbo 也不建）
- ❌ 處理 tech-debt — 除非 `--turbo` 且 HANDOFF/ROADMAP 明確列為待辦 `- [ ]` 項
- ❌ Cross-consumer 編排 — per-consumer 各自一個 loop（turbo 同）
- ❌ 修改 `.claude/rules/` 或 `AGENTS.md` — 標準層不在 scope（turbo 同）
- ❌ `--unattended` 時問 user 問題 — routine 無人值守，卡點 log + skip
