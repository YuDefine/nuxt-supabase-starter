#!/usr/bin/env bash
# PreToolUse(Read) hook — 主線要把截圖 / 圖片讀進 context 時提示正規入口。
# **warn-only，永不 block。**
#
# 為什麼需要這條：[verify:ui] evidence 的正規入口是 screenshot-review Claude subagent，
# 而實測 147 條 (verified-ui:) annotation 0 次走 codex、92 個 session 全部走 bypass 形狀
# （見 rules/core/agent-routing.md）。這條提示的收件人就是正在走 bypass 的主線。
#
# 這條**不是**成本提示：2026-08-04 的初版寫「平均 163k 字元/張、佔 tool_result 56%」，
# 那是用 base64 字元數量的，而圖片按尺寸計費。成本口徑複跑是平均 1,148 tok/張、佔 1.9%
# —— 比一次全檔 Read（1,409 tok）還便宜。錯數字已於 2026-08-06 全面更正（clade TD-375）。
#
# 為什麼是 warn 不是 block：dispatcher 判 FAIL / UNCERTAIN 之後主線**應該**讀那一張，
# 那是正當用途。block 會擋掉唯一合法路徑；這條提示的收件人是「正要連讀第二張」的主線。
#
# 對應規約：rules/core/review-gui-surface.md § 截圖 evidence 與符合性判定
# 對應 TD-375。fail-open：拿不到 file_path / 非圖片 → 靜默 exit 0。

set -euo pipefail

payload=$(cat)

path=$(printf '%s' "$payload" |
  sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || exit 0

case "${path,,}" in
  *.png | *.jpg | *.jpeg | *.webp | *.gif | *.bmp) ;;
  *) exit 0 ;;
esac

session=$(printf '%s' "$payload" |
  sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# 每個 session 只提示一次 —— 反覆響的提示會被整段忽略。
state_dir="${TMPDIR:-/tmp}/clade-img-read"
mkdir -p "$state_dir" 2>/dev/null || exit 0
state_file="$state_dir/${session:-unknown}.seen"
[ -f "$state_file" ] && exit 0
: > "$state_file" 2>/dev/null || true

# 刻意不印檔案 KB：圖片按尺寸計費，位元組大小與 context 成本無關 —— 印它正是初版
# 量出「56%」那個錯誤的同一個混淆。
cat >&2 <<EOF
⚠️ 正在把截圖讀進主線 context。evidence 的正規入口是 dispatcher，不是主線目視。
   per rules/core/review-gui-surface.md § 截圖 evidence 與符合性判定：
     • 收 [verify:ui] evidence → 派 screenshot-review Claude subagent，主線只讀它回的 JSON
     • dispatcher 判 FAIL / UNCERTAIN → 才讀**那一張**，NEVER 順便連讀其他張
     • 想確認整批有沒有拍到 → 跑 emptiness preflight，NEVER 逐張目視
   （本提示每個 session 只出現一次。）
EOF
exit 0
