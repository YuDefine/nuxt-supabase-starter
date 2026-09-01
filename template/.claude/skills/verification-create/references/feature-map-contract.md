<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/verification-create/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Feature map contract

Feature map 是產品使用者視角的驗證導航，不是 source tree inventory。它回答「使用者怎麼到達、怎麼操作、什麼外部可觀察結果算成功」。

## `features/README.md`

依序包含：

1. `# <App> verification map`
2. `## Baseline preconditions` — URL、env、seed、auth、doctor、isolation、lease。
3. `## Driving conventions` — baseline state、stable handles、harness、reset。
4. `## Proof and skip reporting` — action/result evidence、side effects、unreachable prerequisites、entry-point honesty。
5. `## Feature entry contract` — 本檔的固定四段契約。
6. `## Features` — 每個 sibling feature file 恰好一條相對連結。

## `features/<feature>.md`

每檔以 H1 與一段 user-visible behavior 開頭，接著只有下列四個 H2，順序固定：

1. `## Sub-features` — stable short IDs + one-line observable behavior。
2. `## How to get to it (user POV)` — 所有 user entry points。
3. `## Driving it with <harness>` — `Preconditions:`、exact action、exact command、observable result。
4. `## Gotchas` — 會浪費、污染或使 proof 失真的陷阱。

## Freshness and evidence

- README 寫 `Last source reconciliation`、`Subject revision` 與 `Maintainer outcome`。
- 每份 artifact 記 feature ID、entry point、subject revision、timestamp、digest 與 evidence reference。
- 敏感 payload 依 control-plane evidence policy redact／到期；metadata 與 digest 保留以供稽核。
- map 不記內部實作 walkthrough；需要引用 source 時使用 repo-relative pointer，不複製整段 code。

## Example feature

```markdown
# Create a note

Create note lets a user save a titled note and confirm persistence from a second user-facing view.

## Sub-features

- `create-save` persists a title and body.
- `create-cancel` discards an unfinished draft.

## How to get to it (user POV)

- Choose `New note` in the toolbar.
- Run `notes create ...` from the CLI.

## Driving it with control-notes

Preconditions:

- Doctor reports the expected disposable data directory.

- **Save.** Run the exact fill and click commands. Reopen the note from the list and observe both values.

## Gotchas

- A transient success toast is not persistence proof; reopen from a second view.
```

