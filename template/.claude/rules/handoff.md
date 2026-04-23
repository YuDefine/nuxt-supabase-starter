# Handoff

## 什麼時候建 HANDOFF.md

在以下任一情境，**MUST** 在 `template/HANDOFF.md` 建立或更新交接文件：

- Session 結束時有 in-progress 的 spectra change（`openspec/changes/` 含非 archive 目錄）
- 被 `/clear` 打斷前，有未 commit 的 WIP
- 交接給其他 agent（`/assign`、Codex、Cursor）
- 使用者明確要求

## 格式

```markdown
# Handoff

## In Progress

- [ ] 正在做什麼（spectra change 名稱、task 編號）
- 目前卡在哪 / 做到哪

## Blocked

- 什麼原因被擋住
- 需要什麼才能繼續

## Next Steps

1. 接下來該做什麼（按優先序）
2. 注意事項 / 陷阱
```

## 生命週期

- HANDOFF.md 是 **session-scoped**——用完即清
- 新 session 接手後，讀取 → 執行 → 完成後刪除或清空
- **允許 commit 進 git**（不 gitignore）——方便跨機器、跨 agent 交接

## 與 MEMORY.md 的差別

|          | HANDOFF.md                         | MEMORY.md                        |
| -------- | ---------------------------------- | -------------------------------- |
| 範圍     | 單次交接                           | 跨 session 持久                  |
| 內容     | 當前 WIP 狀態、blocker、next steps | 使用者偏好、專案知識、回饋       |
| 生命週期 | 用完刪除                           | 長期維護                         |
| 位置     | `template/HANDOFF.md`              | `~/.claude/projects/.../memory/` |
