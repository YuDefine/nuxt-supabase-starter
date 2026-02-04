# Starter Template Validation Skill

驗證 nuxt-supabase-starter 範本的完整性與文件一致性。

## When to Use

- 發布新版本前的完整驗證
- 修改文件後確認與實際結構一致
- 確保 Tech Stack 完整安裝
- 檢查 package.json 依賴是否正確

## Validation Checklist

### Phase 1: Clone & Structure Validation

從乾淨狀態建立專案，驗證目錄結構：

```bash
# 建立測試目錄
TEST_DIR="/tmp/starter-validation-$(date +%s)"
git clone <repo> "$TEST_DIR"
cd "$TEST_DIR"
rm -rf .git && git init
```

**檢查項目**：

| 檢查           | 文件來源       | 驗證方式            |
| -------------- | -------------- | ------------------- |
| CLAUDE.md 存在 | QUICK_START.md | `test -f CLAUDE.md` |
| .claude/ 結構  | QUICK_START.md | 見下方              |
| openspec/ 結構 | QUICK_START.md | 見下方              |
| app/ 結構      | QUICK_START.md | 見下方              |
| server/ 結構   | QUICK_START.md | 見下方              |
| docs/ 結構     | QUICK_START.md | 見下方              |

**.claude/ 必須包含**：

- `commands/` (含 `opsx/` 子目錄)
- `agents/`
- `hooks/`
- `skills/`
- `settings.local.json.example`

**openspec/ 必須包含**：

- `project.md`
- `specs/`
- `changes/`
- `changes/archive/`

**app/ 必須包含**：

- `app.vue`
- `assets/css/`
- `auth.config.ts`
- `pages/`
- `types/`
- `types/database.types.ts`

**server/ 必須包含**：

- `auth.config.ts`
- `utils/`
- `utils/supabase.ts`

### Phase 2: Documentation Consistency

比對文件描述與實際結構：

```bash
# 搜尋所有提到目錄結構的文件
grep -r "├──\|└──" docs/*.md README.md
```

**需驗證的文件**：

- `docs/QUICK_START.md` - Step 1 目錄結構
- `README.md` - 目錄結構章節
- `docs/CLAUDE_CODE_GUIDE.md` - .claude/ 結構

### Phase 3: Package Installation

```bash
# 安裝依賴
pnpm install

# 檢查是否有錯誤
echo $?
```

**必須成功且無警告**。

### Phase 4: Tech Stack Verification

**動態驗證**：從 `README.md` 解析 Tech Stack 章節，自動對照 `package.json`。

```bash
node -e "
const fs = require('fs');
const readme = fs.readFileSync('README.md', 'utf8');
const pkg = require('./package.json');
const allDeps = {...pkg.dependencies, ...pkg.devDependencies};

// 從 README.md 的 Tech Stack 章節提取套件名稱
// 格式：[Package Name](url) 或 \`package-name\`
const techStackSection = readme.match(/## Tech Stack[\\s\\S]*?(?=\\n## |$)/)?.[0] || '';
const packageMatches = techStackSection.matchAll(/\\[([^\\]]+)\\]\\(https?:\\/\\/[^)]+\\)/g);
const codeMatches = techStackSection.matchAll(/\\\`([a-z@][a-z0-9\\-\\/@.]+)\\\`/gi);

// 已知的套件名稱對照（README 顯示名稱 → npm 套件名）
const knownMappings = {
  'Nuxt': 'nuxt',
  'Vue': 'vue',
  'TypeScript': 'typescript',
  'Supabase': '@nuxtjs/supabase',
  'Nuxt UI': '@nuxt/ui',
  'Nuxt Charts': 'nuxt-charts',
  'Tailwind CSS': 'tailwindcss',
  'Nuxt Image': '@nuxt/image',
  'Lucide Icons': '@iconify-json/lucide',
  'nuxt-better-auth': '@onmax/nuxt-better-auth',
  'Pinia': '@pinia/nuxt',
  'Pinia Colada': '@pinia/colada',
  'VueUse': '@vueuse/nuxt',
  'Vitest': 'vitest',
  '@nuxt/test-utils': '@nuxt/test-utils',
  'OXLint': 'oxlint',
  'OXFmt': 'oxfmt',
  'Zod': 'zod',
  'Commitlint': '@commitlint/cli',
  'Husky': 'husky',
  'VitePress': 'vitepress',
  'NuxtHub': '@nuxthub/core',
  'Sentry': '@sentry/nuxt',
  'Cloudflare Workers': 'wrangler'
};

const packagesToCheck = new Set();
for (const [_, name] of packageMatches) {
  const mapped = knownMappings[name];
  if (mapped) packagesToCheck.add(mapped);
}

let pass = true;
let checked = 0;
let missing = [];

console.log('Tech Stack from README.md:');
console.log('─'.repeat(50));

for (const pkgName of packagesToCheck) {
  checked++;
  if (allDeps[pkgName]) {
    console.log('✓', pkgName, allDeps[pkgName]);
  } else {
    console.log('✗', pkgName, 'NOT FOUND in package.json');
    missing.push(pkgName);
    pass = false;
  }
}

console.log('─'.repeat(50));
console.log('Total:', checked, '| Found:', checked - missing.length, '| Missing:', missing.length);

if (!pass) {
  console.log('\\nMissing packages:', missing.join(', '));
  process.exit(1);
}
"
```

**原理**：
1. 讀取 `README.md` 的 Tech Stack 章節
2. 解析 `[Name](url)` 格式的連結
3. 透過 `knownMappings` 對照表轉換為 npm 套件名稱
4. 與 `package.json` 比對

**維護方式**：
- 當 README.md 新增技術時，只需更新 `knownMappings` 對照表
- 套件名稱變更時，同步更新對照表即可

### Phase 5: Build & Type Check

```bash
# 類型檢查
pnpm typecheck

# 測試
pnpm test

# 完整檢查
pnpm check
```

**所有命令必須成功退出 (exit code 0)**。

### Phase 6: Claude Code Commands

驗證所有命令可被識別：

```bash
# 列出所有命令
ls -1 .claude/commands/*.md .claude/commands/opsx/*.md
```

**預期命令（15 個）**：

- `commit.md`
- `db-migration.md`
- `doc-sync.md`
- `tdd.md`
- `validate-starter.md`
- `opsx/new.md`
- `opsx/apply.md`
- `opsx/archive.md`
- `opsx/continue.md`
- `opsx/explore.md`
- `opsx/ff.md`
- `opsx/verify.md`
- `opsx/sync.md`
- `opsx/onboard.md`
- `opsx/bulk-archive.md`

### Phase 7: Environment Setup

```bash
# 檢查 .env.example 存在
test -f .env.example

# 檢查 Claude settings example 存在
test -f .claude/settings.local.json.example

# 複製設定檔
cp .env.example .env
cp .claude/settings.local.json.example .claude/settings.local.json
```

## Validation Script

執行完整驗證的腳本：

```bash
#!/bin/bash
set -e

TEST_DIR="/tmp/starter-validation-$(date +%s)"
REPO_PATH="$(pwd)"

echo "=== Phase 1: Clone & Structure ==="
git clone "$REPO_PATH" "$TEST_DIR"
cd "$TEST_DIR"
rm -rf .git && git init

# Structure checks
echo "Checking structure..."
test -f CLAUDE.md && echo "✓ CLAUDE.md"
test -d .claude/commands/opsx && echo "✓ .claude/commands/opsx/"
test -d .claude/agents && echo "✓ .claude/agents/"
test -d .claude/hooks && echo "✓ .claude/hooks/"
test -d .claude/skills && echo "✓ .claude/skills/"
test -f .claude/settings.local.json.example && echo "✓ .claude/settings.local.json.example"
test -f openspec/project.md && echo "✓ openspec/project.md"
test -d openspec/specs && echo "✓ openspec/specs/"
test -d openspec/changes && echo "✓ openspec/changes/"
test -f app/app.vue && echo "✓ app/app.vue"
test -f app/auth.config.ts && echo "✓ app/auth.config.ts"
test -f server/auth.config.ts && echo "✓ server/auth.config.ts"
test -f server/utils/supabase.ts && echo "✓ server/utils/supabase.ts"

echo ""
echo "=== Phase 2: Package Installation ==="
pnpm install

echo ""
echo "=== Phase 3: Tech Stack Verification ==="
echo "Parsing README.md Tech Stack section..."
node -e "
const fs = require('fs');
const readme = fs.readFileSync('README.md', 'utf8');
const pkg = require('./package.json');
const allDeps = {...pkg.dependencies, ...pkg.devDependencies};

const knownMappings = {
  'Nuxt': 'nuxt', 'Vue': 'vue', 'TypeScript': 'typescript',
  'Supabase': '@nuxtjs/supabase', 'Nuxt UI': '@nuxt/ui',
  'Nuxt Charts': 'nuxt-charts', 'Tailwind CSS': 'tailwindcss',
  'Nuxt Image': '@nuxt/image', 'Lucide Icons': '@iconify-json/lucide',
  'nuxt-better-auth': '@onmax/nuxt-better-auth', 'Pinia': '@pinia/nuxt',
  'Pinia Colada': '@pinia/colada', 'VueUse': '@vueuse/nuxt',
  'Vitest': 'vitest', '@nuxt/test-utils': '@nuxt/test-utils',
  'OXLint': 'oxlint', 'OXFmt': 'oxfmt', 'Zod': 'zod',
  'Commitlint': '@commitlint/cli', 'Husky': 'husky',
  'VitePress': 'vitepress', 'NuxtHub': '@nuxthub/core',
  'Sentry': '@sentry/nuxt', 'Cloudflare Workers': 'wrangler'
};

const techStack = readme.match(/## Tech Stack[\\s\\S]*?(?=\\n## |$)/)?.[0] || '';
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

echo ""
echo "=== Phase 4: Type Check ==="
pnpm typecheck

echo ""
echo "=== Phase 5: Tests ==="
pnpm test

echo ""
echo "=== Phase 6: Commands Check ==="
EXPECTED_COMMANDS=15
ACTUAL_COMMANDS=$(find .claude/commands -name "*.md" | wc -l | tr -d ' ')
echo "Expected: $EXPECTED_COMMANDS, Actual: $ACTUAL_COMMANDS"
if [ "$ACTUAL_COMMANDS" -ge "$EXPECTED_COMMANDS" ]; then
  echo "✓ Commands count OK"
else
  echo "✗ Commands count mismatch"
  exit 1
fi

echo ""
echo "=== All Validations Passed ==="
echo "Test directory: $TEST_DIR"
```

## Output Format

驗證完成後輸出報告：

```markdown
## Starter Validation Report

**Date**: YYYY-MM-DD HH:mm
**Commit**: <hash>

### Structure

| Check     | Status |
| --------- | ------ |
| CLAUDE.md | ✅     |
| .claude/  | ✅     |
| openspec/ | ✅     |
| app/      | ✅     |
| server/   | ✅     |
| docs/     | ✅     |

### Packages

| Category | Status | Missing |
| -------- | ------ | ------- |
| Core     | ✅     | -       |
| UI       | ✅     | -       |
| State    | ✅     | -       |
| Database | ✅     | -       |
| Testing  | ✅     | -       |
| Deploy   | ✅     | -       |

### Commands

- Total: 14
- Status: ✅

### Build & Test

| Check          | Status |
| -------------- | ------ |
| pnpm install   | ✅     |
| pnpm typecheck | ✅     |
| pnpm test      | ✅     |

### Result: **PASS** / **FAIL**
```

## Common Issues

### Missing .gitkeep files

```bash
# 確保空目錄被追蹤
touch openspec/specs/.gitkeep
touch openspec/changes/.gitkeep
touch openspec/changes/archive/.gitkeep
```

### Documentation vs Reality Mismatch

檢查以下文件的目錄結構描述：

- `docs/QUICK_START.md`
- `README.md`
- `docs/CLAUDE_CODE_GUIDE.md`

### Package Not Found

確認 package.json 中的依賴名稱正確，注意 scoped packages 的格式：

- `@nuxt/ui` (不是 `nuxt-ui`)
- `@pinia/colada` (不是 `pinia-colada`)
