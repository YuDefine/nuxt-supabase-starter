#!/usr/bin/env bash
# spectra-ux: pre-propose UX scan
#
# Outputs blast-radius scan instructions and required-section reminders for
# any agent about to run spectra-propose. Agent-agnostic; called by:
#   - Claude Code: .claude/hooks/pre-propose-ux-scan.sh (thin wrapper)
#   - Codex / Copilot: invoked manually per AGENTS.md instructions
#   - Humans: invoked from CLI
#
# Exit: always 0 (informational only)
# Output: instructions on stdout for the agent to act on

set -euo pipefail

cat <<'EOF'
[UX Completeness] spectra-propose 額外要求 — 在建立 proposal 前完成以下步驟：

## 步驟 1: 提取受影響的 entity

從 requirement 找出所有會被動到的：
  - DB table 名稱
  - Enum / CHECK constraint 擴張（例：card_type 新增 'kit' 值）
  - 新增 column
  - 新增 FK 關聯

若一個都找不到，此 change 可能是純流程/UI 變動，跳過此步驟。

## 步驟 2: Surface Blast Radius 掃描

對每個 entity，找出所有 user-facing surface：

**優先用 codebase-memory-mcp**（若已 index）：
  - search_graph(name_pattern="<EntityName>")
  - search_code(pattern="<enum_value>|<column>")

**Fallback 用 grep**：
  - 找 canonical type 位置（取得完整 enum values）
  - 找所有 .vue / .tsx / .jsx 引用
  - 找 API handler
  - 找 navigation 是否有對應入口

## 步驟 3: 產出 Surface Blast Radius 表格

在 propose 流程中先輸出表格給使用者看：

```
Surface Blast Radius for <change>:
  [type]   <types-dir>/<name>             — canonical enum definition
  [API]    <api-dir>/<path>               — request handler
  [page]   <ui-dir>/<name>                — 管理頁面
  [nav]    <navigation-file>              — 側邊欄入口
```

## 步驟 4: proposal.md 必填區塊

除了原本的 Why/What Changes/Impact，必須包含：

### `## Affected Entity Matrix`（若觸動 DB schema）

對每個 entity 列矩陣：columns / roles / actions / states / surfaces

### `## User Journeys`（強制）

對每個 entity × role × 關鍵 action 寫具體 journey，URL 必須明確。

若純後端，寫：`**No user-facing journey (backend-only)**` 並說明理由。

## 步驟 5: tasks.md 必須涵蓋每個 surface

每個在 blast radius 掃描中找到的 UI 檔案，在 tasks.md 必須有：
  - 對應的實作 task（具體檔案路徑，不是 catch-all「更新 UI」）
  - 對應的人工檢查 task（具體 URL + 步驟）

找不到但決定不動的 surface，在 proposal 的 Non-Goals 明確排除。

## 核心心智模型

1. **DB allow ≠ feature ready** — migration 通過不等於功能可用
2. **Tests pass ≠ UX done** — API test 綠不等於使用者能做事
3. **列舉比記憶可靠** — 用 grep/codebase-memory，不要靠記憶
4. **Admin 路徑同等重要** — 管理頁面是功能入口，不是附加品
5. **Completion momentum is a liar** — 覺得完成時離真正完成還差一哩

完整規則見 docs/rules/ux-completeness.md
EOF

exit 0
