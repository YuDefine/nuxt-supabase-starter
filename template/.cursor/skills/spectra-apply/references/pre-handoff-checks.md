<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-apply — Step 8a.5 / 8a.6 / 8a.7 / 8b 執行細節與理由

> 本檔是 `spectra-apply/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 8a.5 — 理由（impl 期間的 manual-review drift）

`## 人工檢查` items can drift during Step 7 implementation phases — impl-phase tasks may surface new manual-review items, edit existing ones inline, or paste internal jargon (DB column names / capability flag names / spec heading slugs) into descriptions while the impl context is fresh. Re-running the same enforcement hook that `/spectra-propose` Step 3a uses keeps jargon leakage / abstract reference / missing URL 等問題不會抵達 GUI handoff，也不會被烘進 archive history。

Defense in depth：primary catches 是 propose / ingest / archive；apply Step 8a.5 專門接的是**在 impl phase 才產生、繞過那三道的漂移**。

---

## Step 8a.6 — 理由（<consumer-a> app-status-badge-extraction 2026-05-24 實證）

The user must not be the **first** to discover trivial UX/data defects in the GUI. <consumer-a> `app-status-badge-extraction`（2026-05-24）handed 9 fabricated `(verified-ui:)` annotations + an all-「-」員工 column straight to the user because nothing between Step 8a and the GUI re-checked the change. Step 8a.6 is that re-check.

---

## Step 8a.6 — E.1 收集 / 判定、結果處理、ledger record、E.2 dispatcher 與 fallback

   **E.1 收集階段**（pi Grok-4.6 medium；收集輸出不是 gate，判定階段才是）：

   ```bash
   node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
     --brief /tmp/pi-8a6-e1-collect-<change>-prompt.md \
     --cwd <consumer-repo-root> \
     --label spectra-e1-collect-<change> \
     --model grok-xai --effort medium \
     --route routing-table --tier-basis table-row --table-row spectra-prehandoff-collect
   ```

   Prompt 基於 `~/offline/clade/vendor/snippets/pre-handoff-cross-check/main-self-analysis.template.md`，要求 pi 走全 **5 dimensions**（D1 task↔render / D2 evidence↔dom fab guard / D3 list↔fallback / D4 api contract boundary / D5 error tail），對每個 dimension 收集**客觀 evidence**（讀截圖、讀 DOM observation、讀 annotation、讀 git diff、讀 API response），輸出 JSON：`{"dimensions": [{"id":"D1","evidence":"...","raw_data":"..."}, ...]}` — 收集階段**不做** PASS/FAIL 判定。

   **E.1 判定階段**（pi GPT-5.6-sol xhigh）：

   ```bash
   node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
     --brief /tmp/pi-8a6-e1-judge-<change>-prompt.md \
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

   **Layer E.2 — pi cross-model second opinion**（clade fork addition；Phase 2）：E.1 之後 **MUST** 再派 **pi GPT-5.6-sol xhigh** 對同 5 dimension 做獨立 cross-check（E.1 收集 + 判定都是同 model 同 session，E.2 另起一個 session 獨立審——不同 session 各自推理，防止 E.1 session 內的 rationalization 傳染）：

   ```bash
   node <clade-vendor>/scripts/pi-dispatch-pre-handoff-check.ts \
     --change <change-name> --consumer-path . \
     --tasks-file openspec/changes/<change-name>/tasks.md \
     --screenshots-dir screenshots/local/<change-name>
   ```

   - Dispatcher stdout 印 JSON：`{"layer":"E.2","runtime":"codex","status":"pass"|"fail","findings":[{dimension,severity,evidence,suggested_fix}]}`。
   - **merge E.1 + E.2 findings**：兩方任一 `FAIL` → 對應 item 寫 `（issue: <dimension>: <evidence>）` annotation（去重；D2 fabrication 同樣 strip 假 `(verified-ui:)` + restore `[ ]`）。
   - **Fallback**：dispatcher 回 `status:"error"` + `fallback:"claude-subagent"`（pi 不在 / 無 parseable JSON）→ 改派一個 Claude subagent 用 `main-self-analysis.template.md` 同 5 dimension 做 cross-check（**NEVER** 憑記憶補；**NEVER** 跳過 cross-check 直接 handoff）。

---

## Step 8a.6 — rollout 狀態與 soak 評估

**Level**: Phase 2 仍為 **warning / soft-gate** — E.1 + E.2 都跑、findings 必寫成 `（issue:）`annotation 讓 user 在 review-gui 看到，但**不**hard-block workflow（user 在 GUI 拍板）。Phase 3.1 才把「zero unresolved findings」整進 `archive-gate.sh` 成 hard gate。每次 E.1/E.2 verdict 已落 `<consumer>/.spectra/pre-handoff-ledger.jsonl`（telemetry，gitignored）；Phase 3.1 升 hard gate 的 soak 評估跑 `node <clade-vendor>/scripts/pre-handoff-ledger.ts report --all-consumers`（出 fire-rate / by-dimension / E.1↔E.2 agreement）。

---

## Step 8a.7 — 理由（stale 截圖的 relay 不該是 user 的事）

Step 8a verify:ui 拍完截圖後，後續步驟（seed fix、allow-empty marker、pattern re-check fix、E.2 finding fix 等）常產生新 commit 碰到 `.vue` / seed / config 檔。這些 commit 讓先前的截圖 mtime < last UI commit → review-gui 顯示 ⚠ 截圖過時。User 必須手動告訴 Claude session 重拍 — 這個 relay 不該是 user 的事。本 step 把「重拍 stale」從 behavioral rule 升級成 mechanical gate。

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

   3. **STALE 重拍**（**`screenshot-review` Claude subagent**）：對 `stale` array 內每個 item：
      - 從 tasks.md `## 人工檢查` 找到對應 `#N` item 的 URL + ready_signal
      - 派 `screenshot-review` Claude subagent 重拍該張截圖（本 channel NEVER 派 Pi）
      - 覆蓋原檔（mtime 自然 > last UI commit）
      - 重拍完成後，對重拍的截圖跑 **Screenshot Match Analysis gate**（同 Step 8a § 4 的 pi GPT-5.6-sol xhigh 分析），確認重拍截圖匹配要求

   4. **重跑 audit 確認 0 stale**：

      ```bash
      node --experimental-strip-types ~/offline/clade/vendor/scripts/audit-screenshot-staleness.ts \
        --repo <consumer-or-worktree-path> --change <change-name> --json
      ```

      `stale` array 長度 **MUST** 為 0 才進 Step 8b。若仍有 stale → 重拍對應項（最多 2 輪）。

   5. **Commit 更新截圖**：selective `git add -f` 重拍的檔案 + `git commit`。

---

## Step 8b — review-gui deep-link 機制（cross-consumer mode / preflight guard / port fallback）

為什麼預設措辭不能是「請在 worktree root 執行」：

- **MUST 直接給 review-gui deep-link**（per `rules/core/proactive-skills.md` § Inline Review-GUI Deep-Link）：訊息 **MUST** 含 `http://127.0.0.1:5174/review/<consumer-id>:<change-name>` 完整 URL（cross-consumer mode 預設啟用，沒 `<consumer-id>:` prefix 會 fallback 到 clade mainEntry → API 404；`<consumer-id>` 從 `~/offline/clade/registry/consumers.json` 對應 entry 抓）。**NEVER** 寫「請在 worktree root 執行」或「請在 main consumer root 執行」當預設措辭——review-gui (`vendor/scripts/review-gui.ts` `listSourceRoots`) 從 clade home 跑時偵測 `vendor/scripts/review-gui.ts` + `consumers.local` 雙標記 → 進 cross-consumer mode，自動聚合所有 consumer + worktree change；consumer 端跑會被 `preflightCladeOnly` guard 擋下、退出 exit 2。**NEVER** 列 dev server URL（`http://localhost:3040/admin/...`）當替代——review-gui 內部已有 final-state screenshot + evidence。若 review 過程發現需要 fresh screenshot 或 user 想 sanity check，**MUST** 由 agent 自起 dev server（per `rules/core/proactive-skills.md` § Dev Server Auto-Spawn：scan free port 3001–3050、避開 3000、`run_in_background`、回報 URL + shellId），**NEVER** 叫 user cd worktree 跑 `pnpm dev`。`5174` 是 `vendor/scripts/review-gui.ts` `DEFAULT_PORT`，找不到時會 fallback 到 5174-5194，由 GUI startup banner 告知 user，主線不必猜。

---

## Step 8b — DEFAULT path handoff message 範本

   - **DEFAULT path**（**MUST script exit 0 才發**）：回覆前，主線 MUST 自行從 clade home 啟動 `pnpm review`，等待 review GUI URL 可連線，再給 user deep-link；**NEVER** 要 user 切到 clade home 或啟動 server。Reply with something like:
     > Implementation 完成。Step 8a 已處理 verify channels：automatic `[verify:e2e]` / `[verify:api]` items 已寫 annotation 並自動完成；含 `[verify:ui]` / `[review:ui]` 的 `<N>` 項仍待你確認。
     >
     > Review GUI 已就緒：
     > http://127.0.0.1:5174/review/<consumer-id>:<change-name>
     >
     > GUI 會自動配對 `screenshots/local/<change-name>/#<N>-*.png`、conflict-aware 寫回 tasks.md、對 `[verify:e2e]` / `[verify:api]` automatic-only items 自動勾 `[x]`、對 `[verify:ui]` / `[review:ui]` items 顯示 evidence 等你 OK / Issue / Skip。你只需完成 GUI 的 OK / Issue / Skip 決策；完成後回報，我繼續 Step 9 status。
