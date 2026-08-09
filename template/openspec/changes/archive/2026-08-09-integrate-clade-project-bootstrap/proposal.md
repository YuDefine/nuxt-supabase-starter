# Change: Integrate the Clade project bootstrap contract

## Why

The starter currently initializes a generated project with a Clade script path that no longer exists and records consumers in `consumers.local`, which is derived local state rather than Clade's registry source of truth. A generated project can therefore look integrated while remaining absent from the fleet registry and `$bp` workflow.

## What Changes

- Resolve the current Clade `scripts/init-consumer.ts` entrypoint, with a compatibility fallback for older `.mjs` checkouts.
- Add repository identity, workflow, activity, and allocated dev-port CLI inputs for explicit fleet identity.
- Register an initialized project through Clade's deterministic `scripts/register-consumer.ts` command.
- Stop appending directly to `consumers.local`.
- When repository identity is missing, print the exact Clade project-bootstrap continuation instead of claiming fleet registration.
- Document and test the new registration contract.

## Impact

- Affected specs: `scaffolder-clade-registration`
- Affected code: `packages/create-nuxt-starter/src/cli.ts`, `packages/create-nuxt-starter/src/post-scaffold.ts`
- Affected docs: CLI and integration guidance
- External dependency: a Clade checkout containing `scripts/register-consumer.ts`
