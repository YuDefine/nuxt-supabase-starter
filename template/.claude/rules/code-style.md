---
description: 程式碼格式化與 lint 工具鏈—一律用 vite-plus 的 oxfmt + oxlint，禁止 eslint / prettier
paths: ['**/*.{js,ts,vue,jsx,tsx,mjs,cjs,mts,cts,md,json}', '.*rc*', '.*.config.*']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/code-style.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Code Style — vite-plus / oxc 工具鏈

**核心命題**：本治理範圍下所有 JS/TS 專案**一律使用 `vite-plus`（vp）內建的 oxc 工具鏈**：`oxfmt`（formatter）+ `oxlint`（linter）。禁止任何 eslint / prettier 設定檔。

理由：
- `oxc` 用 Rust 寫的，比 prettier/eslint 快 10–100 倍
- `vp` 已 batteries-included，不需要額外裝 / 維護兩套生態系
- 統一工具鏈避免 consumer 之間 lint rule drift

## Governance — lint / fmt 設定改在哪

**跨 consumer 統一的 baseline**（oxlint rules / oxfmt 風格 / 共用 ignore patterns）**MUST** 改在 clade 中央倉 `vendor/oxc-shared/preset.mjs`，再 `node scripts/publish.mjs <bump> && node scripts/propagate.mjs` 散播到所有 consumer。**NEVER** 在 consumer 端的 `vendor/oxc-shared/preset.mjs` 投影副本直接改 — 下次 propagate 會覆蓋，且各 consumer 會 silently drift。

**consumer 自家業務 override**（單一 consumer 因第三方套件需要關掉某條 rule、或自家業務需要加 ignore path）寫在該 consumer 的 `vite.config.ts` 內、`spread baseline 之後`的 override block，**禁止**整段 inline 重寫 baseline（會 silently drift）。範例見下方 § `vite.config.ts` 必備欄位。

判斷流程：

1. 「這條規則 / 風格 / ignore 是否每個 consumer 都該套？」
   - 是 → clade `vendor/oxc-shared/preset.mjs`（baseline）
   - 否，只有單一 consumer 需要 → 該 consumer 自家 `vite.config.ts` override block
2. 不確定 → 預設放 clade baseline（過鬆比過嚴容易補；先散播再個別 override 比反向收斂容易）

## 禁止事項（NEVER）

### 禁止建立 eslint 設定檔

**NEVER** 建立或保留以下任一檔案：

- `.eslintrc`、`.eslintrc.json`、`.eslintrc.js`、`.eslintrc.cjs`、`.eslintrc.yml`、`.eslintrc.yaml`
- `eslint.config.js`、`eslint.config.cjs`、`eslint.config.mjs`、`eslint.config.ts`
- `package.json` 內的 `eslintConfig` 鍵
- `.eslintignore`

### 禁止所有 prettier config 檔（含 `.prettierignore`）

**NEVER** 建立或保留以下任一檔案：

- `.prettierrc`、`.prettierrc.json`、`.prettierrc.yaml`、`.prettierrc.yml`、`.prettierrc.toml`
- `.prettierrc.js`、`.prettierrc.cjs`、`.prettierrc.mjs`、`prettier.config.*`
- `package.json` 內的 `prettier` 鍵
- **`.prettierignore`**（自 v0.4.x 起進入黑名單，由 `.oxfmtignore` + `--ignore-path` 取代）

理由：oxfmt 有自己的 ignore-file 機制（[官方 docs](https://oxc.rs/docs/guide/usage/formatter/ignore-files)），不必借用 prettier 的命名空間。`.prettierignore` 留著會（a）讓 oxfmt fallback 行為跟「我們其實沒裝 prettier」的事實互相矛盾、（b）讓 consumer 誤以為還在用 prettier、（c）在 IDE 端被 prettier 擴充誤觸發。

#### `.oxfmtignore`（clade-managed，承接原 `.prettierignore` 用途）

`.oxfmtignore` 由 clade 治理（`scripts/lib/oxfmtignore-governance.mjs`），**只能**保留 clade-managed LOCKED projections（`.claude/rules/`、`.claude/skills/`、`.claude/hooks/`、`.claude/agents/`、`.claude/commands/`、`.agents/`、`.codex/`）的 ignore 條目。**禁止**手動加任何其他條目，也**禁止**整個刪除——刪掉之後 `pnpm hub:bootstrap` 會自動重建。

oxfmt 不會自動 fallback 讀 `.oxfmtignore`（只有 `.prettierignore` / `.gitignore` 是 fallback），所以**所有 `vp fmt` 調用入口都必須顯式帶 `--ignore-path .oxfmtignore`**。clade 散播的 `package.json` `format` / `format:check` script 已預先帶 flag，consumer 端走 `pnpm format` / `pnpm format:check` 即可；裸打 `vp fmt` 必須手動加 flag。

> ⚠️ 不能用 `.oxfmtrc.json` `ignorePatterns` 欄位承接：vite-plus 0.1.21 / oxfmt 0.48 仍有 upstream bug，`ignorePatterns` **不會被套用到 file walking**（2026-05 重驗確認）。等 upstream 修好後再評估是否撤回 `.oxfmtignore` 例外、改用 `ignorePatterns` 集中設定。

### 禁止把 eslint / prettier 加進 dependencies

**NEVER** 在 `package.json` `dependencies` / `devDependencies` 安裝：

- `eslint`、`@typescript-eslint/*`、任何 `eslint-config-*` / `eslint-plugin-*`
- `prettier`、`@trivago/prettier-plugin-*`、任何 `prettier-plugin-*`

例外：當第三方套件（如 husky / lint-staged / Nuxt module）的 peer dependency 強制要求時，可保留，但**不該被 user code 直接呼叫**。

### 禁止依賴全域 vite-plus（hard rule）

`vite-plus`（vp）**MUST** 安裝為 consumer 的 per-project devDependency 並 pin 具體版本。**禁止**僅依賴全域 `pnpm add -g vite-plus` 而 consumer `package.json` 不列。

**推薦寫法（catalog mode，對齊官方）**：

```jsonc
// package.json
"devDependencies": { "vite-plus": "catalog:" }
```
```yaml
# pnpm-workspace.yaml
catalog:
  vite-plus: 0.1.21      # ← strict pin，不要 ^ / ~
```

理由：vite-plus 官方 migrator（`packages/cli/src/migration/migrator.ts`）對 pnpm workspace 預設寫 `"catalog:"` 引用 + 把版本放 catalog；官方 repo 自家也用 `catalogMode: prefer`。catalog 機制把版本集中管理，未來拆 sub-package / 升級時改一處。

**Fallback 寫法（devDeps direct）**：

```jsonc
"devDependencies": { "vite-plus": "0.1.21" }
```

純單 repo + 不打算用 catalog 時可走。功能等價，audit signal 都會回 `aligned`。

#### 理由

- 全域版本是 user 機器狀態，跨機器、跨 CI runner 不一致 → `vp lint` / `vp fmt` 行為漂移。CI 跟 dev 抓到不同 lint violation 是常見實證踩坑（user 升全域 → 突然某條 rule 變嚴 → dev 過 / CI 紅）。
- vp bundle 的 oxlint / oxfmt 版本由 vp `dependencies` 嚴格 pin（`=1.63.0` / `=0.48.0` 之類），等同 vp 版本 = 工具鏈確定版本。vp 沒釘 = 工具鏈沒釘。
- consumer 端升 vp **MUST** 走 [`upgrade-packages`](../../plugins/hub-core/skills/upgrade-packages/SKILL.md) skill（per-package commit + bisect-friendly + 走品質閘門），不是 user 跑 `pnpm add -g vite-plus@latest` 偷偷升所有 consumer。
- 跨 consumer 工具鏈 lockstep 是 clade governance 的前提（[`code-style.md`](./code-style.md) § Governance），全域裝法繞過了這層治理。

#### MUST

- consumer 端 `vite-plus` 必 pin 具體版本（不是 `^` / `~` / `*`），透過下列任一機制：
  - **catalog mode（推薦）**：`package.json` `"vite-plus": "catalog:"` + `pnpm-workspace.yaml` 的 `catalog.vite-plus: <pinned version>`
  - **devDeps direct**：`package.json` `devDependencies.vite-plus: "<pinned version>"`
- 新 fork consumer 第一件事：`pnpm add -D vite-plus@<latest stable>`。pnpm workspace consumer 建議手動改寫成 `"catalog:"` + 加 `pnpm-workspace.yaml` catalog，對齊官方 migrator 行為。

#### NEVER

- consumer `package.json` 完全沒 `vite-plus` 條目、跑 `vp` 靠 user `~/Library/pnpm/global/.../vite-plus`。
- 跑 `pnpm add -g vite-plus`（純探索用 OK，但**MUST** 在當天內改成 per-project）。
- 在 consumer 端用 `"vite-plus": "^0.1.x"` 浮動 range — vp 嚴格 pin oxlint / oxfmt，浮動 vp 等於浮動工具鏈。

#### 對應偵測

`scripts/audit-tooling-drift.mjs` 提供 `viteplusLocal` signal（diagnostic-only，exit code 永遠 0），對每個 consumer 讀 `package.json` 看 `vite-plus` 是否 pinned-local。

#### 真實事故參考


### 禁止在 lint-staged / pre-commit / CI 命令中呼叫 eslint / prettier

**NEVER** 在 hook script、`package.json` `scripts`、CI workflow 寫：

- `eslint --fix` / `eslint .`
- `prettier --write` / `prettier --check`

一律改用 `vp lint` / `vp fmt` / `vp staged`（Vite+ 提供）。

> ⚠️ **NEVER** 直接呼叫 `oxlint` / `oxfmt` CLI binary：在 vite-plus 0.1.x 起，這兩個 binary 已退化成 IDE-only / LSP-only stub，直接執行會回傳 `This oxfmt wrapper is for IDE extension use only` 錯誤導致 pre-commit / CI 失敗。**MUST** 走 `vp lint` / `vp fmt` 入口（vp 內部會用編譯版 oxc）。

### CI workflow 禁止跑 `vp check` / `vp run check`（hard rule）

**NEVER** 在 `.github/workflows/**.yml` 跑 `vp check` 或 `vp run check`。

理由：`vp check` 內部 fmt step **不支援 `--ignore-path` flag**（CLI 沒這 option，pass-through 也不一定生效），意思是 CI 環境下 `vp check` 會掃描整 working tree 包括 LOCKED projection（`.claude/agents/`、`.claude/commands/` 等 chmod 444 檔），撞 oxfmt format issue → CI 紅燈。

consumer 端 LOCKED projection 的 ignore 機制設計：
- `.oxfmtignore` 由 clade `scripts/lib/oxfmtignore-governance.mjs` 在 `pnpm hub:bootstrap` 時生成
- oxfmt **不會自動 fallback** 讀 `.oxfmtignore`（只認 `.prettierignore` / `.gitignore` 是 fallback，但 `.prettierignore` 已 v0.4.x 黑名單）
- 所有 `vp fmt` 調用入口**必須**顯式帶 `--ignore-path .oxfmtignore`
- clade 散播的 `package.json` `format` / `format:check` script 預埋此 flag：
  ```json
  "format:check": "vp fmt --check --ignore-path .oxfmtignore",
  "format": "vp fmt --write --ignore-path .oxfmtignore",
  ```

**MUST** CI workflow 拆 step 跑各別 npm script，每個 script 自帶必要 flag：

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

對應 `package.json` `check` script（local dev / pre-push 用）可保留 `vp check` 但 consumer 必須**清楚知道**這個 script 在 LOCKED projection 既有的情況下會撞——dev 端用 `vp staged` (pre-commit) 或拆 step 跑各別 npm script 替代。


## 必須事項（MUST）

### `vite.config.ts` 必備欄位（跨 consumer 統一，避免 propagate drift）

clade 散播檔（`vendor/scripts/*.mts`、`scripts/spectra-advanced/*`、`.github/actions/*`）會進到每個 consumer 的 `vp fmt` 掃描範圍。若 clade 與 consumer 的 `vite.config.ts` fmt 設定不一致，consumer 端 `vp fmt --check` 會把 clade 寫出的程式重排成 consumer 風格 → 形成 LOCKED 檔被改動 → CI 紅燈或下次 propagate 出現 drift commit。

**MUST** 從 clade 散播的 `vendor/oxc-shared/preset.mjs` import baseline 並 spread merge：

```ts
import { defineConfig } from 'vite-plus'
import { lintBase, fmtBase } from './vendor/oxc-shared/preset.mjs'

export default defineConfig({
  resolve: { alias: [/* consumer build config */] },

  lint: {
    ...lintBase,
    rules: {
      ...lintBase.rules,
      // 業務 override 僅放這裡（屬於 baseline 的請改 preset.mjs，跨 consumer 統一）
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

baseline 內容（自 `vendor/oxc-shared/preset.mjs`）：

- `fmt`: `semi: false`, `singleQuote: true`, `printWidth: 100`, `tabWidth: 2`, `trailingComma: 'all'`, `quoteProps: 'as-needed'`, `arrowParens: 'always'`, `endOfLine: 'lf'`, `htmlWhitespaceSensitivity: 'css'`, `vueIndentScriptAndStyle: true`, `experimentalSortPackageJson: { sortScripts: true }`
- `lint.categories`: `correctness:error` / `suspicious:warn` / `perf:warn` / `pedantic|style|restriction|nursery:off`
- `lint.plugins`: `['typescript', 'unicorn', 'import', 'promise']`
- `lint.rules`: `no-console:off`, `no-debugger:warn`, `no-alert:error`, `eqeqeq:['error','always']`, `@typescript-eslint/no-unused-vars:warn`, `no-await-in-loop:off`, `no-underscore-dangle:['warn',{allow:['__dirname','__filename']}]`
- `lint.env`: `{ browser: true, node: true, es2024: true }`
- 共通 `ignorePatterns`：`node_modules/`, `.nuxt/`, `.output/`, `dist/`, `coverage/`, `supabase/`, `.claude/skills/`, `.agents/`, `.codex/`, `.clade/`, `*.d.ts`（lint）;  `**/*.md`, `coverage/**`, `.nuxt/**`, `.output/**`, `pnpm-lock.yaml`, `.claude/plugins/cache/**`, `.spectra/**`（fmt）

**禁止**：

- 直接 inline 寫 `lint:` / `fmt:` 全部欄位而不 import preset — 哪天 preset 升版（例：oxlint patch 升 `no-underscore-dangle` 從 warn 升 error 要在 preset 反制），consumer 就會 silently drift。
- 在 consumer 端的 `vendor/oxc-shared/preset.mjs` 投影檔直接改 — 下次 propagate 會覆蓋。要改 baseline → cd 到 clade 改 `vendor/oxc-shared/preset.mjs` 再 propagate。


### 用 vp 命令做 lint / format

```bash
# Lint（修復可自動修復的問題）
pnpm vp lint --fix

# Format（裸打必須帶 --ignore-path，否則 LOCKED 投影檔會被報 format issue）
pnpm vp fmt --ignore-path .oxfmtignore

# 推薦走 package.json script（clade 散播的 hub-scripts 已預埋 flag）
pnpm format        # 等同 vp fmt --write --ignore-path .oxfmtignore
pnpm format:check  # 等同 vp fmt --check --ignore-path .oxfmtignore

# Pre-commit staged 檢查（clade 散播的 vp-staged.sh，shell layer 已過濾 LOCKED）
bash scripts/pre-commit/runner.sh
```

`vp` 內部呼叫 oxc，行為一致。**裸打 `vp fmt` 時遺漏 `--ignore-path .oxfmtignore` 就會掃到 LOCKED 投影檔**（chmod 444）並報 format issue。

### lint-staged 配置（若用 husky）

`.lintstagedrc.cjs`：

```js
module.exports = {
  '*.{js,ts,vue,jsx,tsx}': ['vp lint --fix', 'vp fmt --ignore-path .oxfmtignore'],
  '*.md': (files) => {
    const allowed = files.filter(
      (f) => !f.startsWith('.claude/rules/') && !f.startsWith('.claude/skills/') && !f.startsWith('.claude/hooks/')
    )
    return allowed.length ? [`vp fmt --ignore-path .oxfmtignore ${allowed.join(' ')}`] : []
  },
}
```

`.claude/{rules,skills,hooks}/` 由 clade 治理（chmod 444），lint-staged 必須排除。雙重保險：shell-side filter + `--ignore-path .oxfmtignore`。

> ⚠️ **NEVER** 用 `oxlint --fix` / `oxfmt` 直接呼叫（見上節「禁止在 lint-staged ... 中呼叫 eslint / prettier」的注意事項）。`vp lint` / `vp fmt` 是唯一正確入口。

### Pre-commit hook 用 `vp staged`

`.husky/pre-commit` / `.vite-hooks/pre-commit`：

```sh
vp staged
```

或當需要 customize 時：

```sh
pnpm exec vp lint --fix --no-error-on-unmatched-pattern "$@"
pnpm exec vp fmt --ignore-path .oxfmtignore --no-error-on-unmatched-pattern "$@"
```

### 自家 ignore patterns — 雙軌制

**(A) 專案自己的 ignore（首選 `vite.config.ts` `fmt.ignorePatterns`，目前壞著只能靠 `.gitignore` 掩護）**

`vite.config.ts` 內 `fmt.ignorePatterns`（或 `.oxfmtrc.json` 的同名欄位）是 oxfmt 規劃中的「正確且唯一」ignore 入口：

```ts
// vite.config.ts
fmt: {
  // ... 其他設定
  ignorePatterns: [
    'coverage/**',
    '.nuxt/**',
    '.output/**',
    'dist/**',
    'node_modules/**',
    '**/database.types.ts',
    'pnpm-lock.yaml',
    'supabase/seed.sql',
  ],
}
```

> ⚠️ **已知 upstream bug**（vite-plus 0.1.21 / oxfmt 0.48，2026-05 重驗）：`ignorePatterns` 欄位**不會被套用到 file walking**——只有 `--ignore-path` 或 fallback（`.gitignore`、`.prettierignore`）會生效。**`.prettierignore` 已被 rule 禁用**（見上節），所以實際 ignore 路徑只剩 `.gitignore` 與顯式 `--ignore-path`。等 upstream 修好後，`ignorePatterns` 才能回到「集中設定」位置。

**(B) Clade-managed LOCKED projections ignore（用 `.oxfmtignore` + `--ignore-path` 顯式 flag，clade 治理）**

`.claude/rules/`、`.claude/skills/`、`.claude/hooks/`、`.claude/agents/`、`.claude/commands/`、`.agents/`、`.codex/` 這些 clade 投影目錄是 chmod 444，oxfmt 不能寫入但會走訪到，會被報 format issue。clade 透過 `scripts/lib/oxfmtignore-governance.mjs` 在 `pnpm hub:bootstrap` 時自動寫 `.oxfmtignore`，並由 clade 散播的 `package.json` `format` / `format:check` script 預埋 `--ignore-path .oxfmtignore` flag。

**consumer 不要手動編輯 `.oxfmtignore`**（內容由 governance 治理；可以加自家條目，但 LOCKED 那幾條由 governance 維持）。

oxlint 的 ignore 走另一條路徑（`vite.config.ts` 內 `lint.ignorePatterns` 或 `.oxlintrc.json` `ignorePatterns`，**lint 的 `ignorePatterns` 是 work 的**），跟 fmt 不共用 `.oxfmtignore`：

```ts
// vite.config.ts
lint: {
  // ... 其他設定
  ignorePatterns: ['.claude/**', 'shared/types/database.types.ts'],
}
```

產生範本指令：

```bash
pnpm exec vp fmt --init        # 產 .oxfmtrc.json 預設值
pnpm exec vp fmt --migrate=prettier  # 從既有 prettier config 遷移（若有）
```

`.gitignore` 在 oxfmt fallback 鏈仍會被讀，可以順便擔任 `.nuxt/` / `.output/` 等構建產物的 ignore source；LOCKED 投影目錄走 `.oxfmtignore`（B 軌）；專案自家額外 ignore 寫進 `vite.config.ts` `fmt.ignorePatterns`（A 軌，等 oxfmt 修好後生效）。

## 心智模型

| 情境 | 工具 | 命令 |
| --- | --- | --- |
| 寫 code 時 IDE 即時 format | oxfmt（vp 包） | IDE 設 oxfmt 為 formatter |
| 寫 code 時 IDE 即時 lint | oxlint（vp 包） | IDE 設 oxlint extension |
| 跑全專案 lint | vp | `pnpm vp lint --fix` |
| 跑全專案 format | vp | `pnpm vp fmt` |
| pre-commit | vp | `vp staged` |
| CI lint check | vp | `pnpm vp lint`（非 --fix） |
| CI format check | vp | `pnpm vp fmt --check` |

## 違反偵測

### 已實作（v0.4.x+）

- `scripts/sync-rules.mjs --check` 在跑 drift report 時偵測 consumer 端 `.prettierignore` 存在 → 列為 drift
- `scripts/lib/oxfmtignore-governance.mjs` 在 `pnpm hub:bootstrap` 時主動刪除舊 `.prettierignore`（self-healing）
- `pnpm hub:check` 包含上述 drift signal，consumer 端 CI 應啟用此 job
- `scripts/audit-tooling-drift.mjs`（v1.3.19）：掃每個 consumer 的 `vite.config.ts` 對齊狀態。報兩個 signal：
  1. **presetImport** — 是否從 `./vendor/oxc-shared/preset.mjs` import `lintBase` + `fmtBase`
  2. **inlineDrift** — 未 import preset 時，inline 寫死的 fmt baseline 欄位（`trailingComma`、`semi`、`singleQuote`、`printWidth` 等 11 項）與 baseline 不一致的 entries
  - 用法：`node scripts/audit-tooling-drift.mjs [--markdown|--json]`；diagnostic-only，exit code 永遠 0；HANDOFF §4 baseline 由此 script 維護

### 建議擴充（尚未實作）

- `scripts/audit-tooling-drift.mjs` Phase 2：併入 `.eslintrc*` / `.prettierrc*` / `eslint.config.*` / `prettier.config.*` 等禁用 config 檔的存在性掃描（目前 sync-rules.mjs 只認 `.prettierignore` 一條）
- pre-commit hook 加 check：偵測到 eslint/prettier config 進 staging 直接擋
- CI workflow 同步檢查

## 與其他規則的關係

- `commit.md`：commit 走 `/commit` 流程；本規則補充 commit 前 `vp staged` 應該 pass
- `development.md`（framework/nuxt 等 variant）：framework-specific 風格約定（Composition API、`<script setup>` 等）跟本規則正交，**都要遵守**

## 違反時的回報方式

```
[Code Style] 偵測到禁止的工具鏈設定

問題：<檔案路徑> 是 eslint/prettier 設定檔

修正方式：
  - 刪除該檔案
  - 改用 vp lint / vp fmt（已透過 vite-plus 安裝）
  - 若有 customization 需求，移到 vp.config.ts

繞過：
  - 若有不可避免的 peer dependency 需求，加 <bypass marker> 並在
    docs/decisions/YYYY-MM-DD-<topic>.md 記錄理由
```
