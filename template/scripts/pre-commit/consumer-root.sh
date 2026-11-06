#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/consumer-root.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/consumer-root.sh
# CLADE:VENDOR-SCRIPT
#
# consumer-root — runner.sh 與 checks/*.sh 共用的 consumer root 解析（被 source，不單獨執行）
#
# consumer root ≠ git toplevel 的 consumer（monorepo 子目錄，如 nuxt-supabase-starter 的 `template/`）：
# 本目錄恆在 `<consumerRoot>/scripts/pre-commit/`，所以「本目錄的上兩層」才是 consumer root；
# `git rev-parse --show-toplevel` 會解到 monorepo 根，於是 check 在錯的目錄跑
# （vp fmt 在根找不到 workspace package、new-python 找錯根、supabase/migrations 永遠不存在）。
#
# 優先序：
#   1. CLADE_CONSUMER_ROOT（runner.sh 已解好並 export；測試與非標準版面也可明確指定）
#   2. 本目錄上兩層——僅當版面是 consumer 版面（`scripts/pre-commit/`，且 `scripts` 的上層不是 `vendor/`）
#   3. git toplevel（clade 源檔 `vendor/scripts/pre-commit/` 版面，或其他版面）
#
# 任何分支解不出來 MUST 非零退出，NEVER 退回空字串（空 root 會讓後面的 cd 回到呼叫者 cwd，靜默跑錯目錄）。
#
# staged 路徑的使用規約（check 作者必讀）：解出 root 後 `cd "$PROJECT_ROOT"`，之後
#   - `git diff --cached --name-only` MUST 帶 `--relative`（預設吐 toplevel 相對路徑且不限縮子樹）
#   - 讀 index 內容用 `git show :./"$file"`（`:path` 是 toplevel 相對，`:./path` 才是 cwd 相對）
#   - pathspec（`-- '*.vue'`）本來就是 cwd 相對，不用改
# consumer root == toplevel 的一般 consumer 上，上述三條與舊寫法逐位元同義。
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

clade_consumer_root() {
  local here root
  if [[ -n "${CLADE_CONSUMER_ROOT:-}" ]]; then
    if [[ ! -d "$CLADE_CONSUMER_ROOT" ]]; then
      echo "[clade pre-commit] CLADE_CONSUMER_ROOT 指向不存在的目錄：$CLADE_CONSUMER_ROOT" >&2
      return 1
    fi
    (cd "$CLADE_CONSUMER_ROOT" && pwd -P)
    return
  fi

  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  if [[ "$(basename "$here")" == "pre-commit" && "$(basename "$(dirname "$here")")" == "scripts" ]]; then
    root="$(cd "$here/../.." && pwd -P)"
    # clade 源檔版面是 vendor/scripts/pre-commit/，上兩層是 vendor/ 不是 consumer root
    if [[ "$(basename "$root")" != "vendor" ]]; then
      printf '%s\n' "$root"
      return
    fi
  fi

  if ! root="$(git rev-parse --show-toplevel 2>/dev/null)" || [[ -z "$root" ]]; then
    echo "[clade pre-commit] 解不出 consumer root（不在 git 工作區，且本目錄不是 consumer 版面）" >&2
    return 1
  fi
  printf '%s\n' "$root"
}
