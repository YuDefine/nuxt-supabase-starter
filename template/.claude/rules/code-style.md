<!--
🔒 LOCKED — managed by clade
Source: rules/core/code-style.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: 程式碼格式化與 lint 工具鏈—一律用 vite-plus 的 oxfmt + oxlint，禁止 eslint / prettier
globs: ['**/*.{js,ts,vue,jsx,tsx,mjs,cjs,mts,cts,md,json}', '.*rc*', '.*.config.*']
---

# Code Style — vite-plus / oxc 工具鏈

**核心命題**：本治理範圍下所有 JS/TS 專案**一律使用 `vite-plus`（vp）內建的 oxc 工具鏈**：`oxfmt`（formatter）+ `oxlint`（linter）。禁止任何 eslint / prettier 設定檔。

理由：
- `oxc` 用 Rust 寫的，比 prettier/eslint 快 10–100 倍
- `vp` 已 batteries-included，不需要額外裝 / 維護兩套生態系
- 統一工具鏈避免 consumer 之間 lint rule drift

## 禁止事項（NEVER）

### 禁止建立 eslint 設定檔

**NEVER** 建立或保留以下任一檔案：

- `.eslintrc`、`.eslintrc.json`、`.eslintrc.js`、`.eslintrc.cjs`、`.eslintrc.yml`、`.eslintrc.yaml`
- `eslint.config.js`、`eslint.config.cjs`、`eslint.config.mjs`、`eslint.config.ts`
- `package.json` 內的 `eslintConfig` 鍵
- `.eslintignore`

### 禁止所有 prettier config 檔（`.prettierignore` 例外）

**NEVER** 建立或保留以下任一檔案：

- `.prettierrc`、`.prettierrc.json`、`.prettierrc.yaml`、`.prettierrc.yml`、`.prettierrc.toml`
- `.prettierrc.js`、`.prettierrc.cjs`、`.prettierrc.mjs`、`prettier.config.*`
- `package.json` 內的 `prettier` 鍵

#### `.prettierignore` 例外（clade-managed）

`.prettierignore` 由 clade 治理（`scripts/lib/prettierignore-governance.mjs`），**只能**保留 clade-managed LOCKED projections（`.claude/rules/`、`.claude/skills/`、`.claude/hooks/`、`.claude/agents/`、`.agents/`、`.codex/`）的 ignore 條目。**禁止**手動加任何其他條目，也**禁止**整個刪除——刪掉之後 `pnpm hub:bootstrap` 會自動重建。

理由：vite-plus 0.1.14 / oxfmt 0.42.0 的 `.oxfmtrc.json` `ignorePatterns` 欄位**不會被套用到 file walking**（已驗證 bug，2026-05），導致 oxfmt 走訪 LOCKED 目錄時試圖寫入 chmod 444 檔案、被報成 format issue 讓 `pnpm vp fmt --check` 紅燈。`.prettierignore` 是 oxfmt 預設 fallback ignore-file，能正確生效。等 oxfmt 修好 `ignorePatterns` 之後可以撤回此例外。

### 禁止把 eslint / prettier 加進 dependencies

**NEVER** 在 `package.json` `dependencies` / `devDependencies` 安裝：

- `eslint`、`@typescript-eslint/*`、任何 `eslint-config-*` / `eslint-plugin-*`
- `prettier`、`@trivago/prettier-plugin-*`、任何 `prettier-plugin-*`

例外：當第三方套件（如 husky / lint-staged / Nuxt module）的 peer dependency 強制要求時，可保留，但**不該被 user code 直接呼叫**。

### 禁止在 lint-staged / pre-commit / CI 命令中呼叫 eslint / prettier

**NEVER** 在 hook script、`package.json` `scripts`、CI workflow 寫：

- `eslint --fix` / `eslint .`
- `prettier --write` / `prettier --check`

一律改用 `vp lint` / `vp fmt` / `vp staged`（Vite+ 提供）或直接 `oxlint --fix` / `oxfmt`（oxc CLI）。

## 必須事項（MUST）

### 用 vp 命令做 lint / format

```bash
# Lint（修復可自動修復的問題）
pnpm vp lint --fix

# Format
pnpm vp fmt

# Pre-commit staged 檢查（lint + fmt 在 staged files 上）
pnpm vp staged
```

`vp` 內部呼叫 oxc，行為一致。

### lint-staged 配置（若用 husky）

`.lintstagedrc.cjs`：

```js
module.exports = {
  '*.{js,ts,vue,jsx,tsx}': ['oxlint --fix', 'oxfmt'],
  '*.md': (files) => {
    const allowed = files.filter(
      (f) => !f.startsWith('.claude/rules/') && !f.startsWith('.claude/skills/') && !f.startsWith('.claude/hooks/')
    )
    return allowed.length ? [`oxfmt ${allowed.join(' ')}`] : []
  },
}
```

`.claude/{rules,skills,hooks}/` 由 clade 治理（chmod 444），lint-staged 必須排除。

### Pre-commit hook 用 `vp staged`

`.husky/pre-commit` / `.vite-hooks/pre-commit`：

```sh
vp staged
```

或當需要 customize 時：

```sh
pnpm exec vp lint --fix --no-error-on-unmatched-pattern "$@"
pnpm exec vp fmt --no-error-on-unmatched-pattern "$@"
```

### 自家 ignore patterns — 雙軌制

**(A) 專案自己的 ignore（用 `.oxfmtrc.json` `ignorePatterns`）**

oxfmt 自家 config（`.oxfmtrc.json`）的 `ignorePatterns` 欄位是專案 ignore 的**主要**機制：

```json
{
  "$schema": "https://oxc.rs/schemas/oxfmtrc.json",
  "ignorePatterns": [
    "coverage/**",
    ".nuxt/**",
    ".output/**",
    "dist/**",
    "node_modules/**",
    "**/database.types.ts",
    "pnpm-lock.yaml",
    "supabase/seed.sql"
  ]
}
```

> ⚠️ **已知 upstream bug**（2026-05 驗證）：vite-plus 0.1.14 / oxfmt 0.42.0 的 `ignorePatterns` 欄位**不會被套用到 file walking**——換句話說只有用 `--ignore-path` 或預設 fallback（`.gitignore` / `.prettierignore`）才會生效。等 oxfmt 修好之後 `ignorePatterns` 才會回到「正確且唯一」位置。

**(B) Clade-managed LOCKED projections ignore（用 `.prettierignore`，clade 治理）**

`.claude/rules/`、`.claude/skills/`、`.claude/hooks/`、`.claude/agents/`、`.agents/`、`.codex/` 這些 clade 投影目錄是 chmod 444，oxfmt 不能寫入但會走訪到，會被報 format issue。clade 透過 `scripts/lib/prettierignore-governance.mjs` 在 `pnpm hub:bootstrap` 時自動寫 `.prettierignore`，oxfmt 預設 fallback 就會讀到並跳過。**consumer 不要手動編輯這個檔**。

對 oxlint，用 `.oxlintrc.json` 的 `ignorePatterns`（同名欄位）：

```json
{
  "$schema": "https://oxc.rs/schemas/oxlintrc.json",
  "ignorePatterns": [".claude/**", "shared/types/database.types.ts"]
}
```

產生範本指令：

```bash
pnpm exec vp fmt --init        # 產 .oxfmtrc.json 預設值
pnpm exec vp fmt --migrate=prettier  # 從既有 prettier config 遷移（若有）
```

`.gitignore` 不該作為 lint/format ignore（git 跟 lint 是獨立面向）。LOCKED 投影目錄走 `.prettierignore`（B 軌）；專案自家 ignore 走 `.oxfmtrc.json` `ignorePatterns`（A 軌，等 oxfmt 修好後生效；目前可暫時 fallback 用 `.gitignore` 已 ignore 的條目掩護）。

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

## 違反偵測（建議擴充）

以下 enforcement 之後可加進 clade：

- `scripts/audit-tooling-drift.mjs`：掃 consumer 是否有 `.eslintrc*` / `.prettierrc*` 等檔案，存在則報 drift
- pre-commit hook 加 check：偵測到 eslint/prettier config 進 staging 直接擋
- CI workflow 同步檢查

當前版本（v0.1.3）僅以 rule 規範，未加自動偵測。發現 consumer 違反時手動報修。

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
