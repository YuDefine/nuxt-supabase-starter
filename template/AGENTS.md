<!-- AUTO-GENERATED from .claude/ — 請勿手動編輯 -->

# AGENTS.md

## Rules (auto-derived from .claude/rules)

<!--
🔒 LOCKED — managed by clade
Source: rules/core/ci-watch-reflex.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
# CI Watch 反射

`git push` 成功後，若 repo 含 `.github/workflows/`，**MUST** 立刻透過目前 runtime 的 `gh-ci-watch` skill 入口派出 CI watcher。支援 slash invocation 的入口使用 `/gh-ci-watch`；其餘入口依 adapter 提供的 skill 呼叫方式執行同一協定。

協定、指令樣板、exit code 對照表：`plugins/hub-core/skills/gh-ci-watch/SKILL.md`。

---

<!--
🔒 LOCKED — managed by clade
Source: rules/core/db-reset-coordination.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
# DB Reset Coordination

**每一次**從 primary checkout reset dev DB 前，MUST 先跑：

```bash
node scripts/db-reset-peer-coordination.ts coordinate --cwd "$(pwd)"
```

只有 `safe_to_reset` 才可 reset。Helper 以 git common-dir 找同專案 Herdr peers；`resetting`／`dependent` peer 完成或到 checkpoint 後 release，requester 最後 reset。

**Iron Law：未收斂就不 reset；warning、title、`idle`／`done` 都不是同意。** 缺回覆、Herdr 不可用、identity／correlation mismatch、timeout 均 fail closed；agent MUST 自行協調，NEVER 照跑或叫 user 排序。

Linked worktree 回 `not_applicable` 後走 DB topology rule；shared／canonical DB 另須 `db-lease`。Herdr NEVER 傳 secret、credential 或 DB row data。

---

<!--
🔒 LOCKED — managed by clade
Source: rules/core/evlog-triage-reflex.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
# Prod 症狀 → 先查 evlog

repo 的 resolved manifest `modules.capabilities` 含 `evlog` 時，prod / staging runtime 症狀的**第一個證據動作 MUST 是查 evlog wide event**，先於 grep code。各 runtime adapter 交付同一份 investigate 規約；Claude 的投影位置是 `.claude/rules/evlog-investigate.md`，其他 runtime 不以該檔是否存在判定能力。

協定與 recipe：`rules/modules/capabilities/evlog/evlog-investigate.md`。

---

<!--
🔒 LOCKED — managed by clade
Source: rules/core/ui-invariants-reflex.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
# UI Invariants 反射

UI 改動 MUST 遵守 5 條 universal invariant（整欄塌縮 / lookup 解析率 / page load 4xx-5xx / row count vs seed / 不可逆操作確認框）。

baseline template 與 consumer 擴充方式：`claude-md/core-snippets/ui-invariants.template.md`。

---

## Additional rules (pointer only — too large for inline)

- `rules/agent-routing.md` — Agent Routing
- `rules/agent-self-verification.md` — Runtime adapter boundary
- `rules/codebase-memory-index.md` — codebase-memory index
- `rules/commit.md` — Commit
- `rules/output-hygiene.md` — Output Hygiene — 別把內部過程變成讀者的負擔
- `rules/proactive-skills.md` — Proactive Skill Orchestra
- `rules/prod-mcp-safety.md` — Prod MCP Safety
- `rules/secret-custody.md` — Secret Custody（secret 值到手時的既定動作）
- `rules/session-tasks.md` — Session Tasks
- `rules/threshold-remediation.md` — Threshold Remediation（門檻處置的幅度紀律）
- `rules/verification-lease.md` — Verification Lease
- `rules/worktree-default.md` — Worktree Default

# RTK Instructions

Use RTK (Rust Token Killer) to reduce token-heavy shell output when running commands through an AI coding assistant.

## Command Routing

- Prefer `rtk git status`, `rtk git diff`, `rtk git log`, `rtk gh ...` for Git and GitHub CLI output.
- Prefer `rtk pnpm ...`, `rtk npm ...`, `rtk vitest`, `rtk playwright test`, `rtk lint`, and `rtk tsc` for package manager, test, lint, and typecheck output.
- Prefer `rtk grep`, `rtk find`, `rtk read`, and `rtk ls` when the expected output is large.
- Use raw shell commands for small, structural, or shell-native operations such as `pwd`, `cd`, `mkdir`, `test`, `[ ... ]`, `[[ ... ]]`, `true`, `false`, `export`, `printf`, and `echo`.
- Do not rewrite shell builtins as RTK subcommands. For example, use `test -d path`, not `rtk test -d path`.
- For shell syntax, compound commands, heredocs, or commands RTK does not understand, use the raw command or `rtk proxy <command>` only when compact tracking is still useful.

## Sandbox Database

RTK tracking must use a Codex-writable database path. Add this to `~/.config/rtk/config.toml`
(RTK ships without that file — `rtk config` prints the defaults and says `file not created`):

```toml
[tracking]
database_path = "~/.codex/memories/rtk/history.db"
```

**Expand `~` yourself when you write that file.** TOML does not expand it: a literal `~`
makes RTK create a directory actually named `~` and tracking silently records nothing —
no error, no warning. The path is written portably here because this file is committed into
each consumer repo and must not carry one machine's home directory.
