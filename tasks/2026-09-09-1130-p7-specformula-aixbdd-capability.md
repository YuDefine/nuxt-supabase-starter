# P7：啟用 specformula + aixbdd capability（starter template）

開工：2026-09-09 11:30
Scope：`template/.claude/hub.json` 宣告雙 capability + clade-managed 投影落地。本 repo 不建應用 ISA。

## 任務

- [x] `template/.claude/hub.json` / `template/.clade/manifest.json` 加 `modules.capabilities: ["aixbdd","specformula"]`
- [x] 跑 `hub-sync.ts` 投影 rules / skills / commands / .cursor / .agents
- [x] 修復 hub-sync 造成的去識別化回退（sync-rules 不套 sanitization profile，propagate 才套）
- [x] `audit-template-hygiene.sh` 綠、`audit-public-hygiene.mjs` PASS
- [x] `audit-specformula-adoption.ts` 報現況（PARTIAL；無 ISA / features 為預期）
- [x] 0-A.1 兩條 finding 修完（Major：`.cursor/` 投影未去識別化；Minor：`.commit.lock.history` 帶明文 token 未 ignore）
- [ ] 0-A.2 深度 review + 跨模型裁決
- [ ] commit 落地

## 已知限制（非本次修）

- `vendor/specformula-ts` 對本 repo **withheld**：`sync-vendor --check` 回
  「PUBLIC repo … withheld 146 target(s) from vendor/specformula-ts — 來源不在 PUBLIC_SAFE_SRC_ROOTS」。
  所以 adoption audit 的 `pin` / `workspace` / `test:bdd` 恆為 `—`。要放行需改 clade
  `scripts/lib/vendor-targets.ts` 的 PUBLIC_SAFE_SRC_ROOTS，屬 clade 標準層，不在本 session scope。
- `sync-vendor --check` 另有 6 筆 pre-existing drift（`scripts/pre-push/**`、`scripts/checks/**`），
  需 propagate 帶入，非本次工作造成。
- `pnpm test` 2 failed（`clade-registry-seam.test.ts`）＝ pre-existing，已登記 root `docs/tech-debt.md` TD-013。
- `pnpm run doctor` exit 1（0 blocker / 0 error / 1 warn / 6 info），全落在本次未觸及的 `.vue` 與
  `server/plugins/sentry-cloudflare.ts`，pre-existing。
- registry `conventions.sdd-framework` 仍是 `variant: spectra / state: declared`，屬 clade registry，
  本 session 不動。
