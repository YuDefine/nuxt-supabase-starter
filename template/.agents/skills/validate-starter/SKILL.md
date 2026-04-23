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

- [ ] `commands/` 存在且包含 `spectra/` 子目錄
- [ ] `agents/` 存在
- [ ] `hooks/` 存在
- [ ] `skills/` 存在
- [ ] `settings.json` 存在

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

### Phase 5: Tech Stack 驗證（動態）

從 `README.md` 的 Tech Stack 章節動態解析，與 `package.json` 比對：

```bash
node -e "
const fs = require('fs');
const readme = fs.readFileSync('README.md', 'utf8');
const pkg = require('./package.json');
const allDeps = {...pkg.dependencies, ...pkg.devDependencies};

// README 顯示名稱 → npm 套件名對照表
// 注意：Vue 由 Nuxt 內建管理，不需檢查
const knownMappings = {
  'Nuxt': 'nuxt', 'TypeScript': 'typescript',
  'Supabase': '@nuxtjs/supabase', 'Nuxt UI': '@nuxt/ui',
  'Nuxt Charts': 'nuxt-charts', 'Tailwind CSS': 'tailwindcss',
  'Nuxt Image': '@nuxt/image', 'Lucide Icons': '@iconify-json/lucide',
  'nuxt-better-auth': '@onmax/nuxt-better-auth', 'Pinia': '@pinia/nuxt',
  'Pinia Colada': '@pinia/colada', 'VueUse': '@vueuse/nuxt',
  'Vite+': 'vite-plus', '@nuxt/test-utils': '@nuxt/test-utils',
  'Zod': 'zod',
  'Commitlint': '@commitlint/cli',
  'VitePress': 'vitepress', 'NuxtHub': '@nuxthub/core',
  'Sentry': '@sentry/nuxt', 'Cloudflare Workers': 'wrangler'
};

const techStack = readme.match(/## Tech Stack[\\s\\S]*?(?=\\n## |\$)/)?.[0] || '';
const matches = techStack.matchAll(/\\[([^\\]]+)\\]\\(https?:\\/\\/[^)]+\\)/g);

let pass = true, checked = 0, missing = [];
for (const [_, name] of matches) {
  const pkgName = knownMappings[name];
  if (!pkgName) continue;
  checked++;
  if (allDeps[pkgName]) {
    console.log('✓', pkgName);
  } else {
    console.log('✗', pkgName, 'MISSING');
    missing.push(pkgName);
    pass = false;
  }
}
console.log('');
console.log('Total:', checked, '| Pass:', checked - missing.length, '| Missing:', missing.length);
if (!pass) process.exit(1);
"
```

**原理**：從 README.md 的 `[Name](url)` 格式連結，透過 `knownMappings` 對照表轉換為 npm 套件名。
**維護**：新增技術時只需更新 README.md 和 `knownMappings`。

### Phase 6: 設定環境變數

依照 QUICK_START.md Step 3，設定 `.env` 避免 TTY 錯誤：

```bash
cp .env.example .env
# 產生必要的 secrets
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "NUXT_SESSION_PASSWORD=$(openssl rand -base64 32)" >> .env
```

### Phase 7: Build & Test

```bash
pnpm typecheck  # 必須成功
pnpm test       # 必須成功
pnpm check      # 必須成功（如果 supabase 未啟動，部分測試可跳過）
```

### Phase 8: Commands 驗證

動態列出所有命令並確認結構：

```bash
echo "=== 根層命令 ==="
ls .agents/skills/*.md

echo "=== spectra/ 子命令 ==="
ls .agents/skills/spectra/*.md

echo "=== 數量統計 ==="
ROOT_COUNT=$(ls .agents/skills/*.md | wc -l | tr -d ' ')
SPECTRA_COUNT=$(ls .agents/skills/spectra/*.md | wc -l | tr -d ' ')
TOTAL=$((ROOT_COUNT + SPECTRA_COUNT))
echo "根層: $ROOT_COUNT, spectra/: $SPECTRA_COUNT, 總計: $TOTAL"
echo "# 預期：15 個以上"
```

預期根層命令：`commit.md`, `db-migration.md`, `doc-sync.md`, `validate-starter.md`

預期 spectra/ 命令：`analyze.md`, `apply.md`, `archive.md`, `ask.md`, `clarify.md`, `debug.md`, `discuss.md`, `ingest.md`, `propose.md`, `sync.md`, `tdd.md`, `verify.md`

## Output

輸出驗證報告：

```markdown
## Starter Validation Report

**測試目錄**: $TEST_DIR
**來源 Commit**: $(git rev-parse --short HEAD)

### 結構驗證

| 項目      | 狀態  |
| --------- | ----- |
| .claude/  | ✅/❌ |
| openspec/ | ✅/❌ |
| app/      | ✅/❌ |
| server/   | ✅/❌ |

### 文件一致性

| 檔案                 | 狀態  | 備註 |
| -------------------- | ----- | ---- |
| QUICK_START.md       | ✅/❌ |      |
| README.md            | ✅/❌ |      |
| CLAUDE_CODE_GUIDE.md | ✅/❌ |      |

### Tech Stack

| 類別     | 狀態  | 缺少 |
| -------- | ----- | ---- |
| Core     | ✅/❌ |      |
| UI       | ✅/❌ |      |
| State    | ✅/❌ |      |
| Database | ✅/❌ |      |
| Testing  | ✅/❌ |      |
| Deploy   | ✅/❌ |      |

### Build & Test

| 命令           | 狀態  |
| -------------- | ----- |
| pnpm install   | ✅/❌ |
| pnpm typecheck | ✅/❌ |
| pnpm test      | ✅/❌ |

### Commands

- 預期: 15+
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
