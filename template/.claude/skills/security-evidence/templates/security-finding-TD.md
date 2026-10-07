<!-- 一項一條；repo 有 specs/truth/work-lifecycle.md 的寫進承載它的 plan Open work，未遷移 consumer 才寫進它的 docs/tech-debt.md。Class 依該 consumer 慣例。Priority 由 Severity（finding）或 P0／P1（map）決定，NEVER 因 Confidence 低而降；owner 缺就寫 Owner Missing -->

## TD-{{TD_NUMBER}} — {{TD_TITLE}}

**Class**: {{TD_CLASS}}
**Status**: open
**Priority**: {{TD_PRIORITY}}
**Discovered**: {{DISCOVERED_DATE}} — security-scan {{RUN_KIND}} {{OUTPUT_DIR}}，security-evidence {{EVIDENCE_MODE}} verdict={{VERDICT}}
**Owner**: {{OWNER}}
**Location**: `{{LOCATION}}`

### 要做什麼

{{REMEDIATION}}

### 自驗

- Proof Gap：{{PROOF_GAP}} → {{SAFE_COLLECTION}}
- 通過條件：{{PASS_CONDITION}}
- 修完：node $CLADE_HOME/scripts/security-scan.ts verify --finding {{FINDING_ID}}
