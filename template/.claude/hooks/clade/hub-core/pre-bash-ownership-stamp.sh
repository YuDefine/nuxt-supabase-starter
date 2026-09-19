#!/usr/bin/env bash
# PreToolUse(Bash) hook — 替 Bash 寫入的所有權歸屬開一個時間窗（TD-664 Phase 2）。
#
# **靜默、fail-open、永不 block。** 它只 touch 一個 stamp 檔，不對 agent 說任何話。
#
# ## 為什麼要有 pre 這一半
#
# PostToolUse 拿到的只有 command 字串，從任意 shell 解析「這次寫了哪些檔」不可靠 ——
# 而**猜錯的方向會把別人的檔記成我的**（`rules/core/session-claims.md` § 3.2 的逐字禁令）。
# 所以歸屬改用時間窗：這裡記下「Bash 開始前的那一刻」，post hook 只收 mtime 落在那之後的
# dirty 路徑。窗越窄誤歸越少，所以 stamp MUST 在**這一次** Bash 之前寫、由 post hook 用完
# 即刪，NEVER 讓一個 stamp 橫跨多次 Bash。
#
# 本 session 家族相當比例的寫入走 `sed -i` / heredoc 而不是 Edit/Write，Phase 1 把那些檔
# 全部丟進 `unknown`。這一半就是把它們接回來的地方。
#
# ## 窗內的併發寫入仍會誤歸
#
# 別 session 在同一個窗裡寫同一棵樹，那個檔會被記成我的。所以 post hook 標
# `attribution: "mtime-diff"`，消費端據此知道這條證據比 `hook` 弱。**NEVER** 把
# mtime-diff 的歸屬讀成與 Edit/Write 同級的證據，也 NEVER 因為它可能誤歸就改成
# 「掃 git status 全記」—— 後者是把偶爾誤歸換成必定誤歸。

set -u
set +e

payload=$(cat)

session=$(printf '%s' "$payload" |
  sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$session" ] || exit 0

hook_cwd=$(printf '%s' "$payload" |
  sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$hook_cwd" ] || hook_cwd=$PWD
[ -d "$hook_cwd" ] || hook_cwd=$PWD

# journal 檔住 consumer root（一個 consumer 一份，所有 worktree 共寫）—— 與 post hook 同定義，
# NEVER 改成 tree root，否則兩支 hook 會各寫各的目錄而永遠對不上 stamp。
common_dir=$(git -C "$hook_cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$common_dir" ] || exit 0
consumer_root=$(dirname "$common_dir")
[ -d "$consumer_root" ] || exit 0

journal_dir="$consumer_root/.clade/ownership"
mkdir -p "$journal_dir" 2>/dev/null || exit 0
if [ ! -f "$journal_dir/.gitignore" ]; then
  printf '*\n!.gitignore\n' >"$journal_dir/.gitignore" 2>/dev/null || true
fi

# session id 進檔名前先過濾，避免 path traversal 與奇怪字元。
safe=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
: >"$journal_dir/.bash-stamp-$safe" 2>/dev/null || true

exit 0
