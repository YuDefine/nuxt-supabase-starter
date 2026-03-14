## ADDED Requirements

### Requirement: README line count reduction

The README.md SHALL be reduced to 250 lines or fewer by extracting detailed content to dedicated documents.

#### Scenario: Tech Stack extraction

- **WHEN** a newcomer reads README.md
- **THEN** the Tech Stack section SHALL show a condensed summary (one table, no sub-tables)
- **AND** link to `docs/TECH_STACK.md` for full details

#### Scenario: AI efficiency section removal

- **WHEN** README.md is streamlined
- **THEN** the "AI 輔助效率" section SHALL be removed from README
- **AND** its content SHALL be preserved in `docs/CLAUDE_CODE_GUIDE.md`

#### Scenario: Skills update section removal

- **WHEN** README.md is streamlined
- **THEN** the "Skills 更新機制" section SHALL be removed from README
- **AND** a one-line link to `docs/SKILL_UPDATE_GUIDE.md` SHALL remain

### Requirement: Tech Stack dedicated document

A `docs/TECH_STACK.md` SHALL contain the full Tech Stack tables and technology rationale previously in README.

#### Scenario: Content completeness

- **WHEN** a user reads `docs/TECH_STACK.md`
- **THEN** it SHALL contain all Tech Stack tables (核心框架, UI 與樣式, 認證與狀態, 開發工具, 部署與監控)
- **AND** the "為什麼選這套 Stack" comparison section
- **AND** no content SHALL be lost from the original README
