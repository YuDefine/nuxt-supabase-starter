---
description: 新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界
paths: ['.gitignore', '.clade/skills/**', '.claude/skills/**', '.agents/skills/**', '.codex/skills/**', '.cursor/skills/**', 'plugins/*/skills/**', 'scripts/install-skills.sh', 'skills-lock.json']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/skill-management.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor skill delivery

The Clade capability renderer delivers skills to `.cursor/skills/<name>/`, commands to `.cursor/commands/`, and agent instructions to `.cursor/agents/`. These are distinct from `.cursor/rules/` instruction delivery and from the native Task tool. Keep source/hash ownership for generated artifacts and preserve consumer-owned or third-party collisions until an explicit, recoverable adoption.

Run the common capability dry-run and then verify discovery and invocation in the actual Cursor product and version. Producing a command or agent instruction file does not prove a matching native tool exists. Third-party installation follows its installer's observed Cursor support and lock definition; missing support stays unverified rather than using another target's installer invocation.
