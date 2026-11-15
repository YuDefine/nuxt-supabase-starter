#!/usr/bin/env bash
# PreToolUse:Artifact hook — 擋 reply-article 回覆頁沒寫理由就發到 claude.ai Artifact（block，exit 2）
#
# 為什麼：claude.ai Artifact 的作答只存在作答者瀏覽器（Artifact db 也由發頁帳號持有），別的 cc 帳號、別的 session
# 讀不到。
# reply-article SKILL.md Phase 4 改成一律發 web-article 平台，Artifact 只在平台不可用時當備援。
# check_reply_page.py 的 --target 只聽呼叫者自報、擋不住「照舊發 Artifact 又不帶參數」，所以把關卡掛在真正發布的動作上。
#
# 判定：Artifact publish（action 省略或 publish、不是 asset 上傳）的 file_path 是含外層代送契約
# （`type: 'web-article:submit'`）與 `id="storage-note"` 的 HTML（＝reply-article 樣板產的回覆頁）
# → description 沒有「平台不可用：<原因>」就擋。
#
# threat model：防漂移（絆索不是牆）。改寫頁面拿掉契約字樣、用 files 多檔發布、檔案讀不到，一律看不到（放行）。
# gate 型別：安全型的降級——判定故障（node 不在、stdin 不是 JSON、判定丟例外）放行並以 additionalContext 告知。
# 測試：test/pre-artifact-reply-page-gate.test.ts。

set -uo pipefail

input=''
IFS= read -r -d '' input || true

degraded() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"reply-article 回覆頁發布 gate 故障未判定（%s）：回覆頁 MUST 發 web-article 平台（vendor/web-article/scripts/publish.ts）；只有平台不可用時才發 Artifact，description 寫「平台不可用：<原因>」。"}}\n' "$1"
  exit 0
}

command -v node >/dev/null 2>&1 || degraded 'node 不在 PATH'

err=$(
  node -e '
const fs = require("fs")
let j
try { j = JSON.parse(fs.readFileSync(0, "utf8")) } catch { process.exit(3) }
const t = (j && j.tool_input) || {}
if (t.action && t.action !== "publish") process.exit(0)
if (t.asset || typeof t.file_path !== "string" || !/\.html?$/i.test(t.file_path)) process.exit(0)
let html
try { html = fs.readFileSync(t.file_path, "utf8") } catch { process.exit(0) }
if (!html.includes("type: \x27web-article:submit\x27") || !html.includes("id=\"storage-note\"")) process.exit(0)
const m = String(t.description || "").match(/平台不可用[：:]\s*(\S.{5,})/)
if (m && !/<[^>]*>/.test(m[1])) process.exit(0)
process.stderr.write(
  "回覆頁（reply-article）預設發 web-article 平台：claude.ai Artifact 的作答只存在作答者瀏覽器，別的 cc 帳號讀不到。\n" +
  "改用 WEB_ARTICLE_TOKEN=… node ~/offline/clade/vendor/web-article/scripts/publish.ts <客戶>/<專案>/<文件> " + t.file_path + " --title <頁名>（reply-article SKILL.md Phase 4 step 1）。\n" +
  "平台真的不可用才發 Artifact：description 寫「平台不可用：<具體原因>」，回報也寫同一個原因（Phase 4 step 2）。\n")
process.exit(2)
' <<<"$input" 2>&1 >/dev/null
)
rc=$?
case "$rc" in
  0) exit 0 ;;
  2)
    printf '%s\n' "$err" >&2
    exit 2
    ;;
  *) degraded "判定行程 exit ${rc}" ;;
esac
