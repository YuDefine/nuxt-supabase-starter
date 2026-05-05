---
audience: both
applies-to: post-scaffold
---

# Tech Debt Register

追蹤 `@followup[TD-NNN]` marker 對應的未解決項目。所有在 `openspec/changes/**/tasks.md` 裡出現的 marker 都必須在此有對應 entry，否則 `spectra-archive` 會被 `pre-archive-followup-gate.sh` 攔截。

規則詳見 `.claude/rules/follow-up-register.md`。

---

## Index

| ID     | Title                                                 | Priority | Status | Discovered                      | Owner |
| ------ | ----------------------------------------------------- | -------- | ------ | ------------------------------- | ----- |
| TD-001 | upgrade-design-review.mts 會吃掉 Design Review 證據行 | mid      | open   | 2026-05-05 — codex review xhigh | clade |
| TD-002 | post-propose-check.sh DESIGN_SECTION grep 跨步誤判    | mid      | open   | 2026-05-05 — codex review xhigh | clade |
| TD-003 | spectra-ux .mts 12 個 no-await-in-loop lint warnings  | low      | open   | 2026-05-05 — pnpm check 0-C     | clade |

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
