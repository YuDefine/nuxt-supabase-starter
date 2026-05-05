---
audience: both
applies-to: post-scaffold
---

# Tech Debt Register

追蹤 `@followup[TD-NNN]` marker 對應的未解決項目。所有在 `openspec/changes/**/tasks.md` 裡出現的 marker 都必須在此有對應 entry，否則 `spectra-archive` 會被 `pre-archive-followup-gate.sh` 攔截。

規則詳見 `.claude/rules/follow-up-register.md`。

---

## Index

| ID  | Title | Priority | Status | Discovered | Owner |
| --- | ----- | -------- | ------ | ---------- | ----- |

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
