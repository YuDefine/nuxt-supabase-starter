#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋在禁用 prettier 的 repo 內執行 prettier（block，exit 2）
#
# 觸發條件：tool_input.command 在**命令位置**出現 prettier（npx / pnpm exec / npm exec /
#           yarn / bunx / node_modules/.bin/prettier / 裸 prettier），且目標 repo 是
#           oxfmt repo（有 .oxfmtignore / .clade/manifest.json / .claude/hub.json，或 package.json 依賴 vite-plus）。
# 行為：exit 2 並在 stderr 給等效的 `pnpm format` 命令。
#
# 為什麼需要這道 gate：
#   rules/core/code-style.toolchain.md 禁的是 **config 檔**（.prettierrc* / prettier.config.* /
#   package.json 的 prettier 鍵 / .prettierignore）與**直接安裝**（dependencies / devDependencies）。
#   兩條都沒有攔到 binary：prettier@3.9.6 經 @nuxt/hints@1.1.4 的 transitive dep + .npmrc 的
#   shamefully-hoist 躺在 node_modules/.bin/prettier（2026-08-28 registry-driven 掃描：
#   <consumer-a>、<consumer-b>、nuxt-supabase-starter 命中，其餘 11 個 consumer 無 —— starter 命中代表
#   每個新 scaffold 出來的 consumer 都繼承它）。而 prettier **不需要 config 就能運作**，
#   所以禁 config 檔對它殺傷力是零。
#   2026-08-28 <consumer-a> 實例：跑 --write，exit 0、零警告、整檔從單引號無分號改成雙引號加分號，
#   586 行假 diff。全文見 docs/pitfalls/2026-08-28-banned-tool-binary-still-on-path.md。
#
# ⚠️ 這不是全面封鎖，是絆索：
#   本 gate 只看得到 **Claude Code 的 Bash tool call**。user 在自己 terminal 手打 prettier
#   不產生 tool call、不產生那個 JSON，hook 根本不會被 exec —— 那條路徑**沒有任何機制攔截**。
#   NEVER 把本 gate 存在讀成「這個 repo 已經不可能被 prettier 改壞」。它擋的是 agent，
#   而 2026-08-28 兩台命中的當事人恰好都是 agent。
#
# 為什麼不接 pnpm check：
#   binary 是 transitive dep，**移不掉**（@nuxt/hints 是 Nuxt 系的正常依賴），所以狀態型檢查
#   會讓 <consumer-a> / <consumer-b> 的 CI 永久紅。永久紅的 gate 不是攔阻，是噪音 —— 而噪音會訓練所有人略過它。
#   攔阻要掛在**動作**上（有人正要跑它的那一刻），不是掛在**狀態**上（binary 存在與否）。
#
# 為什麼不換 shim：
#   改 node_modules/.bin/prettier 的內容會被任何一次 pnpm install 還原，CI 全新裝機時也不存在。
#
# 只在 oxfmt repo 生效：
#   目標目錄（cd 前綴 → CLAUDE_PROJECT_DIR → PWD）三個 marker 一個都沒有就靜默放行 ——
#   非 clade fleet 的 repo 用 prettier 是它自己的自由。第三個 marker（package.json 依賴
#   vite-plus）不是冗餘：clade home 自己**沒有** .oxfmtignore 也沒有 .clade/manifest.json / .claude/hub.json
#   （它是源頭不是投影對象），少了它，最需要這道 gate 的那棵樹反而不受保護。
#
# 已知誤擋：命令裡把 prettier 寫在**行首**當文字（heredoc 寫文件、貼範例）會被判成命令位置。
#   本檔就是這種內容的產地，所以逃生門是必要的，不是放寬。
# 逃生門：CLADE_ALLOW_PRETTIER=1 放行並在 stderr 留一行記錄。
#
# fail-open：解析失敗 / 無 jq / 無 perl → 靜默 exit 0。hook 壞掉不該擋住工作。

set -uo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# 快篩：絕大多數命令不含 prettier，在這裡返回，不付 perl 解析成本
case "$cmd" in
  *prettier*) ;;
  *) exit 0 ;;
esac

# 命令位置 = 字串開頭、換行、或 ; & | && || ( 之後、或 then/do 之後。
# 三種形狀：套件執行器（npx / pnpm [exec] / yarn dlx / …）、.bin 路徑、裸 prettier。
# 執行器與 prettier 之間允許任意 flag 與子命令，因為下面每一種都是真的跑得起來的：
#   pnpm prettier            → 沒有同名 script 時 pnpm 直接跑 .bin 裡的 binary
#   env npx prettier / command prettier → env 與 command 是不帶賦值的合法前綴
#   pnpm --silent exec prettier / yarn dlx prettier / npx -p prettier prettier
# 下列都不匹配：
#   grep -rn 'prettier' docs/       → prettier 在引號內，前面是引號不是分隔符
#   rg prettier package.json        → 命令位置是 rg
#   cat .prettierignore             → prettier 前面是 '.'，不在命令位置
#   ls node_modules/.bin/prettier   → 命令位置是 ls（.bin 分支要求它自己在命令位置）
printf '%s' "$cmd" | perl -0777 -e '
  my $c = <>;
  $c = "" unless defined $c;
  my $pos = qr{ (?: ^ | [;&|(\n] | \bthen\b | \bdo\b ) \s*
                (?: cd \s+ [^;&|\n]+ && \s* )?
                (?: (?: env | command | nice ) \s+ )*
                (?: (?:env\s+)? \w+=\S+ \s+ )*
                (?: (?: env | command | nice ) \s+ )* }x;
  # 執行器 → 任意 flag / 子命令（exec dlx run x）→ prettier。中間不得跨過分隔符，
  # 否則 `pnpm build && cat x` 這種也會被串起來。
  my $runner = qr{ (?: npx | bunx | pnpm | npm | yarn | bun )
                   (?: \s+ (?: exec | dlx | run | x | --?\S+ ) )* \s+ prettier \b }x;
  exit(($c =~ m{ $pos $runner }x) ? 0 :
       ($c =~ m{ $pos (?: \./ )? \S* node_modules/\.bin/prettier \b }x) ? 0 :
       ($c =~ m{ $pos prettier \b }x) ? 0 : 1)
' || exit 0

# 候選目錄：命令裡**每一個** `cd <dir>` 的目標；一個 cd 都沒有時才回退到預設目錄
# （CLAUDE_PROJECT_DIR → PWD）。有 cd 就不看預設目錄，否則 `cd <別的 repo> && …`
# 這種明確指定目標的命令會被自己所在的 repo 連坐。
# 取全部而不是第一個：複合命令的 cd 與 prettier 不見得配對得起來
# （`cd /foreign && ls; npx prettier` 的 prettier 跑在哪，字面上判不出來）。
# 任一候選是 oxfmt repo 就擋 —— 這個方向的誤判是多擋一次（有逃生門），
# 反方向是靜默改壞整檔。
# 終止符用 lookahead 不消耗 —— 消耗掉 `&&` 的話，`cd /tmp && cd /oxfmt && npx prettier`
# 的第二個 cd 前面就沒有分隔符可比對，只會收到 /tmp（0-A.1 第二輪抓到）。
candidate_dirs=$(printf '%s' "$cmd" | perl -0777 -ne 'print "$1\n" while m{(?:^|[;&|\n])\s*cd\s+([^;&|\n]+?)\s*(?=&&|;|\||$)}g')

is_oxfmt_repo=0
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  dir=$(printf '%s' "$dir" | sed "s/^['\"]//; s/['\"]$//")
  case "$dir" in
    '~'*) dir="${HOME}${dir#\~}" ;;
  esac
  [ -d "$dir" ] || continue
  # oxfmt repo 判定：往上找三個 marker 之一，到 git root 或 / 為止。
  probe="$dir"
  while [ -n "$probe" ] && [ "$probe" != "/" ]; do
    if [ -f "$probe/.oxfmtignore" ] || [ -f "$probe/.clade/manifest.json" ] || [ -f "$probe/.claude/hub.json" ] ||
      { [ -f "$probe/package.json" ] && grep -q '"vite-plus"' "$probe/package.json"; }; then
      is_oxfmt_repo=1
      break
    fi
    [ -d "$probe/.git" ] && break
    probe=$(dirname "$probe")
  done
  [ "$is_oxfmt_repo" = "1" ] && break
done <<EOF
$(if [ -n "$candidate_dirs" ]; then printf '%s\n' "$candidate_dirs"; else printf '%s\n' "${CLAUDE_PROJECT_DIR:-$PWD}"; fi)
EOF

[ "$is_oxfmt_repo" = "1" ] || exit 0

# 逃生門：hook 讀的是**自己的** env，而 `CLADE_ALLOW_PRETTIER=1 npx prettier …` 這個賦值
# 在命令字串裡、還沒被任何 shell 執行過 —— 所以只看 env 的話那個前綴永遠不生效。
# 兩邊都認：harness 進程的 env（極少數情況），以及命令字串裡的前綴（實際會用到的那個）。
if [ "${CLADE_ALLOW_PRETTIER:-}" = "1" ] ||
  printf '%s' "$cmd" | grep -qE '(^|[;&|(]|env )[[:space:]]*CLADE_ALLOW_PRETTIER=1[[:space:]]'; then
  printf 'prettier gate: CLADE_ALLOW_PRETTIER=1 — 放行 prettier 命令\n' >&2
  exit 0
fi

cat >&2 <<'MSG'
prettier gate: 這是 oxfmt repo，NEVER 跑 prettier —— 它會靜默把整檔改成互斥風格
（單引號無分號 → 雙引號加分號），exit 0、零警告。

改用：

  pnpm format                        # 全 repo（已帶 --ignore-path .oxfmtignore）
  pnpm exec vp fmt --write <file>    # 單檔

binary 還在 node_modules/.bin/ 是因為它是 @nuxt/hints 的 transitive dep（移不掉），
不是因為這個 repo 允許用它。

判準：rules/core/code-style.toolchain.md § 禁止所有 prettier config 檔
成因：docs/pitfalls/2026-08-28-banned-tool-binary-still-on-path.md

只是要在文件裡寫下這個命令字串（不是真的要跑）：CLADE_ALLOW_PRETTIER=1 前綴放行。
MSG
exit 2
