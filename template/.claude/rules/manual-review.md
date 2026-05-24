<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# 人工檢查（Manual Review）

繁體中文 | [English](./manual-review.en.md)

> **本檔是 always-load 主檔**，只列核心 invariant、Item Kind Marker 一覽、claude-analyzed annotation、@evidence-via-marker、Parent State Derivation、Post-Edit Gate、禁止事項。  
> 詳細規約依場景 path-scoped 載入：
>
> | Sub-file | Path-scoped 觸發 | 內容 |
> | --- | --- | --- |
> | [[manual-review.backend]] | `server/**`、`test/**`、`e2e/**`、`supabase/**` | Backend-only change 規約 + 標準流程 verify channels + review:ui flow |
> | [[manual-review.data-readiness]] | `openspec/changes/**/proposal.md`、`tasks.md` | Pre-Review Data Readiness + step actionability + `@no-manual-review-check` marker + 截圖檔名配對 |
> | [[manual-review.evidence]] | `openspec/changes/**/tasks.md`、`docs/manual-review-archive.md` | 給 propose/spec 寫作者 + Kind 分類指引 + 反例 + `@no-screenshot` marker |
> | [[manual-review.discuss]] | `openspec/changes/**/tasks.md`、`plugins/hub-core/skills/spectra-archive/**`、`HANDOFF.md` | `[discuss]` flow + Defer-to-HANDOFF + Resume mode + HANDOFF.md schema + 混合 kind change |

## 核心規則

**NEVER** 自行標記 `## 人工檢查` 區塊中**屬於 `[review:ui]` kind** 的 `- [ ]` 為 `- [x]`。

`[review:ui]` items 的 checkbox 只能在以下流程中勾選：

1. 先派遣 screenshot review 流程截圖
2. 向使用者展示每個檢查項的實際畫面或證據
3. 使用者回覆 OK → 標記該項 `[x]`
4. 使用者回覆有問題 → 不標記，記錄問題
5. 使用者回覆 skip → 標記 `[x]` 並加註 `（skip）`
6. 使用者回覆 skip all → 全部標記 `[x]` 並註記

**`[discuss]` items 例外**：spectra-archive Step 2.5「Discuss Items Walkthrough」流程中，主線 Claude 主動準備 evidence、向使用者展示後取得明確 OK，可由 Claude 勾選 `[x]` 並插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation 作為 evidence trail。詳見下方「Item Kind Marker」與「標準流程」章節。

**`[verify:e2e]` / `[verify:api]` automatic channel 例外**：spectra-apply Step 8a 寫入對應 `(verified-e2e: ...)` / `(verified-api: ...)` annotation 後，review-gui auto-check helper 可自動勾 `[x]`；這些 channel 不需要使用者在 GUI 再確認。`[verify:ui]` 仍需使用者在 GUI 確認 visual evidence。

**`(claude-analyzed: route=E)` annotation 不勾 checkbox**：當 review-gui 「🤖 等 Claude 接手」群「接手分析」prompt 路由結論為 **(E) false positive / 等 user 重新評估** 時，Claude 可在帶 `（issue:）` 的 item 同行寫入 `(claude-analyzed: <ISO> route=E[ note=<...>])` annotation，但 **NEVER** 翻 checkbox。語意：「Claude 已對此 issue 分析、路由結論=ball in user's court」。User 在 GUI 對該 item 點 OK / Issue / Skip 時 stripAnnotations 自動清掉 `（issue:）` 與 `(claude-analyzed:)` 兩條 annotation。詳見下方「Item Kind Marker」章節的 `(claude-analyzed: ...)` annotation 段。

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

### 為什麼這條 rule 存在 + 規約 + 寫作者指南

完整真實案例（2026-05-08 loan-conflict-prompt screenshot review 全綠 → 撞 ZodError）、`## 人工檢查` 區寫作的「動詞 → 結果」格式、給 propose / spec 寫作者的詳細指引：詳見 [[manual-review.evidence]] § 給 propose / spec 寫作者 + [[manual-review.backend]] § Screenshot Review ≠ Functional Verification。

核心 invariant（**MUST** 都做）：

- `## 人工檢查` 項目用「動詞 → 結果」format
- functional round-trip（form submit / mutation / API call → response → state update）**MUST** 列為使用者人工檢查項目，**NEVER** 把 screenshot review 「按鈕存在」當成 round-trip 已驗證
- **NEVER** 在使用者尚未真實互動驗收前 archive UI change

### Pre-Review Data Readiness（hard rule，摘要）

每條 `[review:ui]` / `[verify:ui]` item **MUST**：

1. **Sample inline 引用** — item 描述直寫具體 sample identifier（PK / UUID / business key），**禁止**模糊指代（「某張」「某筆」「任一張」「任一筆」「pick one」）
2. **多步驟驗收條列 Step** — 含分支 / 互斥狀態 / 對稱驗證時 **MUST** 拆 `#N.M` scoped sub-items
3. **Sample 持久化寫進 seed** — 對應 sample **MUST** 由 propose 階段對應的 Fixtures / Seed Plan task 寫進專案 seed 檔（`supabase/seed.sql` 或等價）

完整禁止指代詞清單、必填三件事細節、互斥 / 對稱驗收範例、適用範圍、規則 rationale：詳見 [[manual-review.data-readiness]] § Pre-Review Data Readiness。

### `[review:ui]` 純功能驗證 step actionability（hard rule，摘要）

每條 `[review:ui]` item **MUST**：

- **明確 URL**（不要只寫頁面暱稱，寫出完整 route / URL）
- **逐步動作 sub-items**（`#N.M` scoped，每條一個原子動作）
- **預期觀察具體化**（具體 toast 文字 / badge 狀態 / route 變化，**禁止**「畫面正常」「狀態正確」）
- **實體裝置 / 規格外輸入 MUST 提供 dev 替代輸入路徑**（dev card UID input box、QR paste、條碼槍手 type、desktop responsive emulation、dev inbound webhook stub）

完整通則、範例、規則 rationale、baseline 缺漏處理：詳見 [[manual-review.data-readiness]] § `[review:ui]` 純功能驗證 step actionability。

### Backend-only change 的特別規約

當 `proposal.md` 宣告 `**No user-facing journey (backend-only)**` 時，`## 人工檢查` 區塊適用更嚴的規約 — 只允許三類項目（production 授權 / 商業判斷 / production 觀察）。其餘 SSH / psql / curl / schema 驗證 evidence collection **MUST** 寫進 `## N. Backend Verification Evidence` section 由 apply 階段 Claude 自跑自貼。

完整三類定義、模板、例外宣告固定文字、反面範例：詳見 [[manual-review.backend]] § Backend-only change 的特別規約 + [[ux-completeness]] § 必填 Backend-only Manual Review 規約。

## 可解析格式（hard rule）

`tasks.md` 的 `## 人工檢查` 區塊必須使用可被工具穩定解析的 `#N` schema。

Parent item 格式：

```markdown
- [ ] #1 確認主要流程可完成
- [x] #2 確認錯誤狀態可理解（skip）
```

Scoped sub-item 格式必須剛好縮排兩個空白，並使用 `#N.M`：

```markdown
- [ ] #3 確認行動版流程
  - [ ] #3.1 390px viewport 無水平溢出
  - [x] #3.2 keyboard focus state 清楚
```

禁止在 `## 人工檢查` checkbox line 使用 legacy section ids，例如 `8.1`、`9.3`，也禁止省略 `#N` / `#N.M`。這個 schema 只讓 tooling 能定位與寫回項目，不改變人工檢查 ownership：agent 仍然 **NEVER** 在未取得使用者明確 OK、Issue handling、skip 或 skip all 前自行勾選 `[review:ui]` items；`[discuss]` items 的勾選規則見下方「Item Kind Marker」章節。

### Parent State Derivation（hard rule）

Parent item `#N` 若有 scoped sub-items（`#N.M`），parent state **MUST** 由所有 children AND derive，不接受 user 或 agent 直接對 parent line 給 feedback：

- 所有 children `[x]` 且無 `（issue: ...）` annotation → parent line `[x]`
- 任一 child `[ ]`、或帶 `（issue: ...）` → parent line `[ ]`（rollup 後若 child 改 issue 也要 un-rollup 回 `[ ]`）

#### 真相層責任分工

| 真相層 | 責任 |
| --- | --- |
| Review GUI (`applyReviewActionToContent`) | 每次寫回 child line 後 **MUST** 重 derive parent state 並寫回 parent line（auto-rollup / un-rollup） |
| commit Step 0-MR awk gate | **MUST** leaf-only count — parent-with-scoped-children 不計 pending |
| `spectra-advanced/archive-gate.sh` | **MUST** leaf-only count（已正確 — semantic fully aggregated from scoped children） |
| 未來新加的 tooling | **MUST** 沿用 leaf-only count；禁止 naive `grep '- \[ \]'` 或同義 awk 計 pending |

#### 禁止項

- User 透過 GUI 對 parent line 直接 OK / Issue / Skip — GUI **MUST** 隱藏 parent 的 feedback 控制（既有行為：「母項不需要回饋，請對下方子項分別作回饋」）
- Agent 自行 Edit tasks.md 把 parent flip `[x]` — 違反本段 + 「NEVER 代勾 review:ui」核心規則。Parent state 由 children 透過 GUI 自動 rollup，**不**經 agent 操作
- 任何 gate / tooling 用 naive `grep '- \[ \]'` 或同義邏輯計 pending — **MUST** 排除 parent-with-scoped-children

## Item Kind Marker（hard rule）

每條 `## 人工檢查` checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接一個 leading kind marker。合法 marker：

- `[review:ui]` — 需要使用者親自確認的 UI / UX 驗收。例：收 email / 收 webhook / 實體裝置 / 視覺主觀美感 / 真機跨機器。**MUST** 由使用者完成，agent 禁止代勾。
- `[discuss]` — Claude 主導的 evidence-based 討論項目。例：production 授權、商業判斷、production 觀察、後端 evidence 查驗。spectra-archive Step 2.5 walkthrough 流程下，Claude 主動準備證據與使用者討論、取得 OK 後可代勾並寫入 `(claude-discussed: <ISO-8601-timestamp>)` annotation。**`[discuss]` items MUST 由 `/spectra-archive` Step 2.5 walkthrough 觸發推進，NEVER 由 review:ui home page handoff prompt（含「等 Claude 接手」群「接手分析 prompt」按鈕）dispatch 給接手 Claude**。理由：production-observation / production 授權 / 商業判斷類 item 的勾選 trigger 是外部 signal（deploy / soak / 商業決策），Claude 提前分析只會回「等外部 signal」、tasks.md 無更新、change 永遠卡在 review:ui pending state、archive 不了。對應 review-gui 行為：純 D-only pending（I=0、V=0、evidenceMissing=0）的 change MUST 進「🗓 等 archive walkthrough」群、無接手 prompt 按鈕。
- `[verify:e2e]` — Playwright spec-based automated round-trip。主線在 `e2e/verify/<change>/<topic>.spec.ts` 寫 spec、跑 `pnpm test:e2e:verify <change>`，通過後寫 `(verified-e2e: <ISO> spec=<path> trace=<path>)` annotation。
- `[verify:api]` — 純 HTTP round-trip（curl / ofetch / fetch）。主線跑 request，通過後寫 `(verified-api: <ISO> <METHOD> <URL> <STATUS>[ body=<hash>])` annotation。**裝 `nuxt-csurf` 的 consumer**（<consumer-a> / <consumer-c> / <consumer-d> 等）走 `vendor/snippets/verify-channels/api-roundtrip.template.sh` 的 dual-token recipe（harvest `csrf=<uuid>` cookie + HTML `<meta name="csrf-token">` token，POST 帶 `-H "csrf-token: <token>"`）；不走 dual-token 第一次就會撞 403 `CSRF Cookie not found`。
- `[verify:ui]` — final-state screenshot + DOM observation。主線派 screenshot-review agent `mode: verify` 只開已知 URL、等待載入、截 final-state screenshot、記錄 DOM 觀察，回來後寫 `(verified-ui: <ISO> screenshot=<path>[ dom=<obs>])` annotation；使用者仍需在 review GUI 點 OK 才勾 `[x]`。
- `[verify:<a>+<b>]` / `[verify:<a>+<b>+<c>]` — multi-marker，僅允許組合 `e2e` / `api` / `ui` verify channels，例如 `[verify:api+ui]` 或 `[verify:e2e+ui]`。
- `[verify:auto]` — **DEPRECATED alias**，僅為既有 consumer tasks.md 相容保留；解析時視為 synthetic `[verify:api+ui]` 並 emit deprecation warning。新項目 **NEVER** 使用 `[verify:auto]`。

### Canonical line format

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [(claude-analyzed: ...)] [@followup[TD-NNN]] [@no-screenshot]
```

- Marker **MUST** 是 `#N` / `#N.M` 後第一個 token，與 id 之間僅一個空白。
- Marker 出現在 description 中間（例：`Click the [discuss] button`）視為 plain text，**MUST NOT** 被解析成 marker。
- `[review:ui]` / `[discuss]` 不得與 verify multi-marker 混用。`[verify:api+review:ui]`、`[verify:api+discuss]` 都是非法 marker。
- Verify multi-marker 的 channel canonical order 是 `e2e → api → ui`；annotation 寫回也 **MUST** 依此順序。

### `(claude-analyzed: ...)` annotation（Claude-writable）

當 review-gui 「🤖 等 Claude 接手」群 → 「接手分析」prompt 走完後，Claude 路由結論為 **(E) false positive / item 應改回 OK 或翻 [x] / 需 user 重新評估** 時（典型情境：修法已落地 + 新 evidence 已收集，等 user 重看新截圖決定 OK / Issue），**MAY** 在帶 `（issue:）` 的 item 同行寫入此 annotation 作為 evidence trail，告訴 GUI「我已分析過、ball in user's court」。

#### Schema

```text
(claude-analyzed: <ISO-8601> route=<code>[ note=<sanitized one-liner>])
```

- **Half-width parens**（machine annotation，與 `(claude-discussed:)` / `(verified-*:)` 同類）
- `<ISO-8601>` **required**（UTC，秒級精度，與其他 annotation 共用 timestamp 慣例）
- `route=<code>` **required**：目前只支援 `E`。Schema 預留為自由 `string` 給未來擴展，但 hard rule 限 `E`
- `note=<one-liner>` optional：剝半形括號、上限 240 chars。**Single hyphen-joined token**（write 時 `sanitizeNote` 後 whitespace 折成 `-`）— 與 `verified-ui` 的 `dom=<obs>` 同 convention，避免解析端 `findKeyValue` whitespace split 只拿到第一個 word
- 落點：description 後、所有 trailing markers (`@followup` / `@no-manual-review-check` / `@no-screenshot`) 前
- 與 `（issue: ...）` co-exist：issue **MUST** 已存在（沒 issue 就不該寫 claude-analyzed）；兩者並存表達「Claude 已分析此 issue，路由結論=等 user 重新評估」

#### Claude 可寫條件（hard rule）

- **MUST** 在路由 **(E)** 結論時寫
- **MUST** 在 item 已帶 `（issue:）` annotation 時才寫
- **MUST NOT** 翻 checkbox（保留原 `[ ]`，user 在 GUI 點 OK / Issue / Skip 才翻）
- **MUST NOT** strip 既有 `（issue:）` annotation（兩者語意正交：issue 是 user 回饋，claude-analyzed 是 Claude 分析證跡）
- **MUST NOT** 在路由 (A) / (B) / (C) / (D) 結論時寫 — 那些情境 user 仍需要 Claude 動作（改 proposal / 開 TD / 改 code / 切 clade session），不是「等 user 重新評估」

#### Strip semantics

User 在 GUI 對該 item 點 **OK / Issue / Skip** 時，`stripAnnotations`（in `vendor/scripts/review-gui.mts`）會 **同時** 清掉：

- `（issue: ...）` 與 `（skip[: ...]）` / `（note: ...）` / `（finding: ...）` 等 action annotation（既有行為）
- `(claude-analyzed: ...)` annotation（新增 strip 規則）

設計 rationale：claude-analyzed 的語意一旦 user 動了該 item = 評估已完成，annotation 失效；保留會讓下次 GUI re-render 把 item 錯誤地仍歸到 `awaitingUserReEval` bucket。verified-* 與 claude-discussed annotation **不**受此 strip 影響（它們是 archive evidence trail，需要永久保留）。

#### 與 `(claude-discussed:)` 的差異

| 維度 | `(claude-discussed:)` | `(claude-analyzed:)` |
| --- | --- | --- |
| 適用 kind | `[discuss]` | `[review:ui]` / `[verify:ui]`（帶 `（issue:）` 的 item） |
| 觸發流程 | `/spectra-archive` Step 2.5 walkthrough | review-gui 「等 Claude 接手」prompt 路由 (E) |
| Checkbox 行為 | 翻 `[x]` | **不翻**（保 `[ ]`） |
| Strip on user action | 不 strip（archive evidence trail） | strip（user 點 OK / Issue / Skip 即清） |
| User 主動性 | user 必須先看 evidence 才允許 Claude 寫 | Claude 自己分析後寫，user 之後重整 GUI 看到 |

#### Home page 影響

當 change 的所有 issued items 都已被 Claude 寫 `(claude-analyzed: route=E)`、且 user-actionable / verify pending / evidence missing / readiness hits 都是 0 → change 落入 **「✋ Claude 已分析、等 user 重新評估」** bucket（review-gui home page），不再被 「🤖 等 Claude 接手」群 prompt 抓走重複分析。User 點 card 進 detail，重看 final-state evidence 後在 GUI 點 OK / Issue / Skip 結束流程。

詳見 `vendor/scripts/review-gui.mts` 內 `analyzedIssuedCount` field、`awaitingUserReEval` bucket dispatch、`stripAnnotations` claude-analyzed strip 段。

#### 範例

寫入前（user 點 issue 後 Claude 收到「接手分析」prompt、走完分析路由 (E)）：

```markdown
- [ ] #4.1 [verify:ui] /vending/inventory final-state visual review （issue: 整體 UI 設計難以理解 不好看也不好用 改進方案已實作完成 待重拍新版 screenshot 後 user 重新評估）
```

寫入後（Claude 在路由 (E) 結論時加 annotation）：

```markdown
- [ ] #4.1 [verify:ui] /vending/inventory final-state visual review （issue: 整體 UI 設計難以理解 不好看也不好用 改進方案已實作完成 待重拍新版 screenshot 後 user 重新評估） (claude-analyzed: 2026-05-24T13:00:00Z route=E note=Re-Design)
```

User 在 GUI 對 #4.1 點「✓ 通過」後：

```markdown
- [x] #4.1 [verify:ui] /vending/inventory final-state visual review
```

`（issue:）` 與 `(claude-analyzed:)` 兩條 annotation 同時被 strip，change 進入下一輪流轉。

### Default Kind Derivation Rule（fallback）

當 item 行無 leading marker（典型情境：legacy in-flight change），parser 依 `proposal.md` 推導 default kind：

- proposal 含 `**No user-facing journey (backend-only)**` → default kind = `discuss`
- 其餘 → default kind = `review:ui`

**Fallback 不涵蓋任何 `verify:*`** — verify channels 代表 apply 階段會收集自動 evidence，不能由 proposal default silent derive。新寫 verify items **MUST** 顯式標 marker。

**Fallback ≠ 允許省略**：所有**新寫**或**ingest 修改**的 `## 人工檢查` items **MUST** 顯式標 marker。Default 只給既有 in-flight change 過渡用。spectra-propose / spectra-ingest 的 Manual Review Marker Hygiene Check 會擋下未標 marker 的新內容。

> **ADR (2026-05-22) — Default Kind Flip 未採用，勿再提案**
>
> 曾被提出的修案：「把 user-facing fallback default 從 `[review:ui]` 改成 `[verify:ui]`」（理由：`[review:ui]` 是最 strict 的「真的需要人」白名單，silent fallback 到 strict kind 等於把 agent 該做的工作推給 user）。
>
> **未採用**，理由：
>
> 1. **Root cause 已被 explicit marker enforcement 取代**：`MISSING_KIND_MARKER` pattern（`patterns.json` v1.4.0）在 propose / ingest 階段透過 hook fail-fast 強制每條 sub-item 標 explicit marker。Fallback 只剩 legacy in-flight item 在用，新 case 不會再進。
> 2. **任何 default 都猜不對**：`[review:ui]` / `[verify:ui]` / `[verify:api]` 三種 kind 走不同 review flow，default 選哪個都會在某類內容上錯。改 default 從「猜成 review:ui」變「猜成 verify:ui」，PATCH /api/... 這種 backend roundtrip 還是錯（正解是 `[verify:api]`）。只有 explicit marker 是正解，default 永遠是「猜」。
> 3. **會 break legacy review-gui flow**：fallback derived item 從「user 在 GUI 點 OK 過」變成「需 final-state screenshot evidence (`verified-ui` annotation) + 點 OK」，可能在 review-gui 觸發 evidence missing red banner、卡住既有 archive flow。
> 4. **review-gui chip 已視覺化**：`hasExplicitKind: false` 的 item 顯示 `(fallback)` amber chip，user 看得到、知道要跑 `/spectra-ingest` 補。漸進清 legacy 即可，不需大爆改。
>
> **Future agent**：看到 missing marker 問題的反射性建議**不該**是「改 default」，應該是「補 explicit marker（或 hook 已擋）」。本 ADR 防止 default flip 提案反覆出現。

### 與 `@no-screenshot` / `@followup[TD-NNN]` 共存 ordering

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [@followup[TD-NNN]] [@no-screenshot]
```

`[<kind>]` 永遠在最前（緊接 `#N`），`@no-screenshot` 永遠在最後；`@followup[TD-NNN]` 若存在須夾在 description 與 `@no-screenshot` 之間。寫回 annotation（`（issue: ...）` / `（skip）` / `（note: ...）` / `（finding: ...）` / `(claude-discussed: <ISO>)` / `(claude-analyzed: <ISO> route=<code>[ note=<...>])` / `(verified-e2e: ...)` / `(verified-api: ...)` / `(verified-ui: ...)`）**MUST** 插在 description 後、所有 trailing markers (`@followup` / `@no-screenshot`) 前。`（finding: ...）` 與 `（issue: ...）` / `（skip）` / `（note: ...）` 正交（可共存於同一行），其餘 action annotation 之間仍互斥。`(claude-analyzed:)` 與 `（issue:）` 必須共存（路由 (E) 時 Claude 寫入 claude-analyzed，issue 保留為 user 原始回饋），user 在 GUI 動作時兩者同時被 strip — 詳見「`(claude-analyzed: ...)` annotation」段。

### Kind 分類指引（摘要）

寫 `## 人工檢查` 時依以下原則判斷 marker：

- 主線能用 Playwright spec 重現 journey / persistence → `[verify:e2e]`
- 主線能用 curl / ofetch 重現 HTTP round-trip → `[verify:api]`
- 只需 final-state screenshot + DOM observation → `[verify:ui]`
- 同一 business assertion 需要多種 evidence → `[verify:<a>+<b>]`
- 需要 SSH / psql / cron 等不可由 HTTP 重現的 walkthrough → `[discuss]`
- 真的需要人（email / webhook / 實體裝置 / 視覺主觀 / 真機 / SMS）→ `[review:ui]`

完整 kind by-kind 詳細描述、反面範例（「按鈕應隱藏」「authz status matrix」「persistence」常見誤標）、`[review:ui]` 收斂原則 hard rule：詳見 [[manual-review.evidence]] § Kind 分類指引。

## `@no-screenshot` Marker（hard rule，摘要）

純 functional round-trip 且 screenshot review 無法提供視覺證據時，在 checkbox line 行尾加 `@no-screenshot` marker。`pnpm review:ui` 視為 round-trip-only manual-review item，使用者親自操作後直接勾 OK、不需截圖。

Marker schema、canonical ordering（與 `@followup` / `@no-manual-review-check` 共存）、範例：詳見 [[manual-review.evidence]] § `@no-screenshot` Marker。

## `@no-manual-review-check` Marker（hard rule，摘要）

針對 hook regex 誤判（false positive）或合法例外（如真機掃 SMS 驗證碼、實體鎖匙等真的無 dev replay endpoint 場景），在 checkbox line 行尾加 `@no-manual-review-check[<reason>]` marker，跳過 Pre-Review Data Readiness regex 檢查（hook + review-gui banner 都 skip）。

Marker schema、`<reason>` 必填規約、canonical ordering、audit trail、跟 hook regex 的關係：詳見 [[manual-review.data-readiness]] § `@no-manual-review-check` Marker。

## `@evidence-via-manual-review` Marker（hard rule）

針對「impl 已做、verification evidence 必須在 review-gui `## 人工檢查` 區蒐集」的 phase task，加 `@evidence-via-manual-review` marker 把該 task 從 review-gui 90% implementation-progress threshold 計數中排除。**這條 marker 用在 phase task line（regex `^- \[([ x])\] N.M `），不用在 `## 人工檢查` `#N` / `#N.M` items**。

### 解決什麼問題

某些 phase task 的「驗證」clause 寫法依賴 review-gui evidence（典型：「驗證：review-screenshot evidence 覆蓋 …」、「驗證：screenshots 路徑寫入 design-review evidence」、「驗證：`[verify:ui]` evidence 覆蓋 …」）。這類 task 的 `[ ]`/`[x]` 狀態跟 review-gui 互相依賴形成 deadlock：

- phase task 卡 `[ ]`（等 evidence）
- review-gui 偵測 < 90% threshold → 暫停 manual review
- manual review 暫停 → 沒法蒐 `[verify:ui]` / `[review:ui]` evidence
- phase task 永遠卡 `[ ]`

`@evidence-via-manual-review` marker 切開這個循環：bearing marker 的 phase task **不計入** threshold，author 可放心讓它停 `[ ]`，evidence 由對應 `## 人工檢查` items 在 review-gui 階段蒐集。

### Schema

```text
@evidence-via-manual-review
```

- **MUST** 是 trailing token（位於 phase task line 行尾）
- 沒有 brackets / 沒有 reason 欄位（語意已固定 — 不像 `@no-manual-review-check` 是 case-by-case exception）
- 同一行 **MUST NOT** 出現多個 marker
- Marker 出現在 description 中間（例：documenting the marker syntax inside backticks）視為 plain text，**MUST NOT** 被解析成 marker

### Canonical line format

```text
- [ ] N.M <description>；驗證：<verification clause referencing review-gui evidence> @evidence-via-manual-review
```

範例：

```markdown
- [ ] 4.5 完成 design `Responsive / Spatial Spec` 對帳：admin pages desktop + 390px mobile 無文字重疊；驗證：review-screenshot / verify:ui evidence 覆蓋 `/admin/users`、`/admin/groups` @evidence-via-manual-review
- [ ] 6.6 執行 review-screenshot 視覺 QA，截 admin pages desktop + 390px mobile；驗證：screenshots 路徑寫入 design-review evidence @evidence-via-manual-review
```

### Marker 與 checkbox 狀態語意

- Marker bearing task 的 `[ ]` / `[x]` 由 author 決定，**不**受 review-gui 強制
- 通常 author 在 impl 寫完後可直接勾 `[x]`，因為 marker 已宣告「verification 在 manual review，不擋 phase task 完成」
- 留 `[ ]` 也合法 — 表示「等待 manual review 完成後再回頭勾」
- Archive gate 是另一道閘門，依 `## 人工檢查` items 完成度判斷，不依 phase task `[x]` 狀態

### 何時該用 marker

寫 phase task 時，「驗證」clause 出現以下任一字眼 **SHOULD** 加 marker：

- `review-screenshot`
- `[verify:ui]` evidence / screenshot evidence / `verify:ui` 評估
- `screenshots 路徑寫入 ...`
- `截圖 ... evidence`
- `review-gui` / `pnpm review:ui`
- 任何把 verification responsibility 推到 manual review 階段的 phrasing

### 何時 **不該** 用 marker

- Phase task 驗證可由 `pnpm typecheck` / `pnpm lint` / `rg` static check 完成 → **不要**加 marker（這類 task 本來就 agent-self-verifiable，計入 threshold 才有意義）
- Phase task 是純 implementation work（寫 endpoint / 抽 composable / 加 schema 欄位）且驗證是 grep static check → **不要**加 marker

### Review-gui 行為

- `countImplementationProgress(content)` 掃 phase task line，bearing marker 的 task 進 `excluded` 計數，不計入 `implTotal` / `implDone`
- `implTotal` / `implDone` 計算 threshold ratio，bearing marker 的 task 完全不影響
- Manual review gate 訊息（`Implementation 未完成 ...`）會附帶 `(+ N 項 @evidence-via-manual-review 已排除)` transparency note 讓 user 看到 marker 生效

### Audit trail

Marker bearing task 不寫額外 audit log（與 `@no-manual-review-check` 不同 — 那條因為是 case-by-case bypass 需要 audit）。`@evidence-via-manual-review` 是 design-time decision，author 寫進 tasks.md 時就明說「這條走 manual review」，archive 階段 tasks.md 進 `docs/manual-review-archive.md` 自然保留語意。

### 與其他 marker 共存

`@evidence-via-manual-review` 只用在 **phase task line**（id 是 `N.M` 格式）；不會跟 `## 人工檢查` 用的 `@no-screenshot` / `@no-manual-review-check` / `@followup[TD-NNN]` 撞，因為那些用在 `#N` / `#N.M` items。phase task line 本身不接其他 trailing marker，所以 canonical ordering 簡單：

```text
- [ ] N.M <description>；<驗證 clause> @evidence-via-manual-review
```

## 截圖檔名與 item id 配對（hard rule，摘要）

`pnpm review:ui` 自動把截圖配到 item，**MUST** 用：

```text
#<item-id>[<variant>]-<descriptor>.<ext>
```

例：item `#1` → `#1-clock-light.png`、`#1a-clock-dark.png`；scoped item `#3.1` → `#3.1-mobile.png`。

完整命名規範（含變體、legacy fallback、違反處理）：詳見 [[screenshot-strategy]] + [[manual-review.data-readiness]] § 截圖檔名與 item id 配對。

## 標準流程（依 kind 分流）

依 item 的 kind marker 走不同 flow。**MUST** 覆蓋 verify channels、`[review:ui]`、`[discuss]` — 一個 change 的 `## 人工檢查` 區塊可同時包含多種 kind 的 items。

| Kind | Flow 觸發點 | 完整 spec 位置 |
| --- | --- | --- |
| `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / multi-marker | spectra-apply Step 8a Verify Channel Pass | [[manual-review.backend]] § `[verify:*]` flow |
| `[review:ui]` | spectra-archive `pnpm review:ui` GUI 引導 | [[manual-review.backend]] § `[review:ui]` flow |
| `[discuss]` | spectra-archive Step 2.5 Walkthrough | [[manual-review.discuss]] § `[discuss]` flow |
| 混合（同一 change 多種 kind 並存） | apply 階段 Step 8a → archive 階段 Step 2.5 → review GUI | [[manual-review.discuss]] § 混合 kind change |

核心 invariant（**MUST** 都做）：

- `[verify:e2e]` / `[verify:api]` annotation 寫入後可自動 flip `[x]`（automatic channel）
- `[verify:ui]` annotation 後仍 **MUST** 使用者在 review GUI 點 OK（semi-automatic）
- `[review:ui]` **NEVER** 由 agent 代勾，必使用者親自互動後在 GUI 確認
- `[discuss]` 由主線 Claude 在 archive Step 2.5 主動準備 evidence + 走 walkthrough；OK → 勾 `[x]` + `(claude-discussed: <ISO>)` annotation

Verify channel pre-baseline 假設（all `verify:*` channel 都依賴 codebase-level baseline，**MUST** 主線預檢、缺則停下回報，**NEVER** 派 agent 撞 baseline 缺）、dev-login route missing → scaffold-first hard rule、Detection helper（`vendor/snippets/dev-auth/lib/detect-dev-login-route.mjs`）+ audit script（`scripts/audit-dev-login-adoption.mjs`）為 detection SoT、cookbook 範本（`vendor/snippets/verify-channels/`）：詳見 [[manual-review.backend]] § `[verify:*]` flow + Pre-verify baseline 假設 + Dev-login route missing → scaffold-first hard rule。

## Post-Edit Validation Gate（hard rule）

修改 `tasks.md` `## 人工檢查` 區（透過 `/spectra-ingest` / `/spectra-propose` / 手動 Edit）後，**MUST** 在 commit 前重跑 hook 驗證 0 violation，**NEVER** 只靠目測。

```bash
bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
```

預期輸出 `✓ post-propose-manual-review-check passed (N items)` 才能 commit。出現 finding 即修，修完重跑直到綠燈。

### Stale-hook fallback（worktree drift 場景）

Session worktree fork 在 clade hook 升版前時，worktree 內 `scripts/spectra-advanced/post-propose-manual-review-check.sh` / `vendor/snippets/manual-review-enforcement/patterns.json` 可能是 pre-update 版本 — 跑 worktree-local hook 會撞 stale regex / 缺 KIND_FILTER 等 false positive。**MUST** fallback：

1. 在 main worktree（fresh hook）跑 hook 對該 change 路徑（hook 看的是 `<cwd>/openspec/changes/<name>/tasks.md`，若 main 跟 worktree 的 change tasks.md 已分歧，要先複製 worktree 版本進 main 暫存 — 但這違反 scope discipline）
2. 或直接對個別 pattern 用 grep 驗：

   ```bash
   PATTERN='某張|某筆|某個|任一張|任一筆|...'   # 從 main 的 patterns.json 抓
   awk '/^## 人工檢查/,0' <worktree>/openspec/changes/<name>/tasks.md \
     | grep -iE "$PATTERN" && echo "HIT" || echo "NO_HIT"
   ```

3. 或在 worktree 內跑 `pnpm hub:bootstrap` sync clade projection，再用 worktree-local hook（清乾淨 stale state）

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
- **NEVER** 對非「External signal pending」trigger 分類的 `[discuss]` item 走 Defer-to-HANDOFF 路徑 — `(deferred-to-handoff: ...)` 只給真的等不到 signal 的 item，把 Internal evidence / signal already occurred 的 item 也 defer 等於規避 walkthrough
- **NEVER** 在 Resume mode 外（archived change directory）寫 `(deferred-to-handoff: ...)` annotation — 只有 archive 階段 Step 2.5 才產生這個 annotation，Resume mode 是把它翻成終態（claude-discussed / issue / skip）或保留
- **NEVER** 對沒帶 `（issue: ...）` 的 item 寫 `(claude-analyzed: ...)` annotation — 此 annotation 語意是「Claude 已分析此 issue、路由結論=等 user 重評」，沒 issue 就沒有對象可分析
- **NEVER** 用 `route` 值不為 `E` 的 claude-analyzed — schema 預留未來擴展，但目前 hard rule 限 `E`（false positive / item 應改回 OK 或翻 [x] / 需 user 重新評估）。其他路由結論 (A) / (B) / (C) / (D) 表示 user 仍需要 Claude 動作，**不該**寫 claude-analyzed annotation
- **NEVER** 在寫 `(claude-analyzed: ...)` 時翻 checkbox — 此 annotation 保 `[ ]`，user 在 GUI 點 OK / Issue / Skip 才翻；翻了會打破 GUI bucket 分類（awaitingUserReEval 條件要求 issued > 0、checkbox `[ ]`）
- **NEVER** 在 GUI 寫回 user action（OK / Issue / Skip）時遺漏 strip `(claude-analyzed: ...)` annotation — 保留 stale annotation 會讓下次 GUI re-render 把已動過的 item 仍歸到「✋ Claude 已分析、等 user 重新評估」bucket，造成 user 困惑
- **NEVER** dispatch verify channels 前不檢查 per-channel baseline — 撞 baseline 缺後升 UNCERTAIN 是浪費 budget；主線預先 grep / read 確認，缺則停下回報 user 補齊
- **NEVER** 在 verify dispatch 當下才問 user「dev-login / seed 準備好了嗎」— baseline 是 codebase 層長期狀態，不該每次派工都驚動 user
- **NEVER** 修完 `## 人工檢查` 區後直接 commit 而沒重跑 `post-propose-manual-review-check.sh` 驗 0 violation — 見「Post-Edit Validation Gate」。實證會在 ingest 過程引入新 pattern hit（如寫範例 step 時用「任一筆」），目測抓不到
