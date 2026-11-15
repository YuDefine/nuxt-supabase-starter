#!/usr/bin/env bash
# PreToolUse(Write|Edit|MultiEdit|Bash) hook — CLAUDE.md、AGENTS.md、CLAUDE.local.md 保持淨空，只准刪、不准加。
#
# 規則正本：where-to-put skill（決策表）；bp skill 的 rules/落點路由判準.md（Rule 8）只是登記進 clade 時的落點判準，指回它。
# 隨 clade 投影進每個 consumer 的 .claude/hooks/，協作者 clone 就生效，不依賴任何全域安裝。
#
#   Write    → 寫完只能是空檔、AGENTS.md 標題 `# AGENTS.md`，或「去空白後恰好一行」where-to-put pointer：
#              repo 層 CLAUDE.md／AGENTS.md（含新建）是 `.claude/skills/where-to-put/SKILL.md`（AGENTS.md 另可是 agents-only
#              投影的 `.agents/skills/where-to-put/SKILL.md`；不准 `~/.agents/...` 寫法），
#              全域指示檔（~/.claude*/CLAUDE.md、$CLAUDE_CONFIG_DIR/CLAUDE.md、~/.pi/agent/AGENTS.md）是 `~/.agents/skills/where-to-put/SKILL.md`
#   Edit     → new_string 必須比 old_string 短，且是 old_string 刪字得來（子序列；MultiEdit 每一段都要）
#   Bash     → 對這些檔的 >、>>、tee、sed -i 一律擋，cp、mv 只擋「這些檔是目的地」（拿它當來源備份或搬走是刪、放行）；`: > 檔` 清空放行
# 例外：上游第三方 repo（路徑含 /offline/herdr/）、node_modules。
#
# 擋下時 exit 2（stderr 給模型看）；jq 缺、輸入讀不出來 → fail-open exit 0。
in=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
tool=$(jq -r '.tool_name // empty' <<<"$in" 2>/dev/null) || exit 0
name_re='(^|/)(CLAUDE|AGENTS|CLAUDE\.local)\.md$'
exempt() { [[ "$1" == */offline/herdr/* || "$1" == */node_modules/* ]]; }
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
rule_pointer() {
  local root="${CLAUDE_PROJECT_DIR:-$PWD}" r=""
  # shellcheck source=_skill-rule-reminder.sh
  if [ -n "$HOOK_DIR" ] && . "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null; then
    r=$(skill_rule_path "$root" bp rules/落點路由判準.md)
  fi
  printf '%s' "${r:-bp skill 的 rules/落點路由判準.md}"
}
# 全域（跨 repo）指示檔：~/.claude*/CLAUDE.md（含 ~/.claude-N 帳號池）、$CLAUDE_CONFIG_DIR/CLAUDE.md、~/.pi/agent/AGENTS.md
# shellcheck disable=SC2088  # 字面比對 `~/` 寫法，不是要展開 ~
is_global_file() {
  local p="$1" cfg="${CLAUDE_CONFIG_DIR:-}"
  [[ "$p" == "~/.claude/CLAUDE.md" || "$p" == "~/.pi/agent/AGENTS.md" ]] && return 0
  [[ -n "$cfg" && "$p" == "${cfg%/}/CLAUDE.md" ]] && return 0
  [[ -n "$HOME" ]] || return 1
  [[ "$p" == "$HOME"/.claude/CLAUDE.md || "$p" == "$HOME"/.claude-*/CLAUDE.md || "$p" == "$HOME/.pi/agent/AGENTS.md" ]]
}
block() {
  echo "Blocked: $1 CLAUDE.md／AGENTS.md 保持淨空，只准刪不准加。想加的東西先讀 .claude/skills/where-to-put/SKILL.md 照決策表判載體（hook、settings、output style、skill、SessionStart 注入或持有它的檔）；登記進 clade 的落點判準見 $(rule_pointer)（Rule 8）。" >&2
  exit 2
}
case "$tool" in
  Write)
    p=$(jq -r '.tool_input.file_path // empty' <<<"$in")
    [[ "$p" =~ $name_re ]] || exit 0
    exempt "$p" && exit 0
    # 每行去頭尾空白、丟掉空行；pointer 必須是整檔唯一一行
    body=$(jq -r '.tool_input.content // ""' <<<"$in" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | grep -v '^$')
    # pointer 放行範圍見 where-to-put skill 與 bp rules/落點路由判準.md Rule 8
    # shellcheck disable=SC2088  # 字面比對路徑與檔案內容，不是要展開 ~
    if is_global_file "$p"; then
      [[ -z "$body" || "$body" == "~/.agents/skills/where-to-put/SKILL.md" ]] && exit 0
    elif [[ "$p" =~ (^|/)(CLAUDE|AGENTS)\.md$ ]]; then
      [[ -z "$body" || "$body" == ".claude/skills/where-to-put/SKILL.md" ]] && exit 0
      # agents-only 投影（沒有 claude 目標）的 AGENTS.md 指向 .agents/skills；`# AGENTS.md` 只為相容舊投影而保留
      [[ "$p" =~ (^|/)AGENTS\.md$ && ( "$body" == ".agents/skills/where-to-put/SKILL.md" || "$body" == "# AGENTS.md" ) ]] && exit 0
    else
      [[ -z "$body" || "$body" == "# AGENTS.md" ]] && exit 0
    fi
    block "寫入 $p 會留下內容。" ;;
  Edit|MultiEdit)
    p=$(jq -r '.tool_input.file_path // empty' <<<"$in")
    [[ "$p" =~ $name_re ]] || exit 0
    exempt "$p" && exit 0
    # 每一段都要「更短」且 new_string 是 old_string 的子序列（只刪字、沒有加新字）
    grow=$(jq -r 'def subseq($n; $o): ($n | explode) as $a | ($o | explode) as $b
        | (reduce $b[] as $c (0; if . < ($a | length) and $a[.] == $c then . + 1 else . end)) == ($a | length);
      [(.tool_input.edits // [ .tool_input ])[]
        | select(((.new_string // "") | length) >= ((.old_string // "") | length)
                 or (subseq(.new_string // ""; .old_string // "") | not))] | length' <<<"$in")
    [ "$grow" = 0 ] && exit 0
    block "這次修改 $p 沒有讓內容變短。" ;;
  Bash)
    c=$(jq -r '.tool_input.command // empty' <<<"$in")
    # 例外只豁免「路徑本身在上游 repo」的指示檔（/offline/herdr/…/AGENTS.md）；指令別處提到 herdr 路徑不豁免整條。
    # 只用 POSIX sed／awk 語法（無 \x27、無 GNU 專屬的 `:a;N;$!ba`）：macOS 的 BSD sed 不認得，會讓 cmd 變空而放行所有寫入。
    q="'"
    c=$(sed -E "s#[^[:space:];&|<>\"$q]*/offline/herdr/[^[:space:];&|<>\"$q]*(CLAUDE|AGENTS)(\\.local)?\\.md##g" <<<"$c")
    grep -qE '(CLAUDE|AGENTS|CLAUDE\.local)\.md' <<<"$c" || exit 0
    # 只看「指令本身」：先丟掉 heredoc 內文（只是被引用的文字，不是指令），把換行接成一行，
    # 再把含空白的引號字串清成空字串（commit message、grep 樣式、echo 的說明文字只是提到檔名）。
    # 不含空白的引號字串（如 `> "CLAUDE.md"`、`sed -i 's/a/b/' AGENTS.md`）保留，照樣判目標；
    # 含空白、但結尾就是指示檔名的引號字串（`> "my dir/CLAUDE.md"`）也保留（空白換成底線），否則目標會被清掉而漏擋。
    # 換行直接在 awk 內接成 ` @@NL@@ `（不靠 sed 的 N／ba 迴圈），再由 sed 單行替換還原成 `;`。
    cmd=$(awk -v q="$q" '
      BEGIN { ORS = " @@NL@@ "; inq = ""; sp = 0 }
      skip { t = $0; sub(/^[ \t]+/, "", t); if (t == delim) skip = 0; next }
      { print
        # 逐字掃描並追蹤引號（跨行）：只認引號外的 `<<`；delimiter 可帶引號、可含連字號等非 identifier 字元。
        n = length($0); i = 1
        while (i <= n) {
          ch = substr($0, i, 1)
          if (inq != "") {
            if (inq == "\"" && ch == "\\") { i += 2; continue }
            # 雙引號內的 `$(`：命令替換內引號狀態重新開始（heredoc 型的 commit message 寫法），遇到配對的 `)` 才回到外層雙引號
            if (inq == "\"" && ch == "$" && substr($0, i + 1, 1) == "(") { sp++; stk[sp] = inq; par[sp] = 1; inq = ""; i += 2; continue }
            if (ch == inq) inq = ""
            i++; continue
          }
          if (sp > 0) {
            if (ch == "(") par[sp]++
            else if (ch == ")") { par[sp]--; if (par[sp] == 0) { inq = stk[sp]; sp--; i++; continue } }
          }
          if (ch == "\\") { i += 2; continue }
          if (ch == q || ch == "\"") { inq = ch; i++; continue }
          if (ch == "#" && (i == 1 || substr($0, i - 1, 1) ~ /[ \t]/)) break
          if (ch == "<" && substr($0, i, 2) == "<<") {
            if (substr($0, i, 3) == "<<<") { i += 3; continue }
            j = i + 2
            if (substr($0, j, 1) == "-") j++
            while (substr($0, j, 1) ~ /[ \t]/) j++
            qc = substr($0, j, 1); d = ""
            if (qc == q || qc == "\"") { k = index(substr($0, j + 1), qc); if (k > 0) d = substr($0, j + 1, k - 1) }
            else if (match(substr($0, j), /^[^ \t;&|<>()]+/)) { d = substr($0, j + RSTART - 1, RLENGTH); sub(/^\\/, "", d) }
            if (d != "") { delim = d; skip = 1; break }
            i = j; continue
          }
          i++
        } }
    ' <<<"$c" \
      | awk -v q="$q" '
          # 逐字配對引號：開引號一定配到它自己的閉引號，含空白才清成空字串。
          # （用 regex 全域替換會把「前一段的閉引號」與「後一段的開引號」誤配，吃掉中間真正的重導向。）
          # 引號外的行尾註解（`# …` 到該行尾）直接丟掉。
          { out = ""; n = length($0); i = 1
            while (i <= n) {
              ch = substr($0, i, 1)
              if (ch == "\\") { out = out ch substr($0, i + 1, 1); i += 2; continue }
              if (ch == "#" && (i == 1 || substr($0, i - 1, 1) ~ /[ \t]/)) {
                p = index(substr($0, i), " @@NL@@ ")
                if (p == 0) break
                i += p - 1; continue
              }
              if (ch != q && ch != "\"") { out = out ch; i++; continue }
              j = i + 1; closed = 0
              while (j <= n) {
                c2 = substr($0, j, 1)
                if (ch == "\"" && c2 == "\\") { j += 2; continue }
                if (c2 == ch) { closed = 1; break }
                j++
              }
              if (!closed) { out = out substr($0, i); break }
              body = substr($0, i + 1, j - i - 1)
              # shell -c／eval 的字串本身就是指令：原樣保留，裡面的重導向才判得到
              if (out ~ /(^|[ \t;&|(])(bash|sh|zsh|dash|ksh)[ \t]+(-[a-zA-Z]+[ \t]+)*-[a-zA-Z]*c[ \t]+$/ || out ~ /(^|[ \t;&|(])eval[ \t]+$/) out = out ch body ch
              else if (body !~ /[ \t]/) out = out ch body ch
              else if (body ~ /(^|\/)(CLAUDE|AGENTS|CLAUDE\.local)\.md$/) { gsub(/[ \t]+/, "_", body); out = out ch body ch }
              else out = out ch ch
              i = j + 1
            }
            print out }
        ' \
      | sed -E "s/ @@NL@@ /;/g")
    # `: > X.md` 清空放行；去掉它與不寫檔的重導向後再看有沒有寫入動作指向這些檔
    rest=$(sed -E 's/(^|[;&|][[:space:]]*):[[:space:]]*>[[:space:]]*[^[:space:];&|]*(CLAUDE|AGENTS)(\.local)?\.md//g; s/[0-9]*>&[0-9-]+//g; s/[0-9]*>>?[[:space:]]*\/dev\/null//g' <<<"$cmd")
    # 檔名要有邊界：前面是路徑分隔、空白或引號（不是別的檔名的尾巴，如 OLD-CLAUDE.md），後面是引號、空白、分隔符或行尾
    # （不是 sed 表達式裡的 `/CLAUDE.md/`）。
    nm='(CLAUDE|AGENTS|CLAUDE\.local)\.md'
    pre='[[:space:]/"'"'"']'
    post='(["'"'"'[:space:];&|)]|$)'
    fn='(["'"'"']|[^[:space:];&|]*/)?'"$nm"
    if grep -qE ">>?[[:space:]]*$fn$post|\\btee\\b[^;&|]*$pre$nm$post|sed[[:space:]]+([^;&|]*[[:space:]])?(-[a-zA-Z]*i[^[:space:];&|]*|--in-place[^[:space:];&|]*)[[:space:]][^;&|]*$pre$nm$post|\\b(cp|mv)\\b[^;&|]*${pre}${nm}[\"']?([[:space:]]+-[^[:space:];&|]*)*[[:space:]]*(\$|[;&|)])" <<<"$rest"; then
      block "這個指令會寫入 CLAUDE.md／AGENTS.md（只有 \`: > 檔\` 清空放行；要刪內容請用 Edit）。"
    fi ;;
esac
exit 0
