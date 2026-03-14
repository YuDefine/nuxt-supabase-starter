## ADDED Requirements

### Requirement: Post-tutorial learning path

The `docs/FIRST_CRUD.md` SHALL include a "What's Next" section at the end with a structured learning progression.

#### Scenario: Three-tier progression

- **WHEN** a newcomer finishes the FIRST_CRUD tutorial
- **THEN** the "What's Next" section SHALL present three tiers:
  1. **Beginner**: 3-4 docs for foundational knowledge
  2. **Intermediate**: 3-4 docs for deeper understanding
  3. **Advanced**: 3-4 docs for production readiness
- **AND** each tier SHALL link to existing documents with a one-line description

#### Scenario: Recommended reading order

- **WHEN** the learning path is presented
- **THEN** each tier SHALL list documents in recommended reading order
- **AND** the progression SHALL flow naturally from the tutorial's topics (DB → API → Auth → Deploy)

### Requirement: READING_GUIDE cross-reference

The `docs/READING_GUIDE.md` SHALL reference the learning progression in FIRST_CRUD.md.

#### Scenario: Reading guide updated

- **WHEN** a user reads READING_GUIDE.md
- **THEN** it SHALL mention FIRST_CRUD.md as the recommended hands-on starting point
