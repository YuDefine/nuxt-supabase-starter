---
description: Runtime adapter fragment for notion-work-coupling.md
paths: ['tasks/**', 'specs/plans/**', '.claude/consumer-meta.json', 'registry/notion-hubs.json', 'vendor/scripts/notion-sync.ts', 'vendor/scripts/lib/notion-hub.ts']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/notion-work-coupling.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Runtime adapter: Cursor

Cursor needs only a working `ntn login` token on this machine; it does not require a target-native Notion client. Lifecycle writes go only through `node ~/offline/clade/vendor/scripts/notion-sync.ts <command>`, which enforces the schema check, absolute SET, Work ID reconciliation, and customer-approval contracts. If the `ntn login` token is missing, report the script's error and leave the write pending; do not invent a replacement API or property key.
