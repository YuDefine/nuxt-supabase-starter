# Codex scaffolder fresh-clone projection contract

Work: `W-2026-09-27-template-ci-unit-tests-scaffold-test-codex-curso` on branch
`session/2026-09-28-0525-scaffold-codex-projection-ci`.

## Coordinator continuation decision

2026-09-28 coordinator decision (recorded verbatim):

> Codex 投影的產品契約改為「managed scaffold 在依賴安裝成功後由 clade canonical wrapper 產出」；--no-install 與 scaffold-only 選 Codex 時，MUST 明確印出延後投影的確切指令並在 JSON 結果標示 codex projection deferred，NEVER 靜默跳過或宣稱已產出。

The standalone Clade projection mode is a separate coordinator-owned TD.

## Reproduction and evidence

- `git clone --no-local --branch session/2026-09-28-0525-scaffold-codex-projection-ci
  /home/charles/offline/nuxt-supabase-starter-wt/scaffold-codex-projection-ci
  /home/charles/.cache/clade/tmp/starter-codex-fresh-eIHDPU/repo` contained neither
  `template/.codex` nor `template/.agents`.
- In that untouched clone, `pnpm exec vp test run
  packages/create-nuxt-starter/test/scaffold.test.ts` reported 30 passed, 1 failed:
  `.codex/config.toml` was absent at `scaffold.test.ts:256`.
- `node /home/charles/offline/clade/scripts/run-sync-to-codex.ts --dry-run
  --no-health-check` from the fresh worktree template failed with
  `runtime MCP source is missing: .clade/runtime/mcp.json`.
- A no-install, scaffold-only CLI smoke on the fresh clone with this worktree's
  current source (`pnpm exec tsx src/cli.ts codex-smoke --yes --minimal --agents codex
  --no-install --no-register-consumer --no-push --offline --json`) exited 0 and
  reported `status: scaffolded`, but the generated project had `AGENTS.md` and
  `.claude/skills/commit/SKILL.md` without `.codex` or `.agents`.
- Clade `scripts/bootstrap-hub.ts` now prunes the former user-level
  `~/.claude/scripts/sync-to-codex.*` shim. The starter's post-scaffold path had
  depended on that shim. Canonical projection is
  `scripts/run-sync-to-codex.ts`, which requires initialized runtime metadata.

## Starter implementation

- `template/packages/create-nuxt-starter/src/assemble.ts`: stops copying ambient
  ignored Codex projection from a maintainer checkout.
- `template/packages/create-nuxt-starter/src/post-scaffold.ts`: runs Clade's
  canonical wrapper after managed install and requires the config and commit
  skill. With `--no-install` or scaffold-only, it prints a shell-quoted command
  to initialize Clade, install dependencies, bootstrap and project Codex.
- `template/packages/create-nuxt-starter/src/cli.ts`: forwards
  `codexProjection.status` and the deferred command in the JSON result.
- `template/packages/create-nuxt-starter/test/scaffold.test.ts`: checks the
  assembly phase's tracked Claude source instead of ignored ambient projection.
- `template/packages/create-nuxt-starter/test/post-scaffold.test.ts`: covers
  canonical wrapper execution and output checking in the managed install path.
- `template/packages/create-nuxt-starter/test/consumer-update-policy.test.ts`:
  covers deferred JSON and terminal output for scaffold-only and managed
  `--no-install`.
- `template/packages/create-nuxt-starter/README.md`: documents the contract.

Latest local related tests (three files): 99 passed. `pnpm exec vp check`: pass.
Required `npx tsc -p tsconfig.clade.json --noEmit` cannot run here: TS5058,
this repo has no `tsconfig.clade.json` (also noted in the P7 report).
Fresh clone scaffold-only Codex smoke output had `codexProjection.status = deferred`,
`reason = scaffold_only`, and a full command ending in Clade's
`run-sync-to-codex.ts --no-health-check`.

## Coordinator follow-up

The coordinator owns 0-A review, PR ready/merge, and the separate Clade TD for
standalone projection before registration or installation. The Clade tree is
outside this worker's write scope. The starter branch should remain draft until
review is complete. Do not mistake a deferred Codex projection for a generated
one; the JSON field records the distinction.
