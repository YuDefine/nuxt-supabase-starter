---
audience: both
applies-to: post-scaffold
---

# Tech Debt Register

追蹤 `@followup[TD-NNN]` marker 對應的未解決項目。所有在 `openspec/changes/**/tasks.md` 裡出現的 marker 都必須在此有對應 entry，否則 `spectra-archive` 會被 `pre-archive-followup-gate.sh` 攔截。

規則詳見 `.claude/rules/follow-up-register.md`。

---

## Index

| ID     | Title                                                 | Priority | Status | Discovered                       | Owner   |
| ------ | ----------------------------------------------------- | -------- | ------ | -------------------------------- | ------- |
| TD-001 | upgrade-design-review.mts 會吃掉 Design Review 證據行 | mid      | done   | 2026-05-05 — codex review xhigh  | clade   |
| TD-002 | post-propose-check.sh DESIGN_SECTION grep 跨步誤判    | mid      | done   | 2026-05-05 — codex review xhigh  | clade   |
| TD-003 | spectra-ux .mts no-await-in-loop lint warnings        | low      | done   | 2026-05-05 — pnpm check 0-C      | clade   |
| TD-004 | scaffold-smoke path filter 沒命中 deploy commit       | mid      | done   | 2026-05-05 — v0.30.1+ CI runs    | starter |
| TD-005 | propagate auto-commit 沒觸發 Template CI              | high     | done   | 2026-05-05 — clade-fix-3 watcher | clade   |
| TD-006 | hub:vendor 不在 propagate 自動流程內                  | high     | done   | 2026-05-05 — clade-fix-3 watcher | clade   |
| TD-007 | Template E2E v0.30.4 cancelled 原因不明               | low      | done   | 2026-05-05 — v0.30.4 CI          | starter |

---

## TD-001 — upgrade-design-review.mts 會吃掉 Design Review 證據行

**Status**: done
**Priority**: mid
**Discovered**: 2026-05-05 — codex review xhigh（starter v0.3.33 投影 review）
**Resolution**: 2026-05-06 — clade v0.3.39 / starter cd403a0
**Location**: clade `vendor/scripts/spectra-ux/upgrade-design-review.mts:207-216`（投影到 consumer `scripts/spectra-ux/upgrade-design-review.mts`）
**Related markers**: 此 bug 在 clade 端，consumer 投影層繼承

### Problem

當既有 `## N. Design Review` section 含有 checkbox 以外的證據或備註行（例如 screenshot link、使用者確認紀錄、子項目）時，`upgradeSection` 只用解析到的 checkbox 重新合成 section，後續會把整段舊 section 覆蓋掉。跑新的 fixer 會靜默刪掉這些 review 證據。

### Fix approach

修改 `upgradeSection` 邏輯，保留 checkbox 之外的所有行（screenshot link、註記、子項目），只改寫 checkbox task line。或限制只在 section 為「純 checkbox」時才 upgrade。

### Acceptance

- 對含證據行的舊 Design Review section 跑 upgrade，證據行原樣保留
- Unit test 覆蓋此 case

### Resolution notes

- clade `a1279e1`: `upgradeSection` 改用新 `parseSection` 把 oldSectionLines 切成 (checkbox + evidence) segments，重組時把 evidence 黏回對應 canonical step 後面
- 加 clade `test/upgrade-design-review.test.mjs` 3 個 test cases（single-line screenshot evidence、multi-line evidence with blank + indented list、partial section + evidence preserved through canonical renumbering）
- 投影到 starter 的 `template/scripts/spectra-ux/upgrade-design-review.mts` via propagate v0.3.39 (commit cd403a0)

---

## TD-002 — post-propose-check.sh DESIGN_SECTION grep 跨步誤判

**Status**: done
**Priority**: mid
**Discovered**: 2026-05-05 — codex review xhigh（starter v0.3.33 投影 review）
**Resolution**: 2026-05-06 — clade v0.3.39 / starter cd403a0
**Location**: clade `vendor/scripts/spectra-ux/post-propose-check.sh:246-252`（投影到 consumer `scripts/spectra-ux/post-propose-check.sh`）
**Related markers**: 此 bug 在 clade 端

### Problem

`post-propose-check.sh` 用整個 `DESIGN_SECTION` 做 grep 來判斷 7 個步驟是否各自存在。問題：

- N.3 grep `DRIFT` 會 match 到 N.7 的「無 DRIFT」 → N.3 缺失誤判為存在
- 同理 N.3 的「DRIFT = 0」也可能讓 N.7 過關
- 結果：section 有 7 個 checkbox 但實際漏掉某些步驟時，post-propose 與 archive gate 都可能放行

### Fix approach

改成匹配每個編號 task line（grep `^- \[[x ]\] N\.{step}`），對該行內容做 keyword 比對，避免跨步污染。

### Acceptance

- Section 有 7 checkbox 但 N.3 缺實際 DRIFT 修復、N.7 缺 Fidelity 確認 → check 應該擋下
- Unit test 覆蓋這些 false-positive scenarios

### Resolution notes

- clade `a1279e1`: 用 `[[ "$line" =~ ^-\ \[[\ x]\]\ [0-9]+\.([0-9]+)\ (.+)$ ]]` 把每個 N.k task line parse 進 `DR_STEP_TEXT` indexed array，per-step grep 只看自己那一行
- 加 clade `test/post-propose-check.test.mjs` 2 個 cases（cross-step false-negative 修法後正確擋下、all-7-canonical 不誤報）
- 投影到 starter via propagate v0.3.39

---

## TD-003 — spectra-ux .mts no-await-in-loop lint warnings

**Status**: done
**Priority**: low
**Discovered**: 2026-05-05 — `pnpm check` 0-C（starter v0.3.33 投影 review）
**Resolution**: 2026-05-06 — clade v0.3.39 / starter cd403a0
**Location**: clade `vendor/scripts/spectra-ux/{collect-followups,upgrade-design-review}.mts`（投影到 consumer `scripts/spectra-ux/*.mts`）
**Related markers**: 此 bug 在 clade 端，consumer 投影層繼承

### Problem

`vp lint` 對 starter 投影層的 vendor scripts/spectra-ux/\*.mts 回報 4 個 `no-await-in-loop`（實際清查比 register 標題的 12 少；登記時是估計值）：

- `collect-followups.mts:67` `walkTaskFiles` 遞迴 `await`
- `collect-followups.mts:213` `scanMarkers` 序列 `await`
- `upgrade-design-review.mts:112` `findActiveTasksFiles` 內 `stat in loop`
- `upgrade-design-review.mts:346` `main` 內 `processFile` 序列 `await`

全是純 IO，可並行。

### Fix approach

逐個檔評估：

- 純 IO（read file 等）→ 改 `Promise.all`
- 需要 ordering（例如 stash / git commit 序列）→ 加 `// eslint-disable-next-line no-await-in-loop` 帶 reason 註解
- 不可改的、保留 await 的，eslint 註記說明理由

### Acceptance

- `vp lint` 對 vendor/scripts/spectra-ux/\*.mts 0 warnings
- 必要時的 eslint-disable 都帶 reason 註解
- 散播到 consumer 後 consumer 端也 0 warnings

### Resolution notes

- clade `a1279e1`: 4 處全部改 `Promise.all` (純 IO 並行) — `walkTaskFiles` 遞迴用 `Promise.all(entries.map(...)).flat()`、`scanMarkers` 用 `Promise.all(taskFiles.map(scanMarkers))` 後 flat、`findActiveTasksFiles` 用 `Promise.all(candidates.map(probe))`、`processFile` loop 用 `Promise.all` + 內嵌 try/catch 保留 per-file error 行為
- 沒用到 eslint-disable — 4 處都能純並行
- 投影到 starter 後 Template CI lint step 0 warnings (run 25405654828 success 驗證)

---

<!--
Entry template — 複製下列區塊到 Index 之下，依 TD-NNN 順序新增。

## TD-NNN — {一行標題}

**Status**: open | in-progress | done | wontfix
**Priority**: critical | high | mid | low
**Discovered**: YYYY-MM-DD — {change name / 人工檢查 #N / ADR / ...}
**Location**: {file path(s) with optional line ranges}
**Related markers**: search `@followup[TD-NNN]` in repo

### Problem

{為什麼這是個問題？使用者 / 開發者 / 系統會看到什麼}

### Fix approach

{建議修法；可列多個選項比較}

### Acceptance

{解完後怎麼驗收；可指向 spec 檔、測試、metric}

-->

## TD-004 — scaffold-smoke path filter 沒命中 deploy commit

**Status**: done
**Priority**: mid
**Discovered**: 2026-05-05 — starter v0.30.1 / v0.30.2 / v0.30.3 / v0.30.4 CI runs
**Resolution**: 2026-05-06 — starter 6fb7bbd + 1ff3461 + (smoke-scaffold scan_placeholders fix)
**Location**: starter `.github/workflows/scaffold-smoke.yml`（trigger paths 設定）+ `scripts/smoke-scaffold.sh:scan_placeholders`
**Related markers**: starter-ci-watcher v0.30.1+ 多次發現

### Problem

scaffold-smoke workflow 的 trigger paths 沒命中 deploy commit（v0.30.1+ 多次只動 `package.json` 的 `🚀 deploy: 發布新版本 vX.Y.Z` push 都沒跑 scaffold-smoke）。導致：

- v0.30.0 跑 scaffold-smoke（fail，verify-starter glob 議題）
- v0.30.1 / v0.30.2 / v0.30.3 / v0.30.4 都沒跑 scaffold-smoke（path filter 沒命中）

verify-starter glob 修法（v0.30.1）實際上沒被 CI 驗證過。

### Fix approach

修 `.github/workflows/scaffold-smoke.yml` trigger 條件：

- 加 `package.json` 到 paths（version bump 也觸發）
- 或改成 `on: push` 不限 paths（每次 main push 都跑）
- 或加 `workflow_dispatch` + 手動觸發

### Acceptance

- 任何 main push 都觸發 scaffold-smoke
- v0.30.1 verify-starter glob 修法實地驗證

### Resolution notes

- starter `6fb7bbd`: scaffold-smoke.yml 的 push paths 加 `package.json` / `docs/QUICK_START.md` / `docs/CLAUDE_CODE_GUIDE.md` / `docs/CLI_SCAFFOLD.md` / `.github/workflows/scaffold-smoke.yml` — 確保 deploy commit 的 version bump 也觸發 CI
- starter `1ff3461`: 順手把 verify-starter.mjs 自身的 ripgrep glob `!**/verify-starter.mjs` 改成 `!verify-starter.mjs`（self-check 路徑也 robust）
- starter (smoke-scaffold scan_placeholders fix): 才是真正修 scaffold-smoke fail 的地方 — `scripts/smoke-scaffold.sh:scan_placeholders` 的 rg / grep 加 `!verify-starter.mjs` 排除 verify-starter.mjs 自身 source 內的 sentinel 字串
- 不採「`on: push` 無 paths」— 怕對 docs-only / non-template commit 浪費 CI 配額

---

## TD-005 — propagate auto-commit 沒觸發 Template CI

**Status**: done
**Priority**: high
**Discovered**: 2026-05-05 — clade-fix-3 watcher 發現
**Resolution**: 2026-05-06 — starter 6fb7bbd
**Location**: starter `.github/workflows/template-ci.yml` trigger paths
**Related markers**: clade v0.3.37 propagate 自動 commit (e62dafc) 沒觸發 starter Template CI

### Problem

propagate.mjs 對 clean consumer 自動 commit `🧹 chore: 升級 clade 至 vX` 後 push 到 origin/main，但因 commit 只動 `template/.claude/hub.json` + `template/.claude/.hub-state.json`，starter Template CI 的 trigger paths 不含 `.claude/`，導致 propagate 自動 push 不觸發 CI 驗證。

意味著 propagate 帶來的投影層更新從未經 CI 驗證，只有 deploy commit 觸發 CI 時才會驗證投影層內容。

### Fix approach

兩個方向：

1. **starter 側**：CI workflow 加 `template/.claude/**` 到 trigger paths
2. **clade 側**：propagate auto-commit 後額外觸發空 commit / `workflow_dispatch` 強制跑 CI

### Acceptance

- propagate 自動 push 後 Template CI 跑一次驗證
- 投影層偷渡 bug 立即被抓到

### Resolution notes

- 走 starter 側修法（不走 clade workflow_dispatch — 後者要跨 repo GH token 太重）
- starter `6fb7bbd`: template-ci.yml 加 `'template/.claude/hub.json'` + `'template/scripts/**'` 到 pull_request.paths 與 push.paths
- 只 watch `hub.json` 不 watch 整個 `template/.claude/**` — 避免 `.hub-state.json` 噪音 / rules 散播時無端跑 CI
- `template/scripts/**` 同步加上去因為 propagate 加 sync-vendor 後 vendor scripts 變更也應該被 CI 驗證（與 TD-006 修法配套）
- 驗證：clade v0.3.39 propagate auto-commit `cd403a0` 觸發 Template CI run 25405654828 全綠 ✓

---

## TD-006 — hub:vendor 不在 propagate 自動流程內

**Status**: done
**Priority**: high
**Discovered**: 2026-05-05 — clade-fix-3 watcher 發現
**Resolution**: 2026-05-06 — clade v0.3.39
**Location**: clade `scripts/propagate.mjs:runConsumerSync`
**Related markers**: starter v0.3.37 投影層 hub.json bumped 但 vendor scripts (roadmap-sync.mts) 沒升

### Problem

`propagate.mjs` 對 consumer 散播時，只跑 `sync-rules.mjs`（rules + skills + commands）+ plugin update + bump hub.json，**不跑 `sync-vendor.mjs`**。consumer 端 `scripts/spectra-ux/*` 與 `scripts/audit-ux-drift.mts` 等 vendor scripts 不會自動更新到最新 clade 版本。

意味著：

- propagate 升 hub.json 到 vX.Y.Z
- 但 vendor scripts 還是舊版
- 必須手動跑 `pnpm hub:vendor --force` 才會升

starter v0.3.37 propagate 後 hub.json 是 v0.3.37 但 roadmap-sync.mts 還是 v0.3.36，導致 v0.30.3 CI 仍紅燈。直到主線手動跑 `pnpm hub:vendor --force` 才修好（v0.30.4）。

### Fix approach

1. `propagate.mjs` 加 `sync-vendor` step（在 sync-rules 之後、commit 之前）
2. 或文件強調每次 propagate 後 consumer 必跑 `pnpm hub:vendor --force`
3. 或 consumer 加 pre-commit hook 偵測 vendor drift

### Acceptance

- propagate 後 vendor scripts 自動同步
- 不需要手動 hub:vendor

### Resolution notes

- 走方法 1（最徹底）
- clade `8098feb`: `runConsumerSync` 在 sync-rules 之後、sync-to-agents 之前加 `sync-vendor.mjs --force` 呼叫
- `--force` 必須 — propagate 把 consumer 投影層當 strict mirror，consumer 不該 customize vendor，要客製就 fork / wrap
- 驗證：v0.3.39 propagate auto-commit `cd403a0` 同時帶了 `template/.claude/hub.json` + `template/.claude/.hub-state.json` + `template/scripts/spectra-ux/*` 共 5 檔 — 修法前只會有前 2 檔

---

## TD-007 — Template E2E v0.30.4 cancelled 原因不明

**Status**: done
**Priority**: low
**Discovered**: 2026-05-05 — v0.30.4 (76f67fa) Template E2E run
**Resolution**: 2026-05-06 — starter 9d68955 + 2b37ca7
**Location**: starter `template/playwright.config.ts` (`use.nuxt.dev`)、`template/nuxt.config.ts` (`typescript.typeCheck`)
**Related markers**: run 25403838318

### Problem

v0.30.4 是第一次 Template CI success，Template E2E 真的跑了（前面 v0.30.0~0.30.3 都 skipped），但 conclusion 是 `cancelled` 而非 success/failure。log 顯示 `The operation was canceled` + supabase setup-cli@v1 Node 20 deprecation 警告。

### Triage findings (2026-05-06)

- 不是 timeout：job 跑 11 分 21 秒就被 cancel，timeout 設 15 分鐘
- 不是 supabase/setup-cli@v1：deprecation warning 是次要訊息，不會 cancel
- 真實 root cause：Vite dev mode 反覆 fail 載入 `@vite-plugin-checker-runtime`，4 輪 build cycle 後 cancel
  - `playwright.config.ts:23 use.nuxt.dev: true` 用 `@nuxt/test-utils` dev mode 跑 E2E
  - dev mode 在 ubuntu CI 環境有 vite-plugin-checker runtime 解析問題
  - 本機沒裝 vite-plugin-checker (`pnpm list` 沒顯示)，可能是 vp / Nuxt devtools 內建 dev-only plugin

### Fix approach

可能修法（依優先序）：

1. **`use.nuxt.dev: !process.env.CI`** — CI 走 production build E2E，避開 vite-plugin-checker runtime 死鎖；本地保 dev mode 快速 iter
2. 或 explicit disable Nuxt devtools / vite-plugin-checker in CI 環境
3. 升級 `supabase/setup-cli@v1 → @v2`（順手清 Node 20 deprecation，不是 cancel 主因）
4. 加 step-level timeout-minutes 讓 cancel 更早、log 更乾淨

### Acceptance

- 下次 Template CI success 後 E2E 真的跑完，conclusion 是 success 或 failure（不是 cancelled）

### Resolution notes

**兩階段 fix**（v0.3.39 propagate 觸發的 run 25405691049 / 25405846276 仍 cancel → 確認需主動修法）：

1. starter `9d68955`：`nuxt.config.ts` 改 `typescript.typeCheck: !process.env.CI`
   - 修掉 `Failed to resolve "/_nuxt/@vite-plugin-checker-runtime"` error（typeCheck:true 在 dev mode 注入 vite-plugin-checker，CI ubuntu 環境 plugin runtime 解析失敗）
   - 但下一輪 E2E run 25407272134 變成 timeout cancel：dev mode 為每個 spec 重啟 Nuxt，23 tests 累積超過 timeout-minutes:15
2. starter `2b37ca7`：`playwright.config.ts` 改 `use.nuxt.dev: !process.env.CI`
   - CI 走 production build E2E（workflow 前 step `Build Nuxt` 已 nuxt build），不再為每 spec 重啟 dev server
   - E2E run 25408209957 跑 10 分鐘（vs 之前 cancel 在 11~16 分鐘），conclusion = failure（非 cancel）→ acceptance 達成

實際 test failure 本身是另外的 bug（assertion / supabase setup / fixture），與 TD-007 無關。TD-007 的核心是「E2E 跑得完才能看到真實 fail / pass」，現在 cancel 噪音清掉了，後續 test failure 才能正常 surface 並修。

兩個修法保留：`typeCheck:!CI` 不嚴格必要（dev:false 之後 vite-plugin-checker 已不會被載入），但 typecheck 已在 Template CI typecheck step 獨立跑、CI dev-time HMR 反饋無意義，保留更乾淨。
