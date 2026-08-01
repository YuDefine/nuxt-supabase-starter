<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-archive/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-archive — Step 3.5 discuss items walkthrough 細節

> 本檔是 `spectra-archive/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 3.5 — walkthrough 步驟 1–6、呈現格式、OK / Issue / Skip / Defer 分支、HANDOFF write

   1. Read the item description and surrounding context (proposal.md User Journeys, related task results, recent diff).
   2. **Classify the item's trigger condition** (key for next step):
      - **Internal evidence available now** — code / schema / migration state / cron config / dev DB query result. Claude can collect evidence immediately.
      - **External signal already occurred** — staging / production already deployed, soak window already elapsed, business decision already made. Claude can query the post-signal state (prod URL `<title>`, prod evlog row, prod migration `\d` output) and collect evidence.
      - **External signal pending** — required deploy / soak / business authorization has **not yet** occurred. Claude **CANNOT** synthesize evidence by analysis alone; any "based on code, this should work" reasoning is speculation, not walkthrough evidence.
   3. **Prepare evidence** relevant to the item — pick whichever combination is most informative:
      - `grep` / `rg` results showing the relevant code paths or migrations touched
      - Recent `git diff` excerpts (focused on the area the item references)
      - Command output (if the item asks about deploy / migration / cron / data state, run the relevant query and paste the output)
      - Data summary (e.g., row counts, distribution stats, drift counts)
      - Cross-consumer / cross-environment check results (e.g., per-consumer migration apply status)

      **For "External signal pending" items**: skip evidence collection (there's nothing to collect yet). Move directly to step 4 with the trigger condition stated explicitly.
   4. Present to the user, in this format:

      ```
      ### Discuss item #<id> [discuss] <description>

      **Trigger condition:** <internal evidence | external signal already occurred | external signal pending — describe>

      **Evidence:** (omit this section if trigger is "external signal pending")
      <grep / diff / command output / summary>

      **My read:** <one or two sentences explaining what the evidence implies, OR "waiting on <signal>; no evidence available yet — recommend Defer to HANDOFF so archive can proceed">

      請確認：OK / Issue / Skip[ / Defer]
      ```

      The **Defer** option is shown **only** when trigger is "external signal pending". For the other two trigger classes, only OK / Issue / Skip are valid — Claude has evidence available and there is nothing legitimate to wait on.

   5. Wait for the user's response. Branch on the answer:

      - **OK**: Edit `tasks.md` for this line:
        - Set checkbox to `[x]`
        - Insert `(claude-discussed: <ISO-8601-timestamp>)` annotation between description and any trailing markers (`@followup[TD-NNN]` / `@no-screenshot`), preserving canonical ordering. Use the current ISO-8601 UTC timestamp (`new Date().toISOString()`).
        - Example before: `- [ ] #2 [discuss] Confirm rollout @no-screenshot`
        - Example after: `- [x] #2 [discuss] Confirm rollout (claude-discussed: 2026-05-10T14:23:00Z) @no-screenshot`
      - **Issue**: Edit `tasks.md`:
        - Keep checkbox as `[ ]`
        - Append `（issue: <user note>）` annotation between description and trailing markers
        - Note in summary: this item is intentionally left unchecked; archive **does NOT** block on it (user retains control)
      - **Skip**: Edit `tasks.md`:
        - Set checkbox to `[x]`
        - Append `（skip）` annotation (or `（skip: <reason>）` if the user gave a reason)
      - **Defer** (only valid when trigger is "external signal pending"): Edit `tasks.md`:
        - Set checkbox to `[x]`
        - Insert `(deferred-to-handoff: <ISO-8601-timestamp>) (awaiting-signal: <signal-desc>)` between description and trailing markers (canonical ordering: kind marker → annotations → `@followup` / `@no-screenshot`)
        - Example after: `- [x] #2 [discuss] Confirm rollout (deferred-to-handoff: 2026-05-22T03:14:00Z) (awaiting-signal: prod deploy) @no-screenshot`
        - **AND** write a HANDOFF entry (see "HANDOFF write" subsection below). Archive flow **continues** — do NOT stop.

   6. Move to the next unchecked `[discuss]` item until all are processed.

   **HANDOFF write** (only fires when at least one item took the Defer path in this archive run):

   - Resolve target path: `$MAIN_WT_PATH/HANDOFF.md` (use `git rev-parse --path-format=absolute --git-common-dir` to find the main worktree even from a linked worktree; same idiom as `handoff` skill Step 1.5).
   - Locate `## Deferred discuss items` heading. If missing, append the heading + an empty body at the end of HANDOFF.md.
   - For each deferred item, append an entry block (preserving any pre-existing entries in deferred-at ascending order):

     ```md
     <!-- deferred-begin:<change-name>:<item-id> -->
     - **<change-name>** #<item-id> — <one-line description copied from tasks.md, stripped of kind marker and annotations>
       - Awaiting signal: <signal-desc same as awaiting-signal annotation>
       - Resume: `/spectra-archive <change-name>`
       - Deferred at: <ISO-8601-timestamp same as deferred-to-handoff annotation>
     <!-- deferred-end:<change-name>:<item-id> -->
     ```

   - The HTML markers are load-bearing — Resume mode (Step 1 path resolution) uses them for `sed`-based entry removal. Do **NOT** drop or rename them.
