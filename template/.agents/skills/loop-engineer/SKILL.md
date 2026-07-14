---
name: loop-engineer
description: "Deprecated alias — 已改名 /change-loop（2026-07-05）。Use when 既有 routine 或舊指令仍呼叫 /loop-engineer 時轉發。"
metadata:
  author: clade
  deprecated: true
  renamed-to: change-loop
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/loop-engineer/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# /loop-engineer（已改名 → /change-loop）

本 skill 已於 2026-07-05 改名為 **`/change-loop`**（銳評結論：舊名指「loop 工程能力」，實為 spectra change 推進的單一 instance；通用 loop 方法論在 `vendor/snippets/loop-engineering/` cookbook）。

**收到本 skill 的 invoke 時**：立即用 Skill tool invoke `change-loop`，把收到的 `$ARGUMENTS`（含 `--unattended`）原樣帶過去。不要在本 stub 內執行任何 loop 邏輯。

```text
$ARGUMENTS
```

既有 routine 更新指引（user 手動）：routine prompt 內的 `/loop-engineer` 改為 `/change-loop`；改完後本 stub 即可從白名單移除。
