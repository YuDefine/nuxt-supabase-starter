#!/usr/bin/env bash
# PreToolUse:Bash hook — 等待迴圈的 `pgrep -f` 自我匹配 advisory（warn-only，NEVER block）
#
# 觸發條件：tool_input.command 的 **迴圈條件片段**（`until`/`while` 到 `do` 之間）
#           含 `pgrep ... -f`，且該片段沒有 `[x]` 形式的自我排除。
# 行為：印 advisory 到 stderr，**一律 exit 0**。這是提醒不是 gate。
#
# 為什麼是 hook 而不是規約散文（TD-316，2026-08-02 實測）：
#   `rule-pressure-test.ts` 對這個主題跑了兩種 framing 共 10 reps，人工複讀
#   **全部正確** —— 模型知識裡本來就有 `[v]itest` 這條。可是兩個真實 session
#   仍各自寫錯一次（一個過度匹配卡 73 分鐘、一個匹配不到偽成功）。失敗不在
#   知識，在注意力放別處時。散文規約要付 always-load 預算卻換不到行為改變；
#   hook 在**動作發生的當下**觸發，不依賴模型當時注意力在哪。
#
# 為什麼 warn 不 block（2026-08-05 對 100,971 個歷史 Bash 命令回測）：
#   命中本 hook 條件的有 98 次（0.097%），其中 60 次 background / 38 次 foreground。
#   絕大多數是真的自我匹配，但仍有極少數是診斷用命令（pattern 字串內含 "until"）——
#   block 會擋掉正當操作，而這個失敗型態的代價（浪費時間）不到 block 的代價（擋住工作）。
#
# 前景也會中（2026-08-05 實測，推翻「只有背景 job 才自我匹配」的直覺）：
#   前景 `pgrep -f 'ZZ-SENTINEL-FG'` 回 **2 matches**、背景 `sh -c` 回 **3 matches**。
#   Claude Code 兩種模式都把命令字串當 shell 參數傳，`/proc/<pid>/cmdline` 都含 pattern。
#
# fail-open：解析失敗 / 無 jq / 無 perl → 靜默 exit 0。
# Darwin 的 BSD grep 沒有 -P（PCRE），所以條件抽取走 perl，不依賴 GNU grep。

set -uo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0

# 快篩：99.4% 的 Bash 命令不含 pgrep，在這裡就返回，不付後續解析成本
case "$cmd" in
  *pgrep*) ;;
  *) exit 0 ;;
esac

# 抽迴圈條件片段：`until`/`while` 到 `; do` 或換行 `do` 之間。
# 只看這一段是關鍵 —— 命令別處出現的 pgrep（典型 `kill $(pgrep -f ...)`）與
# 迴圈是否會卡住無關，把它們算進來會製造雜訊（回測：117 → 98，少 19 個誤報）。
conds=$(printf '%s' "$cmd" | perl -0777 -ne 'while (/\b(?:until|while)\b.*?(?=;\s*do\b|\n\s*do\b)/sg) { print "$&\0" }' | tr '\0' '\n') || exit 0
[ -n "$conds" ] || exit 0

hit=""
while IFS= read -r cond; do
  [ -n "$cond" ] || continue
  printf '%s' "$cond" | perl -0777 -e 'exit((<> =~ /\bpgrep\b[^|;&]*\s-\w*f/) ? 0 : 1)' || continue
  # 已用 `[x]yz` 自我排除 → 這條寫對了，不出聲
  printf '%s' "$cond" | perl -0777 -e 'exit((<> =~ /\[[^]]\]/) ? 0 : 1)' && continue
  hit="$cond"
  break
done <<EOF
$conds
EOF

[ -n "$hit" ] || exit 0

cat >&2 <<EOF

⚠️  [clade] 這個等待迴圈的 \`pgrep -f\` 會匹配到迴圈自己

  條件片段：${hit}

  \`pgrep -f\` 比對**完整命令列**，而執行這個迴圈的 shell，其命令列必然含 pattern
  字串本身 → 條件恆真 → 迴圈永不退出。失敗是**靜默**的：job 狀態 running、輸出
  0 bytes、無任何錯誤訊息。實測前景 2 matches / 背景 3 matches，兩種模式都中。

  改法（任一）：
    1. pattern 自我排除：'[c]odex exec'、'v[i]test'、'[n]uxt typecheck'
    2. 改用哨兵檔：\`<cmd> && touch /tmp/done-\$\$\`，迴圈等該檔出現
    3. 等**自己剛送出**的背景 job → NEVER 另寫等待迴圈，harness 完成時會通知

  另一個方向訊號相反、更難發現：pattern **打不到**時迴圈第一圈就退出並印出成功
  訊息（執行時間異常短、第一行就是成功訊息，看起來完全正常）。送出前 MUST 拿
  **真實輸出**做雙態驗證 —— 「條件成立中」要判 true、「條件不成立」要判 false，
  兩態都跑過才准送出。只驗一態必漏掉另一個方向。

  （advisory only — 這個 hook 從不擋任何指令）

EOF

exit 0
