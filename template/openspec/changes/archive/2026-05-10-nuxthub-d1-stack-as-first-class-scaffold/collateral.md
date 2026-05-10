# Collateral Note: <consumer-c> TD-069

## Scope Boundary

<consumer-c> TD-069 is an external user-action item in `~/offline/<consumer-c>/`.
It is cross-linked here only as retroactive collateral for this starter change.

This change does not modify the <consumer-c> repository, does not register a starter follow-up marker, and does not treat TD-069 as starter maintainer debt.

## External User-Action Checklist

For the <consumer-c> maintainer after this starter change is archived:

- Enter the external repo: `cd ~/offline/<consumer-c>/`
- Generate a D1 migration using the NuxtHub D1 overlay produced by this change as the schema reference for <consumer-c>'s D1 layout.
- Review the resulting `server/database/migrations/` diff in <consumer-c>.
- Commit and push the <consumer-c> migration changes from the <consumer-c> repository.

## Non-Action In This Change

- Do not edit `~/offline/<consumer-c>/` from this starter change.
- Do not add a starter follow-up marker for <consumer-c> TD-069.
- Do not mark TD-069 done from the starter repository.

---

## Task 3.1 — PRESET.md Cross-Layer Note (Decision 8)

`template/presets/evlog-nuxthub-ai/PRESET.md` is a clade-managed LOCKED projection (`🔒 LOCKED — managed by clade sync-evlog-presets.mjs`). Per Decision 8 (Documentation and collateral stay in the correct layer), the **correct layer** for PRESET.md content updates is the clade central repository (`~/offline/clade/scripts/sync-evlog-presets.mjs` and its source snippets), not this starter change.

Task 3.1 has therefore been satisfied by **confirming the layer boundary** rather than by modifying the LOCKED projection. The PRESET.md content update — including reconciling the `evlog@^2.16.0` reference with what the evlog.dev official guide actually recommends — is a separate clade-side work item and out of scope for this starter change.

Future clade-side work item:

- Update `~/offline/clade/scripts/sync-evlog-presets.mjs` (or its underlying snippet sources) so the generated PRESET.md aligns with the evlog.dev nuxt integration guide (https://www.evlog.dev/integrate/frameworks/nuxt) — typically by removing the hardcoded `evlog@^2.16.0` install line and following whatever the guide recommends.
- Run clade sync to propagate the regenerated PRESET.md to the 5 consumers (including this starter).
