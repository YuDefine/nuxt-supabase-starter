
# Rule 1 - 產物是 consumer-owned、tracked 的 canonical skill，NEVER 寫進投影目錄

- Level: `MUST`
- 建立 `<skills-root>/verify-<app>/`（`SKILL.md`、`features/README.md`、`features/<feature>.md`；`scripts/` 只有 repo 真的需要 helper 才建立）。
- `.agents/`、`.codex/` 是投影面，NEVER 直接把 canonical source 寫進那些目錄。現有 `sync-to-codex` 負責跨 runtime 投影。
- `<skills-root>` 指該 runtime 的 skill 根目錄；**NEVER** 在別的 runtime 上照抄 Claude 的字面路徑；找不到該目錄就回報標準未送達，不猜一個。

## Good Example

- 這個例子是好的，因為 canonical 寫在 consumer 的 tracked skill 根。

```text
<skills-root>/verify-<consumer-id>/SKILL.md、<skills-root>/verify-<consumer-id>/features/README.md
```

## Bad Example

- 這個例子是壞的，因為直接寫進投影面。

```text
.agents/skills/verify-<consumer-id>/SKILL.md、.codex/skills/verify-<consumer-id>/SKILL.md（手寫，沒有 canonical 來源）
```

# Rule 2 - `verify-<app>/SKILL.md` 六段依序齊全

- Level: `MUST`
- `SKILL.md` 必須有可發現的 `name`／`description`，並依序包含：
  1. `Launch` — exact command、ready signal、teardown；server/UI 使用 verification lease。
  2. `Doctor` — first drive、fresh session 與 surprising failure 後都可重跑的唯讀檢查。
  3. `Drive` — repo 現有 stable selector／command；UI 優先 role、accessible name、route 與既有 test handle。
  4. `Evidence` — real user path、action + result、second-view side-effect proof、artifact location。
  5. `Cleanup` — 只清自己建立的 process／scratch state，NEVER 依 process name 殺程序，NEVER 刪 evidence。
  6. `Helpers` — 每支 helper 的 invocation、inputs、outputs 與 executable bit。
- 段名與 `scripts/check-feature-map.mjs` 的 `REQUIRED_SKILL_SECTIONS` 逐字一致。

## Good Example

- 這個例子是好的，因為六個 H2 依序出現。

```md
## Launch
## Doctor
## Drive
## Evidence
## Cleanup
## Helpers
```

## Bad Example

- 這個例子是壞的，因為缺 Doctor 與 Helpers，順序也錯。

```md
## Drive
## Launch
## Evidence
```

# Rule 3 - Evidence ID 由 recorder 配發，NEVER 自造

- Level: `MUST`
- 若 control-plane evidence recorder 已存在，Evidence 交給 recorder 配發 `evd_*` 並記 subject revision、digest、timestamp 與 typed references。尚未接 recorder 時寫 artifacts + manifest；NEVER 自造看似 canonical 的 ID。

## Good Example

- 這個例子是好的，因為沒有 recorder 時只寫 artifact 與 manifest。

```text
artifacts/verify/2026-10-05T0930/create-save.png ＋ manifest.json（feature、entry point、revision、digest）
```

## Bad Example

- 這個例子是壞的，因為自造 `evd_` 前綴的 ID。

```text
evidence id：evd_20261005_001
```
