# 常見疑問集（FAQ）

開發過程中常見問題的集中解答。

---

## 工具選擇類

### Spec-Kit vs Plan Mode：何時使用哪個？

| 面向           | Spec-Kit                                               | Claude Code Plan Mode      |
| -------------- | ------------------------------------------------------ | -------------------------- |
| **流程**       | 多階段（specify → clarify → plan → tasks → implement） | 單階段規劃                 |
| **成果**       | 4+ 個檔案（spec.md, plan.md, tasks.md, checklist.md）  | 單一 plan.md               |
| **內建驗證**   | ✅ clarify（澄清需求）+ analyze（一致性分析）          | ❌ 無                      |
| **適用場景**   | 複雜功能、多人協作、需求不明確                         | 小修改、快速迭代、需求明確 |
| **上下文保留** | 持久化到檔案，可跨對話                                 | 僅在當次對話               |

**選擇指南**：

| 情境                         | 推薦                 |
| ---------------------------- | -------------------- |
| 功能需要 **3+ 個檔案變更**   | Spec-Kit             |
| 需求**可能變化**或不明確     | Spec-Kit             |
| 需要**多人審閱**計畫         | Spec-Kit             |
| **Bug 修復**、單檔變更       | Plan Mode            |
| **緊急部署**、時間緊迫       | 直接實作             |
| 需求**非常明確**，已知怎麼做 | Plan Mode 或直接實作 |

**範例**：

- 「新增使用者管理模組」→ Spec-Kit（多檔案、需規劃）
- 「修正登入按鈕顏色」→ 直接實作
- 「重構 API 錯誤處理」→ Plan Mode（影響多處但邏輯明確）

---

### VitePress 在專案中的意義？

**用途**：將 `docs/` 目錄的 Markdown 轉換為可瀏覽的文件網站。

**為什麼要用？**

- 方便分享給團隊成員
- 提供搜尋功能
- 更好的閱讀體驗

**命令**：

```bash
pnpm docs:dev    # 本地預覽（http://localhost:5173）
pnpm docs:build  # 建置靜態網站
```

**目前狀態**：使用 VitePress 預設配置。如需客製化，可建立 `.vitepress/config.ts`。

---

### nuxt-skills 如何自動更新？

**兩種 Skill 類型**：

| 類型        | 數量  | 更新方式                                                            |
| ----------- | ----- | ------------------------------------------------------------------- |
| 技術 Skills | 12 個 | [nuxt-skills](https://github.com/onmax/nuxt-skills) plugin 自動同步 |
| 情境 Skills | 5 個  | 本地維護，手動更新                                                  |

**技術 Skills 更新流程**：

1. GitHub Actions 定期執行（或手動觸發）
2. 從 nuxt-skills repo 拉取最新版本
3. 更新到 `.claude/skills/` 目錄
4. 提交 PR 或自動合併

**情境 Skills 何時需要更新？**

- 專案架構變更時
- 發現更好的實踐模式時
- RLS/Migration 規則調整時

---

### Claude Code 需要付費嗎？推薦什麼方案？

**推薦方案**：[Claude Code Max](https://claude.ai/code)（每月 $100 美元起）

**為什麼？**

本範本大量使用 Claude Opus 4.5 模型進行：

- 複雜的程式碼生成與重構
- 多檔案同時編輯
- 資料庫 migration 設計
- spec-kit 結構化開發

| 方案       | 每月費用 | Opus 用量 | 適合                 |
| ---------- | -------- | --------- | -------------------- |
| Pro        | $20      | 有限      | 輕度使用、學習       |
| **Max 5x** | **$100** | **充足**  | **日常開發**（推薦） |
| Max 20x    | $200     | 大量      | 密集開發、團隊共用   |

> **實際經驗**：2.5 個月開發中使用了 2,500+ 次 Claude 對話。若使用 Pro 方案，會頻繁遇到 Opus 配額限制，被迫切換到 Sonnet 模型。Max 5x 方案足以支撐日常開發。

---

### Commands、Agents、Skills 的差別？

| 類型         | 觸發方式                  | 用途         | 範例                                  |
| ------------ | ------------------------- | ------------ | ------------------------------------- |
| **Commands** | 使用者輸入 `/xxx`         | 執行特定流程 | `/commit`, `/tdd`, `/speckit.specify` |
| **Agents**   | 自動觸發或被 Command 呼叫 | 執行子任務   | check-runner, post-implement          |
| **Skills**   | 自動偵測情境載入          | 提供專業知識 | supabase-rls, server-api              |

**類比**：

- Commands = 你下達的指令
- Agents = 執行指令的機器人
- Skills = 機器人的專業知識

---

## 開發實務類

### Client 和 Server 如何分工？

**核心原則**：**Client 讀、Server 寫**

| 操作     | 位置   | 方式                                                    |
| -------- | ------ | ------------------------------------------------------- |
| **讀取** | Client | `useSupabaseClient<Database>().from('table').select()`  |
| **寫入** | Server | `$fetch('/api/v1/resources', { method: 'POST', body })` |

**為什麼？**

1. RLS 已保護讀取操作
2. 寫入需要集中管理（權限檢查、日誌、業務邏輯）
3. 讀多寫少，Client 直連減少延遲

**詳細說明**：見 [CLAUDE.md](../CLAUDE.md#-supabase-資料存取策略)

---

### 認證該用什麼 API？

**正確方式**：

```typescript
// Client 端
const { user, loggedIn, signIn, signOut } = useUserSession()

// Server 端
// 使用 better-auth 提供的方式取得 session
```

**錯誤方式**（絕對禁止）：

```typescript
// ❌ 這是舊的 Supabase Auth，本專案不使用
const user = useSupabaseUser()
const user = await serverSupabaseUser(event)
```

**詳細說明**：見 [AUTH_INTEGRATION.md](verify/AUTH_INTEGRATION.md)

---

### Migration 怎麼建立？

**Local-First 原則**：所有 migration 必須先在本地建立、測試通過後，再 push 到 remote。

```bash
# 1. 建立 migration
supabase migration new add_user_roles

# 2. 編輯 migration 檔案（在 supabase/migrations/ 下）

# 3. 本地測試
supabase db reset

# 4. 安全檢查
supabase db lint --level warning

# 5. 重新產生類型
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null

# 6. 最後才 push
supabase db push
```

**禁止事項**：

- ❌ 不要手動建立 `.sql` 檔案
- ❌ 不要用 `mcp__remote-supabase__apply_migration`
- ❌ 不要修改已套用的 migration

**詳細說明**：見 [SUPABASE_MIGRATION_GUIDE.md](verify/SUPABASE_MIGRATION_GUIDE.md)

---

### RLS Policy 要注意什麼？

**關鍵重點**：API 寫入操作的 RLS policy 必須包含 `service_role` 繞過！

```sql
CREATE POLICY "Allow manager update" ON your_schema.table FOR UPDATE
USING (
  (SELECT auth.role()) = 'service_role'  -- ⚠️ 必須加這行！
  OR your_schema.current_user_role() IN ('admin', 'manager')
);
```

**詳細說明**：見 [RLS_BEST_PRACTICES.md](verify/RLS_BEST_PRACTICES.md)

---

### Function 的 search_path 要怎麼設定？

**必須使用空字串**：

```sql
CREATE OR REPLACE FUNCTION your_schema.my_function()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''  -- 必須是空字串！
AS $$ BEGIN
  SELECT * FROM your_schema.users WHERE id = auth.uid();
END; $$;
```

**禁止**：`SET search_path = public, pg_temp`

---

## 疑難排解類

### Toast 成功但資料沒變

**原因**：缺少對應的 RLS policy

**解決**：

1. 檢查是否有該操作（INSERT/UPDATE/DELETE）的 RLS policy
2. 確認 policy 包含 `service_role` 繞過
3. 使用 `supabase db lint --level warning` 檢查

---

### API 回傳 HTML 而非 JSON

**原因**：路由衝突

**常見情況**：同目錄下同時存在 `[id].ts` 和 `[id]/xxx.ts`

**解決**：調整路由結構，避免衝突

---

### pnpm check 失敗

**原因**：可能是 format、lint、typecheck 或 test 任一環節失敗

**解決**：

1. 看錯誤訊息判斷是哪個環節
2. 逐一修復
3. 重新執行 `pnpm check`

**各環節單獨執行**：

```bash
pnpm format     # 格式化
pnpm lint       # Lint 檢查
pnpm typecheck  # 類型檢查
pnpm test       # 測試
```

---

### Supabase 本地環境連不上

**檢查清單**：

1. Docker 是否在運行？
2. 執行 `supabase status` 確認服務狀態
3. 檢查 `.env` 的 `SUPABASE_URL` 是否正確（應為 `http://127.0.0.1:54321`）

**重啟方式**：

```bash
supabase stop
supabase start
```

---

### 類型錯誤：找不到 Database 類型

**原因**：`app/types/database.types.ts` 可能過時或不存在

**解決**：

```bash
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
```

---

## 架構決策類

### 該用 RPC 還是 Edge Function？

**快速決策**：

| 情境              | 推薦          |
| ----------------- | ------------- |
| 純資料庫操作      | RPC           |
| 需要外部 API 呼叫 | Edge Function |
| 需要複雜業務邏輯  | Edge Function |
| 效能敏感的查詢    | RPC           |
| 需要檔案處理      | Edge Function |

**詳細決策樹**：見 `.claude/skills/supabase-arch/SKILL.md`

---

### Pinia Store 該怎麼設計？

**核心原則**：

- 使用 Composition API 風格
- State 使用 `readonly()` 保護
- 透過 actions 修改 state

**範例**：見 [PINIA_ARCHITECTURE.md](verify/PINIA_ARCHITECTURE.md)

---

## 還有問題？

1. 搜尋 `docs/` 目錄的其他文件
2. 查看 [CLAUDE.md](../CLAUDE.md) 的相關章節
3. 使用 Claude Code 詢問（它會參考專案的 Skills 和規範）
