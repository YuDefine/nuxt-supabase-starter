#!/usr/bin/env bash
# SessionStart hook — clade home 的 symlink skill ↔ permissions.deny 對應自驗（clade home 自用）。
#
# 規約：.claude/rules/local/clade-role-and-todo-discipline.md § clade home 自己消費哪幾支
# hub skill——「deny MUST 逐支列名」，新增 symlink skill 缺 deny 一列就是製造下一個無聲丟失。
# 自驗指令原文要人手跑；本 hook 掛在契約已知的 SessionStart（ConfigChange 契約未驗證，
# 見 docs/hook-inventory.md 候選 7），下個 session 必然接住 drift。
#
# 通道：stdout（SessionStart 的 stdout 注入 context）。乾淨 → 零輸出。
# 非 clade home（無 .claude/skills）/ jq 缺 → silent exit 0（fail-open）。

set -uo pipefail

cat > /dev/null

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SKILLS_DIR="$ROOT/.claude/skills"
SETTINGS="$ROOT/.claude/settings.json"
[ -d "$SKILLS_DIR" ] || exit 0
[ -f "$SETTINGS" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

DENY=$(jq -r '.permissions.deny[]? // empty' "$SETTINGS" 2>/dev/null) || exit 0

MISSING=""
for d in "$SKILLS_DIR"/*/; do
  [ -e "${d%/}" ] || continue
  [ -L "${d%/}" ] || continue
  name=$(basename "${d%/}")
  if ! printf '%s\n' "$DENY" | grep -qF ".claude/skills/${name}/"; then
    MISSING="${MISSING}${MISSING:+ }${name}"
  fi
done

[ -n "$MISSING" ] || exit 0

cat <<WARN
⚠️ symlink skill 缺 permissions.deny 對應條目：${MISSING}
   per clade-role-and-todo-discipline § clade home 自己消費哪幾支 hub skill——
   落地要四件一起做，補 .claude/settings.json 的 deny 一列（attended session 處理，逐支列名、NEVER 用目錄萬用字元）。
WARN
exit 0
