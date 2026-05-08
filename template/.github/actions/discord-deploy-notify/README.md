# discord-deploy-notify (clade vendored)

Shared GitHub Composite Action that posts a Discord embed summarizing a deploy workflow run. **Vendored** into each consumer repo via clade's `sync-vendor.mjs` propagation — every consumer keeps its own self-contained `.github/actions/discord-deploy-notify/` copy with no runtime dependency on any external repo.

## Source of truth

This file (`vendor/actions/discord-deploy-notify/action.yml` in clade) is the canonical version. Updates flow:

```
clade/vendor/actions/discord-deploy-notify/  ← edit here
                ↓ propagate
consumer/.github/actions/discord-deploy-notify/  ← committed in each consumer's main
                ↓ uses: ./
consumer's deploy.yml notify step
```

To update the action: edit in clade, bump clade version (`node scripts/publish.mjs <bump>`), then `node scripts/propagate.mjs` — every consumer in `consumers.local` receives the new copy in their next propagate cycle.

## Usage in a consumer workflow

```yaml
notify-deploy:
  if: always()
  needs: [ci, deploy]
  runs-on: ubuntu-latest
  steps:
    # ⚠️ Required: vendored local actions need the repo checked out before they resolve.
    # Without this step the runner errors out with:
    #   ##[error]Can't find 'action.yml'... Did you forget to run actions/checkout
    #   before running your local action?
    - uses: actions/checkout@v5

    - uses: ./.github/actions/discord-deploy-notify
      with:
        webhook_url: ${{ secrets.DISCORD_WEBHOOK_URL }}
        target: production
        language: zh
        results: |
          [
            {"name":"CI","result":"${{ needs.ci.result }}"},
            {"name":"Deploy","result":"${{ needs.deploy.result }}"}
          ]
```

The leading `./` is critical — it tells GitHub Actions to resolve the action from the calling repo's working tree (i.e., the vendored copy), not from any remote ref. **And because it resolves from the working tree, the calling job MUST run `actions/checkout` first** — even when the job has no other reason to check out the repo (e.g. a notify-only job that just reports `needs.*.result`). Forgetting this is the most common breakage when migrating from a remote-action reference (`uses: org/repo@v1`, which doesn't need a checkout) to the vendored model.

### Why this README warning isn't the only safeguard

In v1.157~v1.159 this exact rule was violated three times across 4 consumer repos despite the warning above. Documentation-level reminders proved unreliable, so the rule is now **machine-enforced** by `scripts/audit-vendor-checkout.mjs` (run from clade's repo root):

- `pnpm audit:vendor-checkout` — standalone CLI; scans every consumer in `consumers.local`, exits 1 on any finding
- `node scripts/propagate.mjs` — automatically calls `auditConsumerWorkflows()` per consumer **before** writing any files; missing checkout → that consumer's propagate is **aborted** (returns `failed`, others continue)

If you add a new vendored action under `vendor/actions/<name>/`, the audit covers it automatically — `listVendoredActionNames()` enumerates the directory.

Runner requirements: `jq` and `curl` available. GitHub-hosted runners ship both. Self-hosted runners must install them.

## Inputs

| Input         | Required | Type          | Default | Notes                                                       |
| ------------- | -------- | ------------- | ------- | ----------------------------------------------------------- |
| `webhook_url` | yes      | string        | —       | Empty value → action skips with `::warning::`, exits 0.     |
| `title`       | no       | string        | `Deploy` | Embed title prefix.                                          |
| `target`      | no       | string        | `""`    | When set, appended to title as `[<abbrev>]` (see abbreviation table below). |
| `results`     | no       | string (JSON) | `[]`    | Array of `{name: string, result: string}` per upstream job. |
| `language`    | no       | string        | `zh`    | Enum: `zh` \| `en`. Invalid value → action fails the step. |
| `tag`         | no       | string        | `""`    | Empty → falls back to `${{ github.ref_name }}`.            |

`result` values are mapped to icons:

| `result`    | Icon |
| ----------- | ---- |
| `success`   | ✅   |
| `failure`   | ❌   |
| `cancelled` | ⏹️   |
| `skipped`   | ⏭️   |
| any other   | ❓   |

Title status string by language:

| Language | Success            | Failure          |
| -------- | ------------------ | ---------------- |
| `zh`     | `✅ 部署成功`      | `❌ 部署失敗`    |
| `en`     | `✅ Deploy succeeded` | `❌ Deploy failed` |

`target` abbreviation table (applied when `target` is non-empty; rendered as `[<abbrev>]`):

| `target` value | Abbrev rendered |
| -------------- | --------------- |
| `production`   | `Prod`          |
| `staging`      | `Stg`           |
| any other (e.g. `dev`, `e2e-canary`) | rendered literally inside `[ ]` |

Example titles: `target=production language=zh tag=v1.2.3` → `❌ 部署失敗 — Deploy [Prod] — v1.2.3`. `target=staging language=en` → `✅ Deploy succeeded — Deploy [Stg]`. `target=dev` → `❌ Deploy failed — Deploy [dev]`.

Overall status is `succeeded` only when every entry in `results` has `result == "success"`. Empty `results` array also yields `succeeded` (no jobs reported = no failures). Embed color: `3066993` (green) on success, `15158332` (red) on failure.

## Behavior on failure

- **Empty webhook_url**: emits `::warning::DISCORD webhook not provided, skipping notification` and exits 0. Does NOT fail the calling job.
- **Invalid `language`**: exits non-zero with `::error::Invalid language input: '...'`. Fails the calling step.
- **`curl` non-zero exit** (network failure, 4xx/5xx from Discord): emits `::warning::Discord webhook failed`, exits 0. Does NOT fail the calling job.

## Why vendored, not a shared remote action

Earlier iteration of this action lived at `YuDefine/discord-deploy-notify` (public repo) and consumers referenced it via `uses: YuDefine/discord-deploy-notify@v1`. That model has a single point of failure: if the public repo is deleted, archived, or the `v1` tag is force-updated to broken code, every consumer breaks at once.

Vendoring eliminates that failure mode:
- Each consumer's action.yml is a regular tracked file in their main branch.
- Workflows resolve `./` against the consumer's checked-out tree — no network call to a remote repo.
- A clade upgrade is required to receive a new version; consumers stay frozen on whatever they have until the next `propagate.mjs` cycle.
- Even if clade itself disappears, consumers keep working — they have their own copies.

The trade-off is mild: a 5–10 line action file × 5+ consumer repos = ~30 lines of formal "duplication". Acceptable cost for full isolation.
