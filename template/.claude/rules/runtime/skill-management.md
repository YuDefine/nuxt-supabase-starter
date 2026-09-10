---
description: 新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界
paths: ['.gitignore', '.clade/skills/**', '.claude/skills/**', '.agents/skills/**', '.codex/skills/**', '.cursor/skills/**', 'plugins/*/skills/**', 'scripts/install-skills.sh', 'skills-lock.json']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/skill-management.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude skill delivery

Clade plugin skills render to `.claude/skills/<name>/`; commands and agents use their own Claude native directories. These generated files retain source/hash ownership. Existing consumer-owned or third-party files in that directory remain their recorded source until an explicit, recoverable adoption; a shared directory name does not authorize overwrite.

For the existing third-party installation workflow, use its recorded `npx skills add --agent claude-code --copy` invocation and source/version, preserve the skill contents and `skills-lock.json`, and verify from a fresh setup. This legacy install command does not install Codex or Cursor skills. Claude skill discovery and invocation must be checked in the actual target product; the projection receipt alone does not prove loading.
