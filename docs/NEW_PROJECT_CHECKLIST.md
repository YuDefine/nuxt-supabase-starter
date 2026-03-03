# 新專案檢查清單

使用本 starter 建立新專案後，請確認以下項目都已完成。

## ✅ 基礎設定

- [ ] 已執行 `git init` 並建立初始 commit
- [ ] 已安裝 Node.js 20+、pnpm 9+、Docker
- [ ] 已安裝 Supabase CLI 和 Claude Code CLI
- [ ] 已複製 `.env.example` 到 `.env` 並填入環境變數

## ✅ Supabase 設定

- [ ] 已執行 `supabase init`
- [ ] 已執行 `supabase start` 並成功啟動
- [ ] 已產生 TypeScript 類型檔案 `app/types/database.types.ts`
- [ ] 已在 `.env` 填入 Supabase URL 和 Key

## ✅ 依賴安裝

- [ ] 已執行 `pnpm install` 安裝 npm 套件
- [ ] **已執行 `pnpm skills:install` 安裝 AI Skills**
- [ ] 執行 `pnpm skills:list` 確認已安裝約 20+ 個 skills

### Skills 檢查

執行 `pnpm skills:list`，應該包含：

**通用 Skills（從 skills.sh）：**

- [ ] vue
- [ ] vueuse-functions
- [ ] nuxt
- [ ] pinia
- [ ] vitepress
- [ ] vitest
- [ ] vue-best-practices
- [ ] supabase-postgres-best-practices
- [ ] nuxt-ui
- [ ] find-skills

**專案 Skills（本地）：**

- [ ] nuxt-better-auth
- [ ] supabase-rls
- [ ] supabase-migration
- [ ] server-api
- [ ] pinia-store
- [ ] OpenSpec skills（openspec-\*）

## ✅ Claude Code 設定

- [ ] 已複製 `.claude/settings.local.json.example` 到 `.claude/settings.local.json`
- [ ] 執行 `claude` 成功啟動 Claude Code
- [ ] 測試 `/tdd` 指令正常運作
- [ ] 測試執行 `pnpm check` 成功

## ✅ 開發環境驗證

- [ ] 執行 `pnpm dev` 成功啟動開發伺服器
- [ ] 瀏覽 http://localhost:3000 看到初始頁面
- [ ] 執行 `pnpm check` 全部通過（format → lint → typecheck → test）
- [ ] 執行 `pnpm test` 測試通過

## ✅ 文件檢查

- [ ] 已閱讀 [QUICK_START.md](./QUICK_START.md)
- [ ] 已瀏覽 [README.md](../README.md) 了解 Tech Stack
- [ ] 知道如何使用 `pnpm skills:update` 更新 skills
- [ ] 知道在哪裡查看 [SKILL_UPDATE_GUIDE.md](./SKILL_UPDATE_GUIDE.md)

## ✅ Git 設定（選用）

- [ ] 已設定 remote repository
- [ ] 已執行 `git add .` 和 `git commit`
- [ ] 已執行 `git push` 推送到遠端

## ⚠️ 常見問題

### Skills 沒有安裝完整？

```bash
# 重新安裝
pnpm skills:install

# 檢查列表
pnpm skills:list

# 應該看到約 20+ 個 skills
```

### Claude Code 無法使用指令？

1. 確認 `.claude/commands/` 目錄存在
2. 確認 `.claude/settings.local.json` 已建立
3. 重新啟動 `claude`

### Supabase 無法啟動？

1. 確認 Docker 正在執行
2. 執行 `supabase stop` 後再 `supabase start`
3. 查看錯誤訊息

## 🎯 下一步

完成所有檢查後：

1. 📖 閱讀 [SUPABASE_GUIDE.md](./SUPABASE_GUIDE.md) 建立第一個資料表
2. 🔐 參考 [Better Auth 文件](https://www.better-auth.com/) 設定 OAuth
3. 🤖 使用 `/opsx:new` 建立第一個功能
4. 📝 定期執行 `pnpm skills:update` 更新 skills
