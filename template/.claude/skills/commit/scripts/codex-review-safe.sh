#!/usr/bin/env bash
# codex-review-safe.sh — cross-model code review via Pi openai-codex
#
# Engine: Pi `openai-codex` with a deterministic `read,grep,find,ls` allowlist.
# The caller freezes the working-tree snapshot before model execution. On the
# default (openai-codex) pool the runtime cannot obtain write/edit/bash/MCP
# tools, which keeps prompt injection from escaping into mutations or side
# effects. Historical Sol Cursor isolation (retired for Astra): on `--pool cursor` that allowlist is NOT enforced (TD-520): Cursor
# native tools (Shell / Write / MCP / WebFetch / Subagent) stay available and
# their executions do not enter the pi events log.
#
# Since TD-524 the cursor pool no longer runs under the caller's own UID with a
# live filesystem: `runPi` spawns it inside bubblewrap with the audited
# repo bound read-only, $HOME replaced by a tmpfs, and an auth.json filtered
# down to the cursor credential. Repo mutation is refused by the kernel rather
# than detected afterwards, and ~/.ssh, sibling repos and the codex/xai refresh
# tokens are not in the namespace to reach. The sandbox is mandatory: if bwrap
# is missing the run is REFUSED (errorClass `sandbox-unavailable`), never
# downgraded to a bare spawn.
#
# Since TD-533 the sandbox also no longer keeps the network. The run enters a
# network namespace whose only route is a host-side filter: DNS answers nothing
# outside the Cursor API hostnames, and TLS connections are cut unless the
# ClientHello SNI matches them. Enforcement is in the kernel's routing, so it
# covers the SDK's in-process tools too — not just shell children, which is all
# Cursor's own sandbox option reaches. Missing namespace = REFUSED
# (errorClass `egress-unavailable`), never downgraded to an open network.
#
# What that still does not cover: the Cursor API itself is a permitted
# destination, and the model's prompt reaches Cursor's servers by construction.
# The allowlist bounds where the material can go, not who ultimately sees it.
#
# The worktree integrity check below (exit 6) remains a DETECTION control for
# accidents, concurrent-session edits, and default-pool enforcement
# regressions — NOT a security boundary. Coverage is the repo worktree only.
# Legacy Codex CLI config and credentials are never read, copied, or moved by
# this script.
#
# Usage:
#   .claude/scripts/codex-review-safe.sh [low|medium]
# Legacy --pool cursor is rejected: Astra has no verified Cursor model.
#
# Default reasoning_effort = medium. The commit 0-A flow calls this twice:
# 0-A.1 with `medium` (always, unless fast-path skips), and 0-A.2 with
# `medium --findings <prior verdict>` (conditional — only when 0-A.1 surfaces
# Critical/Major; a fresh-context Astra pass re-verifies each finding).
# Other contexts (Spectra propose/apply) use medium.
# See .claude/skills/commit/SKILL.md Step 0-A.
#
# TD-320 resolved (2026-08-02): this script now collects the working-tree
# changeset itself and embeds it in the prompt, instead of telling codex to run
# `git diff` in its own turn. Step 0-A's "reviews a snapshot; later working-tree
# edits don't retroactively affect an already-running review" semantics are
# unchanged — strengthened, in fact, since the reviewed bytes are frozen into
# the prompt at launch. What changes is that exploration cost becomes bounded:
# in the 2026-07-22 context-exhaustion incident codex chose
# `git diff HEAD --unified=100 -- <file>` per file on its own, inflating a
# ~2,600-line diff to ~16,000 lines — 62% of the blowup that swallowed the
# verdict (docs/pitfalls/2026-07-22-codex-max-review-context-exhaustion-no-verdict.md).
#
# Embed budget: CODEX_REVIEW_MAX_DIFF_LINES (default 6000 lines), enforced at
# whole-file granularity — a file whose diff doesn't fit is dropped intact and
# named in the prompt as out of scope, never cut mid-hunk. Two deliberate
# properties of that rule: the first file is always embedded whole (so a single
# pathological diff can't produce an empty changeset — the budget bounds
# accumulation, not one oversized file), and dropped files are named in the
# prompt rather than silently skipped.
#
# Empty changeset = exit 3 without calling codex. This script is only ever
# invoked when there is something to review, so an empty collection means a
# collection bug — and a codex run over nothing returns "No findings", i.e. a
# passing gate that reviewed zero lines.
#
# TD-235 resolved: migrated from --dangerously-bypass-approvals-and-sandbox to
# -s read-only (2026-07-08). Prompt injection can no longer escape to writes or
# MCP side-effects; "fleet-own diffs only" constraint remains as defense-in-depth.
#
# TD-247 resolved: added --disable skills (2026-07-24). Codex review sessions
# were self-invoking second-opinion skills (~6000 lines clade-review-rules.md),
# consuming ~38% context budget and starving max-effort reviews of diff+verdict
# space.
#
# Semantic Verdict injection (W5-6): the prompt is assembled from literal
# (single-quoted) heredocs sandwiching runtime-generated blocks — the changeset
# and the list of vendor/review-rules/patterns.json's `semantic` rules. Those
# blocks cannot be plain `<<'PROMPT_EOF'` heredocs because heredocs quoted that
# way never expand shell variables. Missing/empty patterns.json degrades to an
# empty block plus one stderr warning; it never fails the script.
#
# Shared machinery (2026-09-21, 段 K): changeset collection, budget selection,
# snapshot integrity, prompt assembly and the exit-6 attribution block live in
# lib/review-common.sh — claude-review-safe.sh (the Fable peer carrier) sources
# the same file so the RESULT/exit-code contract has exactly one implementation.
#
# Exit code: passes through the Pi review runner; 3 also means empty changeset
# (the model was not called).

set -uo pipefail

# Runtime 一律走 CLADE_HOME main（Z2）：propagate 只寫 main，repo 內／舊 worktree 的
# 投影副本會凍結在開樹那一刻——舊 wrapper 不認得新 seat、舊 helper 拒絕新的 Routing
# Table 列（2026-09-23 實測）。所以 wrapper 先把自己換成 CLADE_HOME 那份再跑，helper
# 也從 CLADE_HOME 解析。正在開發這支 wrapper／helper 的樹設 CLADE_RUNTIME_FROM_REPO=1
# 跑自己的版本。CLADE_HOME 沒有這份檔（非 clade 機器）時照原樣跑。
CLADE_HOME="${CLADE_HOME:-$HOME/offline/clade}"
_CLADE_SELF_MAIN="$CLADE_HOME/capabilities/core/scripts/codex-review-safe.sh"
# CLADE_HOME main 是多 session 共寫的 working tree：Z2 要的是「main 已 commit 的版本」，
# 不是別人改到一半的檔。所以借用 CLADE_HOME 的 runtime 之前先驗那幾個路徑與 HEAD 一致；
# 不一致就 fail closed（exit 2）。NEVER 改成從快照副本執行——helper／ledger-writer／flow
# 的 state root 由自身檔案位置推導（CLADE_ROOT = dirname(import.meta.url)/..），副本會把
# dispatch record 與 spine 寫進快照目錄。也 NEVER 靜默退回受審 repo 的副本——那正是 Z2
# 要消滅的凍結舊版。受審 repo 就是 CLADE_HOME 本身、或 CLADE_HOME 不是 git repo 時不驗。
# 殘餘窗口：驗完到 exec／node 載入之間的改寫擋不到（秒級）。
if [ "${CLADE_RUNTIME_FROM_REPO:-}" != "1" ] && [ -z "${CLADE_RUNTIME_REEXEC:-}" ]; then
  _clade_home_top="$(git -C "$CLADE_HOME" rev-parse --show-toplevel 2>/dev/null || true)"
  _clade_repo_top="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  if [ -n "$_clade_home_top" ] \
    && [ "$(cd "$_clade_home_top" && pwd -P)" != "$(cd "$_clade_repo_top" && pwd -P)" ]; then
    _clade_dirty="$(git -C "$_clade_home_top" --no-optional-locks diff --name-only HEAD -- \
      capabilities/core/scripts vendor/scripts vendor/signals 2>/dev/null)"
    if [ -n "$_clade_dirty" ]; then
      {
        echo "[codex-review-safe] 錯誤：CLADE_HOME（$_clade_home_top）的 review runtime 有未 commit 的改動，拒絕執行別人改到一半的 wrapper／helper："
        printf '%s\n' "$_clade_dirty" | head -10 | sed 's/^/  /'
        echo "  → 等持有者 commit 或還原（node \"$_clade_home_top/vendor/scripts/flow/flow.ts\" who 查持有者）後重跑；要跑本樹自己 commit 的版本就設 CLADE_RUNTIME_FROM_REPO=1。"
      } >&2
      exit 2
    fi
  fi
  unset _clade_home_top _clade_repo_top _clade_dirty
fi
if [ "${CLADE_RUNTIME_FROM_REPO:-}" != "1" ] && [ -z "${CLADE_RUNTIME_REEXEC:-}" ] \
  && [ -f "$_CLADE_SELF_MAIN" ] \
  && [ "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")" \
    != "$(cd "$(dirname "$_CLADE_SELF_MAIN")" && pwd -P)/codex-review-safe.sh" ]; then
  CLADE_RUNTIME_REEXEC=1 exec bash "$_CLADE_SELF_MAIN" "$@"
fi
unset _CLADE_SELF_MAIN CLADE_RUNTIME_REEXEC

# clade_runtime <repo-relative path>：CLADE_HOME 優先；CLADE_RUNTIME_FROM_REPO=1 且受審
# repo 有該檔時用 repo 版；CLADE_HOME 缺檔時退回 repo 版（非 clade 機器）。
clade_runtime() {
  if [ "${CLADE_RUNTIME_FROM_REPO:-}" = "1" ] && [ -f "$REPO_ROOT/$1" ]; then
    printf '%s\n' "$REPO_ROOT/$1"
  elif [ -f "$CLADE_HOME/$1" ]; then
    printf '%s\n' "$CLADE_HOME/$1"
  else
    printf '%s\n' "$REPO_ROOT/$1"
  fi
}

REASONING="${1:-medium}"
case "$REASONING" in
  low|medium) ;;
  high|xhigh|max|ultra) REASONING=medium ;; # compatibility with installed Sol recipes
  *) echo "[codex-review-safe] effort must be low or medium" >&2; exit 2 ;;
esac
shift || true  # tolerate no args after reasoning

# --pool cursor：保留舊參數以明確拒跑；Astra 尚無已驗證 Cursor model。
#
# 換池 MUST 走這裡而不是另派一次泛用 codex-dispatch：這支 script 的價值在它自己
# 凍結 changeset、自己組 prompt（含 `## Review Verdict` 與 Semantic Verdict 表的
# 格式契約）。ad-hoc dispatch 產出不帶那份契約，過不了 gates.md § 0-A.1 的機械
# 檢查 —— 抓得到 bug，卻不算 gate 通過。
#
# 同檔換池不是降檔（per rules/core/agent-routing.dispatch-execution.md § 配額耗盡時的 fallback 紀律）。
#
# 安全邊界差異（TD-520 / TD-524）：cursor 池上 pi 的 `--tools` 白名單無效 —— sdk 層
# 三條 enforcement 路徑已查證皆不可行（@cursor/sdk LocalAgentOptions 無工具白名單可設；
# `--cursor-mode plan` 是 prompt guidance；`PI_CURSOR_SANDBOX=1` 本環境直接拒跑）。
# 真修在 OS 層：TD-524 起 cursor 池一律跑在 bwrap 內，受審 repo 唯讀綁入、$HOME 換成
# tmpfs、憑證只掛 cursor 一把。**read-only 現在是核心拒絕，不再是 exit 6 事後補償。**
# 未被涵蓋的仍是外洩（sandbox 保留網路），判斷依據是你餵進去的材料敏感度。
POOL="default"
PI_POOL_ARGS=(--model gpt-6-astra)
if [ "${1:-}" = "--pool" ]; then
  POOL="${2:-}"
  shift 2 || true
  case "$POOL" in
    cursor)
      echo "[codex-review-safe] Astra Cursor model is unavailable; review gate remains unmet (exit 4)." >&2
      exit 4
      ;;
    default) ;;
    *)
      echo "[codex-review-safe] 錯誤：未知的 --pool $POOL（可用：cursor）" >&2
      exit 2
      ;;
  esac
fi

# --findings <file>: 深度複審（0-A.2）把上一輪 verdict 餵給 fresh-context
# reviewer —— 沒有原始 findings，reviewer 無法逐條驗證「已修／仍存在」，
# 只能做無方向的第二遍 discovery。檔案內容是上一輪模型輸出，屬於要查證的
# 主張，不是指令。
FINDINGS=""
if [ "${1:-}" = "--findings" ]; then
  FINDINGS="${2:-}"
  shift 2 || true
  if [ -z "$FINDINGS" ] || [ ! -f "$FINDINGS" ]; then
    echo "[codex-review-safe] 錯誤：--findings 需要一個存在的檔案（上一輪 verdict 輸出）" >&2
    exit 2
  fi
  # An empty or verdict-less findings file silently degrades the required
  # finding-by-finding re-review into another discovery pass — demand the
  # verdict contract the file is supposed to carry.
  if ! grep -q '^## Review Verdict' "$FINDINGS"; then
    echo "[codex-review-safe] 錯誤：--findings 檔案不含 \`## Review Verdict\` 區段（請存上一輪完整 verdict 輸出）" >&2
    exit 2
  fi
fi

# Resolve repo root via git, not the script's own path — clade's own checkout
# (capabilities/core/scripts/) and a consumer's projected copy (.claude/scripts/)
# sit at different depths, so a path computed from $0 would resolve wrong in
# one of the two contexts.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PI_REVIEW_RUNNER="$(clade_runtime vendor/scripts/pi-review.ts)"
if [ "$#" -gt 0 ]; then
  echo "[codex-review-safe] 錯誤：遷移到 Pi 後不接受額外 runtime flags；收到：$*" >&2
  exit 1
fi
# TD-534 上層門檻：repo 身分由 runtime 的下層擋（所有 cursor 派工都過），本層擋的是
# 「repo 是我們的、但這個 branch 上是第三方 PR」。兩層都要——下層拿不到「這批 changeset
# 從哪來」的語意，上層漏掉 codex-dispatch 的 cursor tier。
#
# 判定失敗就拒跑，**NEVER** 印個警告繼續：警告的預設結果是照跑，而這道門檻的整個用途
# 就是改掉那個預設。門檻檔缺席（consumer 尚未散播）時同樣拒跑 cursor 池——「檢查不存在」
# 與「檢查通過」在外部無法區分，fail-open 會讓這道門檻在最需要它的機器上靜靜消失。
if [ "$POOL" = "cursor" ]; then
  CURSOR_ORIGIN_GATE="$CLADE_HOME/vendor/scripts/lib/cursor-material-origin.ts"
  if [ ! -f "$CURSOR_ORIGIN_GATE" ]; then
    echo "[codex-review-safe] 錯誤：--pool cursor 拒跑，找不到材料來源門檻 $CURSOR_ORIGIN_GATE（TD-534）" >&2
    exit 7
  fi
  if ! ORIGIN_VERDICT=$(node --input-type=module -e '
    const m = await import(process.argv[1])
    const v = m.assertFleetAuthored(process.argv[2])
    if (!v.allowed) { process.stderr.write(v.reason + "\n"); process.exit(1) }
  ' "$CURSOR_ORIGIN_GATE" "$REPO_ROOT" 2>&1); then
    echo "[codex-review-safe] 錯誤：--pool cursor 拒跑，材料來源門檻未過（TD-534）" >&2
    echo "[codex-review-safe]   $ORIGIN_VERDICT" >&2
    echo "[codex-review-safe]   第三方材料 MUST 走 default 池。" >&2
    exit 7
  fi
fi

REVIEW_SAFE_TAG="codex-review-safe"
REVIEW_SAFE_SCRIPT="codex-review-safe.sh"
REVIEW_SANDBOX_NOTE='MCP tools are rejected by this sandbox — do not attempt them.'
REVIEW_OUTPUT_PATH=""
PATTERNS_JSON="$REPO_ROOT/vendor/review-rules/patterns.json"
MAX_DIFF_LINES="${CODEX_REVIEW_MAX_DIFF_LINES:-6000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/review-common.sh
. "$SCRIPT_DIR/lib/review-common.sh"

# Collect from the repo root: `git ls-files --others` is cwd-scoped, so running
# from a subdirectory would silently drop untracked files elsewhere in the tree.
cd "$REPO_ROOT" || exit 1

review_make_workdir || exit 1

review_load_semantic_list

# baseline MUST 在 changeset 收集**之前**拍。拍在收集之後的話，收集期間的並行
# 修改會被寫進 baseline —— 那份 stale changeset 通過 review 後，實際 commit 的
# 是另一份內容，而完整性檢查對此完全靜默。
review_snapshot_or_die "$WORK_DIR/worktree-before.txt" before
review_collect_changeset
review_build_snapshot

if [ ! -f "$PI_REVIEW_RUNNER" ]; then
  echo "[codex-review-safe] 錯誤：Pi review runner 不存在：$PI_REVIEW_RUNNER" >&2
  exit 3
fi

# runner 輸出先落檔、通過 after-check 才放行到 stdout。直接串流的話，verdict
# （含 `## Review Verdict` heading 與 Semantic Verdict 表）會在完整性驗證前就
# 到達呼叫端 —— 只認 heading / 表格的機械檢查會把 exit 6 的 run 當通過。
review_emit_prompt | node "$PI_REVIEW_RUNNER" \
  --cwd "$REPO_ROOT" \
  --effort "$REASONING" \
  "${PI_POOL_ARGS[@]}" > "$WORK_DIR/verdict.out" 2>&1
rc=$?

review_verify_integrity

cat "$WORK_DIR/verdict.out"

# Text-level outcome marker. The script already propagates the runner's exit
# code (quota-blocked = 4, verified empirically 2026-08-19), but callers that
# read it through a pipe or a background-shell notice can lose the code and
# see 0 — a quota-blocked run then looks like a silently-passed 0-A.1 gate.
# The marker makes the failure unmissable at the text level: no `## Review
# Verdict` heading plus an explicit RESULT line. NEVER treat a run without a
# `## Review Verdict` heading as a passed review, whatever the exit code says.
case "$rc" in
  0) ;;
  4)
    echo "[codex-review-safe] RESULT: quota-blocked — review DID NOT run；NEVER 當作 0-A.1 通過（exit 4）" >&2
    echo "[codex-review-safe] NEXT: Astra quota exhausted; record the exact RESULT line as unavailability evidence, then retry this same gate through claude-review-safe.sh (Fable medium via Herdr). If the Fable seat is also unavailable the gate remains unmet — no other model substitutes, and mainline self-review does not satisfy it." >&2
    ;;
  5)
    echo "[codex-review-safe] RESULT: workspace binding mismatch — pi session 綁到別的 repo，本次 review 的 repo 探索不可信，NEVER 當作 0-A.1 通過（exit 5）" >&2
    ;;
  *) echo "[codex-review-safe] RESULT: review failed（exit $rc）— 無 verdict 產出，NEVER 當作通過" >&2 ;;
esac
exit "$rc"
