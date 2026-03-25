# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Only dispatch after spec compliance review passes.**

````
Dispatch the TDMS code-review agent (.claude/agents/code-review.md):

  Agent tool:
    description: "Code quality review for Task N"
    model: "opus"
    prompt: |
      Review the code changes between BASE_SHA and HEAD_SHA.

      ## What Was Implemented
      [from implementer's report]

      ## Review Scope
      ```bash
      git diff --stat {BASE_SHA}..{HEAD_SHA}
      git diff {BASE_SHA}..{HEAD_SHA}
      ```

      ## Task Context
      [task summary and plan reference]

      Follow the review process defined in .claude/agents/code-review.md.
      Also load .claude/agents/references/project-review-rules.md for project-specific rules.

      ## Additional Checks (beyond standard code review)

      - Does each file have one clear responsibility with a well-defined interface?
      - Are units decomposed so they can be understood and tested independently?
      - Is the implementation following the file structure from the plan?
      - Did this implementation create new files that are already large, or significantly
        grow existing files? (Don't flag pre-existing file sizes — focus on what this
        change contributed.)
````

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor with file:line), Assessment
