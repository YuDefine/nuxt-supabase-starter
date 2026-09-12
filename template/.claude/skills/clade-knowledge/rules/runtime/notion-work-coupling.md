---
description: Runtime adapter fragment for notion-work-coupling.md
paths: ['tasks/**', 'specs/plans/**', '.claude/consumer-meta.json']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/notion-work-coupling.md; edit canonical source -->
<!-- clade-targets: claude -->

# Runtime adapter: Claude

Claude’s Notion skill entrypoints are `/notion-board` for inbound synchronization and `/notion-ticket` for outbound ticket creation. The portable transport is `ntn`, routed through `notion-ops`; direct page writes use `ntn api -X PATCH "/v1/pages/<page_id>"`. Before writes, run `notion-fetch collection://<dataSourceId>` and copy property keys from the fetched schema.

Customer-owned acceptance and archive transitions remain blocked for agent automation. Project-layer Class 3 decisions use Claude’s `AskUserQuestion` surface.
