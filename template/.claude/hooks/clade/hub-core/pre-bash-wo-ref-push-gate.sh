#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋手打的 `git push … refs/clade/wo/`（工單認領鏈）（block，exit 2）
#
# 約束：認領鏈 `refs/clade/wo/<wo_id>` 是 compare-and-swap 的真相（plans/40 § 設計定稿 三）。不帶 lease
# 直推一個後代 commit 會被 GitHub 當 fast-forward 收下（E22 本機與遠端都實測過），CAS 就破了；刪掉終態 ref
# 則讓同一個 origin_key 能再認領一次。寫入只准走 `vendor/scripts/lib/wo-ledger.ts`（node 自己 spawn git，
# 不經 Bash tool，本 hook 看不到也不擋）。
#
# 型別：安全型 gate。threat model：防漂移（絆索不是牆），誠實但健忘的 agent 順手寫出來的形狀。
# 判定（整條指令文字，用 bash `[[ =~ ]]` 比對、不經 pipe：大指令下 `printf | grep -q` 會吃 SIGPIPE、
# 在 pipefail 下把命中當沒命中）：
#   1. 有 `push`（`git stash push` 不算），且指名認領鏈：`refs/clade/wo`、或省略 `refs/` 的 `clade/wo`
#      （git push 會照 `refs/%s` 規則把短名對到既有遠端 ref）、`card/`、`clade/*`；`wo-test/`、`wo-shadow/` 放行 → 擋。
#   2. 有 `push` 且帶 `--mirror`／`--prune`／`refs/*` 萬用 refspec（可能連帶刪掉本機沒 fetch 的 `refs/clade/wo/*`，
#      預設 refspec 不抓它們）→ 擋（保守：窄 refspec 的 --prune 也擋）。整行判斷、NEVER 切段（續行、引號內的 ; 能把
#      旗標切到別段繞過）。唯一豁免：段首（行首、換行或 ; && || | 之後）的 `git fetch|pull … --prune`，片段內不含引號、
#      替換、分隔符與 push，整段換成空白（NEVER 直接刪：前後文字會黏成新的旗標）。
#   3. gh 的 api 子指令寫入且指名認領鏈（同判定 1 的 ref 樣式，含 `-f ref=refs/clade/wo/…` 建立；`-X`／`--method`／`-f`／`-F`／`--field`／`--raw-field`／`--input`）→ 擋。
# 不看引號與 heredoc：談論這個指令的文字也會被擋，改寫成不含 push 的句子即可。
#
# 繞行場景：
#   | 繞法 | 預期攔截點 |
#   | `git push origin :refs/clade/wo/<id>`、`--delete` | 擋：判定 1 |
#   | `git push origin :clade/wo/<id>`（省略 refs/） | 擋：判定 1 |
#   | `R=refs/clade/wo; git push origin x:$R/<id>` | 擋：判定 1 看整行 |
#   | `git push origin 'refs/clade/*:refs/clade/*'` | 擋：判定 1 |
#   | `git push --mirror`、`git push --prune origin 'refs/*:refs/*'` | 擋：判定 2 |
#   | 續行或引號內 ; 把 `--prune` 切到別段 | 擋：判定 2 整行判斷 |
#   | gh 的 `api -X DELETE …/git/refs/clade/wo/<id>`、`api -X PATCH … -F force=true` | 擋：判定 3 |
#   | gh 的 `api -X POST …/git/refs -f ref=refs/clade/wo/<id>`（建立） | 擋：判定 3 |
#   | `bash -c`、`ssh host "git push …"` | 擋：整條指令文字比對 |
#   | 變數拼出 `refs/` + `clade/wo`、`curl` 打 REST | 不攔：檔頭已寫不承諾 |
#
# 判不出來：
#   | 分支 | 處置 |
#   | E1 jq 不在 | 改比對原始 stdin（JSON 文字含 command），同一條判定 |
#   | E3 stdin 非 JSON、command 欄位缺失 | 同 E1 |
#   | E6 逾時 | harness 砍掉 hook 屬 non-blocking：已知限制 |
#
# 沒有繞過旗標：正當寫入走 `node vendor/scripts/wo-ledger.ts`；量測走 `refs/clade/wo-test/`。

set -uo pipefail

input=$(cat)
command=""
if command -v jq >/dev/null 2>&1; then
  command=$(jq -r '.tool_input.command // empty' 2>/dev/null <<<"$input" || true)
fi
[ -n "$command" ] || command="$input"

block() {
  cat >&2 <<'MSG'
BLOCKED: 手打的 git push／gh api 不准碰 refs/clade/wo/（工單認領鏈）；--mirror／--prune／refs/* 萬用 refspec 可能連帶刪掉它，一併擋。
不帶 lease 的直推會被當 fast-forward 收下、刪 ref 會讓同一件工作能再認領一次——兩者都會破掉單次認領。
改用：node vendor/scripts/wo-ledger.ts（claim／transition，帶 lease、nonce 對帳）；
量測用前綴 refs/clade/wo-test/。設計見 yudefine-hq plans/40 § 設計定稿 三。
只是先 fetch --prune 再 push：拆成兩次 Bash 呼叫。
MSG
  exit 2
}

ref_re='(^|[^[:alnum:]_.-])(refs/)?clade/(wo([^-[:alnum:]_.]|$)|card/|\*)'

# 判定 3：gh api 寫入，且任何位置指名認領鏈（路徑 git/refs/clade/wo/…，或 -f ref=refs/clade/wo/… 建立）
# -X／-f／-F 後面接什麼都算（pflag 收黏寫：-XDELETE、-fref=…）；長旗標才要求空白、= 或行尾
gh_write_re='(^|[[:space:]])(-X|-f|-F|(--method|--field|--raw-field|--input)([[:space:]=]|$))'
gh_re='(^|[^[:alnum:]_-])gh[[:space:]]+api([[:space:]]|$)'
if [[ $command =~ $gh_re && $command =~ $ref_re && $command =~ $gh_write_re ]]; then block; fi

# `git stash push` 不是 push
s=$command
stash_re='stash[[:space:]]+push'
while [[ $s =~ $stash_re ]]; do s=${s/"${BASH_REMATCH[0]}"/stash _}; done
push_re='(^|[^[:alnum:]_-])push([^[:alnum:]_-]|$)'
[[ $s =~ $push_re ]] || exit 0

# 判定 1
if [[ $s =~ $ref_re ]]; then block; fi

# 判定 2：先接續行，再豁免段首的 git fetch|pull … --prune（換成空白）
s=${s//$'\\\n'/}
# 換行也是段界（bash =~ 的 ^ 只錨整串開頭）；片段本體不跨行
nl=$'\n'
fetch_re="(^|[;&|${nl}])[[:space:]]*git[[:space:]]+(fetch|pull)[^;&|${nl}\"'\`\$()\\\\]*[[:space:]]--prune([[:space:]]|$)"
while [[ $s =~ $fetch_re ]]; do
  m=${BASH_REMATCH[0]}
  [[ $m == *push* ]] && break
  s=${s/"$m"/ }
done
wild_re="--mirror|--prune|(^|[[:space:]:+])[\"']?refs/\\*"
if [[ $s =~ $wild_re ]]; then block; fi
exit 0
