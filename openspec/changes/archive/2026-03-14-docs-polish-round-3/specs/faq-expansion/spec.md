## ADDED Requirements

### Requirement: Performance FAQ entries

The FAQ SHALL include a "效能與規模" category with questions about query performance, RLS overhead, and scaling.

#### Scenario: Performance questions answered

- **WHEN** a user reads the FAQ "效能與規模" section
- **THEN** it SHALL answer at minimum:
  1. "RLS 會拖慢查詢嗎？" — with benchmarks context and optimization tips
  2. "怎麼偵測 N+1 查詢？" — with diagnostic tools and fix patterns
  3. "Supabase 免費方案能撐多大規模？" — with concrete limits (connections, storage, bandwidth)

### Requirement: Cost FAQ entries

The FAQ SHALL include entries about Supabase and Cloudflare pricing within the "效能與規模" section.

#### Scenario: Cost questions answered

- **WHEN** a user evaluates this starter for a project
- **THEN** the FAQ SHALL answer at minimum:
  1. "超過免費方案限制怎麼辦？" — upgrade paths and pricing tiers
  2. "Cloudflare Workers 有費用嗎？" — free tier limits and paid plans

### Requirement: Team collaboration FAQ entries

The FAQ SHALL include a "團隊協作" category with questions about multi-developer workflows.

#### Scenario: Team questions answered

- **WHEN** a team evaluates this starter
- **THEN** the FAQ SHALL answer at minimum:
  1. "多人開發怎麼避免 migration 衝突？" — workflow and conventions
  2. "怎麼做 Code Review？" — checklist and standards
  3. "新成員如何快速上手？" — onboarding path reference
