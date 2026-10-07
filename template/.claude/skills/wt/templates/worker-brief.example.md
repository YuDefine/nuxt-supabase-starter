routing-row: non-ui-implementation

# Worker brief：herdr-usage-table-row

- 工作目錄：`<clade-central-repo>-wt/herdr-usage-table-row`
- 分支：`session/2026-10-03-1420-herdr-usage-table-row`
- work id：`W-2026-10-03-herdr-usage-table-row`
- 任務 brief：`<clade-central-repo>-wt/herdr-usage-table-row/WORKTREE-BRIEF.md`

## 開工前先讀 worker 契約

開始任何讀寫之前，先讀 `capabilities/core/skills/wt/rules/worker契約.md`，整份照做；寫入範圍、commit、push／draft PR、WORKTREE-BRIEF 更新與完成回報格式都以該檔為準，本 brief 不重述。

## 任務

herdr-session-handoff.ts 的 usage 字串補上 `--table-row <row>`：parser 已接受這個旗標，`--tier-basis table-row` 也要求它，但 `--help` 沒列出，派工者照 usage 寫指令會漏帶。

## Context

- 要讀的規則與文件：`vendor/snippets/herdr-session-handoff/README.md` § Relay succession recipe（旗標語義）；`rules/core/agent-routing.routing-table.md`（`--table-row` 只接 Claude-native 列）
- 要動的檔案與現況：`vendor/scripts/herdr-session-handoff.ts` 約第 1017 行的 usage 字串缺 `[--table-row <row>]`；第 2763–2784 行的驗證已要求 `--tier-basis table-row` 搭 `--table-row`，而 `--table-row` 搭其他 basis 會被拒，usage 要讓這個配對一眼可見
- 已排除的做法：改成自動從 `--model` 反推 row——會讓 `table-row` 失去「派工者真的查過表」的證據，不做

## Git Baseline

建樹當下 `git -C <clade-central-repo>-wt/herdr-usage-table-row status --porcelain` 的輸出如下；這些路徑是 baseline，不屬於本任務 scope：

```text
（乾淨，無 baseline）
```

## Scope guard

本任務只允許寫入以下路徑：

- `vendor/scripts/herdr-session-handoff.ts`
- `test/herdr-session-handoff.test.ts`

## View-layer guard

本任務不允許修改以下 view-layer 路徑：`*.vue`、`*.tsx`、`*.jsx`、`*.css`、`*.scss`、`app/pages/**`、`app/components/**`、`app/layouts/**`、`pages/**`、`components/**`、`layouts/**`、`views/**`

## 驗收標準

- `node vendor/scripts/herdr-session-handoff.ts --help` 的輸出含 `[--table-row <row>]`，位置緊接在 `--tier-basis` 之後
- `test/herdr-session-handoff.test.ts` 有一條斷言 usage 含 `--table-row <row>`，且該測試先紅後綠
- 驗證指令：`pnpm exec vp check && node node_modules/typescript-native/bin/tsc -p tsconfig.vendor.json --noEmit`
