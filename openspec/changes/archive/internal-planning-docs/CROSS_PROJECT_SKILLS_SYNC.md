# 跨專案 Skills 同步指南

本文件說明如何在多個專案間同步 skills 設定。

## 專案清單

| 專案                  | 路徑                              | 狀態      |
| --------------------- | --------------------------------- | --------- |
| nuxt-supabase-starter | `~/offline/nuxt-supabase-starter` | ✅ 已配置 |
| TDMS                  | `~/offline/TDMS`                  | ✅ 已配置 |
| eHR-2.0               | `~/offline/eHR-2.0`               | ✅ 已配置 |

## 已完成的配置

### 1. 安裝腳本

所有專案都已建立 `scripts/install-skills.sh`，這是 skills 清單的**單一事實來源（Single Source of Truth）**。新增或移除 skill 時，請直接修改此腳本，再執行 `pnpm skills:install` 同步。

```bash
# 內容相同，安裝以下 skills：
- Antfu Skills (8個)
- Onmax Nuxt Skills (9個)
- 官方 Skills (2個)
- TDD (1個)
- Evlog (4個)
- 工具 (1個)
```

### 2. package.json Scripts

所有專案都已加入：

```json
{
  "skills:backup": "備份當前 skills",
  "skills:check": "檢查更新",
  "skills:install": "安裝所有 skills",
  "skills:list": "列出已安裝的 skills",
  "skills:update": "一鍵更新"
}
```

### 3. 文件

所有專案都已建立：

- `docs/SKILL_UPDATE_GUIDE.md` - 完整更新指南（從 starter 複製）
- `docs/SKILLS.md` - 快速參考（針對各專案客製化）

## 使用方式

### 在任何專案中更新 skills

```bash
# 1. 進入專案目錄
cd ~/offline/TDMS
# 或
cd ~/offline/eHR-2.0

# 2. 檢查更新
pnpm skills:check

# 3. 一鍵更新
pnpm skills:update
```

### 初次安裝（新專案或重新安裝）

```bash
# 在專案目錄下執行
pnpm skills:install
```

## Skills 清單

### 通用 Skills（所有專案共用）

從 skills.sh 安裝，所有專案都相同：

| Skill                            | 來源                  |
| -------------------------------- | --------------------- |
| vue                              | antfu/skills          |
| vueuse-functions                 | antfu/skills          |
| nuxt                             | antfu/skills (GitHub) |
| pinia                            | antfu/skills          |
| vitepress                        | antfu/skills          |
| vitest                           | antfu/skills          |
| vue-best-practices               | antfu/skills          |
| supabase-postgres-best-practices | supabase/agent-skills |
| nuxt-ui                          | nuxt/ui               |
| find-skills                      | vercel-labs/skills    |

### 專案特定 Skills

#### nuxt-supabase-starter

- nuxt-better-auth, nuxt-content, nuxt-modules, nuxthub
- reka-ui, motion, ts-library, document-writer
- server-api, pinia-store
- supabase-arch, supabase-migration, supabase-rls
- spectra-\* (所有 Spectra skills)

#### TDMS

- auth-integration.md
- data-table.md
- add-table-column.md
- spectra-\* (所有 Spectra skills)
- nuxt, nuxt-modules, nuxt-ui

#### eHR-2.0

- document-writer, motion
- nuxt-content, nuxt-modules, nuxthub
- spectra-\* (所有 Spectra skills)
- nuxt, nuxt-ui

## 維護建議

### 每月例行

```bash
# 在所有專案執行
for project in nuxt-supabase-starter TDMS eHR-2.0; do
  echo "=== Updating $project ==="
  cd ~/offline/$project
  pnpm skills:update
done
```

### 同步專案特定 Skills

如果在某個專案建立了有用的專案 skill，可以手動複製到其他專案：

```bash
# 例如：將 TDMS 的 data-table.md 複製到其他專案
cp ~/offline/TDMS/.claude/skills/data-table.md \
   ~/offline/nuxt-supabase-starter/.claude/skills/
```

### 更新 install-skills.sh

如果發現新的有用 skill，更新所有專案的 `scripts/install-skills.sh`：

```bash
# 在 install-skills.sh 中加入
npx skills add owner/repo@new-skill -y
```

## 疑難排解

### Skills 沒有正確安裝

```bash
# 1. 備份現有 skills
pnpm skills:backup

# 2. 重新安裝
pnpm skills:install

# 3. 驗證
pnpm skills:list
```

### 某個專案的 skills 版本不一致

```bash
# 強制更新該專案
cd ~/offline/PROJECT_NAME
pnpm skills:update
```

### 需要回滾到舊版本

```bash
# 查看備份
ls .claude/skills.backup.*

# 從備份還原
cp -r .claude/skills.backup.20260210-123456 .claude/skills
```

## 版本歷史

### 2026-02-10

- ✅ 為 TDMS 和 eHR-2.0 建立 skills 管理機制
- ✅ 統一所有專案使用 skills.sh
- ✅ 建立 `scripts/install-skills.sh`
- ✅ 新增 `skills:*` scripts 到 package.json
- ✅ 建立各專案的 SKILLS.md 快速參考
- ✅ 複製 SKILL_UPDATE_GUIDE.md 到各專案
