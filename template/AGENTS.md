<!-- AUTO-GENERATED from .claude/ — 請勿手動編輯 -->

# AGENTS.md

## Rules (auto-derived from .claude/rules)

<!--
🔒 LOCKED — managed by clade
Source: rules/core/ci-watch-reflex.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# CI Watch 反射

`git push` 成功後，若 repo 含 `.github/workflows/`，**MUST** 立刻 invoke `/gh-ci-watch` skill 派出 CI watcher。

協定、指令樣板、exit code 對照表：`plugins/hub-core/skills/gh-ci-watch/SKILL.md`。

---

<!--
🔒 LOCKED — managed by clade
Source: rules/core/db-reset-coordination.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

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

# Prod 症狀 → 先查 evlog

repo 有 evlog 投影（`.claude/rules/evlog-investigate.md`）時，prod / staging runtime 症狀的**第一個證據動作 MUST 是查 evlog wide event**，先於 grep code。

協定與 recipe：`rules/modules/capabilities/evlog/evlog-investigate.md`。

---

<!--
🔒 LOCKED — managed by clade
Source: rules/core/prod-mcp-safety.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Prod MCP Safety

## Prod Supabase MCP Permission

**MUST**：`mcp__prod-supabase__execute_sql` 和 `mcp__prod-supabase__apply_migration` 在 AI Agent settings（`.claude/settings.json` / `.claude/settings.local.json`）**只能**放 `deny`。

**NEVER** 放 `allow` 或 `ask` — `allow` = Claude 不經確認即可對 prod DB 執行任意 SQL；`ask` = 一次 approve 後同 session 不再問。

違反後果：<consumer-d> prod DB 被建立孤兒表 `public.sutekh`（2026-06-22）。

偵測：`scripts/audit-tooling-drift.ts` `prodMcpPermission` signal。

---

<!--
🔒 LOCKED — managed by clade
Source: rules/core/ui-invariants-reflex.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# UI Invariants 反射

UI 改動 MUST 遵守 5 條 universal invariant（整欄塌縮 / lookup 解析率 / page load 4xx-5xx / row count vs seed / 不可逆操作確認框）。

baseline template 與 consumer 擴充方式：`claude-md/core-snippets/ui-invariants.template.md`。

---

## Additional rules (pointer only — too large for inline)

- `rules/agent-routing.md` — Agent Routing
- `rules/agent-self-verification.md` — Agent Self-Verification
- `rules/codebase-memory-index.md` — codebase-memory index
- `rules/commit.md` — Commit
- `rules/output-hygiene.md` — Output Hygiene — 別把內部過程變成讀者的負擔
- `rules/proactive-skills.md` — Proactive Skill Orchestra
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

RTK tracking must use a Codex-writable database path:

```toml
[tracking]
database_path = "~/.codex/memories/rtk/history.db"
```
