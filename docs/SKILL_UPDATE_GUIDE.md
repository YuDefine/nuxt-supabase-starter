# Skill 更新指南

## 📋 已安裝的 Skills 清單

### 來自 skills.sh

所有 skills 統一從 [skills.sh](https://skills.sh) 安裝管理。

#### Antfu Skills (`antfu/skills@*`)

- `vue` - Vue 3 Composition API 最佳實踐
- `vueuse-functions` - VueUse 組合式函式
- `nuxt` - Nuxt 4 開發指引
- `pinia` - Pinia 狀態管理
- `vitepress` - VitePress 文件網站
- `vitest` - Vitest 測試框架
- `vue-best-practices` - Vue 程式碼品質

#### 官方 Skills

- `supabase-postgres-best-practices` (`supabase/agent-skills@*`) - Postgres 最佳實踐
- `nuxt-ui` (`nuxt/ui`) - Nuxt UI 組件

#### 實用工具

- `find-skills` (`vercel-labs/skills@*`) - 搜尋與發現 skills

### 保留的專案 Skills

這些 skills 沒有在 skills.sh 上的對應版本：

- `nuxt-better-auth` - Better Auth 整合
- `nuxt-content` - Nuxt Content 內容管理
- `nuxt-modules` - Nuxt 模組開發
- `nuxthub` - NuxtHub 部署
- `reka-ui` - Reka UI 無頭組件
- `ts-library` - TypeScript 函式庫
- `document-writer` - 文件撰寫
- `motion` - Motion Vue 動畫
- `server-api` - API 設計
- `supabase-arch` - Supabase 架構
- `supabase-migration` - Supabase Migration
- `supabase-rls` - Supabase RLS

### OpenSpec 工作流

所有 OpenSpec skills（來自專案倉庫）

## 🔄 更新所有 Skills（推薦方式）

### 快速指令

```bash
# 檢查是否有更新
pnpm skills:check

# 更新所有 skills
pnpm skills:update

# 查看已安裝的 skills
pnpm skills:list
```

### 詳細說明

#### 1. 檢查更新

```bash
pnpm skills:check
# 或
npx skills check
```

這會列出所有可以更新的 skills。

#### 2. 更新 Skills

```bash
pnpm skills:update
# 或
npx skills update
```

這會自動更新所有從 skills.sh 安裝的 skills。

#### 3. 驗證安裝

```bash
pnpm skills:list
# 或
npx skills list
```

查看所有已安裝的 skills 及其版本。

## 📦 初次安裝 / 重新安裝

### 備份現有 skills

```bash
pnpm skills:backup
```

### 安裝所有 skills

```bash
pnpm skills:install
```

這會執行 `scripts/install-skills.sh`，自動安裝所有來自 skills.sh 的 skills。

## 🛠️ 可用的 Scripts

在 `package.json` 中定義：

| Script           | 指令                  | 說明                        |
| ---------------- | --------------------- | --------------------------- |
| `skills:backup`  | `pnpm skills:backup`  | 備份當前 skills（帶時間戳） |
| `skills:check`   | `pnpm skills:check`   | 檢查 skills 更新            |
| `skills:install` | `pnpm skills:install` | 安裝所有 skills             |
| `skills:list`    | `pnpm skills:list`    | 列出已安裝的 skills         |
| `skills:update`  | `pnpm skills:update`  | 更新所有 skills             |

## 📝 更新檢查清單

- [ ] 執行 `pnpm skills:backup` 備份
- [ ] 執行 `pnpm skills:check` 檢查更新
- [ ] 執行 `pnpm skills:update` 更新
- [ ] 執行 `pnpm skills:list` 驗證
- [ ] 重啟 Claude Code CLI
- [ ] 測試常用 skills 是否正常運作
- [ ] 記錄在版本歷史

## 📅 推薦更新頻率

| Skill 類型       | 更新頻率  | 指令                 |
| ---------------- | --------- | -------------------- |
| skills.sh Skills | 每月      | `pnpm skills:update` |
| 專案 Skills      | 手動      | 視專案需求           |
| OpenSpec         | 跟隨 repo | Git pull             |

## 🔍 查找新的 Skills

使用 `find-skills` skill：

```bash
# 在 Claude Code 中
/find-skills react performance

# 或直接用 CLI
npx skills find react performance
```

瀏覽所有可用的 skills：[https://skills.sh](https://skills.sh)

## ⚠️ 注意事項

1. **統一來源**：優先使用 skills.sh 上的 skills
2. **備份優先**：更新前一定要備份
3. **測試驗證**：更新後測試常用功能
4. **保留專案 Skills**：不要移除專案特定的 skills
5. **定期更新**：每月檢查並更新一次

## 🔙 回滾方式

如果更新後出現問題：

```bash
# 方法 1: 從備份還原
ls .claude/skills.backup.*  # 列出所有備份
cp -r .claude/skills.backup.20260210-123456 .claude/skills

# 方法 2: 使用 Git（如果 skills 有加入版本控制）
git checkout .claude/skills/
```

## 📊 版本歷史

### 2026-02-10

- 🔄 統一使用 skills.sh 管理所有 skills
- ✅ 新增 `skills:*` scripts 到 package.json
- 📝 建立 `scripts/install-skills.sh` 自動安裝腳本
- 📋 整理 skills 清單，區分 skills.sh 與專案 skills
- 🎯 確立更新策略：`pnpm skills:update`
