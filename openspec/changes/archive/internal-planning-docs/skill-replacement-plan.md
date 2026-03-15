# Skills 替換計劃 - 統一使用 skills.sh

## 目標

將所有 skills 改為從 [skills.sh](https://skills.sh) 安裝，使用統一的更新機制。

## 📋 替換清單

### ✅ 從 Antfu Skills 替換

| 現有 Skill  | skills.sh 來源                  | 安裝指令                                                                             |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| vue         | `antfu/skills@vue`              | `npx skills add antfu/skills@vue -y`                                                 |
| vueuse      | `antfu/skills@vueuse-functions` | `npx skills add antfu/skills@vueuse-functions -y`                                    |
| nuxt        | `antfu/skills` (nuxt)           | `npx skills add https://github.com/antfu/skills --skill nuxt --agent claude-code -y` |
| pinia-store | `antfu/skills@pinia`            | `npx skills add antfu/skills@pinia -y`                                               |
| vitepress   | `antfu/skills@vitepress`        | `npx skills add antfu/skills@vitepress -y`                                           |

### ✅ 新增 Antfu Skills

| Skill                | 用途             | 安裝指令                                            |
| -------------------- | ---------------- | --------------------------------------------------- |
| `vitest`             | 測試框架最佳實踐 | `npx skills add antfu/skills@vitest -y`             |
| `vue-best-practices` | Vue 程式碼品質   | `npx skills add antfu/skills@vue-best-practices -y` |

### ✅ 從官方來源替換

| 現有 Skill              | skills.sh 來源                                           | 安裝指令                                                                   |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| postgres-best-practices | `supabase/agent-skills@supabase-postgres-best-practices` | `npx skills add supabase/agent-skills@supabase-postgres-best-practices -y` |
| nuxt-ui                 | `nuxt/ui`                                                | `npx skills add nuxt/ui --agent claude-code -y`                            |

### ⚠️ 保留專案特定 Skills

這些 skills 沒有在 skills.sh 上找到對應版本，暫時保留：

- `nuxt-better-auth` - 專案特定 auth 整合
- `nuxt-content` - 如果使用 Nuxt Content
- `nuxt-modules` - 模組開發指引
- `nuxthub` - NuxtHub 部署
- `reka-ui` - UI 組件庫
- `ts-library` - TypeScript 函式庫開發
- `document-writer` - 文件撰寫
- `motion` - 動畫效果
- `server-api` - API 開發
- `supabase-arch` - Supabase 架構
- `supabase-migration` - Supabase Migration
- `supabase-rls` - Supabase RLS

### 🔄 Spectra Skills

保留所有 Spectra 工作流 skills（來自專案倉庫）

## 🚀 執行步驟

### 1. 備份現有 skills

```bash
# 執行自動備份腳本
pnpm skills:backup
```

### 2. 移除舊版本並安裝新版本

```bash
# 執行自動替換腳本
pnpm skills:install
```

### 3. 驗證安裝

```bash
# 列出所有已安裝的 skills
npx skills list

# 檢查 skills 狀態
pnpm skills:check
```

### 4. 測試 Skills

重啟 Claude Code CLI，測試常用 skills 是否正常運作。

## 📦 package.json Scripts

新增以下 scripts 到 `package.json`：

```json
{
  "scripts": {
    "skills:backup": "cp -r .claude/skills .claude/skills.backup.$(date +%Y%m%d-%H%M%S)",
    "skills:install": "./scripts/install-skills.sh",
    "skills:update": "npx skills update",
    "skills:check": "npx skills check",
    "skills:list": "npx skills list"
  }
}
```

## 🔄 未來更新方式

### 檢查更新

```bash
pnpm skills:check
```

### 更新所有 skills

```bash
pnpm skills:update
```

### 查看已安裝的 skills

```bash
pnpm skills:list
```

## 📝 注意事項

1. **備份優先**：執行替換前一定要備份
2. **逐步驗證**：安裝後測試每個 skill 是否正常
3. **保留專案 Skills**：不要移除專案特定的 skills
4. **統一管理**：未來所有 skills 都從 skills.sh 安裝

## 🎯 預期效果

- ✅ 統一的更新機制（`npx skills update`）
- ✅ 更好的版本管理
- ✅ 來自官方/作者的最新版本
- ✅ 簡化的維護流程

## 📊 安裝後檢查清單

- [ ] 執行 `pnpm skills:backup` 備份
- [ ] 執行 `pnpm skills:install` 安裝
- [ ] 執行 `pnpm skills:list` 驗證
- [ ] 重啟 Claude Code CLI
- [ ] 測試常用 skills（vue, nuxt, postgres）
- [ ] 更新 CLAUDE.md 中的 AI Skills 表格
- [ ] 記錄在版本歷史
