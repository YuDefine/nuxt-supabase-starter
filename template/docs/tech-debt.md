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
| TD-001 | upgrade-design-review.mts 會吃掉 Design Review 證據行 | mid      | open   | 2026-05-05 — codex review xhigh  | clade   |
| TD-002 | post-propose-check.sh DESIGN_SECTION grep 跨步誤判    | mid      | open   | 2026-05-05 — codex review xhigh  | clade   |
| TD-003 | spectra-ux .mts 12 個 no-await-in-loop lint warnings  | low      | open   | 2026-05-05 — pnpm check 0-C      | clade   |
| TD-004 | scaffold-smoke path filter 沒命中 deploy commit       | mid      | open   | 2026-05-05 — v0.30.1+ CI runs    | starter |
| TD-005 | propagate auto-commit 沒觸發 Template CI              | high     | open   | 2026-05-05 — clade-fix-3 watcher | clade   |
| TD-006 | hub:vendor 不在 propagate 自動流程內                  | high     | open   | 2026-05-05 — clade-fix-3 watcher | clade   |
| TD-007 | Template E2E v0.30.4 cancelled 原因不明               | low      | open   | 2026-05-05 — v0.30.4 CI          | starter |

---

## TD-001 — upgrade-design-review.mts 會吃掉 Design Review 證據行

**Status**: open
**Priority**: mid
**Discovered**: 2026-05-05 — codex review xhigh（starter v0.3.33 投影 review）
**Location**: clade `vendor/scripts/spectra-ux/upgrade-design-review.mts:207-216`（投影到 consumer `scripts/spectra-ux/upgrade-design-review.mts`）
**Related markers**: 此 bug 在 clade 端，consumer 投影層繼承

### Problem

當既有 `## N. Design Review` section 含有 checkbox 以外的證據或備註行（例如 screenshot link、使用者確認紀錄、子項目）時，`upgradeSection` 只用解析到的 checkbox 重新合成 section，後續會把整段舊 section 覆蓋掉。跑新的 fixer 會靜默刪掉這些 review 證據。

### Fix approach

修改 `upgradeSection` 邏輯，保留 checkbox 之外的所有行（screenshot link、註記、子項目），只改寫 checkbox task line。或限制只在 section 為「純 checkbox」時才 upgrade。

### Acceptance

- 對含證據行的舊 Design Review section 跑 upgrade，證據行原樣保留
- Unit test 覆蓋此 case

---

## TD-002 — post-propose-check.sh DESIGN_SECTION grep 跨步誤判

**Status**: open
**Priority**: mid
**Discovered**: 2026-05-05 — codex review xhigh（starter v0.3.33 投影 review）
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

---

## TD-003 — spectra-ux .mts 12 個 no-await-in-loop lint warnings

**Status**: open
**Priority**: low
**Discovered**: 2026-05-05 — `pnpm check` 0-C（starter v0.3.33 投影 review）
**Location**: clade `vendor/scripts/spectra-ux/{collect-followups,roadmap-sync,claim-work,release-work,claims-lib}.mts` 等（投影到 consumer `scripts/spectra-ux/*.mts`）
**Related markers**: 此 bug 在 clade 端，consumer 投影層繼承

### Problem

`pnpm check`（vp check / oxlint）對 spectra-ux 的 .mts 檔回報 12 個 `no-await-in-loop` warnings，多數出在：

- `collect-followups.mts:67` `walkTaskFiles` 遞迴內 `await`
- `collect-followups.mts:213` `scanMarkers` 序列 `await`
- 其他 .mts 內 forEach / for...of 內序列 `await`

這些是序列 await pattern，效能上可改 `Promise.all` 並行（除非邏輯需要序列 side effect）。

### Fix approach

逐個檔評估：

- 純 IO（read file 等）→ 改 `Promise.all`
- 需要 ordering（例如 stash / git commit 序列）→ 加 `// eslint-disable-next-line no-await-in-loop` 帶 reason 註解
- 不可改的、保留 await 的，eslint 註記說明理由

### Acceptance

- `vp check` 對 vendor/scripts/spectra-ux/\*.mts 0 warnings
- 必要時的 eslint-disable 都帶 reason 註解
- 散播到 consumer 後 consumer 端 0-C 也 0 warnings

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

**Status**: open
**Priority**: mid
**Discovered**: 2026-05-05 — starter v0.30.1 / v0.30.2 / v0.30.3 / v0.30.4 CI runs
**Location**: starter `.github/workflows/scaffold-smoke.yml`（trigger paths 設定）
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

---

## TD-005 — propagate auto-commit 沒觸發 Template CI

**Status**: open
**Priority**: high
**Discovered**: 2026-05-05 — clade-fix-3 watcher 發現
**Location**: clade `scripts/propagate.mjs` auto-commit + starter `.github/workflows/template-ci.yml` trigger paths
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

---

## TD-006 — hub:vendor 不在 propagate 自動流程內

**Status**: open
**Priority**: high
**Discovered**: 2026-05-05 — clade-fix-3 watcher 發現
**Location**: clade `scripts/propagate.mjs` 與 `scripts/sync-vendor.mjs` 整合
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

---

## TD-007 — Template E2E v0.30.4 cancelled 原因不明

**Status**: open
**Priority**: low
**Discovered**: 2026-05-05 — v0.30.4 (76f67fa) Template E2E run
**Location**: starter `.github/workflows/template-e2e.yml` 與 GitHub Actions runner
**Related markers**: run 25403838318

### Problem

v0.30.4 是第一次 Template CI success，Template E2E 真的跑了（前面 v0.30.0~0.30.3 都 skipped），但 conclusion 是 `cancelled` 而非 success/failure。log 顯示 `The operation was canceled` + supabase setup-cli@v1 Node 20 deprecation 警告。

不確定是：

- E2E job timeout
- supabase setup-cli 失敗導致 cancel
- GitHub Actions runner 異常
- 別的 step 觸發 cancel

### Fix approach

1. 看 `gh run view 25403838318 --log` 詳細 log 找 cancel 觸發點
2. 升級 supabase setup-cli 版本（@v1 → @v2 if 有）
3. 加 timeout-minutes 控制

### Acceptance

- 下次 Template CI success 後 E2E 真的跑完，conclusion 是 success 或 failure（不是 cancelled）
