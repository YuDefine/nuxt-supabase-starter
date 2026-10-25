# Rule 1 - 手動推 Worker secret 只限例外情境，值 NEVER 進 argv

- Level: `MUST`
- 手動推 secret 只限 `secrets.md` § 唯一例外的情境；其餘情境照該規約的正規流程。
- 推送一律經 Phase 4 的 subshell：0600 暫存檔、`trap` 在 subshell 結束時刪檔、Ctrl-C／TERM 中止整段（不會帶著已刪的檔去跑 `cf`）、`cf workers secrets bulk --file`。
- **NEVER** `cf workers secrets update --text <值>`：明文會進 argv 與 shell history。
- 物件欄位取自 `cf workers secrets update --help` 的 `--type`／`--text`；`bulk` 的 schema 未列欄位，第一次用先對非 production worker 驗證。
- 刪除用 `cf workers secrets delete <NAME> --worker <worker-name>`。

## Good Example

- 這個例子是好的，因為值只寫進會被刪除的 0600 暫存檔，不經 argv。

```bash
( f="$(mktemp)"; trap 'rm -f "$f"' EXIT; trap 'exit 130' INT TERM; chmod 600 "$f"
  "${EDITOR:-vi}" "$f"
  cf workers secrets bulk --worker api-staging --file "$f" )
```

## Bad Example

- 這個例子是壞的，因為 secret 值出現在命令列。

```bash
cf workers secrets update API_KEY --worker api --text 'sk-live-…'
```

# Rule 2 - 編輯暫存檔前關掉編輯器的明文副本

- Level: `MUST`
- 編輯器會在暫存檔旁留 swap／backup／undo 副本，那些是明文。
- 用 vim 時把 Phase 4 命令的 `"${EDITOR:-vi}" "$f"` 那行換成 `vim -n -i NONE -c 'set nobackup nowritebackup noundofile' "$f"`；其他編輯器先確認有同等設定才用。
- **NEVER** 把帶參數的命令塞進 `EDITOR`：`"${EDITOR:-vi}"` 有引號，整串會被當成一個執行檔名而失敗。

## Good Example

- 這個例子是好的，因為編輯那行直接關掉 vim 的 swap、viminfo、backup、undo。

```bash
( f="$(mktemp)"; trap 'rm -f "$f"' EXIT; trap 'exit 130' INT TERM; chmod 600 "$f"
  vim -n -i NONE -c 'set nobackup nowritebackup noundofile' "$f"
  cf workers secrets bulk --worker api-staging --file "$f" )
```

## Bad Example

- 這個例子是壞的，因為用預設設定的 vim，暫存檔旁會留下 `.swp` 明文。

```bash
export EDITOR=vim
```
