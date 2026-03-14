## ADDED Requirements

### Requirement: README under 200 lines

The README.md SHALL be reduced to under 200 lines by moving advanced sections to existing guide documents.

#### Scenario: Core concepts section moved

- **WHEN** README is trimmed
- **THEN** the "核心概念" section content SHALL be moved to `docs/WORKFLOW.md`
- **AND** README SHALL replace it with a one-line summary linking to the guide

#### Scenario: Development workflow section moved

- **WHEN** README is trimmed
- **THEN** the "開發工作流程" section content SHALL be moved to `docs/WORKFLOW.md`
- **AND** README SHALL replace it with a one-line summary linking to the guide

#### Scenario: README line count verified

- **WHEN** all moves are complete
- **THEN** `wc -l README.md` SHALL report fewer than 200 lines
- **AND** all internal links SHALL resolve correctly
