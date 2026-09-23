<!-- LOCKED: mirrored from Waterball-Software-Academy/aixbdd@bc8fdebe2d30db384f77911aaed81888ad03bf5f via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->
# Rule 1 - 每次 specify 都必須建立新的 plan package

- Level: `MUST`
- 未命中 Rule 3 的 clade lifecycle repo 判準時，`/specify` 每次執行都必須在 `specs/plans/` 下建立新的 `NNN-<slug>` plan package。
- 同一情況下，`NNN` 使用現有 plan package 最大編號加一，不得回頭覆寫既有 package。
- 即使本次需求是修改或刪除既有行為，也建立新的 plan package，讓舊 plan 保持歷史。
- 命中 Rule 3 的判準時，本 Rule 的編號遞增與目錄建立一律不適用，改依 Rule 3。

## Good Example

- 這個例子是好的，因為修改既有配對規則仍建立新迭代。

```text
specs/plans/004-change-match-rule/spec.md
```

## Bad Example

- 這個例子是壞的，因為回頭改舊 plan package。

```text
specs/plans/001-online-pvp-1a2b/spec.md
```

# Rule 2 - specify 只可寫 plan artifacts

- Level: `MUST`
- `/specify` 只能寫入 `spec.md`、`checklists/requirements.md` 與初始化 `truth-delta.md`。
- 目標 repo 命中 Rule 3 的 clade lifecycle repo 判準時，可寫檔收斂成 `spec.md` 與 `checklists/requirements.md` 兩份，改依 Rule 3。
- `/specify` 不得新增、修改或刪除 `specs/truth/**`。
- 涉及既有 truth 的需求可在 spec 中描述預期新增、修改或刪除意圖，但實際 truth 變更交給 truth owner skill。

## Good Example

- 這個例子是好的，因為輸出全在 plan package 內。

```text
specs/plans/004-room-game-chat/spec.md
specs/plans/004-room-game-chat/checklists/requirements.md
specs/plans/004-room-game-chat/truth-delta.md
```

## Bad Example

- 這個例子是壞的，因為 specify 直接改 truth。

```text
specs/truth/contracts/openapi.yaml
```

# Rule 3 - clade lifecycle repo 的 plan package 由 `flow plan open` 鑄，不自行遞增 NNN

- Level: `MUST`
- **判準**：本次 plan package 的 `plan.md` frontmatter 同時含 `work_id:` 與 `truth_baseline:` 兩個鍵。判準只看這兩個鍵；NEVER 用 repo 名、manifest、`specs/truth/**` 是否存在或任何其他檔案推斷。
- 命中判準時，package 路徑固定是 `specs/plans/<work-id>/`；`<work-id>` 由 `node vendor/scripts/flow/flow.ts plan open <slug> --title '<title>'` 鑄出，格式 `W-<YYYY-MM-DD>-<slug>`。`/specify` NEVER 自行建立 plan package 目錄，NEVER 遞增編號。
- 命中判準時，同一件工作續跑同一個 work id 的既有 package，NEVER 為同一件工作開第二份。
- 命中判準時，`plan.md` 是 lifecycle 檔、由 `flow` 持有：`/specify` NEVER 建立、覆寫或刪除它。
- 命中判準時，該 package 沒有 `truth-delta.md`，`/specify` 也 NEVER 建立一份。本輪的 truth 變更意圖寫進 `plan.md` 的 `## Truth delta` 表，欄位固定 `id`、`action`、`unit`、`reason`、`state`；`/specify` 寫入的列 `state` 一律 `proposed`。
- 命中判準時，被省略的 artifact MUST 在 `plan.md` 的 `## Decisions` 留一行工作特定理由（例：CLI-only 需求沒有 `ui-plan.md`）。
- 未命中判準的 repo（尚未遷移的產品 SDD repo）原樣適用 Rule 1 與 Rule 2。

## Good Example

- 這個例子是好的，因為 package 路徑就是 `flow plan open` 鑄出的 work id，而且意圖列落在 lifecycle 檔裡。

```text
specs/plans/W-2026-09-16-coupon-status/spec.md
specs/plans/W-2026-09-16-coupon-status/checklists/requirements.md
specs/plans/W-2026-09-16-coupon-status/plan.md
```

## Bad Example

- 這個例子是壞的，因為在命中判準的 repo 裡自行遞增編號，又另外建了一份 `truth-delta.md`。

```text
specs/plans/012-coupon-status/spec.md
specs/plans/012-coupon-status/truth-delta.md
```
