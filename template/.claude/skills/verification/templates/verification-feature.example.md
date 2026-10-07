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

