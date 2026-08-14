<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-apply — Step 8a verify channel 執行 recipe

> 本檔是 `spectra-apply/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 8a — Pre-verify baseline check + Baseline-exists-but-functional-gap 自接路徑 (a)(b)(c)(d)

   **Pre-verify baseline check（dispatch 前必做）**：

   1. 主線先 grep / read dev-login route：

      ```bash
      find server packages -path '*/server/routes/auth/_dev-login.get.ts' -o -path '*/server/routes/auth/__test-login.get.ts' 2>/dev/null
      ```

   2. 依 channel 補查：
      - `[verify:e2e]`：Playwright config + `e2e/fixtures/index.ts` style three-role fixture 必須存在（propose 階段 `post-propose-manual-review-check.sh` 已對「標 verify:e2e 但 repo 無 e2e infra」印 warn-only advisory；apply 此處為 hard baseline gate，defense in depth）
      - `[verify:api]`：`__test-login` 或等價 session bypass route 必須存在
      - `[verify:ui]`：`supabase/seed.sql` 或專案等價 seed file 必須存在
   3. 缺 baseline → 先判別**該 item 是否真的需要此 channel**（per TD-176）：
      - **Legitimately 需該 channel**（真 persistence journey 需 e2e / 真需 session round-trip）但 infra 缺 → **STOP**，回報 user 補齊 baseline。
      - **Mis-marked**（描述其實是 final-state 顯示 → `[verify:ui]` / API round-trip → `[verify:api]` / 使用者互動 round-trip「建立/編輯/輸入/點/存」→ `[review:ui]`）→ **MUST reclassify marker**（不是補 infra）；判別依 `manual-review.evidence.md` Kind 分類指引。
      - 兩 case 皆 **NEVER**：派 agent 撞錯、或讓 screenshot-review 補 seed。

   **Baseline-exists-but-functional-gap 自接路徑（hard rule，clade fork addition — per [[pitfall-verify-evidence-handoff-instead-of-self-collect]]）**：

   Baseline 確認存在但**功能性缺**（dev-login route 不接 fixture user UUID / 受測 endpoint 需要 role 不符 / seed identifier 對應不到 dev-login allow-list / curl 401 因 cookie missing 等），主線 / subagent **MUST** 依序嘗試以下 self-collect path，**全部失敗才**寫 `deferred` annotation：

   **(a)(b) 執行者 — 預設派背景 codex**：

   (a)(b) 兩層**預設**派背景 codex 執行，主線不 foreground 自跑：

   ```bash
   node ~/offline/clade/vendor/scripts/codex-dispatch.ts \
     --template ~/offline/clade/vendor/snippets/codex-offload/templates/self-collect-evidence.template.md \
     --var <key>=<value> ...（依 template 變數表填：change name、dev-login route 路徑、fixture UUID、port、table 等） \
     --label 8a-self-collect-<change> --effort medium
   ```

   （背景跑、stdout 單一 JSON evidence；exit 0=ok / 2=(a)(b) 皆業務 fail / 3=機械故障 / 4=quota。exit 2 → 主線依序降到 (c)(d)，**不**重派同一 brief；exit 3/4 → 機械故障，主線 fallback foreground 自跑 (a)(b) 再續 chain。）

   - **(c)(d) 既有路徑不動**：(c) 維持主線自起 dev server + agent-browser；(d) 已走 `codex-dispatch-screenshot-verify.ts`，**不**改走本 dispatcher
   - **Evidence annotation 寫回 tasks.md 維持主線**（多 session 共用 working tree 的寫入紀律）— codex 只回報 JSON evidence，**NEVER** 讓 codex 直接 Edit tasks.md
   - 主線收到 codex JSON evidence 後 **MUST 抽查至少一項**（重跑一條 curl / SELECT 比對回報值）再寫 annotation — **不信 codex 自報**

   **(a) 擴 dev-login route allow-list**（首選；最持久的治根）：

   - Read consumer 端 `server/routes/auth/_dev-login.get.ts`（或 `__test-login.get.ts`、其他等價 dev-only signin endpoint）
   - 加 fixture user UUID 進 allow-list（env var allow-list / query param verified UUID / `dev_user_id` query 接受）
   - 改完跑 `curl -i 'http://localhost:<port>/auth/_dev-login?user_id=<fixture-uuid>'` 驗證 session cookie 可 mint
   - 後續 verify channel 直接重用該 cookie → 成功則 self-collect 路徑收斂在此

   **(b) service_role direct DB query 證 data shape**（escape hatch；HTTP 路徑無法搭起時）：

   - 用 `@supabase/supabase-js` service_role client（或對應 server 端 service_role 連線）直連 DB 跑 `SELECT` 證明 endpoint 期待回傳的 data shape 正確
   - annotation 寫法 **MUST** 標明走 DB 而非 HTTP（避免後續 audit 誤判 round-trip 已完成）。此 escape hatch **維持 legacy 行內格式**——`direct-db-shape` 這個記號本身就是要讓後續 audit 一眼看到，搬進 sidecar 反而藏起來：
     ```text
     (verified-api: <ISO-8601> direct-db-shape table=<table> rows=<n> sha=<sha256-12chars>)
     ```
   - 限制：不能驗證 endpoint 的 authz / RLS / response transform 邏輯；只驗 data shape。authz / transform 必須走 (a)(c)(d) 任一

   **(c) 主線自起 dev server + agent-browser self-login**（OAuth 已設好時）：

   - scan free port（3001-3050，避開 3000）`run_in_background` 起 dev server
   - agent-browser 走 OAuth flow 自手 login（agent-browser persistent profile 已登入）
   - final-state screenshot + DOM 觀察
   - 適用：OAuth provider 在 dev 環境可達 + user 已登入過

   **(d) 派 screenshot-review codex（mode: verify）**：

   - 給 codex 完整 brief（含 dev server URL + known route + expected DOM observation + screenshot path）
   - codex 跑 final-state screenshot capture
   - 適用：純 final-state visual evidence、不涉及 mutation / multi-role / form fill

   **四層全失敗才寫 deferred** + handoff user。Annotation **MUST** 註明已嘗試 path 與失敗原因（避免 user 重複試同樣 path）：

   ```text
   （deferred: tried (a) dev-login route 不接 fixture UUID（route 限 E2E test user only）/ (b) service_role 不適用（需驗 RLS）/ (c) OAuth provider unreachable in dev / (d) screenshot-review fail with <reason>。剩需 user 親自跑）
   ```

   完整 recipe + 適用 / 不適用情境見 `vendor/snippets/verify-channels/main-self-collect-fallback-chain.md`。

---

## Step 8a — 執行流程（e2e / api / ui channels、Screenshot Match Analysis、multi-marker、exit）

   **執行流程**：

   1. **解析未勾 verify items 並依 `kinds` 分類**

      - 單一 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` 依該 channel 執行。
      - Multi-marker 依 `e2e → api → ui` 順序逐 channel 執行。
      - Deprecated `[verify:auto]` **MUST** resolution as `[verify:api+ui]`；同時記錄 deprecation warning，後續 archive-gate 也會 warn。

   2. **`[verify:e2e]` channel — 主線自己寫 Playwright spec**

      - Copy/adapt `vendor/snippets/verify-channels/e2e-spec.template.ts`。
      - Spec path **MUST** 是 `e2e/verify/<change>/<topic>.spec.ts`。
      - 跑：

        ```bash
        pnpm test:e2e:verify <change>
        ```

      - Spec pass 後，**MUST** 先確認 Playwright trace zip 真的有產出（`ls -1 test-results/**/trace.zip` 或對應 reporter output 路徑），再寫 evidence（payload 進 sidecar，stdout 印出的短 marker 原樣貼進 tasks.md 該 item 行末）：

        ```bash
        node ~/offline/clade/vendor/scripts/lib/evidence-store.ts \
          --repo . --change <change> --write --item '#<id>' --kind verified-e2e \
          --spec 'e2e/verify/<change>/<topic>.spec.ts' --trace '<trace-path>'
        # stdout: (verified-e2e: <ISO-8601>)
        ```

      - Trace zip 抓不到（playwright.config 沒開 `trace: 'on'` / per-test 沒 `test.use({ trace: 'on' })`）→ **視同 blocker**，保留 `[ ]`，寫 `（issue: trace not captured — enable trace recording in playwright.config or per-test）`；**NEVER** 省略 `--trace` 硬寫降級 evidence（CLI 會 exit 2，archive-gate 也會擋）。
      - Spec fail → 保留 `[ ]`，寫 `（issue: <spec failure summary>）` 或回報 blocker；**NEVER** 寫 `(verified-e2e:)`。

   3. **`[verify:api]` channel — 主線自己跑 HTTP round-trip**

      - Copy/adapt `vendor/snippets/verify-channels/api-roundtrip.template.sh` 或直接用 curl / ofetch 跑等價 request。
      - 通過後，主線寫 evidence（payload 進 sidecar，stdout 印出的短 marker 原樣貼進 tasks.md 該 item 行末）：

        ```bash
        node ~/offline/clade/vendor/scripts/lib/evidence-store.ts \
          --repo . --change <change> --write --item '#<id>' --kind verified-api \
          --method '<METHOD>' --url '<URL>' --status '<STATUS>' [--body '<sha256-12chars>']
        # stdout: (verified-api: <ISO-8601>)
        ```

      - Request fail / status 不符 → 保留 `[ ]`，寫 `（issue: <METHOD URL expected/actual>）` 或回報 blocker；**NEVER** 寫 `(verified-api:)`。

   4. **`[verify:ui]` channel — 派 verify mode（UI only）**

      **Model allocation**：截圖收集由 **codex GPT-5.6-sol medium** 執行；收集完成後由 **codex GPT-5.6-sol xhigh** 分析每張截圖是否匹配對應 item 要求（防止亂截圖搪塞——收集與判斷分開、同 model 不同 effort，收集便宜跑快、判斷用最高推理力）。

      **Runtime 選擇**（default Codex model via Pi；Claude subagent fallback）：

      - **Default — Codex model via Pi**：偵測 `command -v pi` 存在、Pi `openai-codex` OAuth 已就緒且 env `CLADE_FORCE_CLAUDE_SCREENSHOT` 未設 → 呼叫 `node <clade-vendor>/scripts/codex-dispatch-screenshot-verify.ts --change <name> --consumer-path . --dev-server-url <url> --items-json <items.json>`（dispatcher 內部以 **medium** effort 收集截圖）。Dispatcher 跑完 stdout 印 JSON 摘要（`{"runtime":"codex","transport":"pi","change":...,"items":[...],"audit_exit_code":N,"progress_json":"...","review_md":"..."}`），主線解析該 JSON 後進入 **Screenshot Match Analysis gate**（見下方 §）。Codex 模型任一 item `status` 不是 `PASS` 時 → 保留 `[ ]` + 寫 issue / blocker（業務結果，**NEVER** fallback Claude — 同一 brief 在 Claude 也會撞同樣業務問題）
      - **Fallback — Claude subagent**：以下任一情境**才** fallback 到 `screenshot-review` subagent（brief copy/adapt 自 `vendor/snippets/verify-channels/ui-final-state-brief.template.md`）：
        - `command -v pi` 不存在或 Pi `openai-codex` OAuth 未就緒
        - env `CLADE_FORCE_CLAUDE_SCREENSHOT=1` 強制退場（debug / 退場用）
        - Dispatcher exit 非 0 **且** stdout 沒印出可 parse 的 JSON 摘要（機械故障，例如 Pi auth 失效、subprocess crash）
      - 兩 runtime 走相同的 brief contract（change name、dev server URL、items、Scope）；Pi Codex runtime 多了 self-contained guardrails（machine dispatch 不會 auto-load `screenshot-review.md`）

      **反 bypass（hard rule — 2026-06-11 audit 實證）**：

      - **NEVER** 派 general-purpose / worktree Claude subagent 自跑 playwright / agent-browser 收 `verify:ui` evidence 來取代本步 dispatcher — 2026-06-11 audit 實證：05-29 dispatcher 修復後 147 條 `(verified-ui:)` annotation **0 次走 codex**、92 個 session 全部走此 bypass 形狀（從未進入本分支）、0 次機械故障 fallback 記錄。需要 `verify:ui` evidence 的**唯一**入口是 `node ~/offline/clade/vendor/scripts/codex-dispatch-screenshot-verify.ts`
      - **Claude fallback 僅限機械故障**（`command -v pi` 不存在 / Pi `openai-codex` OAuth 未就緒 / dispatcher exit≠0 且 stdout 無 parseable JSON；env `CLADE_FORCE_CLAUDE_SCREENSHOT=1` 為 user 明確設定的 debug 退場，不在此限），且 **MUST** 在 tasks.md 對應 item 留 `UNCERTAIN(dispatcher-error)` 痕跡 — **無此痕跡的 Claude 自拍 evidence 視為違規**（audit 以 annotation × dispatcher 記錄比對抓）

      共用規約：

      - Brief **MUST** 提供 change name、dev server URL、每個 item 的 known URL、**`ready_signal`（structured，見下）**、預期 screenshot path。
      - **主線 MUST 為每個 assertion-bearing verify:ui item 建 `ready_signal`**：從 item 描述的具體可斷言短語抽機械可判 signal（`text` / `text_all` / `text_any` / `selector` / `regex` / `min_rows`），放進 `--items-json` 的 `ready_signal` 欄。agent capture 前 poll 它命中才拍、拍後 cross-check 它仍在才算 PASS（見 `manual-review.data-readiness.md` § `[verify:ui]` ready_signal 契約 + screenshot-review Verify Mode step 2-4）。**理由**：頁面 async query 資料在 `wait_for_load()` 之後才填，無 signal 時 agent 只能盲拍 → 拍到空殼（per <consumer-b> monitoring-slot 2026-05-30 incident）。
      - **建不出 `ready_signal`**（描述只有「畫面正常」「顯示資料」等模糊語、無具體斷言點）→ **NEVER** 硬 dispatch；依 `manual-review.data-readiness.md` § signal-less 分流 reclassify（純主觀視覺 → `[review:ui]`；需互動才出現 → `[verify:e2e]` / `[verify:api]`）。既有未帶 signal 的 grandfather item → agent 走 generic-settle fallback（**不可**當 PASS 充分條件）。
      - Agent scope **MUST** 限於 open known URL + readiness gate poll（≤15s 等 ready_signal）+ final-state screenshot + post-capture cross-check + DOM observation。
      - Agent **NEVER** 做 mutation / form fill / click sequences / multi-role login switching / seed repair。
      - PASS 後，主線寫 evidence（payload 進 sidecar，stdout 印出的短 marker 原樣貼進 tasks.md 該 item 行末）：

        ```bash
        node ~/offline/clade/vendor/scripts/lib/evidence-store.ts \
          --repo . --change <change> --write --item '#<id>' --kind verified-ui \
          --screenshot 'screenshots/local/<change>/#<id>-final.png' [--dom '<obs>']
        # stdout: (verified-ui: <ISO-8601>)
        ```

      - FAIL / UNCERTAIN → 保留 `[ ]`，寫 issue 或回報 blocker；**NEVER** 寫 `(verified-ui:)`。

      **Screenshot Match Analysis gate**（截圖收集完成後 xhigh 分析）：

      Dispatcher 收集完所有截圖後（JSON 摘要已拿到），**MUST** 對每個 `status === "PASS"` 的 item 派 **codex GPT-5.6-sol xhigh** 做截圖 vs 要求匹配分析：

      ```bash
      node ~/offline/clade/vendor/scripts/codex-dispatch.ts \
        --brief /tmp/codex-screenshot-match-analysis-<change>-prompt.md \
        --cwd <consumer-repo-root> \
        --label screenshot-match-<change> \
        --model sol --effort xhigh \
        --route routing-table --tier-basis table-row --table-row screenshot-review-verify
      ```

      Prompt 內容固定包含：

      ```text
      [DELEGATED-BY-CLAUDE-CODE]

      你是截圖匹配分析器。對以下每張截圖，判斷它是否真正匹配對應的 verify:ui item 要求。

      Change: <change-name>

      Items to analyze:
      <對每個 PASS item 列出>
      - #<id>
        要求描述: <item description from tasks.md>
        ready_signal: <the ready_signal that was used>
        截圖路徑: screenshots/local/<change>/#<id>-final.png
        DOM observation: <from dispatcher JSON>

      請逐一分析每張截圖：
      1. 讀取截圖檔案
      2. 比對 item 描述的具體要求（預期看到的 UI 元素、文字、排序、badge、狀態）
      3. 比對 ready_signal 宣告的條件是否在截圖中可見
      4. 判定 MATCH / MISMATCH / UNCERTAIN

      輸出 JSON：
      {"items": [{"id": <N>, "verdict": "MATCH"|"MISMATCH"|"UNCERTAIN", "reason": "<一句話>"}]}

      判定標準：
      - MATCH: 截圖明確顯示 item 描述要求的 UI 元素 / 文字 / 狀態
      - MISMATCH: 截圖是空白頁 / 錯誤頁 / 顯示內容與要求無關 / 關鍵元素缺失
      - UNCERTAIN: 無法確定（截圖模糊 / 部分匹配）

      MISMATCH 和 UNCERTAIN 都視為需要重新處理。
      ```

      **分析結果處理**：
      - **全部 MATCH** → 對每個 item 寫 `(verified-ui:)` annotation
      - **任一 MISMATCH / UNCERTAIN** → 該 item 保留 `[ ]`，寫 `（issue: screenshot-match-analysis: <reason>）`；主線重派 codex medium 重拍該 item（最多 2 輪），重拍後再跑一次 xhigh 分析
      - **Codex xhigh 不可用 / 機械故障** → fallback 派 Sonnet 5 讀截圖檔做 visual sanity check（Sonnet 5 可讀圖、速度快），判定 MATCH 才寫 annotation

      **NEVER** 跳過 Screenshot Match Analysis 直接寫 `(verified-ui:)` annotation — 收集與判斷分離是防搪塞的核心機制。

      Brief 範例：

      ```text
      mode: verify
      Channel: verify:ui
      Change: <change-name>
      Dev server URL: http://localhost:<port>

      Items:
      - #3 [verify:ui]
        Description: /asset-loans 顯示 overdue badge + top-sort
        Known URL: http://localhost:<port>/asset-loans
        ready_signal:
          text_any: ["逾期", "overdue"]
          selector: "[data-testid=asset-loan-overdue-badge]"
          min_rows: 1
        Screenshot path: screenshots/local/<change-name>/#3-final.png

      Scope:
      - Open the known URL, wait for load, **poll ready_signal until present (≤15s)**, capture final-state screenshot, **post-capture cross-check ready_signal still present**, record DOM observation.
      - Do NOT click, fill forms, submit mutations, switch roles, repair seed, or patch network.
      ```

   5. **Multi-marker completion semantics**

      - 每個 channel 完成就寫對應 annotation；同一 line 可同時有 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)`，順序 **MUST** 是 e2e → api → ui。
      - 最後一個 channel 完成且 item 不含 `verify:ui` / `review:ui` 時，呼叫 review-gui auto-check helper `autoCheckCompletedAutomaticItems(...)`，自動 flip `[x]`。
      - item 含 `verify:ui` 或 `review:ui` 時，checkbox **MUST** 保持 `[ ]`，等 user 在 review GUI 確認。

   6. **Deprecated `[verify:auto]` alias**

      - Alias resolution：視為 `[verify:api+ui]`。
      - 主線先跑 API channel，再派 UI channel。
      - 新 tasks **NEVER** author `[verify:auto]`；若 Step 8a 碰到它，只做 backward-compatible execution 並保留 deprecation warning。

   7. **Exit**

      - 所有 automatic-only items 完成 annotations 後，呼叫 `autoCheckCompletedAutomaticItems(...)` 讓 review-gui helper 自動勾 `[x]`。
      - 所有含 `verify:ui` 的 items 保持未勾，進 Step 8b 由 user GUI 確認 visual evidence。
