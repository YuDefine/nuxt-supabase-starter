<!-- Clade native rule; source: adapters/claude/instructions/rules/core/threshold-remediation.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude threshold review transport

When the shared threshold rule requires the Fable structural review, use the Claude review transport:

`Agent({ subagent_type: 'Plan', model: 'fable', run_in_background: false, prompt: <read-only brief> })`

The brief MUST include the threshold, measured history, current remediation and measured reduction. The reviewer only returns advice and reasons; it NEVER edits files. If this transport or the requested model is unavailable, keep the remediation gate incomplete and report the concrete capability gap.
