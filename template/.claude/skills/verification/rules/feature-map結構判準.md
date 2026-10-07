
# Rule 1 - Feature map 是使用者視角的驗證導航，不是 source tree inventory

- Level: `MUST`
- Feature map 回答「使用者怎麼到達、怎麼操作、什麼外部可觀察結果算成功」。
- 建立 `features/README.md` 與最重要的 3–5 個 user-facing feature；每個 feature 的每一個 entry point 都要明列，**不能**用驗過其中一條路徑代替其他路徑。
- map 不記內部實作 walkthrough；需要引用 source 時使用 repo-relative pointer，不複製整段 code。

## Good Example

- 這個例子是好的，因為列出所有 user entry point。

```md
## How to get to it (user POV)

- Choose `New note` in the toolbar.
- Run `notes create ...` from the CLI.
```

## Bad Example

- 這個例子是壞的，因為寫成 source walkthrough，且只列一條路徑。

```md
## How to get to it (user POV)

- `NoteStore.create()` 在 `src/store/note.ts:88` 被 toolbar handler 呼叫
```

# Rule 2 - README 與 feature 檔的段名與順序固定，與 validator 常數一致

- Level: `MUST`
- `features/README.md` 依序包含：
  1. `# <App> verification map`
  2. `## Baseline preconditions` — URL、env、seed、auth、doctor、isolation、lease。
  3. `## Driving conventions` — baseline state、stable handles、harness、reset。
  4. `## Proof and skip reporting` — action/result evidence、side effects、unreachable prerequisites、entry-point honesty。
  5. `## Feature entry contract` — 本檔的固定四段契約。
  6. `## Features` — 每個 sibling feature file 恰好一條相對連結。
- `features/<feature>.md` 以 H1 與一段 user-visible behavior 開頭，接著只有下列四個 H2，順序固定：
  1. `## Sub-features` — stable short IDs + one-line observable behavior。
  2. `## How to get to it (user POV)` — 所有 user entry points。
  3. `## Driving it with <harness>` — `Preconditions:`、exact action、exact command、observable result。
  4. `## Gotchas` — 會浪費、污染或使 proof 失真的陷阱。
- 段名與 `scripts/check-feature-map.mjs` 的 `REQUIRED_INDEX_SECTIONS`、`REQUIRED_FEATURE_SECTIONS` 逐字一致；改一邊必須同改另一邊與 `templates/`。

## Good Example

- 這個例子是好的，因為四個 H2 依序出現。

```md
# Create a note
...
## Sub-features
## How to get to it (user POV)
## Driving it with control-notes
## Gotchas
```

## Bad Example

- 這個例子是壞的，因為段名自創、順序錯。

```md
# Create a note
## Steps
## Gotchas
## Entry points
```

# Rule 3 - Freshness 與 evidence 欄位必填

- Level: `MUST`
- README 寫 `Last source reconciliation`、`Subject revision` 與 `Maintainer outcome`。
- 每份 artifact 記 feature ID、entry point、subject revision、timestamp、digest 與 evidence reference。
- 敏感 payload 依 control-plane evidence policy redact／到期；metadata 與 digest 保留以供稽核。

## Good Example

- 這個例子是好的，因為 freshness 三欄齊全。

```md
- Last source reconciliation: 2026-10-05
- Subject revision: 4688ab80b4
- Maintainer outcome: changed
```

## Bad Example

- 這個例子是壞的，因為看不出 map 對應哪個 revision。

```md
最後更新：最近
```
