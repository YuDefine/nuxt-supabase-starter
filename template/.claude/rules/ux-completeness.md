<!--
🔒 LOCKED — managed by clade
Source: rules/core/ux-completeness.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: UX 完整性規則——定義 "feature complete"、強制列舉 user-facing surface、防止 DB+API 完成但 UI 缺失
globs: ['openspec/changes/**', 'app/**/*.vue', 'shared/types/**/*.ts', 'supabase/migrations/**']
---

# UX Completeness

繁體中文 | [English](./ux-completeness.en.md)

**核心命題**：feature 的完成度由**使用者結果**定義，不由「tasks 打勾 + tests 綠」定義。DB allow ≠ feature ready；tests pass ≠ UX done。

此規則優先於 spectra skill 內嵌說明與其他規則。

## Definition of Done

一個 change 只有在以下全部成立時才算完成：

1. 每個宣告的 **User Journey** 都能由對應角色在瀏覽器端走完（有截圖佐證）
2. 每個受影響的 **entity** 都有 admin 管理路徑與 end-user 消費路徑（或明確宣告不需要）
3. 每個被觸動的 **enum / const array** 在所有消費點都有對應分支（exhaustiveness 保證）
4. 每個新增的 **route** 有 navigation 入口或明確宣告為 internal-only
5. 每個新增的 UI surface 具備 **empty / loading / error / unauthorized** 四種 state 的處理
6. 每個有 UI 展示的 entity 在本機 dev DB 有**持久化 fixtures**（寫進 `seed.sql` 或同義 seed 機制），review 拍照能立刻看到非空畫面

**完成不是「我改完了」，是「使用者可以做事了」**。

## 必填 Propose 區塊

spectra-propose 階段，`proposal.md` 必須包含以下三個區塊（或明確的 Non-UI 宣告）：

### `## Affected Entity Matrix`

每個被動的 DB entity（table、enum 擴張、column 新增）都要列一個矩陣：

```markdown
### Entity: nfc_cards

| Dimension       | Values                                                          |
| --------------- | --------------------------------------------------------------- |
| Columns touched | `card_type` (enum expansion: +'kit'), `kit_id` (new FK)         |
| Roles           | admin, staff                                                    |
| Actions         | create, read, update, delete, filter, swap                      |
| States          | empty, loading, error, success, unauthorized                    |
| Surfaces        | `/nfc-cards` (管理), `/warehouse` (掃描), `/asset-loans` (檢視) |
```

寫不出矩陣 = scope 沒想清楚，不允許進入 tasks 階段。

### `## User Journeys`

每個 entity × 每個 role × 每個關鍵 action 至少一條具體 journey，URL 與步驟皆須明確：

```markdown
### Kit 卡片註冊流程

- **Admin** 開啟 `/nfc-cards` → 點「新增卡片」→ 選類型「設備組合標籤」→ 選 kit → 儲存 → 列表看到新卡片
- **Admin** 在 `/nfc-cards` 以「設備組合標籤」篩選 → 看到所有 kit 卡片
- **Admin** 編輯現有 kit 卡片 → 改綁定 → 儲存成功
- **Staff** 在 `/warehouse` 刷 kit 貼紙 → 進入組裝模式
```

**純後端 change 的例外**：若此 change 完全沒有 user-facing 影響，必須寫：

```markdown
## User Journeys

**No user-facing journey (backend-only)**

理由：<具體說明為何沒有 UI 影響，例如 cron job / 內部 API / 資料修復 script>
```

沒寫這個宣告 = 視為漏寫 journey。

### `## Implementation Risk Plan`

這個區塊的目的不是寫 implementation 細節，而是把**最容易拖到 `/commit` 才被追問的前提問題**提前回答。固定使用以下五行：

```markdown
## Implementation Risk Plan

- Truth layer / invariants:
- Review tier:
- Contract / failure paths:
- Test plan:
- Artifact sync:
```

說明如下：

- **Truth layer / invariants**：哪個 artifact 是 single source of truth、哪些語義不能漂、哪些同步層必須一起維持一致
- **Review tier**：Tier 1 / 2 / 3，決定後續 review、audit、screenshot review 強度
- **Contract / failure paths**：success / empty / conflict / unauthorized / third-party fail 等要如何處理
- **Test plan**：至少交代 unit / integration / e2e / screenshot / manual evidence 中哪些會做
- **Artifact sync**：除了 code 外，`tasks.md`、`ROADMAP.md`、`HANDOFF.md`、`docs/tech-debt.md`、docs / reports 還要同步哪些

### Scope-sensitive 要求

以下 scope 不允許只寫空標題：

- 觸及 **migration / schema / auth / permission / raw SQL**：`Truth layer / invariants` 必須具體
- 觸及 **API / server**：`Contract / failure paths` 必須具體
- 觸及 **UI**：`Test plan` 至少要提 screenshot、manual journey，或等效瀏覽器驗證
- 觸及 **DB / shared types**：`Artifact sync` 不能只寫「更新文件」，必須點名同步面

寫不出這五行 = scope 還沒收斂，不應進入 apply。

## 必填 Tasks 區塊

`tasks.md` 必須包含 `## Affected Entity Matrix` 衍生出的所有對應 task：

- 每個 surface → 一個實作 task
- 每個 journey → 一個人工檢查 task
- 每個 enum 擴張 → 對應 `shared/types/` task
- 每個 DB migration 修改 column/enum → 對應 API validation schema task + consuming UI task
- 每個新 route → 一個 navigation 入口 task

**不允許**：tasks 中只有「更新 UI」這種 catch-all 任務。必須拆到具體 .vue 檔案路徑。

## 必填 Fixtures / Seed Plan

**核心命題**：資料展示 UI 沒 mock = review 階段拍空畫面 = 白做檢視。Fixtures 是 feature 完整性的一部分，必須在 propose 階段就規劃，不是 review 階段才補的事後工。

### 觸發條件

凡 `Affected Entity Matrix` 任一 entity 的 `Surfaces` 欄非空（= 有 UI 展示）— `tasks.md` **MUST** 包含 `## N. Fixtures / Seed Plan` section（N = 緊接最後一個功能區塊之後、`## N+1. Design Review` 之前）。

### Section 範本

```markdown
## N. Fixtures / Seed Plan

- [ ] N.1 `entity_a` — happy path 至少 3 筆（含關聯 entity X / Y）+ edge case 1 筆（X 為 NULL）→ 寫進 `<seed-file-path>`
- [ ] N.2 `entity_b` — happy path 至少 1 筆 → 寫進 `<seed-file-path>`
- [ ] N.3 跑 `<reset-or-seed-command>` 重建本機 DB 並驗證 list / detail 頁面非空
```

`<seed-file-path>` 偵測順序（依專案實際存在的檔案決定）：

1. `supabase/seed.sql`
2. `db/seed.sql`
3. `prisma/seed.ts`
4. `drizzle/seed.ts`
5. 專案自訂（在 task 內註明絕對路徑）

`<reset-or-seed-command>` 同樣依專案 `package.json` `scripts` 偵測，如 `pnpm db:reset` / `pnpm db:seed` / `supabase db reset` / `pnpm prisma db seed`。

### 例外宣告

若**既有 seed 已足夠驗證所有 Surfaces 非空狀態**，可將 section 簡化為：

```markdown
## N. Fixtures / Seed Plan

**Existing seed sufficient** — <一行說明，例如「entity_a 既有 5 筆已涵蓋 happy + edge case；list / detail 頁面 review 時可正常展示」>
```

但**禁止**寫空白宣告通過 gate — 必須具體說明哪些頁面靠哪些既有 row 撐住。

### 適用範圍邊界

- **適用**：list / table / dashboard / detail / 任何展示既有資料的頁面
- **不適用**：純表單建立頁、登入頁、純 layout / 樣式調整、純後端 change（已有 `No user-facing journey` 宣告）

### 為什麼前置在 propose 階段

- propose 階段已經寫了 `Affected Entity Matrix`，多列一個 fixtures task 邊際成本極低
- apply 階段執行 fixtures task = 自動產生持久化 mock，下次 reset DB 還在
- review 階段 screenshot-review agent 拍前若仍偵測到空狀態，可立刻反查 tasks.md 是否有 Fixtures Plan，定位是「沒規劃」還是「沒執行」

## 必填 Backend-only Manual Review 規約

**核心命題**：當 `## User Journeys` 為 `**No user-facing journey (backend-only)**` 時，`## 人工檢查` 區塊**不該**塞滿 Claude 自己就能跑的 evidence collection（SSH + psql + curl + 查表 + schema introspect）。那些屬於 apply 階段 Claude 該自驗的工作，不是使用者該人工做的。把它們塞進「人工檢查」會誤導使用者去 SSH 跑 SQL，且把真正該由使用者把關的項目（production 授權 / 商業判斷 / production 觀察）淹沒在技術 evidence 之中。

### 觸發條件

`proposal.md` 的 `## User Journeys` 為 `**No user-facing journey (backend-only)**` 宣告時，本規約**強制**生效。

### `## 人工檢查` 限制（hard rule）

backend-only change 的 `## 人工檢查` **MUST** 只保留 `[discuss]` kind 的代表性 use cases：

1. **Production 授權型**：deploy 前的 final go/no-go ack、production-only 破壞性操作（rotation / migration / data fix）前的人工授權
2. **商業判斷型**：Claude 無法自動判斷「結果是否合理」的觀察項，例如「drift 統計分布是否符合業務預期」「異常頻率是否在容忍範圍」「告警閾值需要調整嗎」
3. **Production 觀察型**：deploy 後 N 小時 / N 天的 production-only soak window 觀察，無法在 dev / staging 提前完成

上述三類 **MUST** 標 `[discuss]` marker；spectra-archive Step 2.5 walkthrough 流程下由 Claude 主動準備 evidence 與使用者討論。**user-facing change 也可對個別 item 標 `[discuss]`**（例：純資料修復 task 雖屬於含 UI 的 change，但實際驗證仰賴 evidence 而非 round-trip）— 此時不需 `**No user-facing journey**` 宣告，逐項標 marker 即可。

**MUST NOT** 把以下項目放進 `## 人工檢查`（即使該 change 是 backend-only）：

- SSH 進 dev / staging LXC 跑 psql / `docker exec` 等技術 evidence
- `curl` 觸發 endpoint / cron 並查 response
- `\d <table>` / `SELECT` 驗證 schema / 資料狀態
- 受控製造 drift / seed test data 等可程式化操作
- migration apply 後的 schema 存在性驗證
- 任何 Claude 在 apply 階段可自動執行 + 可貼證據的工作

這些**不是人工檢查**，是 evidence collection。

### `## N. Backend Verification Evidence` section（取代）

把上述被排除項目改寫進 tasks.md 新的 `## N. Backend Verification Evidence` section（位置：最後一個功能區塊之後、`## 人工檢查` 之前。N = 上一個功能區塊的序號 + 1）：

```markdown
## N. Backend Verification Evidence

> 由 apply 階段 Claude 自跑、自貼證據；**非**使用者人工檢查項目。每條 task 完成時 Claude **MUST** 在 task 下貼出實際 SQL / curl / docker exec 的輸出（節錄關鍵欄位即可）作為 evidence，archive 前查 task 已勾且有證據。

- [ ] N.1 Apply migration 到 dev LXC，驗證 `<schema>.<column>` 存在且型別正確 — 貼 `\d <table>` 輸出
- [ ] N.2 製造受控 drift（`SET session_replication_role = replica` + UPDATE）→ 觸發 cron → 貼 `audit_chain_drift` 查詢結果（drift_type / count）
- [ ] N.3 …
```

### 例外宣告

若 backend-only change 確實不需要任何使用者授權 / 商業判斷 / production 觀察，`## 人工檢查` 區塊**MUST** 寫成下列固定文字（archive gate 會把它視為合法宣告）：

```markdown
## 人工檢查

_本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 `## N. Backend Verification Evidence`）；deploy 前無使用者人工檢查項目。_
```

**禁止**寫空 section 或刪掉 `## 人工檢查` 標題 — archive gate 會誤判為「漏寫」。

### 反面範例（為什麼這條規則存在）

```markdown
❌ 不該出現的人工檢查（perno TD-044 原版，且未標 marker）：

- [ ] #1 Apply the TD-044 migration to dev LXC and verify `audit_signed_chain.signed_business_keys` exists as nullable `jsonb`. @no-screenshot
- [ ] #2 Trigger or seed controlled drift rows on dev LXC, run `/_cron/audit-chain-diff`, and verify only-business-key drift inserts `business_keys_drift`. @no-screenshot
- [ ] #3 On dev LXC, verify business-key plus other-field drift inserts both `business_keys_drift` and `evlog_hash_mismatch` for the same event. @no-screenshot
```

問題：

- 全部都是 SSH + psql + curl + `SELECT` 才能驗的事 → 是 evidence collection，不是人工檢查
- 使用者打開 `pnpm review:ui` 看到這 3 條完全不知道怎麼做（無從判斷是要登入哪台 host、跑什麼指令、查什麼結果）
- 真正該人工做的事（如「deploy production 前最後確認」「24h soak 後檢查 drift 是否爆量」）反而沒寫
- 缺 `[review:ui]` / `[discuss]` marker；Default Kind Derivation Rule 會把它們推為 `[discuss]`（因 backend-only），但寫作者**MUST**顯式標 marker 而非依賴 fallback

```markdown
✅ 修正版：evidence collection 移到 `## N. Backend Verification Evidence`，
   `## 人工檢查` 只保留真正需要使用者判斷的 [discuss] 項目：

## 人工檢查

- [ ] #1 [discuss] 24h soak 後確認 `business_keys_drift` count 是否在預期範圍 @no-screenshot
- [ ] #2 [discuss] Production deploy 授權 — confirm migration M-042 已驗證且預備好回滾路徑 @no-screenshot
```

### 與其他規則的關係

- `manual-review.md`：定義 `## 人工檢查` checkbox 不可由 agent 自行勾選；本規則補上 backend-only case 該放什麼進區塊。
- `proactive-skills.md`：spectra-propose Phase 0a prompt 與 Phase 0b cross-check 必須執行此規約；違反 → propose Final Verification Check 8 不過。
- `screenshot-strategy.md`：本規則排除的 evidence collection 不需要截圖；保留的三類項目通常也不需要截圖（用 `@no-screenshot` marker）。

### 違反時的回報方式

```
[UX Gate] Backend-only Manual Review 規約不通過

問題：change `<name>` 為 backend-only，但 `## 人工檢查` 含 SSH/psql/curl 等技術 evidence

證據：
  - tasks.md L<line>: <違規 checkbox 文字>

修正方式：
  - 把該項目從 `## 人工檢查` 移到 `## N. Backend Verification Evidence` section
  - 或保留該項目但確認其屬於 production 授權 / 商業判斷 / production 觀察 三類其一
  - 若全移走後 `## 人工檢查` 已空，改寫成例外宣告固定文字
```

## Exhaustiveness Rule（結構性強制）

所有 enum / const array 的分支處理必須用 `switch + assertNever` pattern，**禁止** `if/else if/else` 鏈：

```typescript
// ❌ 錯誤——加新 enum 值時 TypeScript 不會抱怨，靜默漏 case
function getBindingIcon(cardType: NfcCardType): string {
  if (cardType === 'tray') return 'i-lucide-monitor'
  if (cardType === 'staff') return 'i-lucide-user'
  return 'i-lucide-credit-card' // 默默吃掉未知值
}

// ✅ 正確——加新 enum 值時 compiler 立刻報錯
import { assertNever } from '~/utils/assert-never'

function getBindingIcon(cardType: NfcCardType): string {
  switch (cardType) {
    case 'tray':
      return 'i-lucide-monitor'
    case 'staff':
      return 'i-lucide-user'
    case 'equipment':
      return 'i-lucide-microscope'
    case 'kit':
      return 'i-lucide-package'
    case 'flat_burr':
    case 'drill_burr':
      return 'i-lucide-credit-card'
    case 'warehouse':
      return 'i-lucide-warehouse'
    default:
      return assertNever(cardType, 'getBindingIcon')
  }
}
```

**適用範圍**：任何從 `shared/types/**/*.ts` 匯入的 enum / const array、任何 Zod `z.enum()` 衍生的 union type。

**離線稽核**：`pnpm audit:ux-drift` 會掃描所有非 exhaustive 的 enum 分支並回報。

## Navigation Reachability Rule

新增 `app/pages/**/*.vue` 檔案（非動態 `[id].vue` 或子路由）時：

1. **MUST** 在 `app/layouts/default.vue`（或對應 layout）的 navigation 清單中加入入口
2. **或** 在 proposal 明確宣告 `navigation: internal-only`，並說明使用者如何到達（例如從其他頁面點擊）
3. pre-archive hook 會檢查這點，漏掉會 warn

## Reverse Relationship Rule

新增 FK（`column REFERENCES other_table`）時，必須檢查「被指向的 entity 詳情頁是否需要顯示反向關聯」：

- `inspection_equipment.kit_id → equipment_kits.id` → equipment 詳情頁可能需要顯示「屬於 kit X」
- 評估後若需要 → 加入 tasks；不需要 → 在 proposal 的 Non-Goals 明確排除

## State Coverage Rule

每個新 list/form page 必須處理四種 state：

| State        | 表現                                       |
| ------------ | ------------------------------------------ |
| Empty        | 第一次進入、無資料時的空狀態文案/圖示/引導 |
| Loading      | 資料載入中的骨架屏或 spinner               |
| Error        | 載入失敗的錯誤提示與重試路徑               |
| Unauthorized | 權限不足時的導向或提示                     |

存在任一 state 未處理 = Design Gate 不通過。

## 心智模型清單

照這個順序自問，對上「是」就停下處理：

1. **「DB allow ≠ feature ready」**——migration 通過 != 功能可用
2. **「Tests pass ≠ UX done」**——API test 綠 != 使用者能做事
3. **「Reuse 反咬」**——「既有頁面有了」不代表「不用改」，branching logic 反而需要更多改動
4. **「列舉比記憶可靠」**——用 grep / codebase-memory-mcp 找 surface，不要靠記憶
5. **「Journey 比檔案清單強」**——「admin 在 X 做 Y」比「更新 X.vue」更能暴露遺漏
6. **「Admin 路徑同等重要」**——Kiosk 流程是秀場、admin 管理是舞台，兩者都不能少
7. **「Completion momentum is a liar」**——感覺完成時離真正完成還差一哩，那一哩通常是 UI

## Workflow Integration

| Spectra phase                       | Gate script                                              | When to run                                                     |
| ----------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Before `spectra-propose` (handoff)  | **AskUserQuestion**：A. Codex GPT-5.5 xhigh / B. Claude Code 繼續做；A 路徑由主線 Claude 自己派背景 `codex exec`（**禁止**叫使用者切 CLI） | discuss 結束、進入 propose 前必詢問；由 `spectra-propose` Step 0 統一分流，詳見 `agent-routing.md` |
| Before `spectra-propose`            | `bash scripts/spectra-advanced/pre-propose-scan.sh`            | 注入 blast radius 要求，提醒必填區塊                            |
| After `spectra-propose`             | `bash scripts/spectra-advanced/post-propose-check.sh <change>` | 驗證 proposal 完整性                                            |
| After `spectra-propose`             | `bash scripts/spectra-advanced/design-inject.sh <change>`      | 若有 UI scope，提醒補上 `## Design Review` 區塊                 |
| Before `spectra-apply`              | `bash scripts/spectra-advanced/pre-apply-brief.sh <change>`    | 簡報 user journeys                                              |
| During UI edits                     | `bash scripts/spectra-advanced/ui-qa-reminder.sh <file>`       | 中途提醒 design / screenshot review，不要等到 archive 才檢查    |
| Before `spectra-archive`            | `bash scripts/spectra-advanced/design-gate.sh <change>`        | 阻擋未完成人工檢查或缺設計審查證據的 UI change                  |
| Before `spectra-archive`            | `bash scripts/spectra-advanced/archive-gate.sh <change>`       | 驗證 journey URL touch、schema drift、exhaustiveness            |
| Before `spectra-archive` (v1.5+)    | `bash scripts/spectra-advanced/followup-gate.sh <change>`      | 驗證 tasks.md 的 `@followup[TD-NNN]` 都在 `docs/tech-debt.md` 登記 |
| **Session start / 外部 runtime 跑完 spectra 後** | `pnpm spectra:roadmap` && `pnpm spectra:claims` && `pnpm spectra:followups` | 重算 ROADMAP、查看 active claims、摘要 follow-up 狀態 |

**Claude Code 使用者**：上述由 `.claude/hooks/` 自動觸發，無需手動。
**Codex / Cursor 使用者**：必須在對應 spectra 階段手動呼叫這些腳本，session 開始時也必須手動跑一次 `pnpm spectra:roadmap`、`pnpm spectra:claims`、`pnpm spectra:followups`。

## 必禁事項

- **NEVER** 寫空洞的 User Journeys 為通過 gate
- **NEVER** 用 Non-Goals 隱藏忘記做的 surface（必須有具體理由）
- **NEVER** 把 `if/else if/else` 用在 enum 分支
- **NEVER** 新增 route 但不在 navigation 加入口（除非明確宣告 internal-only）
- **NEVER** 把「tasks 全勾 + tests 綠」當作 feature complete 的充分條件
- **NEVER** 手編 `openspec/ROADMAP.md` 的 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊
- **NEVER** 未 claim 就開始做 active spectra change
- **NEVER** 把 backend evidence collection（SSH / psql / `\d <table>` / `SELECT FROM` / 觸發 cron / 受控 drift 製造 / migration 存在性驗證）放進 backend-only change 的 `## 人工檢查`；改寫進 `## N. Backend Verification Evidence` 由 apply Claude 自跑自貼（見「必填 Backend-only Manual Review 規約」）
## 與既有規則的關係

- **`proactive-skills.md` Design Gate**：本規則**擴充**而非取代。Design Gate 檢查 UI 視覺品質；UX Completeness 檢查 UI 功能覆蓋
- **`development.md` UI Reuse**：本規則**補充**。Reuse 檢查「是否重複寫了」；UX Completeness 檢查「是否漏改了既有的」
- **`migration.md`**：本規則**串聯**。migration 只是起點，後面還有 types + API + UI + navigation 四層

## 違反時的回報方式

hook 或 agent 偵測到違反時，輸出格式統一為：

```
[UX Gate] <檢查名稱> 不通過

問題：<一句話描述>

證據：
  - <檔案/行號/具體缺漏>

修正方式：
  - <具體步驟>

繞過：
  - 若此為刻意決定，加入 <繞過 marker>
```

**禁止** 捏造 journey、空洞的 entity matrix、或只為通過 gate 而寫的佔位內容。發現 → 當場 flag 給使用者。
