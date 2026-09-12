<!-- Clade native rule; source: adapters/claude/instructions/rules/core/proactive-skills.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native orchestration and browser carrier

Use the Claude-native `Agent` surface only after the common routing, scope, model, evidence, and completion predicates pass. `run_in_background` is the asynchronous owner mode; `TaskOutput(block=false)` observes it, `ScheduleWakeup` records a bounded wakeup, and `TaskStop` cancels only an owned task. `AskUserQuestion` is the structured user decision surface. A missing or unverified surface is a blocked capability, never permission to emulate it.

For `[verify:ui]` screenshot collection, dispatch Pi `--table-row screenshot-review-verify` (`--model gemini --effort high`). Design Review / visual judgment uses the reviewed Claude visual executor and its `agent-browser` CLI only when the current session exposes and validates them. Browser auth must use the approved port-3000 singleton and pre-auth route.
