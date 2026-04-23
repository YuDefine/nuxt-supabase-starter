---
name: subagent-dev
description: Use when executing implementation plans with independent tasks via subagent dispatch and two-stage review
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## When to Use

- Have an implementation plan (from Spectra `/spectra-propose` or manual planning)?
- Tasks mostly independent?
- Want to stay in current session?

If all yes → use this skill.

If tasks are tightly coupled → manual execution or break down further.

## The Process

### Setup

1. Read plan, extract ALL tasks with full text
2. Note context for each task (where it fits, dependencies, architecture)
3. Create task tracking with `update_plan` for each task

### Per Task Loop

1. **Dispatch implementer subagent** (using `./implementer-prompt.md` template)
2. **If subagent asks questions** → answer, provide context, re-dispatch
3. **Implementer implements, tests, commits, self-reviews**
4. **Dispatch spec reviewer subagent** (using `./spec-reviewer-prompt.md` template)
5. **If spec issues found** → implementer fixes → spec reviewer re-reviews
6. **Dispatch code quality reviewer** (using TDMS `code-review` agent)
7. **If quality issues found** → implementer fixes → quality reviewer re-reviews
8. **Mark task complete** with `update_plan`
9. → Next task

### After All Tasks

1. Dispatch final code reviewer for entire implementation
2. Address any remaining issues

## Model Selection

Use the least powerful model that can handle each role:

| Role                      | Model             | When                                                 |
| ------------------------- | ----------------- | ---------------------------------------------------- |
| **Implementer**           | `model: "sonnet"` | Isolated functions, clear specs, 1-2 files           |
| **Implementer**           | `model: "sonnet"` | Multi-file coordination, integration                 |
| **Implementer**           | `model: "opus"`   | Architecture decisions, broad codebase understanding |
| **Spec Reviewer**         | `model: "sonnet"` | Always (focused comparison task)                     |
| **Code Quality Reviewer** | `model: "opus"`   | Always (needs broad quality judgment)                |

## Handling Implementer Status

Implementer subagents report one of four statuses:

**DONE:** Proceed to spec compliance review.

**DONE_WITH_CONCERNS:** Read the concerns before proceeding. If about correctness or scope → address before review. If observations (e.g., "this file is getting large") → note and proceed.

**NEEDS_CONTEXT:** Provide the missing context and re-dispatch.

**BLOCKED:** Assess the blocker:

1. Context problem → provide more context, re-dispatch
2. Needs more reasoning → re-dispatch with `model: "opus"`
3. Task too large → break into smaller pieces
4. Plan itself is wrong → escalate to 使用者

**Never** ignore an escalation or force the same model to retry without changes.

## Review Trigger Integration

**After each task completion, auto-trigger review chain:**

### Stage 1: Spec Compliance Review

- Dispatch spec reviewer subagent with `./spec-reviewer-prompt.md`
- Pass: full task requirements + implementer's report
- Must pass before Stage 2

### Stage 2: Code Quality Review

- Dispatch code quality review using TDMS `code-review` agent (`.codex/agents/code-review.md`)
- Pass review scope via git diff:
  ```bash
  BASE_SHA=$(git rev-parse HEAD~N)  # commits before this task
  HEAD_SHA=$(git rev-parse HEAD)
  ```

### Feedback Classification

- **Critical** → fix immediately, re-review
- **Important** → fix before proceeding to next task
- **Minor** → note for later, continue

## Prompt Templates

- `./implementer-prompt.md` - Dispatch implementer subagent
- `./spec-reviewer-prompt.md` - Dispatch spec compliance reviewer subagent
- `./code-quality-reviewer-prompt.md` - Dispatch code quality reviewer subagent

## Example Workflow

```
You: I'm using Subagent-Driven Development to execute this plan.

[Read plan from openspec/changes/ or docs/]
[Extract all 5 tasks with full text and context]
[update_plan for each task]

Task 1: Add new API endpoint

[Get Task 1 text and context (already extracted)]
[Dispatch implementation subagent with full task text + context]

Implementer: "Before I begin - should this use service_role or authenticated?"

You: "service_role - it's a server API endpoint"

Implementer: "Got it. Implementing now..."
[Later] Implementer:
  - Implemented POST /api/v1/tools/register
  - Added tests, 5/5 passing
  - Self-review: Found I missed validation, added it
  - Committed

[Dispatch spec compliance reviewer]
Spec reviewer: ✅ Spec compliant - all requirements met

[Dispatch code quality reviewer via code-review agent]
Code reviewer: Strengths: Good test coverage. Issues: None. Approved.

[update_plan: Task 1 completed]

Task 2: Add UI component
[Continue...]
```

## Red Flags

**Never:**

- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Accept "close enough" on spec compliance
- **Start code quality review before spec compliance is ✅** (wrong order)
- Move to next task while either review has open issues

**If subagent asks questions:**

- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**

- Implementer (same subagent) fixes them
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

**If subagent fails task:**

- Dispatch fix subagent with specific instructions
- Don't try to fix manually (context pollution)

## Integration

**Works with:**

- **Spectra SDD workflow** — `/spectra-propose` creates the plan, this skill executes it
- **TDMS code-review agent** (`.codex/agents/code-review.md`) — used for code quality review stage
- **test-driven-development skill** — subagents follow TDD for each task
- **testing-anti-patterns rule** — auto-loaded when editing test files

**Cost vs. Quality:**

- More subagent invocations (implementer + 2 reviewers per task)
- Controller does more prep work (extracting all tasks upfront)
- Review loops add iterations
- But catches issues early (cheaper than debugging later)
