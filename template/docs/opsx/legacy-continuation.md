# Legacy continuation

Two legacy records have OPSX bindings with explicit provenance. Their original checkbox history is preserved. The new work items remain queued for evidence revalidation; neither change is ready to archive.

The OpenSpec CLI reports planning artifacts as incomplete. Canonical inspect additionally requires current terminal work evidence and projection cursors. Materialization alone does not complete either requirement.

## add-evlog-baseline-and-scaffolder-preset-flag

- Change: `chg_01K4B8Q7M9N2P3R4S5T6V7W8X9` · revision 1
- Binding: `af53784c360af525959c1aea345a7914f36d2fc2`
- Original record: [tasks](../../openspec/changes/add-evlog-baseline-and-scaffolder-preset-flag/tasks.md)
- Provenance digest: `sha256:6f60f6a08bef2f336a635bc02df903795e7011ea7d690373712c5422fdae7d53`

| Work ID | State |
| --- | --- |
| `W-2026-09-05-wsp-addevlogbaselineandscaffolderpresetflag1` | queued |
| `W-2026-09-05-wsp-addevlogbaselineandscaffolderpresetflag2` | queued |
| `W-2026-09-05-wsp-addevlogbaselineandscaffolderpresetflag3` | queued |
| `W-2026-09-05-wsp-addevlogbaselineandscaffolderpresetflag4` | queued |
| `W-2026-09-05-wsp-addevlogbaselineandscaffolderpresetflag5` | queued |
| `W-2026-09-05-wsp-addevlogbaselineandscaffolderpresetflag6` | queued |
| `W-2026-09-05-wsp-addevlogbaselineandscaffolderpresetflag7` | queued |

## starter-public-hygiene-commands

- Change: `chg_01K4B8Q7M9N2P3R4S5T6V7W8YA` · revision 1
- Binding: `3e777791550f81cbf2c1526b3db65d731bbc6ab1`
- Original record: [tasks](../../openspec/changes/starter-public-hygiene-commands/tasks.md)
- Provenance digest: `sha256:0e48a4b6b6a032e3551168d152f34bf5d681f57b6286d1e251c42d73c9200724`

| Work ID | State |
| --- | --- |
| `W-2026-09-05-wsp-starterpublichygienecommands1` | queued |

## Landing

The source bindings are committed. Runtime materialization currently belongs to the isolated checkout. After landing the source bindings, the starter session must materialize these same explicit work IDs in the canonical template checkout before the isolated checkout is removed. This preserves identity across the handoff.

External Sentry and database checks remain external prerequisites. The public-hygiene item is evidence revalidation of the 28 recorded completed rows, not a new business requirement.
