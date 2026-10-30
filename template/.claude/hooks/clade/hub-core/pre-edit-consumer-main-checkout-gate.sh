#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit) hook — 擋 session 用 Write／Edit 寫 consumer **主 checkout**
# 的非投影路徑（W-2026-10-19-consumer-main-checkout-self-heal，plan § Scope 4）。
#
# 為什麼存在：clade-main-align.timer 只對「乾淨」的主 checkout 快轉。session 在主 checkout 寫完沒
# commit 就走（某些 consumer 的 `HANDOFF.md`、`database.types.ts`、`.claude/prod-access.json`），
# 這個 checkout 就從此 `refused`，越髒越卡。投影路徑（propagate 寫的、main-align 能無損丟掉再快轉）
# 不在擋的範圍；擋的是 main-align 救不了的那一類——使用者自己的檔。
#
# 命中條件（全部成立才擋，exit 2 ＋ stderr）：
#   1. 目標檔所在 checkout 是 **fleet 內 consumer 的 main checkout**（fleet_repo_root kind=consumer，
#      git-dir 不含 /worktrees/）。clade home 由 clade-home-guard.ts／pre-edit-main-worktree-reminder 管；
#      不在 fleet 的 repo 不管。判的是**目標檔**的樹，不是 session cwd。
#   2. 路徑不是 gitignored（ignored 的檔不會讓 checkout 變髒）、不是 `.git/` 內、不在 repo 外。
#   3. 路徑不是 clade 投影（scripts/locked-projection.ts 的 isLockedProjectionPathFor(repo, path)——與 wt-helper／
#      main-align 同一份 repo-aware 判定，NEVER 在這裡另抄清單）。
#   4. 路徑不在「可直接 commit 到 main」白名單（main_commit_allowlisted，與 pre-edit-main-worktree-reminder
#      同一個 oracle），**除了**三個共享登記簿 HANDOFF.md／ROADMAP.md／docs/tech-debt.md：它們在白名單內，
#      但「寫了沒 commit 就走」正是 consumer 主 checkout 卡死 refused 的來源，所以照樣擋；handoff skill 對 consumer 改走
#      worktree + merge-back（handoff SKILL.md Step 1.5）。其餘白名單檔（tasks/*、docs/discussions/* …）
#      是 per-session 單寫者、設計上寫完就 commit，維持放行。
#
# 逃生門：`CLADE_ALLOW_MAIN_CHECKOUT_WRITE=1`（session 環境）——確定要在主 checkout 寫、且馬上
# `git commit --only` 時用。
#
# 型別：安全型 gate 的「阻擋」但**判不出一律放行**（jq／git／node 缺、不在 git tree、projection helper
# 不在 fleet 內）：這是防漂移絆索，不是牆；誤擋的代價（打斷合法工作）高於漏擋（main-align 兜底仍在）。
#
#   | REQUIRED 欄位 | 內容 |
#   | --- | --- |
#   | 觸發條件 | 上列四條全成立 → exit 2，stderr 印改去 worktree 的指令。其餘零輸出 exit 0 |
#   | 消費端 | 正要在 consumer 主 checkout 寫檔的 agent；下游是 main-align 不再 `refused` |
#   | 觸發點 | 工具事件 hook：本檔在 Edit／Write 那一刻判定；訊息由 test/pre-edit-consumer-main-checkout-gate-hook.test.ts 釘住 |

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
# shellcheck source=_skill-rule-reminder.sh
. "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

[ "${CLADE_ALLOW_MAIN_CHECKOUT_WRITE:-}" = "1" ] && exit 0

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$INPUT" |
  jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0
case "$FILE_PATH" in
  /*) ;;
  *)
    BASE=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
    FILE_PATH="${BASE:-$PWD}/$FILE_PATH"
    ;;
esac

# Write 可以建新檔：往上找第一個存在的目錄當 git 的落點。
DIR=$(dirname -- "$FILE_PATH")
while [ ! -d "$DIR" ] && [ "$DIR" != "/" ]; do DIR=$(dirname -- "$DIR"); done
[ -d "$DIR" ] || exit 0

is_linked_worktree_dir "$DIR"
[ $? = 1 ] || exit 0

hit=$(fleet_repo_root "$DIR") || exit 0
[ "${hit%%$'\t'*}" = "consumer" ] || exit 0

TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 0
TOP=$(cd -P -- "$TOP" 2>/dev/null && pwd -P) || exit 0
REAL_DIR=$(cd -P -- "$DIR" 2>/dev/null && pwd -P) || exit 0
REL="${REAL_DIR#"$TOP"}"
case "$REAL_DIR" in
  "$TOP" | "$TOP"/*) ;;
  *) exit 0 ;;
esac
REL="${REL#/}"
NAME=$(basename -- "$FILE_PATH")
# DIR 可能是往上找到的祖先（新檔的目錄還不存在）：把缺的那段補回去。
FULL_DIR=$(dirname -- "$FILE_PATH")
if [ "$FULL_DIR" != "$DIR" ]; then
  MISSING="${FULL_DIR#"$DIR"}"
  REL="${REL:+$REL/}${MISSING#/}"
fi
REL="${REL:+$REL/}$NAME"
case "$REL" in
  .git | .git/* | ../* | /*) exit 0 ;;
esac

# gitignored → 不會讓 checkout 變髒。
git -C "$TOP" check-ignore -q -- "$REL" 2>/dev/null && exit 0

# 投影路徑：與 wt-helper／main-align 同一份判定，取 fleet 內可信 helper。
LOCKED=$(trusted_fleet_helper "$TOP" locked-projection.ts) || exit 0
command -v node >/dev/null 2>&1 || exit 0
# exit 3＝確定是投影、1＝確定不是；其他（catch 的 4——import 失敗、node 太舊不支援 .ts、helper 語法錯；或 node 本身起不來）一律放行。
# 判定用 repo-aware 的 isLockedProjectionPathFor(TOP, REL)：裸 isLockedProjectionPath 會把 consumer 自寫的
# .claude/rules/local/**、非 banner-only 的 CLAUDE.md 當投影，與 wt-helper／main-align 的 user WIP 判定不一致。
node --input-type=module -e '
  import { pathToFileURL } from "node:url"
  try {
    const m = await import(pathToFileURL(process.argv[1]).href)
    process.exit(m.isLockedProjectionPathFor(process.argv[2], process.argv[3]) ? 3 : 1)
  } catch {
    process.exit(4)
  }
' "$LOCKED" "$TOP" "$REL" >/dev/null 2>&1
case $? in
  1) ;;
  *) exit 0 ;;
esac

# 白名單內的 per-session 單寫者檔放行；共享登記簿不放行。
case "$REL" in
  HANDOFF.md | ROADMAP.md | docs/tech-debt.md) ;;
  *)
    main_commit_allowlisted "$TOP" "$REL"
    [ $? = 1 ] || exit 0
    ;;
esac

cat >&2 <<EOF
⛔ consumer 主 checkout 不寫非投影路徑：$REL
   $TOP 是共用主 checkout。session 寫了沒 commit 就走，clade-main-align 會從此 refused、落後 origin 越來越多。
   改法：
   1. node vendor/scripts/wt-helper.ts add <slug> --task-summary "<一句話>"（沒有 wt-helper 就 git worktree add），到該 worktree 內寫同一個相對路徑
   2. 落地走該 repo 的正常流程（commit／PR）；HANDOFF.md／ROADMAP.md／docs/tech-debt.md 見 handoff SKILL.md Step 1.5
   確定要在主 checkout 寫、且馬上 git commit --only：session 環境設 CLADE_ALLOW_MAIN_CHECKOUT_WRITE=1。
EOF
exit 2
