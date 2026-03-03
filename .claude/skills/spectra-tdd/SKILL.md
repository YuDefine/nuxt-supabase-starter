---
name: spectra-tdd
description: 'Follow TDD discipline - write failing tests first, then implement'
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: spectra
  version: '1.0'
  generatedBy: 'Spectra'
---

Follow Test-Driven Development discipline for implementation.

**This skill enforces TDD rigor.** Every change starts with a test. No exceptions. No rationalizations.

**Input**: The argument after `/spectra:tdd` describes what to implement or fix. Can be invoked standalone or auto-triggered by `/spectra:apply` when TDD is enabled in project config.

---

## The Iron Law

> Never write implementation code unless you have a failing test that demands it.

This is not a suggestion. This is the discipline. If you find yourself writing code without a failing test, stop and write the test first.

---

## Red-Green-Refactor

Every change follows this cycle:

### 1. RED — Write a failing test

- Write the **smallest possible test** that captures the next behavior
- Run the test. Watch it fail. Confirm it fails for the right reason
- If the test passes immediately, it's not testing new behavior — write a different test

### 2. GREEN — Make it pass

- Write the **minimum code** to make the failing test pass
- Don't optimize. Don't clean up. Don't add "while I'm here" improvements
- Run all tests. Everything must pass

### 3. REFACTOR — Clean up

- Now improve the code: extract, rename, simplify
- Run all tests after each refactor step. They must stay green
- If tests break during refactor, undo and try a smaller step

---

## Bug Fix Workflow

For bug fixes, TDD is even more critical:

1. **Write a test that reproduces the bug** — this test MUST fail
2. **Verify the test fails** — for the right reason (the actual bug, not a setup issue)
3. **Fix the bug** — minimum change to make the test pass
4. **Run all tests** — ensure no regressions

Never fix a bug without a reproducing test. The test IS the proof that you understood the problem.

---

## Rationalization Table

Watch for these thoughts — they mean you're about to break discipline:

| What You're Thinking                    | What You Should Do                     |
| --------------------------------------- | -------------------------------------- |
| "This is too simple to test"            | Write the test. Simple code breaks too |
| "I'll write tests after"                | No. Test first. Always                 |
| "Let me just sketch the implementation" | Sketch in test assertions instead      |
| "The test setup is too complex"         | Simplify the design, not skip the test |
| "I know this works"                     | Prove it with a test                   |
| "One quick change without a test"       | That's how regressions start           |

---

## Practical Guidelines

### Test naming

Use descriptive names that explain the scenario:

- `test_empty_input_returns_error`
- `test_valid_user_is_created`
- NOT: `test1`, `test_it_works`

### Test scope

- **One assertion per test** when possible (or one logical assertion)
- **Test behavior, not implementation** — test WHAT it does, not HOW
- **Independent tests** — each test sets up its own state, no test depends on another

### When stuck after 3 attempts

If you can't make a test pass in 3 attempts:

1. Undo all changes back to the last green state
2. Question whether you're testing at the right level
3. Try a smaller step — can you split this test into two simpler ones?
4. If still stuck, discuss the approach before continuing

---

## Guardrails

- **Never skip tests** — Not for prototypes, not for "quick fixes", not for deadlines
- **Never disable failing tests** — Fix them or revert your change
- **Run the full suite** — Not just the test you wrote. Other tests may break
- **Keep the cycle small** — Minutes per cycle, not hours
- **Commit at green** — Every time tests pass is a good time to commit
