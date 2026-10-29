<!-- 一項一條；repo 有 specs/truth/work-lifecycle.md 的寫進照 follow-up-register § 開獨立 plan 開的那份 plan，未遷移 consumer 才寫進它的 docs/tech-debt.md。Class 依該 consumer 慣例。TD 不帶等級欄位（等級只看 fleet 看板 `td:<repo>:TD-n`）；Severity 寫進 Problem，有損害證據的 agent 可標 P2，再往上由 Charles 在看板拉級，NEVER 因 Confidence 低而略報；owner 缺就寫 Owner Missing -->

## TD-{{TD_NUMBER}} — {{TD_TITLE}}

**Class**: {{TD_CLASS}}
**Status**: open
**Discovered**: {{DISCOVERED_DATE}} — security-scan {{RUN_KIND}} {{OUTPUT_DIR}}，security-evidence {{EVIDENCE_MODE}} verdict={{VERDICT}}
**Owner**: {{OWNER}}
**Location**: `{{LOCATION}}`

### 要做什麼

{{REMEDIATION}}

### 自驗

- Proof Gap：{{PROOF_GAP}} → {{SAFE_COLLECTION}}
- 通過條件：{{PASS_CONDITION}}
- 修完：node $CLADE_HOME/scripts/security-scan.ts path --target . --path {{FINDING_PATH}}（{{FINDING_ID}} 不再出現）
