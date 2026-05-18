# Fixtures Reference

> **Template 說明**：此檔是 nuxt-supabase-starter template 的一部分，scaffold 出新 consumer 時會一併 inherit。新 consumer 應依自家業務改寫：替換 demo 帳號為真實測試身分、補充業務樣本資料（work order ID、entity key 等）、移除本段說明文字。

---

## 測試身分

### Auth Users（seed.sql 第 7–51 行）

| Email               | ID（UUID 前段） | Role  | 密碼          |
| ------------------- | --------------- | ----- | ------------- |
| `admin@example.com` | `a1111111-...`  | admin | `password123` |
| `user1@example.com` | `b2222222-...`  | user  | `password123` |
| `user2@example.com` | `c3333333-...`  | user  | `password123` |

### Profiles（seed.sql 第 89–94 行）

| ID（UUID 前段） | display_name | role  |
| --------------- | ------------ | ----- |
| `a1111111-...`  | 管理員       | admin |
| `b2222222-...`  | 測試使用者一 | user  |
| `c3333333-...`  | 測試使用者二 | user  |

> 完整 UUID：見 `template/supabase/seed.sql` 各 INSERT 區塊的 id 欄位。密碼以 `crypt('password123', gen_salt('bf'))` 儲存，登入時填明文 `password123`。

---

## 樣本資料

_待補_：scaffold 後依業務新增（例：work order ID、tenant key、entity PK 等）。  
每筆 sample 必須對應 `supabase/seed.sql` INSERT row，並在此標記行號或 anchor。

---

## 環境連線

| 項目                 | 值                                                        |
| -------------------- | --------------------------------------------------------- |
| Local Supabase URL   | `http://localhost:54321`                                  |
| Supabase Studio      | `http://localhost:54323`                                  |
| Inbucket（測試信箱） | `http://localhost:54324`                                  |
| DB 連線（直連）      | `postgresql://postgres:postgres@localhost:54322/postgres` |

> Port 以 `supabase status` 輸出為準；若有改動請同步更新此表。

---

## 常用指令

```bash
pnpm db:reset    # 清空 DB + 重跑 migrations + seed（scripts/db-reset.sh）
pnpm db:types    # 從 local Supabase 重新產生 TypeScript 型別（scripts/db-types.sh）
pnpm db:diff     # 比對 schema drift（supabase db diff）
```

---

## 回饋迴路（給 Claude）

1. `Read docs/FIXTURES.md` — 確認 sample 存在且與 seed 一致
2. `/spectra-propose` 或 `[review:ui]` item 引用 sample 時，直接用上表 Email / UUID 前段 / display_name，禁止寫「某位使用者」「找一筆」
3. 若需新增 sample：**同時**更新 `supabase/seed.sql`（加 INSERT row）與本檔（加表格行 + 標 seed 行號）
4. DB reset 後驗證：`pnpm db:reset` → 以 `admin@example.com` / `password123` 登入確認 seed 生效

---

## 給新 consumer 的客製化指引

scaffold 後，依以下步驟改寫此檔：

1. **替換測試身分**：把 demo email / UUID 換成你的業務測試帳號；若有 NFC 員工卡 / tenant key / 組織 ID，補對應 section
2. **補充業務樣本**：在「樣本資料」section 加入你的核心 entity（work order、invoice、product 等），每筆標 seed 行號
3. **對齊 seed.sql**：確保本檔每一筆 sample 都在 `supabase/seed.sql` 有對應 INSERT row，`pnpm db:reset` 後可重現
4. **移除 Template 說明**：刪除本檔頂部的「Template 說明」引言段
5. **更新環境連線**：若改了 Supabase port 設定，同步更新「環境連線」表

---

## 相關規則

- `clade/rules/core/fixtures-reference.md` — 本檔的 hard rule 契約（MUST / NEVER 清單）
- `template/supabase/seed.sql` — 所有 sample 的唯一 source of truth
- `template/docs/AGENTS.md` — AI agent 操作邊界說明
