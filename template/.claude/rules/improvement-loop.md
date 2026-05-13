<!--
🔒 LOCKED — managed by clade
Source: rules/core/improvement-loop.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: clade improvement-loop 契約（訊號 schema、redaction、digest invocation、SoT 寫入禁區）
globs: ['vendor/signals/**', 'vendor/scripts/improvement-digest.mjs', 'vendor/scripts/closure-scanner.mjs', 'vendor/scripts/emit-pre-commit-signal.mjs', 'vendor/ledger/**', 'registry/consumers.json', 'bin/vp', 'bin/clade-gate', 'docs/digests/**']
---

# Improvement Loop

clade 的稽核強化 loop：跨 consumer 訊號 → 結構化 digest → outcome ledger → 「該補哪條標準」候選。本 rule 定義其執行契約。完整背景見 `docs/discussions/2026-05-14-improvement-loop.md`，技術設計見 `openspec/changes/archive/<...>-clade-improvement-digest-loop/design.md`（archive 後）。

## When to run digest

`vendor/scripts/improvement-digest.mjs` 由**具體事件**觸發，**不**綁固定週期：

- **propose 前**：要 codify 新標準時，先跑 digest 看是否已有累積證據
- **archive 後**：spectra change archive 完成時，跑一次補建 outcome ledger
- **publish 前**：clade 發版前掃一次當週 candidate
- **user 主動**：`node vendor/scripts/improvement-digest.mjs`

**禁**：cron job、daily digest、weekly digest。固定週期會讓 loop 變 ritual。

## Closure contract（四層推斷，不可塌縮成單一 rate）

candidate 關閉狀態由 `vendor/scripts/closure-scanner.mjs` 推斷，依序：

1. **explicit** — commit / spectra / TD / PR 含 `DIG-<hash>` reference
2. **state** — `expected_state` 斷言全部 satisfied（machine-checkable only）
3. **diff** — 候選後 commit 觸到 `target_paths` 且 diff 命中 `related_keywords`
4. **touched-not-closed** — 觸到 `target_paths` 但沒命中 keyword；**不**算 closure
5. **superseded-inferred** — 同區域走別套設計修；**不**算成功

Digest 必含 5 個 metric（不可塌縮成單一 closure rate）：

- `explicit_close_rate`
- `inferred_close_rate`
- `artifact_realization_rate`
- `stale_reopen_rate`
- `false_positive_rate_from_manual_review`

樣本不足時各 metric 為字串 `"insufficient data"`。

## Redaction is non-bypassable

`vendor/signals/redact.mjs` 對所有 signal record + candidate + outcome 強制 redaction：

- 任何 record `redaction_applied !== true` → validator 直接 reject
- 任何 field 仍 match `SECRET_PATTERNS`（GitHub PAT / OpenAI key / Anthropic key / AWS / JWT / DB DSN / Bearer / cookie / home path / private IP / internal domain）→ validator reject
- **不**接受 env override、record flag、writer-level opt-out
- 新增來源時必須補 fixture 到 `vendor/signals/fixtures/secret-patterns.json` 並通過 `test/improvement-loop-redact.test.mjs`

## Source-of-truth write invariants

digest 與 closure scanner **MUST NOT** 自動修改：

- `rules/core/**`
- `plugins/hub-core/skills/**`
- `plugins/hub-core/hooks/**`
- `openspec/changes/**`

候選的建議行動（「該補 rule X」「該開 spectra change Y」）以**文字**形式寫進 `docs/digests/<date>.md`，由人類決定是否落地。

任何引入「auto-stub spectra change」「auto-edit rules」「auto-PR rule injection」的 PR 都違反本 rule，必須先改本 rule（提 spectra change 改契約）才能 land。

## v1 boundaries

下列在 v1 **明確不做**：

- **LLM-based pattern detection** — `vendor/scripts/improvement-digest.mjs` 內 `forbidLLMScoring()` sentinel 守住；要改必須先改 design.md
- **依賴 user 標 `Refs: DIG-xxx`** — explicit closure 是最高 confidence layer 但**不**是 mandatory；四層推斷的存在就是為了不靠 user 自律
- **Daemon / fixed-schedule digest** — 必須由事件或 user 觸發
- **Claude-Code-specific PostToolUse hook 作主要 instrument** — agent-agnostic same-name PATH shim 才是主力。Hook 是可選 fallback，且不應假設 Codex 也有對應 hook

要拿掉任何一條限制，必須先改本 rule（spectra change）。

## Consumer registry

`registry/consumers.json` 是唯一可信來源。digest 解析 `consumer_id` → `repo_id` **MUST** 走 registry，**不**得從本地 path / git remote 即時推斷。新增 consumer 必須補 registry entry。

## Canary rollout

每個 consumer entry 帶 `improvement_loop_enabled: boolean`。**v1 起手只有 perno + clade 自己 = true**，其他 4 consumer = false。

當 flag = true：

1. `scripts/lib/vendor-targets.mjs` 自動把 11 個 improvement-loop 檔案加入該 consumer 的 vendor projection（`.clade/bin/`, `.clade/signals/`, `.clade/scripts/`, `.clade/registry/consumers.json`），下次 `pnpm hub:vendor` / `propagate.mjs` 散播
2. **package.json 改寫是 explicit opt-in**：跑 `node vendor/scripts/install-clade-gate.mjs <consumer-path>` 才會包 `pnpm test` / `lint` / `typecheck` 進 `clade-gate run`。Backup 寫到 `package.json.clade-gate-backup`，rollback 用 `... --rollback`

**禁**：在 consumer working tree dirty 時跑 propagate / install-clade-gate。consumer 應先 commit 完業務 WIP，再做 improvement-loop projection。

Canary 觀察期建議 1 週：每天看 `.clade/ledger/signals.jsonl`（gitignored）的 redaction leak 跟 noise rate。沒有 leak、shim transparency 維持、digest emit 順利，才把其他 consumer 的 `improvement_loop_enabled` 翻成 true。

Widen rollout 不能用 propagate 自動觸發 — 要逐個 consumer 在乾淨 working tree 下手動翻 flag + propagate + install-clade-gate。

## Where to extend

| 想加什麼 | 改哪 |
| --- | --- |
| 新 redaction pattern | `vendor/signals/redact.mjs` SECRET_PATTERNS + fixture |
| 新 gate 來源 | `vendor/signals/schema.json` gate_name enum + shim/wrapper |
| 新 expected_state predicate kind | `vendor/scripts/closure-scanner.mjs` evaluateStatePredicate |
| 新 threshold rule | `vendor/scripts/improvement-digest.mjs` THRESHOLDS + thresholdFor |
| 新 consumer | `registry/consumers.json` |
