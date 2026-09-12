---
description: cursor native dispatch and watch controls；具名模型與 UI 角色由共通 routing table 決定
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', '.claude/agents/**', 'screenshots/**/progress.json']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/agent-routing.pi-watch-protocol.md; edit canonical source -->

<!-- clade-targets: cursor -->

# Cursor native dispatch and browser boundary

Cursor's native Task surface and correlated completion controls are target-specific. The shared Pi CLI carrier remains runtime-neutral, including exit codes, route, tier, prompt-file, workspace access, retry, and receipt fields.

When the current MCP catalog exposes `cursor-ide-browser`, open pages through `browser_tabs`, `browser_navigate`, `browser_lock`, and the corresponding snapshot and interaction controls. Keep Cursor main-line residency for Google and Tailscale login; missing browser capability leaves the action blocked.
