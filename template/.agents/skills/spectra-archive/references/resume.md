<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-archive/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-archive — Resume 模式（Dispatch Table + Step 3.5b）

> 本檔是 `spectra-archive/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Resume Dispatch Table（mid-flight，依 sidecar phase 跳轉）

   #### Resume Dispatch Table (mid-flight)

   Read sidecar via `node scripts/spectra-archive-sidecar.ts read <change-name>` (parse JSON `.phase`):

   | `phase` value | Action on `--resume` |
   | --- | --- |
   | `merge-back` | re-run **Step 0** from the top. `wt-helper merge-back --noop-if-missing` is idempotent — if the worktree was already absorbed in the prior run, it silently no-ops. |
   | `gate-check` | jump to **Step 2** and re-run gates (2 / 3 / 3.3 / 3.5 / 5.5). All gates are idempotent: status / task / pattern checks are read-only; the `[discuss]` walkthrough in Step 3.5 only re-prompts items still unchecked. |
   | `spec-sync` | jump to **Step 4** and re-run delta spec assessment. Comparison is idempotent. |
   | `folder-mv` | **STOP — manual fixup required**. Reason: Step 6 invokes `spectra archive` CLI which is a black box from clade's POV; mid-flight interrupt may leave `openspec/changes/<X>/` partially renamed and `openspec/specs/<cap>/spec.md` deltas partially applied. Show the user: <br/> *"phase=folder-mv means `spectra archive` CLI was mid-flight when interrupted. Cannot safely retry — reality is unknown. Manual fixup: (a) inspect `openspec/changes/<X>/` and `openspec/changes/archive/YYYY-MM-DD-<X>/` directory states; (b) inspect `git status` for partial spec delta writes; (c) reconcile by hand (either complete the move or roll back), then `node scripts/spectra-archive-sidecar.ts delete <X>` and re-invoke from a clean state."* |
   | `screenshot-sweep` | jump to **Step 7** and re-run screenshot sweep. `screenshots-archive` Mode B is idempotent on re-copy (existing destination files are silently kept). |
   | `cleanup` | jump to **Step 7.5** and re-run stash reconcile + Step 8 summary. Both are near no-ops on re-run. |

---

## Step 3.5b — Resume walkthrough 全流程（含 HANDOFF entry 移除與 Restrictions）

3.5b. **Resume walkthrough** (clade fork addition — only runs when Step 0.5 detected Resume mode; skip otherwise)

   For each line in `openspec/changes/archive/<change-name>/tasks.md` containing `(deferred-to-handoff:`:

   1. Read item description + extract the `awaiting-signal:` annotation text.
   2. Re-classify trigger condition. The originally-pending signal typically has occurred by now; collect post-signal evidence (prod URL `<title>`, prod evlog row, prod migration `\d` output, etc.). If the signal **still** has not occurred, that's a legitimate "still pending" outcome.
   3. Present to user identical to Step 3.5 walkthrough format, but with header:

      ```
      ### Resume discuss item #<id> [discuss] <description>

      **Originally deferred at:** <ISO from deferred-to-handoff annotation>
      **Awaiting signal:** <signal-desc from awaiting-signal annotation>
      **Trigger condition now:** <internal evidence | external signal already occurred | external signal still pending>

      **Evidence:** (omit if signal still pending)
      <grep / diff / command output / summary>

      **My read:** <one or two sentences>

      請確認：OK / Issue / Skip / Still pending
      ```

      "Defer" is **NOT** offered in Resume mode — that would re-defer the same item indefinitely. The user picks a terminal outcome (OK / Issue / Skip) or signals the item still needs more time (Still pending).

   4. Branch on user response, editing `openspec/changes/archive/<change-name>/tasks.md`:
      - **OK**: Remove `(deferred-to-handoff: ...)` and `(awaiting-signal: ...)` annotations from the line. Insert `(claude-discussed: <new-ISO>)` between description and trailing markers. Keep checkbox `[x]`.
      - **Issue**: Remove `(deferred-to-handoff: ...)` and `(awaiting-signal: ...)`. Change checkbox `[x]` → `[ ]`. Append `（issue: <user note>）` between description and trailing markers.
      - **Skip**: Remove `(deferred-to-handoff: ...)` and `(awaiting-signal: ...)`. Append `（skip[: reason]）`. Keep checkbox `[x]`.
      - **Still pending**: Leave line completely unchanged (annotations + checkbox both stay). HANDOFF entry also stays.

   5. For each item resolved (OK / Issue / Skip) — i.e. NOT "Still pending" — remove the corresponding HANDOFF entry. Resolve `$MAIN_WT_PATH` first (same idiom as `handoff` skill Step 1.5):

      ```bash
      GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
      MAIN_WT_PATH="$(dirname "$GIT_COMMON_DIR")"
      HANDOFF_FILE="$MAIN_WT_PATH/HANDOFF.md"

      # Delete the block between deferred-begin / deferred-end markers for this change/item.
      # Use sed; if markers not found (user manually edited), leave HANDOFF alone and report.
      if grep -q "<!-- deferred-begin:<change-name>:<item-id> -->" "$HANDOFF_FILE"; then
        sed -i.bak "/<!-- deferred-begin:<change-name>:<item-id> -->/,/<!-- deferred-end:<change-name>:<item-id> -->/d" "$HANDOFF_FILE"
        rm "$HANDOFF_FILE.bak"
      else
        echo "warn: HANDOFF entry for <change-name>:<item-id> not found (markers missing); user should clean manually"
      fi
      ```

   6. After all deferred items processed:
      - If `## Deferred discuss items` section body is now empty (no `<!-- deferred-begin:` markers remain anywhere under that heading), best-effort remove the heading too. If removal would risk corrupting surrounding markdown (heading is wedged between other sections), leave heading + empty body and tell user to clean manually.
      - Print one-line summary: `Resume walkthrough complete: X resolved (Y OK / Z Issue / W Skip) / V still pending`

   7. Resume mode does **NOT** run any spectra CLI command. The archived change directory stays in place; only `tasks.md` (and `HANDOFF.md` entries) get edited. User stages + commits the resulting diff manually with a message like `archive: <change-name>; resume — deferred items: X resolved, Y still pending`.

   **Restrictions** (Resume mode):

   - **NEVER** run `spectra archive` CLI in Resume mode (change is already archived — archive flow is a no-op)
   - **NEVER** delete or move the archived change directory
   - **NEVER** re-run gates (archive-gate / manual-review pattern check) / delta sync / screenshot sweep in Resume mode — Step 0.5 explicitly skips those
   - **NEVER** add new `(deferred-to-handoff: ...)` annotations in Resume mode — Defer is forbidden here (would re-defer indefinitely)
   - **NEVER** touch items that lack `(deferred-to-handoff:)` annotation, even in the same `## 人工檢查` section — Resume mode is scoped to deferred items only
