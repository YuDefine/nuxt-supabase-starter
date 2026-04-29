---
audience: both
applies-to: post-scaffold
---

# 團隊協作工作流程

以實際情境說明多人開發時的分支策略、Migration 管理、衝突解決。

---

## 情境設定

- **Dev A**：負責「書籤」功能（新增 `bookmarks` 資料表）
- **Dev B**：負責「標籤」功能（新增 `tags` 資料表）
- 兩人同時在各自的 branch 開發

---

## Step 1：各自建立 Branch

```bash
# Dev A
git checkout -b feature/bookmarks
supabase migration new create_bookmarks

# Dev B
git checkout -b feature/tags
supabase migration new create_tags
```

此時各自的 `supabase/migrations/` 有新檔案：

```
Dev A: 20260314100000_create_bookmarks.sql
Dev B: 20260314100500_create_tags.sql
```

---

## Step 2：各自開發與測試

```bash
# 兩人各自執行
supabase db reset    # 確認 migration 可套用
pnpm test            # 確認測試通過
pnpm check           # 確認品質檢查通過
```

---

## Step 3：建立 Pull Request

```bash
# Dev A（先完成）
git add .
git commit -m "feat: 新增書籤功能"
git push origin feature/bookmarks
gh pr create --title "feat: 新增書籤功能"
```

### PR 的 CI 檢查項目

| 檢查     | 說明                                           |
| -------- | ---------------------------------------------- |
| validate | format + lint + typecheck + test               |
| e2e      | Playwright smoke test                          |
| database | `supabase db push --linked` + table owner 驗證 |

Dev A 的 PR 通過 CI，合併到 `main`。

---

## Step 4：Dev B 同步 main 並推 PR

```bash
# Dev B
git checkout main
git pull origin main
git checkout feature/tags
git rebase main
```

### 可能的情境

**情境 A：無衝突**（最常見）

兩個 migration 檔名不同、時間戳不同，自動合併成功：

```
supabase/migrations/
├── 20260314100000_create_bookmarks.sql  ← Dev A
└── 20260314100500_create_tags.sql       ← Dev B
```

```bash
supabase db reset  # 驗證兩個 migration 都能套用
```

**情境 B：Migration 衝突**（偶爾）

如果兩人修改了同一張表（例如都改 `profiles`），需要手動解決：

```bash
# Git 會顯示衝突
CONFLICT (content): Merge conflict in supabase/migrations/20260314100000_xxx.sql
```

**解決步驟**：

1. 檢查衝突內容：

```bash
git diff
```

2. 手動合併 SQL（保留兩邊的修改）

3. 驗證合併後的 migration：

```bash
supabase db reset  # 確認可以成功套用
pnpm db:types      # 重新產生型別
pnpm check         # 確認一切通過
```

4. 完成 rebase：

```bash
git add .
git rebase --continue
git push origin feature/tags --force-with-lease
```

---

## Step 5：遠端 Migration 衝突處理

如果遠端資料庫已有 Dev A 的 migration，但 Dev B 的 migration 時間戳更早：

```bash
# 檢查遠端 migration 狀態
supabase migration list --linked
```

```
LOCAL      REMOTE     TIME
Applied    Applied    20260314100000_create_bookmarks
Applied    Not Applied 20260314100500_create_tags     ← 需要推送
```

```bash
# 推送到遠端
supabase db push --linked
```

如果遇到衝突：

```bash
# 標記衝突的 migration 為 reverted
supabase migration repair --status reverted 20260314100500

# 修正後重新推送
supabase db push --linked
```

---

## Code Review 檢查清單

PR 審查時，確認以下項目：

- [ ] Migration SQL 語法正確
- [ ] 有函式時包含 `SET search_path = ''`
- [ ] RLS 政策包含 `service_role` bypass
- [ ] 新表已啟用 RLS（`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`）
- [ ] Client 端只有讀取，寫入走 Server API
- [ ] 新增環境變數已更新 `.env.example`
- [ ] `pnpm check` 通過
- [ ] 相關 `docs/verify/` 文件已更新

---

## 最佳實踐

1. **小步快跑**：每個 PR 只做一件事，避免大型合併
2. **先拉後推**：推送前先 `git pull --rebase` 同步最新 main
3. **早合併早安心**：完成的功能儘快合併，減少衝突機率
4. **命名一致**：Migration 檔名用動詞開頭（`create_`, `add_`, `alter_`）
5. **永遠驗證**：合併前 `supabase db reset && pnpm check`

---

## 相關文件

- [WORKFLOW.md](WORKFLOW.md) — 開發流程與 TDD
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md#11-migration-repair) — Migration 修復
- [FAQ.md](FAQ.md) — 團隊協作常見問題
