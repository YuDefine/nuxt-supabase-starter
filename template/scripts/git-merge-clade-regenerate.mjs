#!/usr/bin/env node
/**
 * git-merge-clade-regenerate.mjs — custom git merge driver for clade
 * LOCKED projection files (.claude/hub.json, .claude/.hub-state.json).
 *
 * Invoked by git on 3-way merge conflicts when .gitattributes maps a path to
 * `merge=clade-regenerate`. Receives:
 *   argv[0] = node
 *   argv[1] = this script
 *   argv[2] = %O ancestor file
 *   argv[3] = %A ours file (becomes the merge result — written in place)
 *   argv[4] = %B theirs file
 *   argv[5] = %P pathname (the original file's repo-relative path)
 *
 * Strategy: "prefer ours, validate". The semantics are:
 *   - Stash-pop on top of fresh clade projection produces 3-way conflict where
 *     %A = freshly-regenerated clade version, %B = stashed pre-propagate WIP.
 *   - clade projection files MUST NOT carry hand-edits — so the fresh version
 *     is authoritative. We accept %A unchanged.
 *   - But: if %A is corrupt (invalid JSON), exit non-zero so git surfaces a
 *     real conflict for human investigation rather than silently shipping bad
 *     state.
 *
 * Scope: this driver does NOT regenerate from external sources; it trusts
 * propagate.mjs to have written a valid %A before the merge ran. The
 * "regenerate" in the script name refers to propagate's role; the driver only
 * validates.
 *
 * Limitation: does NOT cover untracked-file writes from bootstrap. If
 * bootstrap writes a new untracked file with the same name, git status will
 * report the conflict separately (no 3-way merge involved). See
 * rules/core/session-claims.md Phase 5 notes.
 */

import { readFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const [, oursPath, , pathName] = args

if (!oursPath) {
  console.error('[clade-regenerate] missing %A argument')
  process.exit(2)
}

try {
  const text = await readFile(oursPath, 'utf8')
  JSON.parse(text)
  process.exit(0)
} catch (e) {
  console.error(
    `[clade-regenerate] ${pathName ?? oursPath}: ours version invalid JSON (${e.message ?? e}); ` +
      `falling through to git conflict — investigate manually.`,
  )
  process.exit(1)
}
