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
| Before `spectra-propose`            | `bash scripts/spectra-ux/pre-propose-scan.sh`            | 注入 blast radius 要求，提醒必填區塊                            |
| After `spectra-propose`             | `bash scripts/spectra-ux/post-propose-check.sh <change>` | 驗證 proposal 完整性                                            |
| After `spectra-propose`             | `bash scripts/spectra-ux/design-inject.sh <change>`      | 若有 UI scope，提醒補上 `## Design Review` 區塊                 |
| Before `spectra-apply`              | `bash scripts/spectra-ux/pre-apply-brief.sh <change>`    | 簡報 user journeys                                              |
| During UI edits                     | `bash scripts/spectra-ux/ui-qa-reminder.sh <file>`       | 中途提醒 design / screenshot review，不要等到 archive 才檢查    |
| Before `spectra-archive`            | `bash scripts/spectra-ux/design-gate.sh <change>`        | 阻擋未完成人工檢查或缺設計審查證據的 UI change                  |
| Before `spectra-archive`            | `bash scripts/spectra-ux/archive-gate.sh <change>`       | 驗證 journey URL touch、schema drift、exhaustiveness            |
| Before `spectra-archive` (v1.5+)    | `bash scripts/spectra-ux/followup-gate.sh <change>`      | 驗證 tasks.md 的 `@followup[TD-NNN]` 都在 `docs/tech-debt.md` 登記 |
| **Session start / after `/assign`** | `pnpm spectra:roadmap` && `pnpm spectra:claims` && `pnpm spectra:followups` | 重算 ROADMAP、查看 active claims、摘要 follow-up 狀態 |

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
