---
description: Consumer 維護 docs/FIXTURES.md 作為「測試身分 / 樣本 UID / business key」speed reference；propose / ingest 階段引用此檔產生具體 sample inline，與 supabase/seed.sql cross-link
paths: ['docs/FIXTURES.md', 'docs/fixtures.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/fixtures-reference.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Fixtures Reference（hard rule）

凡 consumer 含 `## 人工檢查` items 引用具體業務 sample（NFC UID / staff email / business key / entity ID）時，consumer **MUST** 維護 `docs/FIXTURES.md`（或 `docs/fixtures.md` lowercase fallback）作為「測試身分 / 樣本 UID / business key」速查表。

本規則是 `manual-review.md`「Pre-Review Data Readiness」與「`[review:ui]` 純功能驗證 step actionability」hard rule 的配套契約 — propose 寫作者在 manual-review item inline 引用 sample 時 **MUST** 從 `docs/FIXTURES.md` 抓 stable identifier，避免「某張」「某筆」「找一張」這種模糊指代。

## MUST

- **MUST** 維護 `docs/FIXTURES.md` 在 consumer root（或 `docs/fixtures.md` lowercase fallback）
- **MUST** 至少含「測試身分」section（標題如 `## Test Identities` 或 `## 測試身分`），列出 dev / staging 環境下 review 階段會用到的：
  - NFC / 員工卡 UID 與對應的 holder name + role
  - Staff email + role + organization
  - Business key samples（work_report id / loan id / equipment id 等）對應的 status / fixture 預期狀態
- **MUST** propose / ingest 階段在寫 `[review:ui]` / `[verify:ui]` item 前先 Read `docs/FIXTURES.md` 抓 sample identifier
- **MUST** 任何 sample 在 manual-review item inline 引用時，**MUST** 在 `supabase/seed.sql`（或專案等價 seed file，per `manual-review.md`「Pre-Review Data Readiness」§必填三件事 §3）持久化
- **MUST** `docs/FIXTURES.md` 列出的 sample 與 seed file 的 INSERT row 一字不差（key field、identifier、stable PK）

## NEVER

- **NEVER** 在 manual-review item inline sample 但 seed 沒對應 row（review 階段會撞 fixture miss）
- **NEVER** 用 dev DB ad-hoc INSERT 的 sample 作 inline 引用（reset DB 就消失，下個接手者重踩坑）
- **NEVER** 寫「請使用測試員工 X」要求 user 自找
- **NEVER** 在 `docs/FIXTURES.md` 寫 production 真實員工 / 真實客戶資料（test fixtures 限於合成 / anonymized 樣本）
- **NEVER** 為了 review 方便動 production 資料庫（fixture 屬 codebase 層，不該污染 production）

## Schema（per-consumer 自治）

Clade 中央倉 **不**規定 `docs/FIXTURES.md` 內容 schema — per-consumer 業務差異大（kiosk UID 結構、staff role 命名、business key 命名規約都不同）。Clade 只規定該檔 **必須** 存在、必須含「測試身分」section、必須與 seed cross-link。

範例（TDMS 風格，可參考但非強制）：

```markdown
# Fixtures Reference

## Test Identities

### NFC 員工卡

| UID | Holder | Role | Notes |
| --- | --- | --- | --- |
| `04A1B2C3` | 測試 Admin | admin | seed.sql 第 12 行 |
| `04469C0FCB2A81` | 淑貞 | staff | seed.sql 第 18 行 |
| `047D6201CC2A81` | flat_burr 治具 | tool | seed.sql 第 22 行 |

### Staff Email

| Email | Role | Org |
| --- | --- | --- |
| `admin@example.com` | admin | TDMS-DEV |
| `staff@example.com` | staff | TDMS-DEV |

## Work Report 範例

| ID | Status | 用途 |
| --- | --- | --- |
| `WR-9001` | voided | 互斥狀態驗收（不可 Archive） |
| `WR-9002` | archived | 互斥狀態驗收（不可 Void） |
| `WR-9003` | active | 一般 round-trip |
```

## Cross-link with `supabase/seed.sql`

每條 `docs/FIXTURES.md` 列出的 sample **MUST** 在 seed file 有對應 INSERT row。建議於 `docs/FIXTURES.md` 條目旁標註 seed 行號或 anchor（如「seed.sql 第 N 行」或「seed.sql `-- kiosk_cards admin` anchor」）方便 cross-reference。

當 `## N. Fixtures / Seed Plan` task 新增 sample 時，必須**同時更新** `docs/FIXTURES.md` 與 `supabase/seed.sql`，否則 propose 階段 hygiene check 會撞「sample referenced but missing from seed」。

## Propagate 行為

`scripts/propagate.mjs` 對缺 `docs/FIXTURES.md` 的 consumer emit **warning**（不 block）：

```
⚠ propagate: <consumer-name> missing docs/FIXTURES.md
  Required by clade/rules/core/fixtures-reference.md
  Per-consumer follow-up: create the file with at least a「Test Identities」section
  before next /spectra-propose containing [review:ui] items with sample references.
```

Consumer owner 收到 warning 後在自家 ROADMAP / HANDOFF / docs/tech-debt.md 排補檔。clade 端不替 consumer 創建該檔（per-consumer 業務差異大）。

## 與 `manual-review.md` Pre-Review Data Readiness 的關係

| Manual-review hard rule | Fixtures contract enforcement |
| --- | --- |
| 「禁止模糊指代」(`某張` / `某筆` / `find a record`) | `docs/FIXTURES.md` 提供具體 ID 可以引用 |
| 「Sample inline 引用」 | `docs/FIXTURES.md` 是 ID 的 stable source |
| 「Sample 持久化寫進 seed」 | `docs/FIXTURES.md` ↔ `supabase/seed.sql` cross-link enforce |
| 「kiosk 刷卡 round-trip」範例 UID `04A1B2C3` | 來自 `docs/FIXTURES.md` NFC 卡 section |

完整 manual-review 規約見 `manual-review.md`「Pre-Review Data Readiness」+「`[review:ui]` 純功能驗證 step actionability」。本規則只 scope 在「fixtures speed reference contract」這一層，不重複 manual-review 的所有規則。
