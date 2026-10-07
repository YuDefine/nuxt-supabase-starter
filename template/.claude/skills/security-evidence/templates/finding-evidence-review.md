<!-- 改寫來源：Codex Security Bridge Kit Prompt 1（Finding Evidence Explainer）；改寫前的逐字版在 `git show bf08778b5c:capabilities/core/skills/security-evidence/references/finding-evidence-explainer.md`，對照上游新版時從那份 diff -->
<!-- 一則 finding 一份；判讀依據見 rules/finding證據判讀判準.md。證據狀態四選一：Independently Verified／Report-Supplied／User-Confirmed／Unknown -->

## Finding 證據審查：{{FINDING_TITLE}}

### 白話摘要

- 攻擊者：{{ATTACKER}}
- 他做了什麼：{{ATTACKER_ACTION}}
- 系統哪裡做錯：{{SYSTEM_FAILURE}}
- 具體後果：{{CONCRETE_CONSEQUENCE}}

### 前提條件

- 需要的存取：{{REQUIRED_ACCESS}}
- 需要的狀態或時機：{{REQUIRED_STATE_OR_TIMING}}
- 限制攻擊的因素：{{LIMITING_FACTORS}}

### 攻擊路徑

1. Source：{{SOURCE}}
2. 跨越的邊界：{{BOUNDARY_CROSSED}}
3. 預期的 Control：{{EXPECTED_CONTROL}}
4. Control 如何失效：{{CONTROL_FAILURE}}
5. 抵達的 Sink：{{SINK}}
6. 影響：{{IMPACT}}

### 證據帳

| 證據 | 狀態 | 位置或出處 | 證明了什麼 |
| --- | --- | --- | --- |
| {{EVIDENCE}} | {{EVIDENCE_STATUS}} | {{EVIDENCE_LOCATION}} | {{EVIDENCE_PROVES}} |

### 既有控制與反證

- {{CONTROL_OR_COUNTEREVIDENCE}}：{{EFFECT_ON_CLAIM}}

### Severity 與 Confidence

- Severity：{{SEVERITY}}
- Severity 理由：{{SEVERITY_RATIONALE}}
- Confidence：{{CONFIDENCE}}
- Confidence 理由：{{CONFIDENCE_RATIONALE}}

### Coverage

- 已審查：{{REVIEWED}}
- 排除或無法取得：{{EXCLUDED}}
- 未驗證的 production 專屬控制：{{UNVERIFIED_PRODUCTION_CONTROLS}}

### Proof Gaps

- Gap：{{PROOF_GAP}}
  - 為什麼重要：{{GAP_WHY_MATTERS}}
  - 需要的證據：{{EVIDENCE_NEEDED}}
  - 安全的取得方式：{{SAFE_COLLECTION}}

### Verdict

- Verdict：{{VERDICT}}
- 理由：{{VERDICT_RATIONALE}}
- 這個 verdict 不能證明什麼：{{VERDICT_LIMITS}}

### 下一步驗證

1. {{SMALLEST_NEXT_ACTION}}
