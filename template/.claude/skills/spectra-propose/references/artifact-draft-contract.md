<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-propose/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Artifact Draft Contract

> 本檔是 propose / ingest dispatch 共用的規約彙編。draft runtime（Pi / Fable / Claude）和主線 cross-check
> 都只需讀這一份，不需再分別讀 `ux-completeness.md` / `manual-review.md` / `agent-routing.md` 全文。
>
> 每個 § 標注適用場景（propose / ingest / both）。dispatch prompt 的 context pack 列出本次適用的 § 清單，
> draft runtime 只讀命中的 §。cross-check 同理。

---

## §1 Plan-first（propose only）

在動任何 Edit / Write / Bash 寫入動作之前，先在 stdout 最開頭輸出一段 `## Plan` section，包含：

- **要動的具體檔案**（每條一行的相對路徑，例如 `openspec/changes/<change-name>/proposal.md`、`design.md`、`tasks.md`、`specs/<capability>/spec.md`）
- **每個檔案打算寫什麼**（一句話 — 例如 proposal.md 的章節列表、design.md 的決策骨架、tasks.md 預期 phase 數量與分層、specs 的 ADDED/MODIFIED/REMOVED 走向）
- **預期 phase 切分**（特別是 UI view phase vs 非 view phase 的邊界，呼應 §2 Phase Purity）

Plan 寫完後**立刻**繼續執行，**不要**停下來等確認。Plan 是事前公開思路給主線 cross-check，不是 review gate。

---

## §2 Phase Purity — UI view vs 非 view 必須切成獨立 phase（propose only）

若 change 同時涉及 UI view 層（`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss`）與**非 view 工作**（schema / migration / API server / store / hook / API client / type / util / 純 backend），tasks.md **必須**把這兩類切成不同的 `## N.` phase：

- 例：`## 1. Database Schema` + `## 2. API Endpoints` + `## 3. Pinia Store + Composables` + `## 4. UI View Implementation` + `## 5. Fixtures / Seed Plan` + `## 6. Design Review`
- **禁止**把 view 層改動（`.vue` / `app/pages/` 等）與非 view 工作混進同一 phase
- 理由：spectra-apply 的 UI view phase 由主線 Opus 自己做（實作與 Design Review 都不外派）、其他 phase 派 Pi sol；混雜 phase 會破壞 dispatch 規則
- frontend 但非 view 的（store / hook / API client / type / util / unit test）算非 view，可以與 backend 工作放同 phase 或自己一個 phase 都可

---

## §3 Manual Review Item Kind Marker（propose + ingest）

`## 人工檢查` 區塊每條 checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接 leading kind marker。

合法 marker：`[review:ui]` / `[discuss]` / `[verify:e2e]` / `[verify:api]` / `[verify:ui]`，或 verify multi-marker `[verify:<a>+<b>]` / `[verify:<a>+<b>+<c>]`（channels 僅限 `e2e` / `api` / `ui`）。

**NEVER** author new `[verify:auto]` markers。若 draft 產生 `[verify:auto]`，主線 cross-check 必須 inline 替換成 explicit marker：pure API → `[verify:api]`；mutation + visual → `[verify:api+ui]`；persistence / full journey → `[verify:e2e]`。

### Rule 1：每條 item line MUST 有 leading marker

- 缺 marker → 依 Rule 2 / 3 / 4 的內容分類補上正確 marker
- **禁止**仰賴 Default Kind Derivation Rule（fallback 只給既有 in-flight legacy item 用）
- Multi-marker **MUST NOT** 與 `[review:ui]` / `[discuss]` 混用

### Rule 2：Evidence-collection items MUST 標 `[discuss]` 或 `[verify:api]`

若 item description 含 evidence-collection 動詞 / 模式：

- SSH / psql / `\d` / `SELECT` / 受控 drift / migration existence / 商業判斷 → `[discuss]`
- `curl` / HTTP endpoint round-trip 若可重現 → `[verify:api]`
- 誤標 `[review:ui]` / `[verify:ui]` / deprecated `[verify:auto]` → 改為 `[discuss]` 或 `[verify:api]`

### Rule 3：Real user round-trip items 依 channel 分流

- persistence / reload / full journey → `[verify:e2e]`
- HTTP status / backend contract → `[verify:api]`
- final-state visual only → `[verify:ui]`
- mutation response + visual state → `[verify:api+ui]`
- journey + extra screenshot evidence → `[verify:e2e+ui]`
- 真的需要人（Rule 4 白名單） → `[review:ui]`

### Rule 4：「真的需要人」白名單 — 落單者改 explicit verify channel

`[review:ui]` 只給「agent 用 agent-browser 也跑不了」的項目。description 含下列任一關鍵字才 `[review:ui]`：

- 收 email / 收 webhook（agent inbox 不可達）
- 「視覺主觀」/「美感」/「a11y 主觀判斷」
- 「實體裝置」/「真機」/「手機」/「平板」/「kiosk QR」/「印表機」/「條碼槍」
- 「跨機器」/「跨 session」/ 生產環境授權後操作
- 「電話」/「SMS」等規格外的非 UI 環境

其餘真實使用者 round-trip → explicit `verify:*` per Rule 3。

### Rule 5：`[review:ui]` step actionability — 流程式描述要拆

對標 `[review:ui]` 的 line，命中下列任一條件 → 非 actionable，**MUST** 改寫：

- **流程式串接**：parent line 含 ≥ 2 個串接動詞但**未拆 `#N.M` sub-items**
- **缺具體 URL**：item 描述未出現任何 `/xxx` 路徑或具體頁面 anchor
- **實體裝置動詞但缺替代輸入線索**
- **模糊驗收動詞**：「正常」「正確」「能用」等無 falsifiable observation

改寫時拆 `#N.M` scoped sub-items：每條一個原子動作（開 URL → 輸入 Y / 點 Z → 確認具體觀察 W）。
從 `docs/FIXTURES.md`（或 seed file）抓 stable sample identifier。

### Rule 6：需要身分 / 特定 URL 才看得到的 item MUST 落盤結構化 entry

使用 `scripts/manual-entry.ts --repo <repo> --change <change> --item '#N' --url '<URL>' --login-as <role>`。
`--url` 填**要驗收的那一頁**，**NEVER** 填 dev-login URL。

完整規約見 `.claude/rules/manual-review.md`。

---

## §4 Backend-only Manual Review 規約（propose + ingest）

適用 `## User Journeys` 為 `**No user-facing journey (backend-only)**` 的 change。

tasks.md 的 `## 人工檢查` **只**允許 `[discuss]` 類代表性 use cases（production 授權 / 商業判斷 / production 觀察）和 `[verify:api]` round-trip。

SSH / psql / `\d` / `SELECT` / 受控 drift 製造 / migration 存在性驗證等 evidence-collection 項目 **MUST** 從 `## 人工檢查` 搬到 `## N. Backend Verification Evidence` section（位於最後功能區塊之後、`## 人工檢查` 之前）由 apply Claude 自跑自貼。

若移完後 `## 人工檢查` 為空 → 替換成固定文字：`_本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 ## N. Backend Verification Evidence）；deploy 前無使用者人工檢查項目。_`

---

## §5 Fixtures / Seed Plan + Scoped Sub-items（propose only）

若 change 包含 UI scope 且 proposal 有 `## Affected Entity Matrix`（entity 動且有 UI 展示），tasks.md **必須**包含 `## N. Fixtures / Seed Plan` section（每個有 Surfaces 的 entity 一條 task，或 `**Existing seed sufficient**` 宣告 + 一行理由）。

凡 `## 人工檢查` items 涉及以下情境時，**MUST** 拆 `#N.M` scoped sub-items 並 inline 具體 sample identifier：

- NFC / 刷卡 / 員工卡 / 員工 UID / 卡片 UID
- staff login / user role / 多角色 authz
- 業務 entity 操作（具體 work_report id / equipment id / loan id / business key）
- 多步驟流程（流程含「→」「然後」「接著」「完成後」等過渡詞 ≥ 2 個串接）
- 實體裝置（kiosk / 平板 / 真機 / 印表機 / 條碼槍）

**MUST** 從 `docs/FIXTURES.md`（或 `supabase/seed.sql` / 對應 seed file）抓 stable sample identifier。

寫完 tasks.md 後 MUST 自查：
```bash
grep -nE '(刷卡|某張|某筆|任一|挑一筆|隨便|→.*→)' openspec/changes/<change-name>/tasks.md
```
若有 hit 在 `## 人工檢查` 區塊 → 改寫成 scoped sub-items + inline sample。

---

## §6 Language / Locale compliance（propose + ingest）

開工前先跑：
```bash
grep -lE "繁體|繁中|不要使用簡體" CLAUDE.md .claude/rules/*.md 2>/dev/null
```

- **若 grep 命中**（consumer 規定繁體中文）：**全部** artifact（proposal.md / design.md / tasks.md / spec.md）**MUST** 用繁體中文撰寫，**禁止**英文 artifact。
  - 保留：SQL / code / shell command（` ``` ` block 內）、code 識別字、檔案路徑、技術名詞、inline code（單 backtick 內）
  - OpenSpec / Spectra 制式英文標題（`## Why` / `## What Changes` / `## Non-Goals` / `## Affected Entity Matrix` 等）**保留不譯**，body 內容才翻
- **若無命中**：跳過此 step
- **Exception**：spec files (`specs/*/spec.md`) **MUST** always be written in English regardless of locale（normative language SHA​LL/MUST）

---

## §7 Design Review 7 步 template（propose, UI scope only）

若 change 包含 UI scope（tasks 涉及 .vue / pages/ / components/ / layouts/），tasks.md **必須**包含完整 7 步 Design Review section：

```markdown
## N. Design Review

- [ ] N.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document
- [ ] N.2 執行 /design improve [affected pages/components]，產出 Design Fidelity Report
- [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0，max 2 輪）
- [ ] N.4 依 /design improve 計劃按 canonical order 執行 targeted impeccable skills（layout / typeset / clarify / harden / colorize 等實際所需項目）
- [ ] N.5 執行 /impeccable audit，確認 Critical = 0
- [ ] N.6 執行 review-screenshot，補 design-review.md / 視覺 QA 證據
- [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項
```

`[affected pages/components]` 替換為此 change 實際涉及的 UI 檔案/頁面。
位置：tasks.md 最後一個功能區塊之後、`## 人工檢查` 之前。N = 上一個功能區塊的序號 + 1。

---

## §8 Preservation — 保留 [x] / [P]（ingest only）

When updating an existing change：
- Merge new context into existing proposal (don't replace)
- Add new tasks from plan stages or conversation, **preserve completed `[x]` items**
- **Preserve existing `[P]` markers** on tasks that still qualify
- Do NOT remove existing content

**Parallel task markers (`[P]`)**: When updating the **tasks** artifact, first read `.spectra.yaml`. If `parallel_tasks: true` is set, add `[P]` markers to new tasks that can be executed in parallel. Format: `- [ ] [P] Task description`. A task qualifies for `[P]` if it targets different files from other pending tasks AND has no dependency on incomplete tasks in the same group. When `parallel_tasks` is not enabled, do NOT add `[P]` markers — but still preserve any existing `[P]` markers already in the file.

---

## §9 Completion Standard（propose + ingest）

### Analyze-Fix Loop（max 2 iterations）

```bash
spectra analyze <name> --json
```

1. Filter findings to **Critical and Warning only**（ignore Suggestion）
2. If no Critical/Warning findings → "Artifacts look consistent ✓" and proceed
3. If Critical/Warning findings exist：fix each finding, re-run, repeat up to 2 total iterations
4. After 2 attempts, if findings remain → show remaining findings as summary, proceed normally（do NOT block）

### Validation

```bash
spectra validate "<name>"
```

If validation fails, fix errors and re-validate.

### Propose completion

`spectra validate <change-name>` 通過。**NEVER 執行 `spectra park`** — change 維持 active，artifacts 留在 disk。不要呼叫 /spectra-apply。

### Ingest completion

`spectra validate` 通過 + commit artifacts：
```bash
git commit --only -m "📝 docs(spectra): ingest <change-name>" -- openspec/changes/<change-name>/
```

---

## §10 Durable Handoff Review（ingest only）

Updated change has to survive being parked or handed to another agent. Reject and fix any of the following on **incomplete** design and task content（do not rewrite completed `[x]` tasks）：

- **File-path-only tasks**: pending task whose entire description is "edit file X" with no behavior, contract, or verification target
- **Line-number-coupled instructions**: design or task content that points to "line 42" as the only way to identify the work
- **Vague acceptance criteria**: "works correctly", "behaves as expected", "handles edge cases" without naming observable behavior
- **Missing scope boundaries on non-trivial work**: design lacking "in scope" / "out of scope" lines for changes touching more than one subsystem

Fix every failure inline before running the CLI analyzer.

---

## Context Pack 格式

主線在 dispatch 前產一份 context pack 到 `/tmp/`，draft runtime 和 cross-check 共用：

```markdown
# Context Pack: <change-name>

## Change
- name: <change-name>
- type: feature | bugfix | refactor
- locale: <from spectra instructions, e.g. zh-TW>
- ui_scope: true | false
- backend_only: true | false

## Requirement
<requirement 全文>

## Applicable Contract Sections
§1, §2, §3, §5, §6, §7, §9  (根據 flags 動態列出)

## Existing Artifacts (ingest only)
- openspec/changes/<name>/proposal.md (有 / 無)
- openspec/changes/<name>/design.md
- openspec/changes/<name>/tasks.md
- openspec/changes/<name>/specs/**
```

### 適用 § 自動推導

| Flag | 額外適用 § |
|------|-----------|
| propose | §1, §2, §5, §7 (if ui_scope) |
| ingest | §8, §10 |
| always | §3, §6, §9 |
| backend_only | §4 |
