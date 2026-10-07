## wt 回報：herdr usage 補旗標、batch.md 觸發門檻對齊、Pi 派工延遲調查

### Routing

Routing: A (herdr-usage-table-row) → non-ui-implementation / claude-sonnet-5-5 / high / in-process subagent
Routing: B (batch-doc-threshold) → dotclaude-authoring / claude-opus-5-5 / medium / Herdr child
Routing: C (pi-dispatch-latency) → read-heavy-scan / gemini / high / Pi dispatcher

### 任務狀態

✅ A (herdr-usage-table-row) [sonnet-implementer]: committed — 2 files, 1 commit，branch `session/2026-10-03-1420-herdr-usage-table-row`
   usage 字串補上 `[--table-row <row>]`，新增 1 條 usage 斷言，vp check 與 vendor typecheck 綠燈
   下一步：已 batch ready，等批次觸發

✅ C (pi-dispatch-latency) [pi:analyze]: findings — 6 findings，已寫入 WORKTREE-BRIEF.md # Findings，branch `session/2026-10-03-1425-pi-dispatch-latency`
   延遲集中在 quota gate 的同步 ssh 探測，6 筆 location 皆以 `sed -n` 複驗命中
   下一步：交主線以 implementation-decision 判修法，樹保留到開修補任務

⏸️ B (batch-doc-threshold) [herdr:cc2]: blocked — 0 files，branch `session/2026-10-03-1422-batch-doc-threshold`
   worker 回報 `--complete blocked`：commit skill `batch.md` 寫 `pr-merge-based` 1 件即觸發，`vendor/snippets/wt-helper/README.md` 工具表寫 4 件，需要裁決以哪份為準
   下一步：保留來源，裁決後以同一 brief 重派到同一棵樹

### 保留中的 worktree

- `<clade-central-repo>-wt/pi-dispatch-latency`（`session/2026-10-03-1425-pi-dispatch-latency`）：調查證據待主線判修法
- `<clade-central-repo>-wt/batch-doc-threshold`（`session/2026-10-03-1422-batch-doc-threshold`）：worker blocked，等觸發門檻的裁決

### 就緒池

Ready 1 / Blocked 0（`batch status --trigger auto --workflow pr-merge-based`）：已觸發，已呼叫 /commit
