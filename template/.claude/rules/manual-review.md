<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# 人工檢查（Manual Review）

繁體中文 | [English](./manual-review.en.md)

> 本檔是 manual-review 核心規約（無 frontmatter，每個 session 必載入）。詳細場景規約拆到 path-scoped reference：
>
> - 寫 / 審 `openspec/changes/**/tasks.md` 與 `docs/manual-review-archive.md`：[`manual-review.evidence.md`](./manual-review.evidence.md)
> - 寫 `openspec/changes/**/proposal.md` 與 `openspec/changes/**/tasks.md`：[`manual-review.data-readiness.md`](./manual-review.data-readiness.md)
> - 動 backend (`server/`, `test/`, `e2e/`, `supabase/`)：[`manual-review.backend.md`](./manual-review.backend.md)

## 核心規則

**NEVER** 自行標記 `## 人工檢查` 區塊中**屬於 `[review:ui]` kind** 的 `- [ ]` 為 `- [x]`。

`[review:ui]` items 的 checkbox 只能在以下流程中勾選：

1. 先派遣 screenshot review 流程截圖
2. 向使用者展示每個檢查項的實際畫面或證據
3. 使用者回覆 OK → 標記該項 `[x]`
4. 使用者回覆有問題 → 不標記，記錄問題
5. 使用者回覆 skip → 標記 `[x]` 並加註 `（skip）`
6. 使用者回覆 skip all → 全部標記 `[x]` 並註記

**`[discuss]` items 例外**：spectra-archive Step 2.5「Discuss Items Walkthrough」流程中，主線 Claude 主動準備 evidence、向使用者展示後取得明確 OK，可由 Claude 勾選 `[x]` 並插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation 作為 evidence trail。詳見 `manual-review.evidence.md` 的「Item Kind Marker」與「標準流程」章節。

**`[verify:e2e]` / `[verify:api]` automatic channel 例外**：spectra-apply Step 8a 寫入對應 `(verified-e2e: ...)` / `(verified-api: ...)` annotation 後，review-gui auto-check helper 可自動勾 `[x]`；這些 channel 不需要使用者在 GUI 再確認。`[verify:ui]` 仍需使用者在 GUI 確認 visual evidence。

## 人工檢查與靜態 QA 的差別

| 類型 | 目的 | 能否直接勾選人工檢查 |
| --- | --- | --- |
| screenshot review / 靜態截圖 QA | 確認畫面、文案、佈局、狀態 | **不能直接代勾** |
| 使用者確認 | 確認功能與結果符合期待 | **可以** |

截圖是證據，不是使用者確認本身。

## Screenshot Review ≠ Functional Verification（Hard Rule）

Screenshot review **只覆蓋視覺層**，**不**覆蓋功能 round-trip。下列工作 screenshot review **不能**算驗收完成：

| 類型 | Screenshot 能驗 | Screenshot 不能驗 |
| --- | --- | --- |
| 按鈕 / 控件**存在** | ✅ | — |
| Layout / 字級 / 色彩 / a11y attribute | ✅ | — |
| Empty / Loading / Error state 的**視覺呈現** | ✅ | — |
| **Form submit 真的送到 server** | — | ❌ 必須使用者實作 |
| **Server 真的回 200 + DB 真的變更** | — | ❌ 必須使用者實作 |
| **Dialog 提交後 list refetch + 顯示新狀態** | — | ❌ 必須使用者實作 |
| **Edge case payload（null / 空 / 邊界）** | — | ❌ 必須使用者實作 |
| **權限拒絕 path** | — | ❌ 必須使用者實作 |

### 真實案例（為什麼這條 rule 存在）

> 2026-05-08，`loan-conflict-prompt-and-manual-return` change 的 phase 7 screenshot review 報告 Fidelity 8/8、0 DRIFT、0 Critical，包含「Manual return dialog 結構正確」「Submit loading state OK」。Phase 6 quality gates 全綠（焦點 test 23 個）。
>
> 使用者人工檢查 #39 實際送出 dialog → 立刻收到 400 ZodError：「`return_notes`: expected string, received null」。Schema 用 `.optional()` 而非 `.nullish()`，client 送 `null`，phase 2 codex 寫的 test 沒含 `null` boundary case。
>
> Screenshot review 全綠 + test 全綠 + design fidelity 8/8 都沒擋住這個 bug — 因為**沒有任何環節真實送出 form**。

### 規約

- **MUST** 把 functional round-trip（form submit / mutation / API call → response → state update）列為**使用者人工檢查項目**，不依賴 screenshot review
- **MUST** 在 tasks.md 的 `## 人工檢查` 區塊明寫「送出 → 確認 server response → 確認 DB / list refetch」流程，不要只寫「看到按鈕」
- **MUST** 對不需要截圖、只能由使用者親自操作驗收的 round-trip-only item，加上可選的 `@no-screenshot` marker；使用者完成 round-trip 後可在 `pnpm review:ui` 直接勾 OK。Marked item 的 viewer **MUST** 顯示 round-trip-only UI，且 **MUST NOT** 顯示「複製 handoff prompt」。完整 marker schema 見 `manual-review.evidence.md` 的「`@no-screenshot` Marker（hard rule）」段；截圖策略配套見 `screenshot-strategy.md` 的「round-trip-only manual-review item」。
- **NEVER** 把 screenshot review 「按鈕存在 + dialog 結構正確」當成 round-trip 已驗證
- **NEVER** 在使用者尚未真實互動驗收前 archive UI change

## Item Kind Marker（hard rule）

每條 `## 人工檢查` checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接一個 leading kind marker。合法 marker：

- `[review:ui]` — 需要使用者親自確認的 UI / UX 驗收。例：收 email / 收 webhook / 實體裝置 / 視覺主觀美感 / 真機跨機器。**MUST** 由使用者完成，agent 禁止代勾。
- `[discuss]` — Claude 主導的 evidence-based 討論項目。例：production 授權、商業判斷、production 觀察、後端 evidence 查驗。spectra-archive Step 2.5 walkthrough 流程下，Claude 主動準備證據與使用者討論、取得 OK 後可代勾並寫入 `(claude-discussed: <ISO-8601-timestamp>)` annotation。
- `[verify:e2e]` — Playwright spec-based automated round-trip。主線在 `e2e/verify/<change>/<topic>.spec.ts` 寫 spec、跑 `pnpm test:e2e:verify <change>`，通過後寫 `(verified-e2e: <ISO> spec=<path> trace=<path>)` annotation。
- `[verify:api]` — 純 HTTP round-trip（curl / ofetch / fetch）。主線跑 request，通過後寫 `(verified-api: <ISO> <METHOD> <URL> <STATUS>[ body=<hash>])` annotation。
- `[verify:ui]` — final-state screenshot + DOM observation。主線派 screenshot-review agent `mode: verify` 只開已知 URL、等待載入、截 final-state screenshot、記錄 DOM 觀察，回來後寫 `(verified-ui: <ISO> screenshot=<path>[ dom=<obs>])` annotation；使用者仍需在 review GUI 點 OK 才勾 `[x]`。
- `[verify:<a>+<b>]` / `[verify:<a>+<b>+<c>]` — multi-marker，僅允許組合 `e2e` / `api` / `ui` verify channels，例如 `[verify:api+ui]` 或 `[verify:e2e+ui]`。
- `[verify:auto]` — **DEPRECATED alias**，僅為既有 consumer tasks.md 相容保留；解析時視為 synthetic `[verify:api+ui]` 並 emit deprecation warning。新項目 **NEVER** 使用 `[verify:auto]`。

### Canonical line format

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [@followup[TD-NNN]] [@no-screenshot]
```

- Marker **MUST** 是 `#N` / `#N.M` 後第一個 token，與 id 之間僅一個空白。
- Marker 出現在 description 中間（例：`Click the [discuss] button`）視為 plain text，**MUST NOT** 被解析成 marker。
- `[review:ui]` / `[discuss]` 不得與 verify multi-marker 混用。`[verify:api+review:ui]`、`[verify:api+discuss]` 都是非法 marker。
- Verify multi-marker 的 channel canonical order 是 `e2e → api → ui`；annotation 寫回也 **MUST** 依此順序。

### Default Kind Derivation Rule（fallback）

當 item 行無 leading marker（典型情境：legacy in-flight change），parser 依 `proposal.md` 推導 default kind：

- proposal 含 `**No user-facing journey (backend-only)**` → default kind = `discuss`
- 其餘 → default kind = `review:ui`

**Fallback 不涵蓋任何 `verify:*`** — verify channels 代表 apply 階段會收集自動 evidence，不能由 proposal default silent derive。新寫 verify items **MUST** 顯式標 marker。

**Fallback ≠ 允許省略**：所有**新寫**或**ingest 修改**的 `## 人工檢查` items **MUST** 顯式標 marker。Default 只給既有 in-flight change 過渡用。spectra-propose / spectra-ingest 的 Manual Review Marker Hygiene Check 會擋下未標 marker 的新內容。

### 與 `@no-screenshot` / `@followup[TD-NNN]` 共存 ordering

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [@followup[TD-NNN]] [@no-screenshot]
```

`[<kind>]` 永遠在最前（緊接 `#N`），`@no-screenshot` 永遠在最後；`@followup[TD-NNN]` 若存在須夾在 description 與 `@no-screenshot` 之間。寫回 annotation（`（issue: ...）` / `（skip）` / `（note: ...）` / `(claude-discussed: <ISO>)` / `(verified-e2e: ...)` / `(verified-api: ...)` / `(verified-ui: ...)`）**MUST** 插在 description 後、所有 trailing markers (`@followup` / `@no-screenshot`) 前。

詳細 Kind 分類指引、反面範例、收斂原則、可解析格式 schema、`@no-screenshot` / `@no-manual-review-check` marker schema 與標準流程見 reference 檔（路徑見頂部 pointer）。

## 禁止事項

- **NEVER** 問「要不要我直接幫你勾完」
- **NEVER** 在未展示證據的情況下代勾任何 item（含 `[discuss]` items — Step 2.5 walkthrough 的 evidence 展示是強制前提）
- **NEVER** 對 `[review:ui]` items 在使用者尚未親自 round-trip 的情況下代勾，即使 Claude 已分析過程式碼
- **NEVER** 對 `[verify:e2e]` / `[verify:api]` items 在 annotation 寫入後仍要求 user 在 GUI 確認 — automatic channel 完成後由 `autoCheckCompletedAutomaticItems(...)` 自動 done
- **NEVER** 對 `[verify:ui]` items 在使用者尚未於 review GUI 確認 visual evidence 前代勾 `[x]`
- **NEVER** 新增 `[verify:auto]` marker 給新 item — 使用 explicit `[verify:e2e]` / `[verify:api]` / `[verify:ui]` 或 multi-marker
- **NEVER** 在 `verify:ui` agent dispatch 時讓 agent 同時負責 mutation / form fill / multi-role login — 那些屬 `verify:api` / `verify:e2e` channel
- **NEVER** 對任何 `verify:*` channel 在 evidence 沒成功產出時寫 `(verified-<channel>:)` annotation
- **NEVER** 把 screenshot review 當成等同於人工功能驗證
- **NEVER** 為了通過 gate 而批次勾選未確認的項目
- **NEVER** 對 `[discuss]` items 寫入 `(claude-discussed: ...)` annotation 而沒有實際與使用者討論並取得 OK
- **NEVER** dispatch verify channels 前不檢查 per-channel baseline — 撞 baseline 缺後升 UNCERTAIN 是浪費 budget；主線預先 grep / read 確認，缺則停下回報 user 補齊
- **NEVER** 在 verify dispatch 當下才問 user「dev-login / seed 準備好了嗎」— baseline 是 codebase 層長期狀態，不該每次派工都驚動 user
