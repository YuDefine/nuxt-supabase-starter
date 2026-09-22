---
description: Runtime adapter fragment for notion-work-coupling.md
paths: ['tasks/**', 'specs/plans/**', '.claude/consumer-meta.json', 'registry/notion-hubs.json', 'vendor/scripts/notion-sync.ts', 'vendor/scripts/lib/notion-hub.ts', 'vendor/scripts/lib/notion-stage.ts', 'vendor/scripts/flow/notion-follow.ts', 'scripts/audit-notion-hub-schema.ts']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/notion-work-coupling.md; edit canonical source -->
<!-- clade-targets: claude -->

# Runtime adapter: Claude

Claude's Notion skill entrypoints are `/notion-board` for inbound ticket management and `/notion-ticket` for outbound decision tickets. Lifecycle writes (ticket status, 交付項目 progress, release, eta) go only through `node ~/offline/clade/vendor/scripts/notion-sync.ts <command>`; the script checks the data source schema against `FIELDS` before writing, and its transport is `lib/notion-client.ts` calling the Notion HTTPS API with the `ntn login` token. Do not hand-write page PATCH calls for lifecycle fields.

Customer-side acceptance and archive transitions remain blocked for agent automation. `needsDecision` results (including `eta-needs-human` before `--confirmed`) use Claude's `AskUserQuestion` surface.
