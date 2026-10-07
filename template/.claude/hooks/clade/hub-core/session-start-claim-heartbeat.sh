#!/usr/bin/env bash
# clade session-claim: SessionStart heartbeat refresh.
#
# Looks up an existing .clade/claims/<session-id>.json whose worktree_path
# matches the current cwd and refreshes its expires_at. Fail-open: any error
# or absence (no claim, no script, no git repo) is silent. Pure best-effort.
#
# Contract: rules/core/session-claims.md
#
# Output budget: this hook is silent by design — the only external call below
# discards stdout AND stderr (>/dev/null 2>&1), so total session-context
# injection is 0 lines (trivially within the 40-line / 4000-byte SessionStart
# budget). No cap_output wrapping: surfacing previously-discarded helper
# errors would violate the silent best-effort contract above. If this hook
# ever starts emitting, route it through hooks/_output-cap.sh like the other
# session-start-* hooks.
#
# The Claude Code session may start in a session worktree
# (~/offline/<consumer>-wt/<slug>/) — claim-helper.ts walks `git rev-parse
# --git-common-dir` to find the canonical consumer root where claims live.

set -u
set +e

cwd=$(pwd -P 2>/dev/null) || exit 0
[[ -d "$cwd" ]] || exit 0

# helper 只從 fleet 內的 repo 取（clade home／registry 登記的 consumer），而且取自它 main checkout
# 的實體路徑——session worktree 與 main 共用同一份。判定與威脅模型見 _skill-rule-reminder.sh 的
# trusted_fleet_helper。NEVER 改回從 cwd 往上找 `scripts/claim-helper.ts`：在一個 clone 下來的
# 專案裡開 session，就會 node 執行它自帶的腳本。
# shellcheck source=_skill-rule-reminder.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/_skill-rule-reminder.sh" 2>/dev/null || exit 0
helper=$(trusted_fleet_helper "$cwd" claim-helper.ts) || exit 0

[[ -n "$helper" ]] || exit 0
command -v node >/dev/null 2>&1 || exit 0

node "$helper" refresh-by-cwd >/dev/null 2>&1
exit 0
