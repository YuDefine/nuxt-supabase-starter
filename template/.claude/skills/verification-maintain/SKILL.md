---
name: verification-maintain
description: Use when user requests verification maintenance. NOT for setup.
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/verification-maintain/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Maintain project verification infrastructure

Feature map 會隨產品改動而腐化。本 skill 對每一個 feature 做 source reconciliation 與 live drive，但只維護 verification infrastructure，NEVER 在同一輪修產品 code。

## Outcomes

每次只能選一個：

| Outcome | 必要條件 | Git／PR 行為 |
| --- | --- | --- |
| `clean` | 每個 feature 都有 source + live coverage，沒有值得落地的 map／harness diff | **現況結果**：不建 branch、不 commit、不開 PR；dirty verification diff 必須為零 |
| `changed` | 已 live re-prove 的 doc、map 或 owned harness correction | 只包含 target verification skill；依 consumer `workflow_model` 建一個 PR，或以 selective commit 落 trunk |
| `blocked` | coverage 無法完成，或 proven correction 無法安全落地 | 不開 PR；列出已覆蓋範圍、blocker 與 preserved evidence |

**`clean` 是成功交付，不是「什麼都沒做」。** 它必須帶 coverage 與 evidence summary，但 repository outcome 保持無 branch／無 commit／無 PR。每日 unattended run 命中 `clean` 時也遵守同一契約，NEVER 製造空 PR 當活動證明。

## Edit scope

只可修改被維護的 `.claude/skills/verify-<app>/`：`SKILL.md`、`features/` 與它自己擁有的 harness scripts。

- map 描述錯誤 → doc drift，修 map。
- app 正常但 harness 無法 drive → harness gap，修 owned harness 並 live re-prove。
- app 行為真的壞掉 → product gap，只回報；NEVER 改產品 code，NEVER 把 map 改成假裝壞行為正確。

## Pass

### 0. Locate the target

找 `.claude/skills/verify-*/SKILL.md`。零個 → 停止並 invoke `/verification-create`；多個 → 讓使用者指定，不靠名稱相似度猜。

### 1. Validate index hygiene

```bash
node .claude/skills/verification-maintain/scripts/check-feature-map.mjs \
  .claude/skills/verify-<app>
```

修 missing／extra／duplicate／dead index entry。若修正只改結構，仍必須進 live pass 才能成為 `changed`。

### 2. Source wave

每個 feature 都要有 source evidence。依 clade routing threshold 收集：來源多時用一個 read-heavy／exploration prescan 批次處理，NEVER 照 upstream 原版無上限「一 feature 一 subagent」fan-out。

每個 feature 回傳：

```text
feature summary
source entry points with repo-relative locations
likely drift or none
one concise live recipe
```

Children／prescan 只讀 source，不 drive app、不改檔。

### 3. Reconcile

- 每個 feature file 都有 source summary。
- 合併重疊 recipes，減少 app state transitions。
- recent churn 只有具體 user-facing source path 才能判 missing feature。
- source 看起來 clean 不替代 live pass。

### 4. Live pass

Coordinator 依 target skill 的 Launch model drive 每個 feature：server/UI 用一個 leased instance 串行，short-lived CLI 每次用 isolated session。

全程維持：

1. first drive、fresh session、surprising failure 後先 Doctor；doctor 看不到 wedged UI 時 reset 或 relaunch。
2. cleanup 後逐次確認已捕捉 evidence 仍存在。
3. drive 建立的 process、port、profile、scratch state 不超過需要的生命週期。

Agent 可依已授予的 capability 自行 pause／resume；每次 pause／resume 都寫 audit event。這不授予新 credential、external write 或 global scope，grant 外仍走 human gate。

`verified-unreachable` 必須列 attempted route 與具體 unmet prerequisite。若 map 漏了 prerequisite，那是 doc drift。

### 5. Triage and re-prove

任何 map 或 harness correction 都要重跑受影響 feature。產品 gap 不進本次 diff；Experience acceptance 仍由產品 owner／指定 reviewer 決定，live pass 不能自動代表 UX accepted。

### 6. Ship or stop

- `clean`：確認 target dir 無 diff；不建 branch、不 commit、不開 PR。
- `changed`：重新讀每個 changed file；只落 target dir；依 workflow model 建一個 PR 或 selective commit。
- `blocked`：不開 PR；保留 evidence 與 scratch run summary，不把 scratch notes commit。

## Machine-readable report

stdout 結尾輸出：

```json
{
  "schema": "verification-maintenance/v1",
  "outcome": "clean|changed|blocked",
  "target": ".claude/skills/verify-<app>",
  "source_coverage": { "covered": 0, "total": 0 },
  "live_coverage": { "covered": 0, "total": 0 },
  "changed_paths": [],
  "product_gaps": [],
  "unreachable": [],
  "branch_created": false,
  "commit_created": false,
  "pr_created": false,
  "evidence": []
}
```

`clean` 的三個 created 欄位 MUST 全為 `false`。`blocked` 同樣不得藉由空 PR 表達狀態。敏感 evidence payload 依 policy redact／到期；metadata、digest 與 subject revision 留在 receipt。

## Timeout behavior

Product ruling 永不因 timeout 自動批准。External action 到期轉 `blocked`／`cancelled`，恢復時建立新 gate；NEVER 用過期答案繼續 live pass。

## Upstream attribution

本 skill 改編自 Lauren Tan 的 pstack `maintain-verification-skill`。授權與改編邊界見 [UPSTREAM.md](references/UPSTREAM.md)。
