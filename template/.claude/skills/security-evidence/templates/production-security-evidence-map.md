<!-- 改寫來源：Codex Security Bridge Kit Prompt 2（Production Blind-Spot Mapper）；改寫前的逐字版在 `git show bf08778b5c:capabilities/core/skills/security-evidence/references/production-blind-spot-mapper.md`，對照上游新版時從那份 diff -->
<!-- 判讀依據見 rules/production證據地圖判準.md。狀態四值：Confirmed／Needs Test／Needs Production Check／Unknown；verdict 三值：BLOCKED／CONDITIONAL／READY FOR REVIEWED SCOPE -->

## Production 安全證據地圖

### Verdict 與範圍

- Verdict：{{VERDICT}}
- 審查範圍：{{SCOPE_REVIEWED}}
- 日期與 repo 狀態：{{DATE_AND_REPO_STATE}}
- 理由：{{VERDICT_RATIONALE}}
- 這個 verdict 不能證明什麼：{{VERDICT_LIMITS}}

### 各層 Coverage

#### Repository

- 已審查：{{REPO_REVIEWED}}
- 已確認：{{REPO_CONFIRMED}}
- 排除或未知：{{REPO_EXCLUDED}}

#### Staging

- 已完成的測試：{{STAGING_DONE}}
- 還需要的測試：{{STAGING_NEEDED}}
- 與 production 的差異（哪些結論不能搬過去）：{{STAGING_DIFFERENCES}}

#### Production

- 已確認的控制：{{PROD_CONFIRMED}}
- 還需要的檢查：{{PROD_NEEDED}}

#### Third Party 與 Operations

- 已審查的系統：{{THIRD_PARTY_REVIEWED}}
- 還需要的檢查：{{THIRD_PARTY_NEEDED}}

### 依優先序的證據清單

#### P0 Blockers

- 安全規則或風險：{{SECURITY_RULE}}
  - 層：{{EVIDENCE_LAYER}}
  - 預期控制：{{CONTROL_TO_EXPECT}}
  - 通過條件：{{PASS_CONDITION}}
  - 目前證據：{{CURRENT_EVIDENCE}}
  - 狀態：{{STATUS}}
  - Proof Gap：{{PROOF_GAP}}
  - 安全蒐證方式：{{SAFE_COLLECTION}}
  - Owner：{{OWNER}}
  - 期限：{{DEADLINE}}

#### P1 Before Launch

<!-- 欄位同 P0 Blockers -->

#### P2 Hardening

<!-- 欄位同 P0 Blockers -->

### 外部副作用與 agent 控制

- 外部動作：{{EXTERNAL_ACTION}}
  - 權限邊界：{{ACCESS_SCOPE}}
  - 核准條件：{{APPROVAL_GATE}}
  - 花費或速率上限：{{SPEND_OR_RATE_LIMIT}}
  - 停止機制：{{STOP_MECHANISM}}
  - 證據狀態：{{SIDE_EFFECT_STATUS}}

### 最先做的三件事

1. {{ACTION_1}}
   - 為什麼先做：{{ACTION_1_WHY}}
   - 會產出的證據：{{ACTION_1_EVIDENCE}}
2. {{ACTION_2}}
3. {{ACTION_3}}

### 殘餘風險

- 已知且接受的風險：{{ACCEPTED_RISK}}
- 由誰接受：{{ACCEPTED_BY}}
- 複審日期：{{REVIEW_DATE}}
