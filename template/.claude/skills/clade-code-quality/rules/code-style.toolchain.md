---
description: lint / fmt 工具鏈治理——preset 是唯一設定入口、eslint/prettier 全面禁令、vite.config.ts 必備欄位、CI 與 pre-commit 的命令邊界、投影層排除只在 preset（consumer 業務排除寫 `vite.config.ts` override）；format/lint check 紅了 agent 要立刻 write/fix 再驗到綠（不限 /commit）；動任何工具鏈設定檔時載入
paths:
  [
    'vite.config.*',
    'nuxt.config.*',
    'package.json',
    'packages/*/package.json',
    'pnpm-workspace.yaml',
    'tsconfig*.json',
    '.github/workflows/**',
    '.husky/**',
    '.*rc*',
    '.*.config.*',
    '.oxfmtignore',
    '.oxlintignore',
    '.prettierignore',
  ]
---
<!-- Clade native rule; source: rules/core/code-style.toolchain.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Code Style — 工具鏈治理

本檔是 [[code-style]] 的工具鏈半邊，只收編輯上面 `paths:` 那些設定檔時才可能違反的條文。改 `paths:` 前先確認新增的路徑在本檔有對應條文（`scripts/audit-rule-paths.ts` 的 `over-broad-glob` 會抓過寬 glob）。

**核心命題**：本治理範圍下所有 JS/TS 專案**一律使用 `vite-plus`（vp）內建的 oxc 工具鏈**：`oxfmt`（formatter）+ `oxlint`（linter）。禁止任何 eslint / prettier 設定檔。

## Agent 義務：check 紅了立刻 fix（全 session）

`format:check`、`pnpm check`、`vp fmt --check`、`vp run format:check`、lint typecheck 失敗，或 landing PR / CI 紅燈，要在本 session 內修到同一條 check 全綠再收工。不要只跑 `--check` 就停、不要把「等 CI 自己綠」當計畫、不要把 CI workflow 裡的唯讀 `vp fmt --check` 讀成 agent 也只能掃不修——runner 不能改 working tree，agent 可以改，也應該改。

### 標準 loop（MUST）

1. 跑失敗的那條 check（與 CI / 0-C 同一入口，不要換成更窄的單檔命令代替整條 gate）
2. format 紅 → `pnpm format`（等同 `vp fmt --write --ignore-path .oxfmtignore`）；lint 可 auto-fix → consumer 的 `pnpm lint --fix` 或 `pnpm vp lint --fix`
3. 修掉無法 auto-fix 的項目
4. 重跑步驟 1 的**同一條**命令 → exit 0 才算完成

`/commit` 的 0-C 是這條 loop 在 commit ceremony 裡的機械化；**義務不限於 `/commit`**——本機驗證、PR landing、CI 失敗後的修復，同一套。

## Governance — lint / fmt 設定改在哪

- **每個 consumer 都該套**的 baseline（oxlint rules / oxfmt 風格 / 共用 ignore）一律改在 clade `vendor/oxc-shared/preset.ts`，再 `node scripts/publish.ts <bump> && node scripts/propagate.ts` 散播。不確定時預設放 baseline。不要改 consumer 端的 preset 投影副本——下次 propagate 會覆蓋。
- **單一 consumer** 的業務 override 寫在該 consumer `vite.config.ts` 內、spread baseline 之後的 override block；**禁止**整段 inline 重寫 baseline（見 § `vite.config.ts` 必備欄位）。

### 投影層排除清單集中在 preset

投影路徑（`vendor/**`、`.claude/**`、`.clade/**`、`.spectra/**`）在 consumer 端是 `chmod 444` 的 LOCKED 副本，consumer 修不了裡面的 lint / fmt 違規。所以「這些路徑要不要送進 lint / fmt」只由 `vendor/oxc-shared/preset.ts` 的 `PROJECTION_EXCLUDES` 一處決定。

- 不要在 consumer 的 `vite.config.ts` inline 投影層排除路徑（`'vendor/**'`、`'.claude/rules/**'` …），也不要用「加一個 `.oxfmtignore` 就好」代替——那是在補 preset 的洞，沒補的 consumer 會 CI 紅且自己解不掉
- 投影層檔案被 lint / fmt 報錯的**唯一**正解：回 clade 把路徑加進 `PROJECTION_EXCLUDES`，publish + propagate
- 唯一例外是 clade 自己（`vendor/` 是原始碼），其 `vite.config.ts` 把 `vendor/**` 濾回來，有註解且 audit 認得

機械檢查：`node scripts/audit-governance-drift.ts` check 10（inline 排除路徑）。契約全文 `specs/truth/projection-ownership.md`；成因 [[pitfall-projection-excludes-not-in-shared-preset]]。

## 禁止事項（NEVER）

### 禁止建立 eslint 設定檔

不要建立或保留以下任一檔案：

- `.eslintrc`、`.eslintrc.json`、`.eslintrc.js`、`.eslintrc.cjs`、`.eslintrc.yml`、`.eslintrc.yaml`
- `eslint.config.js`、`eslint.config.cjs`、`eslint.config.mjs`、`eslint.config.ts`
- `package.json` 內的 `eslintConfig` 鍵
- `.eslintignore`

### 禁止所有 prettier config 檔（含 `.prettierignore`）

不要建立或保留以下任一檔案：

- `.prettierrc`、`.prettierrc.json`、`.prettierrc.yaml`、`.prettierrc.yml`、`.prettierrc.toml`
- `.prettierrc.js`、`.prettierrc.cjs`、`.prettierrc.mjs`、`prettier.config.*`
- `package.json` 內的 `prettier` 鍵
- **`.prettierignore`**（由 `.oxfmtignore` + `--ignore-path` 承接）

`.prettierignore` 留著會被 oxfmt 當 fallback 讀、也會誤觸發 IDE 的 prettier 擴充；oxfmt 有自己的 ignore 機制。

#### `.oxfmtignore`（clade-managed，承接原 `.prettierignore` 用途）

`.oxfmtignore` 由 `scripts/lib/oxfmtignore-governance.ts` 在 `pnpm hub:bootstrap` 時生成，**只能**保留 clade-managed LOCKED projections（`.claude/rules/`、`.claude/skills/`、`.claude/hooks/`、`.claude/agents/`、`.claude/commands/`、`.agents/`、`.codex/`）的條目。**禁止**手動加其他條目（業務排除寫 `vite.config.ts` override），也**禁止**刪除（bootstrap 會重建）。

oxfmt 不會自動讀 `.oxfmtignore`（fallback 只有 `.prettierignore` / `.gitignore`），所以**所有 `vp fmt` 調用入口都必須顯式帶 `--ignore-path .oxfmtignore`**。clade 散播的 `format` / `format:check` script 已預埋：

```json
"format:check": "vp fmt --check --ignore-path .oxfmtignore",
"format": "vp fmt --write --ignore-path .oxfmtignore",
```

> ⚠️ `fmt.ignorePatterns`（`vite.config.ts` 或 `.oxfmtrc.json`）有 upstream bug：**不會被套用到 file walking**（驗於 vite-plus 0.1.21 / oxfmt 0.48），實際生效的只有 `.gitignore` 與 `--ignore-path`。專案自家 fmt 排除仍寫進 `fmt.ignorePatterns`（修好後生效），構建產物靠 `.gitignore` 掩護。`lint.ignorePatterns` 正常運作，且不與 `.oxfmtignore` 共用。

### 禁止把 eslint / prettier 加進 dependencies

不要在 `package.json` `dependencies` / `devDependencies` 安裝：

- `eslint`、`@typescript-eslint/*`、任何 `eslint-config-*` / `eslint-plugin-*`
- `@nuxt/eslint`、`@nuxt/eslint-config`、`@nuxt/eslint-module`（Nuxt 的 ESLint 整合 module — Vite+ 已內建 oxlint，裝它等於並存兩套 linter）
- `prettier`、`@trivago/prettier-plugin-*`、任何 `prettier-plugin-*`

例外：當第三方套件（如 husky / lint-staged）的 peer dependency 強制要求時，可保留，但**不該被 user code 直接呼叫**。`@nuxt/eslint` 是 opt-in module（不是任何套件的強制 peer dep），不適用此例外 — 直接移除。

#### 上面兩條都攔不到 binary：`node_modules/.bin/prettier` 仍可執行

上面兩條不管 transitive dependency，而 prettier 不需要 config 就能把整檔改成互斥風格（exit 0、零警告）。`@nuxt/hints` 經 `shamefully-hoist` 會把 `node_modules/.bin/prettier` 帶進部分 consumer。

- 不要在本 fleet 的任何 repo 執行 prettier（`npx` / `pnpm exec` / `node_modules/.bin/` /
  裸命令都一樣）。格式化一律走 `pnpm format`（全 repo）或 `pnpm exec vp fmt --write <file>`（單檔）
- 不要為了讓禁令生效去移除 `@nuxt/hints` —— 它是 Nuxt 系的正常依賴，不是這條坑的錯
- 不要把 `.bin/prettier` 存在接成 `pnpm check` 的 fail —— 它是移不掉的 transitive dep，
  那條 check 會讓受影響的 CI 永久紅，而永久紅的 gate 是噪音不是攔阻

攔阻掛在動作上：`capabilities/core/hooks/pre-bash-prettier-invocation-gate.sh`（PreToolUse:Bash）命中 prettier 時 exit 2。它只看得到 Claude Code 的 Bash tool call，不要把它存在讀成「這個 repo 已經不可能被 prettier 改壞」。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 命令位置出現 prettier × 目標 repo 有 `.oxfmtignore` / `.claude/hub.json` / `package.json` 依賴 `vite-plus` → **exit 2 擋下**。逃生門 `CLADE_ALLOW_PRETTIER=1`（給「只是要在文件裡寫下這個字串」用） |
| 消費端 | 已安裝該 Claude hook 的 Bash tool call（consumer 與 clade home）；回歸測試 `test/pre-bash-prettier-invocation-gate.test.ts`。Codex／Cursor 的原生攔截接線另行驗證，規約投影本身不代表已安裝 hook |
| 載入路徑 | 本節 `rules/core/code-style.toolchain.md`，依 frontmatter paths 由各 runtime adapter 交付；成因與 fleet 掃描見 `docs/pitfalls/2026-08-28-banned-tool-binary-still-on-path.md` |

### 禁止依賴全域 vite-plus（hard rule）

`vite-plus`（vp）一律是 consumer 的 per-project devDependency 並 pin 具體版本（不是 `^` / `~` / `*`）。vp 嚴格 pin 它 bundle 的 oxlint / oxfmt，所以 vp 沒釘 = 工具鏈沒釘，全域版本會讓 dev 與 CI 抓到不同 violation。

- **推薦（catalog mode，對齊官方 migrator）**：`package.json` `"devDependencies": { "vite-plus": "catalog:" }` ＋ `pnpm-workspace.yaml` `catalog: { vite-plus: <exact-version> }`
- **Fallback**：`"devDependencies": { "vite-plus": "<exact-version>" }`（單 repo 不用 catalog 時；audit 同樣回 `aligned`）
- 新 consumer 第一件事：`pnpm add -D vite-plus@<latest stable>`
- 不要讓 `package.json` 沒有 `vite-plus` 條目、靠全域 vp 跑；`pnpm add -g vite-plus` 只供探索，當天就要改成 per-project
- 升 vp 要走 [`version-upgrade`](../../capabilities/modules/ecosystem/node/skills/version-upgrade/SKILL.md) skill § Outdated mode，不是升全域

偵測：`scripts/audit-tooling-drift.ts` 的 `viteplusLocal` signal（diagnostic-only）。

#### `setup-vp` 的 `version` input 換的是 global CLI，不是 `vp run` 用的工具鏈（hard rule）

反向那一半：**釘了全域也沒用**。`vp` 有兩層版本，各自獨立：

| 層 | 誰決定 | 帶哪個 oxfmt / oxlint |
| --- | --- | --- |
| global `vp` CLI | `setup-vp` 的 `version` input，或本機全域安裝 | 該 CLI 自己 bundle 的 |
| `vp run <script>` 實際執行的工具鏈 | **`package.json` 的 `vite-plus` devDependency** | local `vite-plus` bundle 的 |

- **不要用 `setup-vp` 的 `version` input 解決工具鏈版本不一致**——它只換第一層，
  `vp run format:check` 走的永遠是第二層。釘 global 之後症狀一模一樣，而排查方向會被帶偏。
- **要換工具鏈就升 devDependency**：`pnpm add -D vite-plus@<帶所需 oxfmt 的版本>`，
  並**移除** workflow 的 `version` pin——`setup-vp` 的預設行為就是從 lockfile 解析，那是對的。
- **`vp --version` 的輸出要讀完兩層**。只看第一行 `vp vX.Y.Z` 會得出「版本已對齊」的
  錯誤結論；`Local vite-plus:` 與 `Tools:` 那兩段才是 `vp run` 的實際版本。

升 vite-plus 時要一起處理：oxlint 新 finding；`minimumReleaseAge` 需要的 `minimumReleaseAgeExclude`（`pnpm add` 會自動寫進 `pnpm-workspace.yaml`，commit 要帶上該檔）。實證見 [[pitfall-setup-vp-version-pins-cli-not-local-toolchain]]。

### Node runtime 全 fleet 釘 major 24（hard rule）

node 是 vp 兩層共同的第三層。適用於 repo root 有 `package.json` 的 repo；沒有的標 `n/a`，不要標成已對齊。

#### MUST：三個來源全部釘，缺一個就是沒釘

| 來源 | 寫什麼 | 沒釘的後果 |
| --- | --- | --- |
| `package.json` 的 `engines.node` | `"^24"` | 本機仍裝得起來，但宣告變成謊話；`pnpm install` 不會擋 |
| `.nvmrc`（或 `.node-version`） | `24` | 開發者本機 `nvm use` / `fnm use` 切到別的 major |
| **每一個** workflow 的**每一處** `node-version` | `'24'` | **CI 當場紅**，且 matrix 只有一格紅時很像 flaky |

第三列是全稱：**每一個** `.github/workflows/*.yml` 的**每一處** `node-version:`，不是只改 `ci.yml` 或每檔第一處。

#### NEVER

- 不要用 `lts/*` 這類浮動寫法當作「已釘」（`node-version-file` 除外）
- 不要用單值 matrix（`matrix: node: [22]`）表達釘版——它讀起來像刻意測多版本
- 不要因為 `engines.node` 已是 `^24` 就跳過 CI 那一格：`engines` 不參與 runner 選版

#### MUST：toolchain 入口 action 釘 SHA

`voidzero-dev/setup-vp` / `pnpm/action-setup` / `actions/setup-node` 一律釘 40 碼 commit SHA
並在行尾註記人讀版號（`@250f29ce…396baf5e8f24498e17c0dfdebabc26eb # v1`）。不要用
`@v1` / `@v5` 這種可被上游移動的浮動 tag。

#### 對應偵測

```bash
node scripts/audit-ci-toolchain-parity.ts          # 人讀表格；--json 給機器；--strict 有 drift 回 1
node scripts/audit-ci-toolchain-parity.ts --target-node 24
```

目標 major 的 SoT 是該 script 的 `TARGET_NODE_MAJOR`；換標準時常數與本節**同步改**，不要只改一邊。操作模板見 `vendor/snippets/ci-parity/`。

### 禁止在 lint-staged / pre-commit / CI 命令中呼叫 eslint / prettier

不要在 hook script、`package.json` `scripts`、CI workflow 寫：

- `eslint --fix` / `eslint .`
- `prettier --write` / `prettier --check`

一律改用 `vp lint` / `vp fmt` / `vp staged`（Vite+ 提供）。

> ⚠️ 不要直接呼叫 `oxlint` / `oxfmt` CLI binary：這兩個 binary 是 IDE-only / LSP-only stub，直接執行會回傳 `This oxfmt wrapper is for IDE extension use only` 錯誤導致 pre-commit / CI 失敗。一律走 `vp lint` / `vp fmt` 入口（vp 內部會用編譯版 oxc）。

### CI workflow 禁止跑 `vp check` / `vp run check`（hard rule）

不要在 `.github/workflows/**.yml` 跑 `vp check` 或 `vp run check`。

理由：`vp check` 內部 fmt step **不支援 `--ignore-path`**，會掃到 LOCKED projection 而 CI 紅（見 § `.oxfmtignore`）。

CI workflow 要拆 step 跑各別 npm script，每個 script 自帶必要 flag：

```yaml
# ✅ 正確 — <consumer-b> 模式（mirror this pattern in all consumers）
- name: Format check
  run: vp run format:check       # 帶 --ignore-path .oxfmtignore

- name: Lint
  run: vp run lint               # 帶 --deny-warnings（若 consumer baseline 為 0 warnings）

- name: Typecheck
  run: vp run typecheck

- name: Run tests
  run: vp run test
```

```yaml
# ❌ 錯誤 — 撞 LOCKED projection
- name: Check (lint + format + typecheck)
  run: vp run check              # = pnpm check = vp check && ... (vp check 沒 ignore-path)
```

`package.json` 的 `check` script（local / pre-push）可保留 `vp check`，但它同樣會撞 LOCKED projection。

## 必須事項（MUST）

### 改 `catalog:` / `overrides:` 之後，收尾 MUST 驗 lockfile 本身

改動 `pnpm-workspace.yaml` 的 `catalog:` / `overrides:`（或 `package.json` 的 `pnpm.overrides`）之後，
要在同一個收尾動作裡讀 `pnpm-lock.yaml` **本身**，確認它記的值等於你剛寫進 manifest 的值：

```bash
awk '/^overrides:/{f=1;next} f&&/^[^[:space:]]/{exit} f' pnpm-lock.yaml   # 值須等於 manifest
awk '/^catalog:/{f=1;next}   f&&/^[^[:space:]]/{exit} f' pnpm-lock.yaml
```

值對不上 = lockfile 沒被改寫。修法是把 pnpm 的 up-to-date 短路條件消掉，**不是**再換一個旗標：

```bash
rm -rf node_modules && pnpm install     # 這次才會真的 resolve 並改寫 lockfile
```

**不要用下列任一項代替上面那條驗證**——它們在 lockfile 錯的整段期間都回「對」：

- `pnpm install` / `--force` / `--lockfile-only` / `--frozen-lockfile` 回 `Already up to date`（四者共用同一道以 node_modules 為判準的短路，不是四個獨立證據）
- `node_modules/<pkg>/package.json` 的版本
- `git diff` 乾淨

錯過時 CI 會照舊 lockfile 裝舊版而不出聲。fleet 偵測：`node scripts/audit-lockfile-staleness.ts`；成因 [[pitfall-pnpm-up-to-date-attests-node-modules-not-lockfile]]。

### packageExtensions 條目契約

`packageExtensions:` 替別人的套件補宣告依賴，從 consumer 的 `package.json` 看不出來。**每一個**條目上方都要有註解，寫兩件事：

1. **存在理由**：哪個套件在哪裡用到、為什麼它自己沒宣告（例：`@specformula/node` 的 index 靜態 import `SqliteDataSource` → `better-sqlite3`，vendored tgz 沒宣告）
2. **移除條件**：什麼事發生之後這條可以刪（例：上游改 lazy import 或宣告 optional peer 並重新 vendor——附上游 TD／issue 編號）

```yaml
# @specformula/node 的 index 靜態 import SqliteDataSource → better-sqlite3，vendored tgz 沒宣告。
# 移除條件：上游改 lazy import 或宣告 optional peer 並重新 vendor（<consumer-e> TD-0xx）。
packageExtensions:
  "@specformula/node":
    dependencies:
      better-sqlite3: 12.11.1
```

依賴**歸屬到真正 import 它的套件**，不要改成在 consumer `devDependencies` 補一條——它會在下次「清掉未使用依賴」時被刪（[[pitfall-pnpm-allowbuilds-entry-removal-reddens-unrelated-scripts]] § 回歸）。機械訊號：`node scripts/audit-pnpm-settings-drift.ts` 的 `packageExtensions` 段（只驗註解存在）。

### `vite.config.ts` 必備欄位（跨 consumer 統一，避免 propagate drift）

clade 散播檔會進 consumer 的 `vp fmt` 範圍；fmt 設定不一致就會重排 LOCKED 檔、CI 紅。要從 `vendor/oxc-shared/preset.ts` import baseline 並 spread merge（baseline 內容以 preset.ts 為準）：

```ts
import { defineConfig } from 'vite-plus'
import { lintBase, fmtBase } from './vendor/oxc-shared/preset.ts'

export default defineConfig({
  resolve: { alias: [/* consumer build config */] },

  lint: {
    ...lintBase,
    rules: {
      ...lintBase.rules,
      // 業務 override 僅放這裡（屬於 baseline 的請改 preset.ts，跨 consumer 統一）
      'unicorn/no-thenable': 'off', // supabase PostgREST mock builder chain
    },
    ignorePatterns: [...lintBase.ignorePatterns, '.wrangler/'],
  },

  fmt: {
    ...fmtBase,
    // experimentalTailwindcss stylesheet 各 consumer 路徑不同，不在 preset
    experimentalTailwindcss: { stylesheet: './app/assets/css/main.css' },
    ignorePatterns: [...fmtBase.ignorePatterns, 'AGENTS.md'],
  },
})
```

**禁止**不 import preset 而 inline 寫全部 `lint:` / `fmt:` 欄位——preset 升版時會 silently drift。

```bash
pnpm vp lint --fix
pnpm format        # 等同 vp fmt --write --ignore-path .oxfmtignore；裸打 vp fmt 必須自帶 --ignore-path
pnpm format:check
bash scripts/pre-commit/runner.sh   # pre-commit staged 檢查
```

### staged 配置：一行 re-export，NEVER 手寫排除陣列

本節只適用**尚未收斂**、hook 仍直接跑 `vp staged` 的 consumer（收斂目標見 § Pre-commit hook 走 `runner.sh`；走 runner 的 consumer 從不呼叫 `vp staged`，`staged:` 是死設定，不要拿它的綠燈推論 pre-commit 有濾投影層）。`vp staged` 不讀 `ignorePatterns`，所以 `staged` 的過濾一定要追溯得到 preset 的 `PROJECTION_EXCLUDES`。預設形狀是直接用 preset 匯出的 `stagedBase`（與 runner 讀同一支 `isStagedExcluded`）：

```ts
import { defineConfig } from 'vite-plus'
import { fmtBase, lintBase, stagedBase } from './vendor/oxc-shared/preset.ts'

export default defineConfig({
  lint: { ...lintBase },
  fmt: { ...fmtBase },
  staged: stagedBase,
})
```

需要自訂 glob 時改用 preset 匯出的 `isStagedExcluded` 自己組，一樣算追溯得到 `PROJECTION_EXCLUDES`。不要只用 `isProjectionPath`：它只涵蓋投影層，漏掉 `STAGED_ONLY_EXCLUDES`（投影到 repo root 的 `scripts/**` 與 LOCKED `AGENTS.md`），會把它們送進 `vp check --fix`：

```ts
import { isStagedExcluded } from './vendor/oxc-shared/preset.ts'

export default defineConfig({
  staged: {
    '*': (files) => {
      const t = files.filter((f) => !isStagedExcluded(f))
      return t.length > 0 ? [`vp check --fix ${t.map((f) => JSON.stringify(f)).join(' ')}`] : []
    },
  },
})
```

- **不要手寫一份平行的目錄清單**（`f.startsWith('.claude/rules/') && …`）——它只長出當下踩到的目錄，必然漂移
- 不要把「別處註解提過 `PROJECTION_EXCLUDES`」當成已經濾了

漏濾的症狀：`vp lint` / `vp fmt` 對「輸入路徑**全部**被 ignore」回 exit 1 `No files found to lint`，像路徑打錯。平時 staged 混有業務檔不會觸發，而 `propagate.ts` 走 `git commit --only -- <clade-paths>`，commit 的全是投影檔，每趟都站在觸發線上。機械檢查：`node scripts/audit-governance-drift.ts` check 16（不擋 publish）。

### Nuxt app 不要照抄官方 `vp migrate` 全文

`vp migrate` 的 README 範例是給純 Vite 專案。Nuxt 4 有三條硬例外：

1. **`dev` / `build` / `typecheck` 維持 `nuxt` CLI。** `vp check` 內建的 typecheck 不是 `nuxt typecheck`；`vp dev` / `vp build` 也不走 Nitro / Nuxt module graph。
2. **測試設定留在 `vitest.config.ts`。** 用 `@nuxt/test-utils` 的 `defineVitestConfig` 或 `defineVitestProject`。`vp test` 優先讀 `vitest.config.*`，這是刻意的第二份設定，不是沒 migrate 完。
3. **不要把 `vitest` override 成 `npm:@voidzero-dev/vite-plus-test@latest`，除非該版與 `vite-plus` / `vite-plus-core` 同一主線。** 不同主線時會把舊 native binding 跟新 `vite-plus` 的 `exports` 疊在一起，`node_modules/.bin/vp` 直接炸。`vite → vite-plus-core`（同主線）可以；`vitest` 維持 Vitest 4.x。

詳見 `docs/conventions/code-quality-tooling.md` Known drift 與 [[pitfall-nuxt-vp-migrate-overrides-mismatch]]。

### Pre-commit hook 走 `runner.sh`

fleet 的 pre-commit **只有一條路徑**。`.husky/pre-commit` / `.vite-hooks/pre-commit`（`core.hooksPath` 實際指到的那一個）在 clade drift-guard 區塊之後：

```sh
bash scripts/pre-commit/runner.sh
```

runner 的 `checks/vp-staged.sh` 經 `scripts/pre-commit/staged-targets.ts` 讀 preset 的 `isStagedExcluded` 濾掉投影層，再 `vp lint --fix` + `vp fmt`；runner 另帶的條件觸發 check，直接跑 `vp staged` 的 hook 拿不到。

- 不要在 hook 裡另外呼叫 `vp staged` / `lint-staged`——那是第二個 lint 入口，`vite.config.ts` 的 `staged:` 會因此活過來，兩份過濾各自漂移
- 不要在 `vp-staged.sh` 或任何 shell 裡手寫投影路徑清單——判定只在 preset（`PROJECTION_EXCLUDES` ∪ `STAGED_ONLY_EXCLUDES`）
- 橋接讀不到 preset 時 `vp-staged.sh` **非零退出**，不會退回「全部放行」或「全部跳過」——兩者在輸出上都像正常

機械檢查：`node scripts/audit-governance-drift.ts` check16 逐台解析實際 hook（`resolveHookTarget`）判路徑，`staged:` 只在會被執行的路徑上驗；未收斂的存量列在 `scripts/lib/staged-projection-filter.ts` 的 `UNCONVERGED_BASELINE`，清單外新增的未收斂 consumer 判 offender。

## 違反偵測

### 已實作

- `scripts/sync-rules.ts --check` 在跑 drift report 時偵測 consumer 端 `.prettierignore` 存在 → 列為 drift
- `scripts/sync-rules.ts` 的 `checkLegacyEslintConfig` 偵測 `.eslintrc*`／`eslint.config.*`／`.eslintignore` → `legacy-eslint-config` drift
- `scripts/lib/oxfmtignore-governance.ts` 在 `pnpm hub:bootstrap` 時主動刪除舊 `.prettierignore`（self-healing）
- `pnpm hub:check` 包含上述 drift signal，consumer 端 CI 應啟用此 job
- `node scripts/audit-tooling-drift.ts [--markdown|--json]`（diagnostic-only）：`presetImport` / `inlineDrift`（vite.config 對齊）、`eslintDeps`（禁用套件 → `forbidden-deps-present`）、`structuralDrift` / `strayDotfiles` / `viteplusLocal` / `pnpmOrphans`

### 未涵蓋

禁用的 **prettier config 檔**（`.prettierrc*` / `prettier.config.*`）沒有存在性掃描，pre-commit 與 CI 也不擋——sync-rules.ts 在 prettier 這側只認 `.prettierignore` 一條。不要拿上面的 audit 綠燈推論 config 檔層也乾淨。

## Heavy gate 准入控制（機器層並行上限）

一台機器上跑 N 個 agent session 時，heavy gate（`typecheck` / `test` / `test-mutation` /
`build` / `e2e`）各自吃 2–4 GiB RAM 與整顆核心——`e2e` 另外還要起 browser 與 app server。閘門是 `vendor/scripts/gate-slot.sh`
（consumer 投影 `scripts/gate-slot.sh`），入口是 `bin/clade-gate`。

**heavy job 一律經 `clade-gate run <label> -- <cmd>` 才受閘。** 光把 label 加進 `CLADE_HEAVY_GATES` 不會讓任何東西受閘。

| script | 要寫成 |
| --- | --- |
| `typecheck` | `clade-gate run typecheck -- <nuxt typecheck / vue-tsc …>` |
| `test`（含 coverage） | `clade-gate run test -- <vitest / vp test …>` |
| `test:mutation` | `clade-gate run test-mutation -- <stryker …>` |
| `build` | `clade-gate run build -- <nuxt build / vite build …>` |
| `test:e2e` | `clade-gate run e2e -- playwright test …` |

**每一條** `test:e2e:*` 變體（`test:e2e:a11y`、`test:e2e:verify`、帶 `PLAYWRIGHT_*` env 的分站版本…）
都 MUST 同樣包進 `clade-gate run e2e`，不是只包 `test:e2e` 那一條——變體跑的是同一套 browser ＋ server。
唯一例外是互動式的 `:ui` 結尾（`playwright test --ui`）：它是人開著看的長駐視窗，包進去會整段佔住 slot。

### Guard 要寫成 arg-safe 形狀，NEVER 裸 `if … fi`

`clade-gate` 不一定存在，script 常包一層 fallback guard，而**裸寫的 guard 會吃不掉附加參數**：

```jsonc
// ❌ pnpm 把使用者的參數接在整條 script 尾端 → 實跑是 `… fi --run` → Syntax error
"test": "if test -x .clade/bin/clade-gate; then .clade/bin/clade-gate run test -- vp test; else vp test; fi"

// ✅
"test": "sh -c 'if test -x .clade/bin/clade-gate; then exec .clade/bin/clade-gate run test -- vp test \"$@\"; else exec vp test \"$@\"; fi' --"
```

三個要點缺一還是壞的：整條包進 `sh -c '…'` 且**結尾的 `--`** 讓附加參數變成位置參數；
**兩個分支都要 `"$@"`**；`exec` 讓 exit code 與訊號直接穿透。

**不需要 fallback 的 repo 用直呼形式**（`.clade/bin/clade-gate run test -- vp test`）。**不要為了「看起來比較安全」給每個 repo 都加 guard**。

壞形狀只在 `pnpm test <檔名>` 時炸，錯誤是 `sh: 1: Syntax error: word unexpected`，看不出真因——靠稽核抓：`node scripts/audit-gate-coverage.ts` § 3b 逐 consumer 印四條 script（含 `test:e2e:*` 變體，`:ui` 除外）的受閘狀態（`✗ 未受閘` / `⚠ 吃不掉參數`），`pnpm build:xxx` 這種轉呼往下解一層以上，間接寫法不誤報。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 任一 consumer 的 heavy script 已定義但未經 `clade-gate run <label>`（表格 `✗ 未受閘`），或有受閘但 guard 是裸 `if … fi`（表格 `⚠ 吃不掉參數`）→ 進該 audit 的 Warnings 段。**warn-only，不 block**：改 script 是 consumer 自治區的動作，擋 clade 自己的 publish 是錯的施力點（同 `audit-lockfile-staleness`） |
| 消費端 | `/clade-health enforcement`（每輪跑 `node scripts/audit-gate-coverage.ts`）；findings 進 HANDOFF 稽核段並 relay 給對應 consumer 的 session |
| 載入路徑 | 本節 `rules/core/code-style.toolchain.md`，依 frontmatter paths 由各 runtime adapter 交付 |

**小範圍 lint 不要包進 heavy label**（`lint` / `format:check` 直呼工具）。

**`pnpm test <檔名>` 走 light semaphore，不排 heavy slot（W-2026-09-24-gate-slot-light-lane）**。`test` label 的 inner argv
扣掉命令本身後，positional **全部**是存在的測試檔（1..`CLADE_LIGHT_TEST_MAX_FILES`，預設 5；帶目錄、
name filter 就判 heavy）、沒有 `--lane`、且沒有一支宣告
`// clade-test-isolation: spawn-heavy` 時，`clade-gate` 設 `CLADE_GATE_CLASS=light`，`gate-slot.sh`
改取獨立的 `light-<i>.lock`（`CLADE_LIGHT_GATE_SLOTS`，預設 2），不取 heavy slot 與 repo lock；
記憶體 scope 與 `MAX_RUNTIME` 照舊。light 只替巢狀 gate 宣稱持有 light slot（`CLADE_GATE_LIGHT_HELD`），
**NEVER** export `CLADE_GATE_SLOT_HELD`：被包命令裡再進的 heavy gate 照常取 repo lock 與 heavy slot。成因：heavy slot 降到 1 之後，重跑 5 個小檔要排在別 repo 的整套
suite 後面，agent 於是繞過閘門直跑——那才是沒有上限的路徑。**NEVER** 為了「定點重跑」直呼
`node --test` / `vitest` 繞過 `clade-gate`：light lane 就是那條路，而且仍受全機上限。

### 三個 exit code 說的是不同層的話

| code | 誰說的 | 意思 |
| --- | --- | --- |
| 75 | `gate-slot.sh`（`BUSY`） | 等不到 slot / `try` 模式取不到。**inner command 從未執行**，不是 gate 失敗 |
| 124 | `timeout`（holder 端自願上界） | inner command 跑超過 `CLADE_HEAVY_GATE_MAX_RUNTIME`（預設 3600s）被結束 |
| 130 / 143 | `gate-slot.sh` 的等待期 trap | waiter 在**排隊期間**收到 SIGINT / SIGTERM，inner command 未執行 |

**不要把這四個讀成品質 gate 失敗**，也不要用調大 timeout、加 `--skip`、改 `--max-old-space-size` 回應（[[pitfall-heavy-gate-exit-75-reads-as-typecheck-failure]]）。

### 機器層調參 NEVER 寫死進 script 預設

所有上限一律走 env，由機器自己設。desk 的設定在 `~/.config/environment.d/60-clade-heavy-job-admission.conf` ＋ `~/.zshenv`，兩份一起改。

| env | desk 值 | 沒設時 |
| --- | --- | --- |
| `CLADE_HEAVY_GATE_SLOTS` | `2`（2026-09-24 VM100 套 10 vCPU 後由 1 調回） | 2（clamp 1..8） |
| `CLADE_LIGHT_GATE_SLOTS` | 預設 | 2（clamp 1..8）——`pnpm test <檔名>` 的 light 類上限 |
| `CLADE_LIGHT_TEST_MAX_FILES` | 預設 | 5；`CLADE_LIGHT_TEST=0` 關閉 light 分類 |
| `CLADE_OXC_THREADS` | `2` | **不注入** —— oxlint / oxfmt 用滿全部核心 |
| `CLADE_VITEST_MAX_WORKERS` | `2` | **不注入** —— vitest 用滿全部核心 |
| `CLADE_GATE_WAIT_TIMEOUT` | 預設 | 3600s |
| `CLADE_HEAVY_GATE_MAX_RUNTIME` | 預設 | 3600s（`0` 關閉） |

`CLADE_OXC_THREADS` / `CLADE_VITEST_MAX_WORKERS` 由 `bin/vp` shim 注入，條件：env 是正整數、子命令是 `lint`/`fmt`/`test`、使用者沒自己帶該旗標。

### `vp check` 收不到 threads 上限（已知殘餘）

`vp check --threads=N` 回 `Unexpected argument '--threads'`（驗於 vp v0.3.0）。
上限只覆蓋**直呼**的 `vp lint` / `vp fmt` / `vp test`。所以：

| package.json 的 check 形狀 | 受不受 threads 上限 |
| --- | --- |
| `pnpm format:check && pnpm lint && …`（各自是 `vp fmt` / `vp lint`） | **受** |
| 單一 `vp check` | **不受** —— 內部扇出到全部核心 |

**不要為了讓它受控就把 `vp check` 拆成兩條**——那讓 check 語義與官方入口分岔；接受這一格或等上游。

### 長駐 dev server 不是 gate —— 閘門結構上攔不到它

`nuxt dev` / `wrangler dev` / `vite` 不經過任何 gate；起它的 session 死後它被 init 收養繼續跑（orphan workerd 可吃數 GB）。處置走 `vendor/snippets/scoped-dev-server/`，貼進 **`~/.zshenv`**。

**一定要貼 `.zshenv`，不要貼 `.zshrc`**（`.zshrc` 不被 `zsh -c` 載入）。**不要用「設定檔裡有這一行」推論它生效**，要實跑 `zsh -c 'printenv <VAR>'` 驗；`~/.config/environment.d/` 要 manager 重載。scope 換到的是**有界且具名**（吃得到 slice 上限、`systemctl --user list-units --type=scope` 叫得動），不要讀成「從此不會有 orphan」。

### NEVER 用 slots 數量近似記憶體

slot 是計數不是權重；記憶體權重靠 cgroup（`agent-workloads.slice` 與每個 session scope 的 `MemoryMax`）。要讓便宜的 heavy 併跑就**分池**（各池一把鎖），不要做成多單位計數 semaphore——檔案鎖上部分持有會死鎖。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 取不到 slot → 排隊（`wait`）或 exit 75（`try`）。**排隊不失敗**：硬 block 會逼人加逃生口，而逃生口常設等於閘門失效 |
| 消費端 | 每一次 `pnpm typecheck` / `test` / `build`（經 `clade-gate` 的必經點，全 fleet 已投影）；孤兒 holder 的判讀由逾時診斷輸出交給人 |
| 載入路徑 | 本節 frontmatter paths 包含 `package.json` / `vite.config.*` / `tsconfig*.json`，接 heavy gate 的 script 就寫在那些檔裡；各 runtime adapter 交付相同義務 |
