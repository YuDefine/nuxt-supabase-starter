---
work_id: W-2026-09-29-work-route-evlog-map-ci-parity-runner-task-pre-p
---

# template-ci evlog map gate 補 `mode:` — 交棒 brief

你是**繼任者**。前任已把改動做完並開成 PR，剩 merge 需要有權者裁決。

- **repo／cwd：** `~/offline/nuxt-supabase-starter`
- **來源：** clade `W-2026-09-29-work-route-evlog-map-ci-parity-runner-task-pre-p`（Decisions D3）；clade 端 PR YuDefine/clade#538
- **PR：** YuDefine/nuxt-supabase-starter#16（branch `ci/evlog-map-gate-mode`，commit `ea75293b` + 本檔）
- **in-flight dispatch：** 無

## 已完成

- `.github/workflows/template-ci.yml` gate 步驟補 `mode: ratchet`（只動 `with:`）；`docs/tech-debt.md` 登記 TD-024（ratchet → `strict` 收斂計畫）與 TD-025（既有紅燈 `scaffold-receipt.test.ts`，main `631418e4` 上 stash 本改動後同樣重現）。
- 驗證（2026-09-29）：
  - clade#538 worktree 的 `local.ts --print-config` → `mode: ratchet`、`cwd: template`、source `template-ci.yml:140`
  - clade#538 的 `run.sh` 帶 `INPUT_CWD=template INPUT_MODE=ratchet` → `✓ ratchet 通過（score 39 >= 39）` exit 0；`INPUT_MODE=` → exit 2
  - 現行投影沒有 `local.ts`／`run.sh`，所以本 repo 的 `node template/.github/actions/evlog-map-gate/local.ts` 要等 clade 那版 propagate 後才跑得起來
- commit 0-A：Opus 5.5 medium，Critical 0／Major 0／Minor 2，兩項都已修。repo root session 叫不出 `commit-0a-reviewer`（TD-022），改走 `claude-review-safe.sh` 的 Herdr create-only carrier（receipt `~/.cache/clade/dispatch/review/f63de6a5-67c9-4eef-9812-09bc55f647c8.json`）。
- 0-C：`pnpm check` 綠、`pnpm run doctor` clean；`pnpm test` 只有 TD-025 那條失敗。

## 剩餘步驟

1. **merge PR #16，且要在 clade#538 那版 propagate 到本 repo 之前完成。** 前任沒有 merge：`node template/scripts/deploy-trigger-check.ts` 回 `verdict=needs-approval`、`status=undeclared`（`.claude/consumer-meta.json has no deploy.deployTrigger`，`derivedMainPushScope=none`）。依 /commit 6-B.0，main 更新要有人明確授權。由有權者（Charles）裁決 merge。
2. merge 且 clade 新版 propagate 後，在 repo 根跑 `node template/.github/actions/evlog-map-gate/local.ts --print-config`，應看到 `mode: ratchet`；不帶旗標跑應 exit 0。
3. 後續事項各由 TD 承接：TD-024（收斂到 strict）、TD-025（scaffold receipt 測試）。另外 `deploy.deployTrigger` 沒宣告，是獨立的宣告修正，不在本次範圍。

## 邊界

- 本次範圍只到 `template-ci.yml` gate 的 `with:` 與 `docs/tech-debt.md`。`template/.github/actions/**`、`template/scripts/pre-push/**` 是 clade 投影，**NEVER** 在本 repo 改。
