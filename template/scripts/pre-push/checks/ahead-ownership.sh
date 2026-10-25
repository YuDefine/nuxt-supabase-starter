#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/checks/ahead-ownership.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/checks/ahead-ownership.sh
# CLADE:VENDOR-SCRIPT
#
# ahead-ownership (pre-push) — push default branch 攜帶 ahead commit 時，要求推的人
# 先逐筆看過那個範圍。
#
# 為什麼這道 check 存在：
#   共享的本機 main 上，別 session 已落地但未推出去的 commit 會被下一次
#   `git push origin main` 靜默帶上去：ad-hoc whitelist commit 在 main 上躺著，
#   另一條 session 的 push 就把它一起推上去。推的人不知道自己攜帶了什麼，
#   被攜帶的人沒機會攔。
#   現行各層都不覆蓋這個形狀：provenance gate 只擋無 `Via: /commit` 的 substantive
#   commit（≤5 檔或純文件 commit——正好是 whitelist commit 的 payload——照放）；
#   propagate 的 ahead 分類只管它自己的 push（CLADE_PROPAGATE）；main-sync 只管
#   clade home。session 對 default branch 的 git push 在 git 層沒有任何看守。
#
# 為什麼是「宣告 ahead 範圍」而不是「比對 commit 是誰的」：
#   commit 層沒有可用的歸屬資料——`Claude-Session:` trailer 記的是 claude.ai web
#   session id（跟本機 env 的 session 識別不同名space）、涵蓋率也不全；author /
#   committer 全 fleet 同一個身分。可靠的攔截面只能是「推的人 MUST 先列舉自己
#   即將推上去的範圍」：env 宣告值 = `git rev-list <remote>..<tip>` 輸出的
#   git hash-object 雜湊，每次 push 都要重算，設一次吃永久做不到，於是列舉
#   這個動作本身不能被 cargo-cult 掉——陌生 commit 會在那次列舉的輸出裡現形。
#
# 為什麼一般 push 零成本：
#   refs 檔不含 default branch ref、或該 ref 的 ahead 為 0，就在解析階段 exit 0，
#   不 fetch、不碰網路。
#
# 豁免與失敗方向：
#   - 具名工具推 main（propagate 的 CLADE_PROPAGATE=1；`flow publish-answers`
#     trunk-based 路徑等帶 CLADE_ALLOW_MAIN_COMMIT=1 的工具）自帶 ahead 判定，豁免。
#   - remote_sha 全零（default branch 首推）／local_sha 全零（刪除）→ 無 ahead
#     範圍可議，放行。
#   - default branch 判不出、refs 檔缺、rev-list 失敗 → infra 層 fail-open 印警示；
#     真正的違規面（ahead 未宣告）一律 fail-closed 擋下。
#
# 規約來源：rules/core/commit.detail.md § 推 default branch 前 MUST 列舉並宣告 ahead 範圍
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

# --- 解 default branch ----------------------------------------------------
# 同 tag-position 的解析順序：origin/HEAD → main/master 後備。判不出 → fail-open
# （沒有 default branch 就沒有「共享 trunk」這個受保護對象）。
git remote get-url origin >/dev/null 2>&1 || exit 0

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
[[ -n "$default_branch" ]] || exit 0

# --- 收集本次 push 打到 default branch 的 ref -------------------------------
default_local_shas=()
default_remote_shas=()
while read -r _local_ref local_sha remote_ref remote_sha; do
  [[ "${remote_ref:-}" == "refs/heads/$default_branch" ]] || continue
  # 刪除 ref：沒有 ahead 可言
  [[ "$local_sha" == "$ZERO" || -z "$local_sha" ]] && continue
  # remote 尚無該 ref（首推）：沒有可對齊的 base，無從談「攜帶別人的」——bootstrap
  # 行為，放行。首推向公開 repo 的內容稽核不屬於本 gate。
  [[ -z "${remote_sha:-}" || "$remote_sha" == "$ZERO" ]] && continue
  default_local_shas+=("$local_sha")
  default_remote_shas+=("$remote_sha")
done < "$REFS_FILE"

# 這次 push 不動 default branch → 零成本離開（絕大多數 push 走這條）
[[ ${#default_local_shas[@]} -gt 0 ]] || exit 0

# --- 具名工具豁免 -----------------------------------------------------------
# propagate（CLADE_PROPAGATE）對每個 consumer 跑自己的 path-based ahead 分類
# （非 clade-managed 路徑的 commit → push-withheld）——它推之前就
# 已經做過更嚴格的歸屬判斷，這裡再要求宣告是重複且不對稱的摩擦。
# CLADE_ALLOW_MAIN_COMMIT 是具名工具的身分標記，同一層語義：工具寫入，不是
# session 攜帶。`flow publish-answers` 的 trunk-based 路徑（answer-publish.ts）
# 先驗本機 default branch 與 origin 對齊、只 commit 單一決策紀錄檔，再帶這個
# 標記推——它的 ahead 恰好是自己那一筆。
if [[ -n "${CLADE_PROPAGATE:-}" || -n "${CLADE_ALLOW_MAIN_COMMIT:-}" ]]; then
  echo "[clade pre-push] ahead-ownership: 具名工具 push（${CLADE_PROPAGATE:+CLADE_PROPAGATE}${CLADE_ALLOW_MAIN_COMMIT:+ CLADE_ALLOW_MAIN_COMMIT}）——豁免"
  exit 0
fi

# --- 逐條 ref 驗證 ahead 宣告 -------------------------------------------------
# 宣告值 = `git rev-list <remote_sha>..<local_sha> | git hash-object --stdin`。
# 雜湊綁的是**整份** ahead 清單的內容：少看一筆、remote 動過、tip 換過，值都對不上，
# 所以「按錯方向盤」（拿著舊值重推、宣告別的範圍）機械上站不住。
blocked=0
for i in "${!default_local_shas[@]}"; do
  local_sha="${default_local_shas[$i]}"
  remote_sha="${default_remote_shas[$i]}"

  if ! ahead_list="$(git rev-list "$remote_sha..$local_sha" 2>/dev/null)"; then
    echo "[clade pre-push] ⚠ ahead-ownership: rev-list $remote_sha..$local_sha 失敗（shallow clone？）——跳過本 ref 的 ahead 檢查" >&2
    continue
  fi
  ahead_n="$(printf '%s\n' "$ahead_list" | grep -c . || true)"
  [[ "$ahead_n" == "0" ]] && continue  # ahead 為空：沒有東西被攜帶

  expected="$(printf '%s\n' "$ahead_list" | git hash-object --stdin)"
  declared="${CLADE_PUSH_MAIN_AHEAD:-}"
  if [[ "$declared" == "$expected" ]]; then
    continue
  fi

  blocked=1
  if [[ -z "$declared" ]]; then
    echo "[clade pre-push] ✗ ahead-ownership: push 會把 $ahead_n 個 ahead commit 推上 origin/$default_branch，但你沒有宣告這個範圍" >&2
  else
    # 帶了宣告卻對不上：算雜湊之後 remote 前移、tip 換過，或宣告的是別的範圍。
    # 訊息要指向「重新列舉」，不是「你沒宣告」。
    echo "[clade pre-push] ✗ ahead-ownership: CLADE_PUSH_MAIN_AHEAD 與這次要推上 origin/$default_branch 的 $ahead_n 個 ahead commit 對不上（宣告之後 remote 前移、tip 換過，或宣告的是別的範圍）——先 git fetch origin 再重新列舉" >&2
  fi
  echo "" >&2
  echo "  即將推上去的 commit（每一筆都 MUST 是你認得的）：" >&2
  # oneline 清單印在攔截輸出裡——「提示」就是讓陌生 commit 當場現形。
  git log --format='  %h %s' "$remote_sha..$local_sha" >&2 || true
  echo "" >&2
done

[[ "$blocked" == "0" ]] && exit 0

cat >&2 <<'MSG'

  這道 gate 存在的原因：共享本機 main 上可能躺著別 session 已落地、還沒推出去的
  commit（ad-hoc whitelist commit、別批已 land 未 push 的內容）。不先列舉就推，
  等於你把它們靜默帶上 origin——TD-614 的實例形狀。

  修法（先列舉，認得每一筆之後帶著宣告重推）：

    git log --oneline origin/<default>..<要推的 tip>     # 看清將推上去的每一筆
    CLADE_PUSH_MAIN_AHEAD="$(git rev-list origin/<default>..<要推的 tip> | git hash-object --stdin)" \
      git push origin <local>:<default>

  若清單裡有不是你這個 session 產生的 commit：NEVER 代推——先查歸屬
  （git show <sha>／batch status／refs/rescue/*），該誰的讓誰推；
  無主物回報協調（fleet-main-align 的 rescue 通道是本機內容的保全路徑）。
  本 gate 不管 commit 內容好壞，只管「推的人看過沒有」。

  規約：rules/core/commit.detail.md § 推 default branch 前 MUST 列舉並宣告 ahead 範圍
MSG

exit 1
