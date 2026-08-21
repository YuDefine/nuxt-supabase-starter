<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-apply — Step 8a.6 / 8a.7 / 8b 執行細節

> 本檔是 `spectra-apply/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 8a.6 — E.1 收集 / 判定、結果處理、ledger record、E.2 dispatcher 與 fallback

   **E.1 收集階段**（codex Grok-4.6 medium；收集輸出不是 gate，判定階段才是）：

   ```bash
   node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
     --brief /tmp/codex-8a6-e1-collect-<change>-prompt.md \
     --cwd <consumer-repo-root> \
     --label spectra-e1-collect-<change> \
     --model grok-xai --effort medium \
     --route routing-table --tier-basis table-row --table-row spectra-prehandoff-collect
   ```

   Prompt 基於 `~/offline/clade/vendor/snippets/pre-handoff-cross-check/main-self-analysis.template.md`，要求 codex 走全 **5 dimensions**（D1 task↔render / D2 evidence↔dom fab guard / D3 list↔fallback / D4 api contract boundary / D5 error tail），對每個 dimension 收集**客觀 evidence**（讀截圖、讀 DOM observation、讀 annotation、讀 git diff、讀 API response），輸出 JSON：`{"dimensions": [{"id":"D1","evidence":"...","raw_data":"..."}, ...]}` — 收集階段**不做** PASS/FAIL 判定。

   **E.1 判定階段**（codex GPT-5.6-sol xhigh）：

   ```bash
   node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
     --brief /tmp/codex-8a6-e1-judge-<change>-prompt.md \
     --cwd <consumer-repo-root> \
     --label spectra-e1-judge-<change> \
     --model sol --effort xhigh \
     --route routing-table --tier-basis table-row --table-row spectra-prehandoff-judge
   ```

   Prompt 給上一階段收集的 5-dimension evidence JSON，要求對每個 dimension 判定 `PASS` / `FAIL` / `N/A` + 判定理由。輸出 JSON：`{"dimensions": [{"id":"D1","verdict":"PASS"|"FAIL"|"N/A","reason":"..."}, ...]}` 。

   **E.1 結果處理**（主線）：
   1. 解析判定 JSON，寫 **finding report**（每個 dimension explicit verdict + evidence）。
   2. For each `FAIL`: edit `## 人工檢查` item to append `（issue: <summary + where>）`; D2 fabrication findings additionally strip the bad `(verified-ui:)` annotation and restore `[ ]`.
   3. **No finding report written → NO Step 8b handoff.** This is the gate.
   4. **Record the E.1 verdict（telemetry-only，fail-open）**：

      ```bash
      node <clade-vendor>/scripts/pre-handoff-ledger.ts record \
        --consumer-path . --change <change-name> --layer E.1 \
        --status <pass|fail> \
        --findings-json '[{"dimension":"D2","severity":"critical"}, ...]'
      ```

      `--status fail` 當任一 dimension FAIL，否則 `pass`；`--findings-json` 列每個 FAIL 的 `{dimension, severity}`（無 FAIL 給 `[]`）。此 step append-only + fail-open，**NEVER** 因 ledger 寫入失敗而中斷 handoff。此 E.1 record 現由 `archive-gate.sh` **Check 7（Pre-handoff Verdict Presence）機械強制存在** — 缺 E.1 record → archive 被擋 exit 2（fail-open 僅限 ledger 檔尚不存在的 pre-propagation consumer）。

   **Layer E.2 — codex cross-model second opinion**（clade fork addition；Phase 2）：E.1 之後 **MUST** 再派 **codex GPT-5.6-sol xhigh** 對同 5 dimension 做獨立 cross-check（E.1 收集 + 判定都是同 model 同 session，E.2 另起一個 session 獨立審——不同 session 各自推理，防止 E.1 session 內的 rationalization 傳染）：

   ```bash
   node <clade-vendor>/scripts/pi-dispatch-pre-handoff-check.ts \
     --change <change-name> --consumer-path . \
     --tasks-file openspec/changes/<change-name>/tasks.md \
     --screenshots-dir screenshots/local/<change-name>
   ```

   - Dispatcher stdout 印 JSON：`{"layer":"E.2","runtime":"codex","status":"pass"|"fail","findings":[{dimension,severity,evidence,suggested_fix}]}`。
   - **merge E.1 + E.2 findings**：兩方任一 `FAIL` → 對應 item 寫 `（issue: <dimension>: <evidence>）` annotation（去重；D2 fabrication 同樣 strip 假 `(verified-ui:)` + restore `[ ]`）。
   - **Fallback**：dispatcher 回 `status:"error"` + `fallback:"claude-subagent"`（codex 不在 / 無 parseable JSON）→ 改派一個 Claude subagent 用 `main-self-analysis.template.md` 同 5 dimension 做 cross-check（**NEVER** 憑記憶補；**NEVER** 跳過 cross-check 直接 handoff）。

---

## Step 8a.7 — Staleness sweep 執行流程（audit → LEGACY 清理 → STALE 重拍 → 0 stale → commit）

   **執行流程**：

   1. **跑 audit**：

      ```bash
      node --experimental-strip-types ~/offline/clade/vendor/scripts/audit-screenshot-staleness.ts \
        --repo <consumer-or-worktree-path> --change <change-name> --json
      ```

      解析 JSON output 的 `stale` 和 `legacy` arrays。

   2. **LEGACY 清理**：刪掉 `legacy` array 內所有無 `#N` 前綴的舊圖（`rm` 即可；它們不配對任何 item）。

   3. **STALE 重拍**（**codex Grok-4.6 medium**）：對 `stale` array 內每個 item：
      - 從 tasks.md `## 人工檢查` 找到對應 `#N` item 的 URL + ready_signal
      - 派 codex Grok-4.6 medium 透過 `pi-dispatch-screenshot-verify.ts` 重拍該張截圖
      - 覆蓋原檔（mtime 自然 > last UI commit）
      - 重拍完成後，對重拍的截圖跑 **Screenshot Match Analysis gate**（同 Step 8a § 4 的 codex GPT-5.6-sol xhigh 分析），確認重拍截圖匹配要求

   4. **重跑 audit 確認 0 stale**：

      ```bash
      node --experimental-strip-types ~/offline/clade/vendor/scripts/audit-screenshot-staleness.ts \
        --repo <consumer-or-worktree-path> --change <change-name> --json
      ```

      `stale` array 長度 **MUST** 為 0 才進 Step 8b。若仍有 stale → 重拍對應項（最多 2 輪）。

   5. **Commit 更新截圖**：selective `git add -f` 重拍的檔案 + `git commit`。

---

## Step 8b — DEFAULT path handoff message 範本

   - **DEFAULT path**（**MUST script exit 0 才發**）：回覆前，主線 MUST 自行從 clade home 啟動 `pnpm review`，等待 review GUI URL 可連線，再給 user deep-link；**NEVER** 要 user 切到 clade home 或啟動 server。Reply with something like:
     > Implementation 完成。Step 8a 已處理 verify channels：automatic `[verify:e2e]` / `[verify:api]` items 已寫 annotation 並自動完成；含 `[verify:ui]` / `[review:ui]` 的 `<N>` 項仍待你確認。
     >
     > Review GUI 已就緒：
     > http://127.0.0.1:5174/review/<consumer-id>:<change-name>
     >
     > GUI 會自動配對 `screenshots/local/<change-name>/#<N>-*.png`、conflict-aware 寫回 tasks.md、對 `[verify:e2e]` / `[verify:api]` automatic-only items 自動勾 `[x]`、對 `[verify:ui]` / `[review:ui]` items 顯示 evidence 等你 OK / Issue / Skip。你只需完成 GUI 的 OK / Issue / Skip 決策；完成後回報，我繼續 Step 9 status。
