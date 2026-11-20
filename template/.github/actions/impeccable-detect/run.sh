#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/actions/impeccable-detect/run.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/actions/impeccable-detect/run.sh
# CLADE:VENDOR-SCRIPT
#
# impeccable-detect — PR 的 impeccable detector 關卡（CI 層；與 commit 0-B.1 互補）。
#
#   - CI：action.yml 的 composite step 設好 INPUT_* 後 `bash "$GITHUB_ACTION_PATH/run.sh"`
#   - 本機：在 repo 根 `INPUT_BASE_REF=origin/main bash .github/actions/impeccable-detect/run.sh`
#
# 判定（只看本 PR 改到的 UI 檔，不掃整個 repo，既有舊問題不會讓每張 PR 變紅）：
#   1. 取 base...HEAD 的變更檔（不含刪除），留 .vue/.css/.scss/.html/.tsx/.jsx，
#      再剔除 clade 投影層（交給 vendor/oxc-shared/preset.ts 的 isProjectionPath 判定，含巢狀 template/vendor 等：
#      LOCKED 副本不算本 PR 的 UI 變更）
#   2. 沒有 UI 檔 → exit 0（印 skip 理由）
#   3. 每個 UI 檔往上找採用標記（所屬目錄或祖先，含 repo 根：PRODUCT.md／DESIGN.md／
#      .impeccable/config.json）；任一 UI 檔找不到 → exit 1，提示跑 `impeccable init`／`document`。
#      與 0-B.1「未採用就跳過」不同：CI 層 NEVER 靜默跳過改到 UI 卻沒採用標記的 PR。
#   4. `impeccable detect --json <UI 檔…>`：exit 0 過；exit 2（有 primary finding）擋；
#      其他 exit（掃不到目標、引擎缺失）是 infrastructure-error，fail-closed exit 2。
#      advisory finding 不影響 exit（impeccable 自身語義），但 exit 0／2 都以 warning annotation 露出。detector 讀 `.impeccable/config.json`
#      的 ignores 與 DESIGN.md，所以要保留的 finding 走使用者確認過的 `impeccable hooks ignore-value`。
#
# 基準：pull_request 事件預設 checkout 的是 GitHub 合成的 merge ref（base tip 併 PR head），它的 sha
# 就是 GITHUB_SHA。INPUT_BASE_REF 傳 base.sha 只停在 PR 開啟／最後同步時，main 之後前進的 UI 檔會被
# 誤算成本 PR 的變更；所以只有 GITHUB_EVENT_NAME=pull_request、HEAD 是 merge commit、且 HEAD 就是
# GITHUB_SHA（確定是合成 merge ref）時才改用第一個 parent（HEAD^1）當 base。PR head 本身是 merge
# commit（「Update branch」或手動 git merge main）而 consumer 直接 checkout PR head 時，HEAD≠GITHUB_SHA，
# 照 INPUT_BASE_REF 取 merge-base——否則 HEAD^1..HEAD 只剩 main 帶進來的檔，PR 自己的 UI 改動不會被掃。
#
# 引擎：優先用 repo 版控的 skill launcher（.claude／.agents 的 skills/impeccable/scripts/impeccable），
# 沒有就用本 action 內附的 launcher（engine/scripts/）。後者的 binary 由本 script 依
# engine/scripts/SHA256SUMS（action 內釘死的各平台 sha256）先下載驗證，過了才用 IMPECCABLE_BIN
# 交給 launcher；不靠 release 同源的 .sha256 sidecar。
#
# 輸入（env）：INPUT_BASE_REF（必填：PR base 的 sha 或 ref）
# 需求：node（跑 preset.ts 的 isProjectionPath；node 22.6+ 的 type stripping）與 repo 內的 vendor/oxc-shared/preset.ts
# （clade propagate 投影；缺任一個都是 infrastructure-error，fail-closed）。相容 bash 3.2（不用 mapfile）。

set -euo pipefail

INPUT_BASE_REF="${INPUT_BASE_REF:-}"
ACTION_DIR="${GITHUB_ACTION_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

annotate() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    echo "::$1::$2"
  else
    echo "[$1] $2"
  fi
}

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# 暫存（diff 清單、下載的引擎 binary、detect 輸出）全放 RUNNER_TEMP 底下單一目錄，退出時一律清掉（self-hosted runner 不累積）
WORK_TMP=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/impeccable-detect.XXXXXX")
trap 'rm -rf "$WORK_TMP"' EXIT

if [ -z "$INPUT_BASE_REF" ]; then
  annotate error "infrastructure-error: base-ref is empty — pass the PR base sha (github.event.pull_request.base.sha); the gate did NOT run"
  exit 2
fi
HEAD_SHA=$(git rev-parse HEAD)
if [ "${GITHUB_EVENT_NAME:-}" = pull_request ] && [ -n "${GITHUB_SHA:-}" ] && [ "$HEAD_SHA" = "$GITHUB_SHA" ] \
  && git rev-parse -q --verify 'HEAD^2' >/dev/null 2>&1; then
  # 合成 merge-ref checkout：HEAD^1 是併入當下的 base tip，HEAD^1..HEAD 恰好是本 PR 的變更
  MERGE_BASE=$(git rev-parse 'HEAD^1')
elif ! MERGE_BASE=$(git merge-base "$INPUT_BASE_REF" HEAD 2>/dev/null); then
  annotate error "infrastructure-error: no merge base between '$INPUT_BASE_REF' and HEAD — checkout with fetch-depth: 0; the gate did NOT run"
  exit 2
fi

# git diff 失敗（物件缺失、partial clone 抓 blob 失敗…）MUST fail-closed：不能讓空清單變成「沒有 UI 檔」放行
DIFF_OUT="$WORK_TMP/changed.nul"
if ! git diff --name-only -z --diff-filter=d "$MERGE_BASE" HEAD > "$DIFF_OUT"; then
  annotate error "infrastructure-error: git diff $MERGE_BASE..HEAD failed — the gate did NOT run"
  exit 2
fi
# clade 投影層（LOCKED 副本，chmod 444）不算本 PR 自己的 UI 變更：consumer 修不了、gate 也禁 ignore-file，
# 放進來會讓 flow=pr 的 propagate PR 擋在它無法修的檔上（monorepo 且標記只在 packages/* 時更是必紅）。
# 判定 MUST 重用 vendor/oxc-shared/preset.ts 的 isProjectionPath（含巢狀 template/vendor、template/.claude），
# NEVER 在 shell 另寫一份前綴清單（rules/core/code-style.toolchain.md 禁止；兩份判斷會漂）。
CANDIDATES="$WORK_TMP/ui-candidates.nul"
: > "$CANDIDATES"
NCAND=0
while IFS= read -r -d '' f; do
  case "$f" in
    *.vue|*.css|*.scss|*.html|*.tsx|*.jsx) ;;
    *) continue ;;
  esac
  [ -f "$f" ] || continue
  printf '%s\0' "$f" >> "$CANDIDATES"
  NCAND=$((NCAND + 1))
done < "$DIFF_OUT"

UI=()
if [ "$NCAND" -gt 0 ]; then
  PRESET="$ROOT/vendor/oxc-shared/preset.ts"
  if [ ! -f "$PRESET" ] || ! command -v node >/dev/null 2>&1; then
    annotate error "infrastructure-error: need node and $PRESET (clade-projected isProjectionPath) to filter projected UI files — re-run clade propagate; the gate did NOT run"
    exit 2
  fi
  KEPT="$WORK_TMP/ui-kept.nul"
  if ! node --no-warnings --experimental-strip-types --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs"
    import { pathToFileURL } from "node:url"
    const { isProjectionPath } = await import(pathToFileURL(process.argv[1]).href)
    const files = readFileSync(process.argv[2], "utf8").split("\0").filter(Boolean)
    writeFileSync(process.argv[3], files.filter((f) => !isProjectionPath(f)).map((f) => f + "\0").join(""))
  ' "$PRESET" "$CANDIDATES" "$KEPT"; then
    annotate error "infrastructure-error: could not evaluate isProjectionPath from $PRESET; the gate did NOT run"
    exit 2
  fi
  while IFS= read -r -d '' f; do UI+=("$f"); done < "$KEPT"
  SKIPPED_PROJECTED=$((NCAND - ${#UI[@]}))
  if [ "$SKIPPED_PROJECTED" -gt 0 ]; then
    echo "impeccable-detect: ignored $SKIPPED_PROJECTED clade-projected UI file(s) (isProjectionPath, vendor/oxc-shared/preset.ts)"
  fi
fi
if [ "${#UI[@]}" -eq 0 ]; then
  echo "impeccable-detect: skip — no UI files (.vue/.css/.scss/.html/.tsx/.jsx) changed since $MERGE_BASE"
  exit 0
fi

UNMARKED=()
for f in "${UI[@]}"; do
  dir=$(dirname "$f")
  found=0
  while :; do
    if [ -f "$dir/PRODUCT.md" ] || [ -f "$dir/DESIGN.md" ] || [ -f "$dir/.impeccable/config.json" ]; then
      found=1; break
    fi
    [ "$dir" = . ] && break
    dir=$(dirname "$dir")
  done
  [ "$found" -eq 1 ] || UNMARKED+=("$f")
done
if [ "${#UNMARKED[@]}" -gt 0 ]; then
  for f in "${UNMARKED[@]}"; do
    msg="impeccable 採用標記缺失：本 PR 改到 UI 檔，但它所屬目錄與祖先（含 repo 根）都沒有 PRODUCT.md、DESIGN.md 或 .impeccable/config.json"
    if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error file=$f::$msg"; else echo "[error] $f: $msg"; fi
  done
  echo "impeccable-detect: ${#UNMARKED[@]} UI file(s) without an adoption marker. Run \`impeccable init\` (PRODUCT.md) and \`impeccable document\` (DESIGN.md) in the app root, commit them, and re-run." >&2
  exit 1
fi

IMP=
for candidate in \
  ".claude/skills/impeccable/scripts/impeccable" \
  ".agents/skills/impeccable/scripts/impeccable" \
  "$ACTION_DIR/engine/scripts/impeccable"; do
  if [ -f "$candidate" ]; then IMP=$candidate; break; fi
done
if [ -z "$IMP" ]; then
  annotate error "infrastructure-error: impeccable launcher not found (repo skill or $ACTION_DIR/engine) — the vendored action is incomplete (re-run clade propagate); the gate did NOT run"
  exit 2
fi

# 內附 launcher：binary 先照 SHA256SUMS 驗證再交給 launcher（repo 版控的 launcher 由 consumer 自己的版控負責）
if [ "$IMP" = "$ACTION_DIR/engine/scripts/impeccable" ] && [ -z "${IMPECCABLE_BIN:-}" ]; then
  SUMS="$ACTION_DIR/engine/scripts/SHA256SUMS"
  VERSION=$(tr -d '[:space:]' < "$ACTION_DIR/engine/scripts/VERSION" 2>/dev/null || true)
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; MINGW*|MSYS*|CYGWIN*) os=windows ;; *) os=unknown ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) arch=unknown ;; esac
  asset="impeccable-$os-$arch"; [ "$os" = windows ] && asset="$asset.exe"
  PIN=
  [ -f "$SUMS" ] && PIN=$(awk -v a="$asset" '$1 !~ /^#/ && $2 == a { print $1 }' "$SUMS")
  if [ -z "$VERSION" ] || [ -z "$PIN" ]; then
    annotate error "infrastructure-error: no pinned sha256 for $asset in $SUMS — refusing an unpinned engine download; the gate did NOT run"
    exit 2
  fi
  BIN_DIR="$WORK_TMP/engine"
  mkdir -p "$BIN_DIR"
  BIN="$BIN_DIR/$asset"
  URL="${IMPECCABLE_DOWNLOAD_BASE:-https://github.com/pbakaus/impeccable/releases/download}/engine-v$VERSION/$asset"
  if ! curl -fsSL --retry 2 -o "$BIN" "$URL"; then
    annotate error "infrastructure-error: could not download the impeccable engine from $URL; the gate did NOT run"
    exit 2
  fi
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$BIN" | cut -d' ' -f1); else ACTUAL=$(shasum -a 256 "$BIN" | cut -d' ' -f1); fi
  if [ "$ACTUAL" != "$PIN" ]; then
    annotate error "infrastructure-error: impeccable engine sha256 mismatch ($asset: expected $PIN, got $ACTUAL) — refusing to run it; the gate did NOT run"
    exit 2
  fi
  chmod +x "$BIN"
  export IMPECCABLE_BIN="$BIN"
fi

echo "impeccable-detect: scanning ${#UI[@]} changed UI file(s) with $IMP ($(tr -d '[:space:]' < "$(dirname "$IMP")/VERSION" 2>/dev/null || echo '?'))"
OUT="$WORK_TMP/detect.json"
set +e
sh "$IMP" detect --json "${UI[@]}" > "$OUT"
rc=$?
set -e

# 把 detect --json 輸出轉成 annotation（primary → error、advisory → warning），空陣列不印
report_findings() {
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("node:fs"); const path = require("node:path")
      const root = process.argv[2]
      let list = []
      try { list = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) } catch { process.stdout.write(fs.readFileSync(process.argv[1], "utf8")); process.exit(0) }
      if (!Array.isArray(list) || list.length === 0) process.exit(0)
      const gha = process.env.GITHUB_ACTIONS === "true"
      let primary = 0
      for (const f of list) {
        const level = f.advisory === true ? "warning" : "error"
        if (level === "error") primary++
        const file = f.file ? path.relative(root, f.file) : "?"
        const msg = `[${f.antipattern}] ${f.name}: ${f.snippet ?? ""} — ${f.description ?? ""}`
        console.log(gha ? `::${level} file=${file},line=${f.line ?? 1}::${msg}` : `[${level}] ${file}:${f.line ?? 1} ${msg}`)
      }
      console.log(`impeccable-detect: ${primary} primary finding(s), ${list.length - primary} advisory`)
    ' "$OUT" "$ROOT"
  else
    cat "$OUT"
  fi
}

case "$rc" in
  0)
    # exit 0 只代表沒有 primary finding；advisory 仍要在 CI 上以 warning 露出，不能靜默吞掉
    report_findings
    echo "impeccable-detect: pass — no primary findings"
    exit 0
    ;;
  2)
    report_findings
    echo "impeccable-detect: blocked — fix the findings, or (only after the user confirms keeping one) record it with \`impeccable hooks ignore-value\`. NEVER ignore-file / ignore-rule to get green." >&2
    exit 1
    ;;
  *)
    cat "$OUT" >&2 || true
    annotate error "infrastructure-error: impeccable detect exited $rc (target not scannable or engine unavailable); the gate did NOT pass"
    exit 2
    ;;
esac
