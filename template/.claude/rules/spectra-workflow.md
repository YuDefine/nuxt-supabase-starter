---
paths: ['openspec/changes/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/spectra-workflow.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Spectra Workflow — Cross-Phase Ownership（治理 doc）

> Phase 3.3 of the pre-handoff quality gates（master plan
> `spectra-pre-handoff-quality-gates-master-plan.md`）. 本檔顯式宣告 spectra
> workflow 每個 phase / checkpoint **負責抓什麼**，消除「每層都覺得不是我」的
> ownership gap — 那是 <consumer-a> `app-status-badge-extraction`（2026-05-24）整列「-」
> UX defect 穿過 propose / apply / design review / verify / manual review **每一層**
> 的根本設計缺口。

## 核心原則：「對 user 可見的 functional data display」有明確 owner chain

事故根因不是某一層的 bug，是**沒有任何一層認領「員工欄不可整列空」這件事** — propose
管 sample key 寫入、apply 管 code、design review 管視覺、verify:ui 管 DOM observation、
manual review 管 user 親驗，每層都覺得「functional data 對不對不是我管」。

修法：functional data display 的正確性現在有一條**顯式 owner chain**，每一棒都有
mechanical 或 model-driven 的 checkpoint：

```
propose  ──→  apply(UI view)  ──→  apply(design review)  ──→  apply(pre-handoff)  ──→  archive
Layer A       Layer B               Layer C                   Layer E.1 + E.2          Layer C re-run
「key 會     「render 後沒          「資料形狀健全嗎          「5 維度跨檢            「archive 前
 render 嗎」   整列 fallback 嗎」      (param vs schema)」        (主線 + codex)」          再驗一次」
        ╰────────────── Layer D（UI-INVARIANTS）是上面 B/C/E 共同引用的宣告式契約 ──────────────╯
```

## Responsibility Matrix

| Phase / checkpoint | **負責抓**（owns） | **不負責**（defers to） | 機制 / Layer |
| --- | --- | --- | --- |
| **Propose**（`/spectra-propose`） | manual-review item data-readiness：sample key inline + **該 key 是否真的會在 target UI render**（reverse page-grep） | runtime 正確性、視覺 | **Layer A** `VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK` + `page-display-check.mjs` |
| **Apply — impl phases** | code 正確性、contract 遵循、typecheck/lint/unit | UI render 結果、視覺、跨檔資料形狀 | typecheck / lint / tests |
| **Apply — Class B UI view phase**（Step 6c） | refactor invariant：admin list/table **無 column 整欄塌縮成 fallback** + page load 0 個 4xx/5xx | static 資料形狀、主觀視覺 | **Layer B** `refactor-invariant-check.mjs` |
| **Apply — Design Review**（Step 7） | 資料形狀 sanity：client query param literal vs server zod bound + lookup-map empty risk | runtime render（B 管）、視覺 | **Layer C** `audit-data-sanity.mjs`（`/data-sanity`） |
| **Apply — Step 8a verify:ui** | DOM observation evidence：screenshot 真的支撐 `dom=` 宣稱（誠實，不 fab） | 跨維度 batch 檢查（E 管） | verify channel；fab 由 E.2 D2 batch 擋（write-time guard = 未來 3.2） |
| **Apply — Step 8a.6 pre-handoff** | 5 維度跨檢（task↔render / evidence↔dom fab / list↔fallback / api boundary / error tail），主線 + codex 跨模型 | — | **Layer E.1**（主線 self-analysis）+ **E.2**（codex cross-check） |
| **Archive**（`/spectra-archive` gate-check） | archive 前再跑 Layer C data-sanity + archive-gate Check 1–5 | — | `archive-gate.sh` + **Layer C** re-run |
| **Manual review**（review-gui） | user 對**主觀視覺 / UX / 真人判斷**做最終驗收 | mechanical defect（應在上游被抓，user 不該當 last-line defense for trivial defect） | review-gui |
| **UI-INVARIANTS**（Layer D） | 宣告式 baseline：list/table 不可整欄 fallback、lookup 解析率 100%、0 個 4xx/5xx、row count 匹配 seed、critical action 有確認框 | （不執行偵測，被 B/C/E 引用） | **Layer D** `ui-invariants.template.md` + `ui-invariants-resolve.mjs` |

## 事故失效鏈 case study（<consumer-a> `app-status-badge-extraction`）

`attendance/amendments.vue:32` 的 `useEmployeeListQuery({ perPage: 200 })` 違反 server
schema `max(100)` → API 400 → `employeeNameMap` empty → 員工 column 整列「-」。

| 失效層 | 當時為何沒抓到 | 現在哪一層 / 怎麼抓 |
| --- | --- | --- |
| 8 個月前 commit `770bfed2` | 寫死 `perPage: 200`，無 review / 無 schema cross-check | **Layer C** static 偵測 client literal vs server `max(100)` boundary |
| Propose | 要求 inline sample key，但沒檢查 key 會不會 render | **Layer A** reverse page-grep：員工欄是 `employeeNameMap` lookup、非 `employee_no` column → 提示 reclassify |
| Apply Phase 2（UBadge → AppStatusBadge refactor） | 完成判定只看「component 換好 + typecheck pass」，沒驗 page 仍正常 render | **Layer B** Step 6c：偵測員工 column 整列「-」→ block phase complete |
| Phase 3 Design Review（screenshot subagent） | Emptiness Preflight 偵測「空頁面」，amendments 不是空頁 → 不命中；整列「-」被 rationalize 成「sample-bearing 延後到人工」 | **Layer C** Design Review 期間跑 + **Layer E** D3「list↔fallback」維度 |
| `/impeccable audit` | design audit dimension 全是 typography / a11y / color，data display correctness 是 invisible dimension | **Layer C** `/data-sanity`（功能性資料形狀，非視覺） |
| Step 8a verify:ui | 主線從 task description synth `dom=EMP-007-approved` annotation，無 grep-against-screenshot 校驗 | **Layer E** D2 fab guard：codex 讀 screenshot 比對 `dom=`，screenshot 不支撐 → block + `（issue:）` |
| Manual review handoff | review-gui 直接把 9 個帶 fab annotation 推給 user，無 pre-handoff cross-check | **Layer E.1 + E.2** Step 8a.6：handoff 前主線 + codex 雙閘 5 維度 |

## 各 phase SKILL 的 ownership 宣告

`spectra-propose` / `spectra-apply` / `spectra-archive` SKILL.md 開頭各有一段 clade-fork
ownership cross-ref（「我負責 X / 不負責 Y / cross-ref Layer Z」），指回本 matrix。改 phase
行為時 **MUST** 同步更新本 matrix 對應列，避免 doc 與實作 drift。

## 與其他 rule 的關係

- 本檔是 cross-phase **治理 / 索引**層；各 Layer 的硬規約仍在自己的 rule / skill：
  manual-review.*（item kind / data-readiness）、code-style、ux-completeness 等。
- Layer A–E 的實作位置見 master plan `docs/spectra-pre-handoff-quality-gates-master-plan.md`
  § Solution overview。
- clade 自身**不使用 spectra**（走 plan mode），本檔 path-scope `openspec/changes/**`，
  只在 consumer 跑 spectra change 時載入。
