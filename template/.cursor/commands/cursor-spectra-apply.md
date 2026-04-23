---
description: Cursor 版 Spectra apply 包裝流程，先補 journey brief 再執行實作
---

# /cursor-spectra-apply <change-name>

## User Input

```text
$ARGUMENTS
```

## 流程

1. 若 `$ARGUMENTS` 為空，停止並要求提供 change name
2. 先執行：

```bash
bash .cursor/hooks/run-spectra-apply-pre.sh "$ARGUMENTS"
```

3. 使用相容載入的 `spectra-apply` skill；若 skill 不可用，依 `openspec/changes/$ARGUMENTS/tasks.md` 逐項實作
4. 涉及 UI 時，同步遵守 `.cursor/rules/proactive-skills.mdc`
5. 完成後回報：
   - 已完成 tasks
   - 尚未完成 tasks
   - 是否可進入 `/cursor-spectra-archive`
