# Design: Clade project bootstrap integration

## Context

The starter owns project assembly. Clade owns consumer identity, fleet metadata, projections, and the `$bp` lifecycle. The integration must preserve that ownership boundary: the starter may call Clade's public commands, but must not reimplement or directly mutate Clade's derived files.

## Decisions

### Repository identity is explicit

Central registration requires `--repo-id <owner/repo>`. A filesystem directory name is not a stable fleet identity and must not be guessed.

`--workflow-model` defaults to `trunk-based` and accepts `trunk-based` or `pr-merge-based`.

### Clade commands are the integration API

The starter invokes:

1. `scripts/init-consumer.ts` inside the generated project.
2. `scripts/register-consumer.ts` from the discovered Clade checkout when `--repo-id` is present.

The starter never edits `registry/consumers.json` or `consumers.local` itself.

### Registration is truthful

If no repository id is provided, project-local consumer initialization may still complete, but fleet registration remains incomplete. The CLI prints a concrete `project-bootstrap` continuation command and does not report the project as centrally registered.

### Compatibility is one-way

The initializer resolver prefers `.ts` and falls back to `.mjs` for older Clade checkouts. The new registry command has no fallback because directly appending the old local file would violate the current source-of-truth contract.

## Failure behavior

- Missing Clade checkout: project scaffolding succeeds with an explicit bootstrap continuation.
- Missing register command: local initialization remains intact; central registration is reported incomplete.
- Registry validation failure or identity conflict: error output from Clade is surfaced and no derived file is mutated.
- Project path containing spaces remains supported because it is passed as an argv element rather than encoded into a whitespace-delimited file.

