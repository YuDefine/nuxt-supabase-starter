#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/checks/tag-position.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/checks/tag-position.sh
# CLADE:VENDOR-SCRIPT
#
# tag-position (pre-push) — 擋住「tag 打在落後 default branch 的 commit 上」。
#
# 為什麼這道 check 存在：
#   tag-triggered deploy workflow 檢出的是 tag 那棵樹。tag 落後 main 時，CI 會忠實地測一棵
#   舊的樹，於是紅在具名 test + 具體行號 + 可重現——與真實回歸**完全同形**。沒有任何訊號
#   指向 tag 位置：git 不警告 tag 落後，CI 也不比對 tag 與 branch head。
#   （2026-08-23 <consumer-b> v1.269.1，tag 落後 main 22 個 commit，4 個 test file 紅。）
#
# 為什麼在 pre-push 而不是「打 tag 那一刻」：
#   git 沒有 pre-tag hook。pre-push 是機械上最接近的可執行點，且 abort 時 tag **尚未到達
#   origin**——不會觸發任何 CI run，善後只是 git tag -d。
#   NEVER 把這道檢查搬進 CI workflow：那時 tag 已經推上去了，等於沒防到。
#
# 為什麼一般 push 零成本：
#   沒有 tag ref 就在解析階段 exit 0，不 fetch、不碰網路。只有 push 帶 tag 時才 fetch。
#
# 規約來源：rules/core/commit.detail.md § Tag 位置（release hard gate）
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"
cd "$PROJECT_ROOT"

# --- 取 push refs ---------------------------------------------------------
# runner.sh 在 spawn 平行 check 之前把 git pre-push stdin 讀進這個檔。
# 檔不存在 = 不是經由 runner 呼叫（手動執行 / 舊版 runner）→ 無從判斷，no-op。
REFS_FILE="${CLADE_PREPUSH_REFS_FILE:-}"
[[ -n "$REFS_FILE" && -s "$REFS_FILE" ]] || exit 0

ZERO='0000000000000000000000000000000000000000'

# git pre-push stdin 格式：<local_ref> <local_sha> <remote_ref> <remote_sha>
tag_names=()
tag_shas=()
while read -r local_ref local_sha remote_ref _remote_sha; do
  [[ -n "${remote_ref:-}" ]] || continue
  [[ "$remote_ref" == refs/tags/* ]] || continue
  # 全零 local_sha = 刪除 tag，沒有位置可言，放行
  [[ "$local_sha" == "$ZERO" || -z "$local_sha" ]] && continue
  tag_names+=("${remote_ref#refs/tags/}")
  tag_shas+=("$local_sha")
done < "$REFS_FILE"

# 這次 push 不含 tag → 零成本離開（絕大多數 push 走這條）
[[ ${#tag_shas[@]} -gt 0 ]] || exit 0

# --- 逃生口 ---------------------------------------------------------------
if [[ -n "${CLADE_ALLOW_STALE_TAG:-}" ]]; then
  echo "[clade pre-push] tag-position: CLADE_ALLOW_STALE_TAG 已設，放行 ${tag_names[*]}"
  exit 0
fi

# --- 解 default branch ----------------------------------------------------
git remote get-url origin >/dev/null 2>&1 || exit 0  # 無 origin → 無從比對

default_branch=''
if head_ref="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)"; then
  default_branch="${head_ref#refs/remotes/origin/}"
fi
if [[ -z "$default_branch" ]]; then
  for b in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/$b"; then
      default_branch="$b"
      break
    fi
  done
fi
[[ -n "$default_branch" ]] || exit 0  # 判不出 default branch → fail-open

# --- fetch（fail-open：離線不擋 push）--------------------------------------
if ! git fetch --quiet origin "$default_branch" 2>/dev/null; then
  echo "[clade pre-push] ⚠ tag-position: 無法 fetch origin/$default_branch（離線？）——跳過 tag 位置檢查" >&2
  exit 0
fi

# --- 比對 -----------------------------------------------------------------
stale=0
ahead=0
for i in "${!tag_shas[@]}"; do
  sha="${tag_shas[$i]}"
  name="${tag_names[$i]}"
  # tag object → 解到它指向的 commit
  commit="$(git rev-parse --quiet --verify "${sha}^{commit}" 2>/dev/null || true)"
  [[ -n "$commit" ]] || continue
  behind_n="$(git rev-list --count "$commit..origin/$default_branch" 2>/dev/null || echo 0)"
  if [[ "$behind_n" != "0" ]]; then
    echo "[clade pre-push] ✗ tag-position: tag '$name' 落後 origin/$default_branch $behind_n 個 commit" >&2
    stale=1
  fi
  # 反方向：tag 指向的 commit 含 origin/<default> 沒有的東西 = 這棵樹還沒推上去。
  # 與 behind 是獨立的失敗模式，不共用 CLADE_ALLOW_STALE_TAG —— 那個逃生口的語義是
  # 「我知道這是舊 commit，我就是要在它上面打 hotfix tag」，對「tag 比 origin 新」不成立。
  # 合法的 hotfix（打在舊 commit 上）不會命中這裡：舊 commit 是 origin/<default> 的祖先，
  # 反方向 count 恆為 0。
  ahead_n="$(git rev-list --count "origin/$default_branch..$commit" 2>/dev/null || echo 0)"
  if [[ "$ahead_n" != "0" ]]; then
    echo "[clade pre-push] ✗ tag-position: tag '$name' 含 origin/$default_branch 沒有的 $ahead_n 個 commit" >&2
    ahead=1
  fi
done

if [[ "$ahead" != "0" ]]; then
  cat >&2 <<'MSG'

  tag 打在還沒推上去的 commit 上。tag 一旦推出去，它就指向一棵 origin 上不存在的樹：
  別人 clone 之後 checkout 這個 tag 會失敗，而 tag-triggered workflow 檢出的正是那棵樹。

  這不是 stale tag 的反面，是另一個失敗模式——CLADE_ALLOW_STALE_TAG 對它無效，也不該有效。

  修法（先把 commit 推上去，再推 tag）：

    git push origin main
    git push origin <tag>

MSG
  exit 1
fi

[[ "$stale" == "0" ]] && exit 0

cat >&2 <<'MSG'

  tag 指向的是一棵舊的樹。tag-triggered workflow 會檢出 tag 而不是 default branch，
  於是 CI 紅在具名 test + 具體行號——與真實回歸完全同形，查測試會愈查愈確信。

  修法（刪掉錯 tag、在正確的 commit 重打）：

    git fetch origin main && git merge --ff-only origin/main
    git tag -d <tag>
    git tag <tag>

  真的要在舊 commit 上打 tag（hotfix release）才用：CLADE_ALLOW_STALE_TAG=1 git push origin <tag>

  規約：rules/core/commit.detail.md § Tag 位置（release hard gate）
  Pitfall：docs/pitfalls/2026-08-23-tag-cut-from-stale-commit.md
MSG

exit 1
