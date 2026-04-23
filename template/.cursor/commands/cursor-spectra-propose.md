---
description: Cursor 版 Spectra propose 包裝流程，補上 pre/post gate
---

# /cursor-spectra-propose <request>

## User Input

```text
$ARGUMENTS
```

## 流程

1. 若 `$ARGUMENTS` 為空，停止並要求提供需求描述
2. 先執行：

```bash
bash .cursor/hooks/run-spectra-propose-pre.sh "$ARGUMENTS"
```

3. 使用相容載入的 `spectra-propose` skill 建立 change；若 skill 不可用，手動建立：
   - `openspec/changes/<change-name>/proposal.md`
   - `openspec/changes/<change-name>/tasks.md`
   - 必要的 spec delta
4. 提案完成後執行：

```bash
bash .cursor/hooks/run-spectra-propose-post.sh "$ARGUMENTS"
```

5. 若輸出提示缺少 `Design Review` 區塊，立刻補進 `tasks.md`
6. 回報 change 名稱、涉及 spec、以及下一步建議是否進入 `/cursor-spectra-apply`
