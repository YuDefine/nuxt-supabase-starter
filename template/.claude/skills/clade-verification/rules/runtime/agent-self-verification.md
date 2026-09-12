<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-self-verification.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native evidence carrier

Claude Code evidence collection uses the approved `Agent` catalog only when the work benefits from a separate session; single-shot collection remains in the main session. Browser work uses the connected `agent-browser` carrier and its verified session/profile. Use the native `Agent` result and the browser observation together as the receipt; a tool success message alone is not evidence.

For a missing visual or authenticated state, use the Claude `Agent`/browser path defined by the approved review skill and retain the full fallback trail in the shared annotation. Never hand a collectable browser, API, or database check to the user.
