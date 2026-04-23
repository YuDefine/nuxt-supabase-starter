---
description: Cursor 版 Spectra archive 包裝流程，先跑 archive gates 再歸檔
---

# /cursor-spectra-archive <change-name>

## User Input

```text
$ARGUMENTS
```

## 流程

1. 若 `$ARGUMENTS` 為空，停止並要求提供 change name
2. 先執行 archive gates：

```bash
bash .cursor/hooks/run-spectra-archive-pre.sh "$ARGUMENTS"
```

3. 若任何 gate 阻擋，先修完再繼續，不得跳過
4. gate 全通過後，使用相容載入的 `spectra-archive` skill；若 skill 不可用，手動完成 archive 流程並同步 `openspec/ROADMAP.md`
5. 完成後回報 archive 結果、更新的文件、以及是否需要補 `template/HANDOFF.md`
