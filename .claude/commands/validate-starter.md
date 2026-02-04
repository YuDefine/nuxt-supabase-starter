---
name: Validate Starter
description: 驗證 starter template 的完整性與文件一致性
---

# Validate Starter Template

依照 `docs/QUICK_START.md` 指引，從建立新專案起驗證：
1. 文件描述與實際結構是否一致
2. Package 是否完善無報錯
3. Tech Stack 是否完整安裝

## Instructions

### Phase 1: 建立測試專案

```bash
TEST_DIR="/tmp/starter-validation-$(date +%s)"
git clone . "$TEST_DIR" && cd "$TEST_DIR" && rm -rf .git && git init
```

在 `$TEST_DIR` 執行以下所有驗證。

### Phase 2: 結構驗證

對照 `docs/QUICK_START.md` 的「你得到了什麼」章節，逐一檢查：

**.claude/ 結構**：
- [ ] `commands/` 存在且包含 `opsx/` 子目錄
- [ ] `agents/` 存在
- [ ] `hooks/` 存在
- [ ] `skills/` 存在
- [ ] `settings.local.json.example` 存在

**openspec/ 結構**：
- [ ] `project.md` 存在
- [ ] `specs/` 存在
- [ ] `changes/` 存在
- [ ] `changes/archive/` 存在

**app/ 結構**：
- [ ] `app.vue` 存在
- [ ] `assets/css/` 存在
- [ ] `auth.config.ts` 存在
- [ ] `pages/` 存在
- [ ] `types/database.types.ts` 存在

**server/ 結構**：
- [ ] `auth.config.ts` 存在
- [ ] `utils/supabase.ts` 存在

### Phase 3: 文件一致性

搜尋所有描述目錄結構的文件：

```bash
grep -n "├──\|└──" docs/QUICK_START.md docs/CLAUDE_CODE_GUIDE.md README.md
```

比對每個描述的項目與實際結構，標記不一致處。

### Phase 4: Package 安裝

```bash
pnpm install
```

確認無錯誤、無嚴重警告。

### Phase 5: Tech Stack 驗證

根據 `README.md` 和 `docs/QUICK_START.md` 檢查 `package.json`：

**Core Framework**：
- [ ] `nuxt`
- [ ] `vue`
- [ ] `typescript`

**UI & Styling**：
- [ ] `@nuxt/ui`
- [ ] `tailwindcss`
- [ ] `@nuxt/fonts`

**State Management**：
- [ ] `pinia`
- [ ] `@pinia/colada`
- [ ] `@vueuse/nuxt`

**Database & Auth**：
- [ ] `@nuxtjs/supabase`
- [ ] `@onmax/nuxt-better-auth`

**Testing & Quality**：
- [ ] `vitest`
- [ ] `@nuxt/test-utils`
- [ ] `oxlint`

**Deployment**：
- [ ] `@nuxthub/core`

### Phase 6: Build & Test

```bash
pnpm typecheck  # 必須成功
pnpm test       # 必須成功
pnpm check      # 必須成功（如果 supabase 未啟動，部分測試可跳過）
```

### Phase 7: Commands 驗證

列出所有命令並確認數量：

```bash
find .claude/commands -name "*.md" | wc -l
# 預期：14 個以上
```

預期命令清單：
- `commit.md`, `db-migration.md`, `doc-sync.md`, `tdd.md`
- `opsx/`: `new.md`, `apply.md`, `archive.md`, `continue.md`, `explore.md`, `ff.md`, `verify.md`, `sync.md`, `onboard.md`, `bulk-archive.md`

## Output

輸出驗證報告：

```markdown
## Starter Validation Report

**測試目錄**: $TEST_DIR
**來源 Commit**: $(git rev-parse --short HEAD)

### 結構驗證
| 項目 | 狀態 |
|------|------|
| .claude/ | ✅/❌ |
| openspec/ | ✅/❌ |
| app/ | ✅/❌ |
| server/ | ✅/❌ |

### 文件一致性
| 檔案 | 狀態 | 備註 |
|------|------|------|
| QUICK_START.md | ✅/❌ | |
| README.md | ✅/❌ | |
| CLAUDE_CODE_GUIDE.md | ✅/❌ | |

### Tech Stack
| 類別 | 狀態 | 缺少 |
|------|------|------|
| Core | ✅/❌ | |
| UI | ✅/❌ | |
| State | ✅/❌ | |
| Database | ✅/❌ | |
| Testing | ✅/❌ | |
| Deploy | ✅/❌ | |

### Build & Test
| 命令 | 狀態 |
|------|------|
| pnpm install | ✅/❌ |
| pnpm typecheck | ✅/❌ |
| pnpm test | ✅/❌ |

### Commands
- 預期: 14+
- 實際: X
- 狀態: ✅/❌

---

## 總結: **PASS** / **FAIL**

### 發現的問題（如有）
1. ...
2. ...
```

## Cleanup

驗證完成後可選擇清理：

```bash
rm -rf "$TEST_DIR"
```
