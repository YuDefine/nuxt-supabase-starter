---
description: Consumer 維護 docs/FIXTURES.md 作為「測試身分 / 樣本 UID / business key」speed reference；propose / ingest 階段引用此檔產生具體 sample inline，與 supabase/seed.sql cross-link
paths: ['docs/FIXTURES.md', 'docs/fixtures.md']
---
<!-- Clade native rule; source: rules/core/fixtures-reference.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Fixtures Reference（hard rule）

凡 consumer 含 `## 人工檢查` items 引用具體業務 sample（NFC UID / staff email / business key / entity ID）時，consumer **MUST** 維護 `docs/FIXTURES.md`（或 `docs/fixtures.md` lowercase fallback）作為「測試身分 / 樣本 UID / business key」速查表。

本規則是 [[manual-review.data-readiness]] 的配套契約：manual-review item inline 引用 sample 時 **MUST** 從 `docs/FIXTURES.md` 抓 stable identifier，避免「某張」「某筆」這種模糊指代。

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

Clade **不**規定 `docs/FIXTURES.md` 內容 schema，只規定該檔存在、含「測試身分」section（如 `## Test Identities` 下列 UID / Holder / Role / seed 行號）、與 seed cross-link。

## Cross-link with `supabase/seed.sql`

每條 `docs/FIXTURES.md` 列出的 sample **MUST** 在 seed file 有對應 INSERT row。建議於 `docs/FIXTURES.md` 條目旁標註 seed 行號或 anchor（如「seed.sql 第 N 行」或「seed.sql `-- kiosk_cards admin` anchor」）方便 cross-reference。

當 `## N. Fixtures / Seed Plan` task 新增 sample 時，必須**同時更新** `docs/FIXTURES.md` 與 `supabase/seed.sql`，否則 propose 階段 hygiene check 會撞「sample referenced but missing from seed」。

## Propagate 行為

`scripts/propagate.ts` 對缺 `docs/FIXTURES.md` 的 consumer emit **warning**（不 block），訊息會指名缺檔的 consumer 並要求補一份至少含「Test Identities」段的檔。Consumer owner 收到 warning 後在自家 ROADMAP／HANDOFF／`docs/tech-debt.md` 排補檔；clade 端不替 consumer 創建該檔（per-consumer 業務差異大）。
