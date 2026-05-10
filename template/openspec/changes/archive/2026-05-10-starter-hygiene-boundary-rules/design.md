## Context

`nuxt-supabase-starter` 是 dual-role monorepo：repo root 是 meta 維護層，`template/` 是被 scaffold / degit 帶走的 starter seed。Spectra CLI 的 cwd 是 `template/`，所以本 change 的 artifacts 放在 `template/openspec/changes/starter-hygiene-boundary-rules/`；但實作會跨到 repo root。所有 root 路徑在本 design / tasks 以 `../` 表示，或在文字中註明「相對 repo root，非 `template/`」。

目前 root `CLAUDE.md` 只說明 monorepo 結構，沒有明確定義 meta vs template 的邊界。`template/.claude/rules/` 是 clade-managed LOCKED projection，不適合作為 root meta repo 的 starter hygiene 規則落點。若缺少 root 層規則與自動化 gate，任何 dogfood 業務碼、私人 `.env`、真實 email / tenant / token、或未標記 starter-only 文件都可能被使用者新專案繼承。

## Goals / Non-Goals

**Goals:**

- 建立 root meta repo 的 starter hygiene rule，讓維護者與 Claude session 在改檔前能判斷 root meta 工作與 `template/` seed 工作。
- 讓 pre-commit hook 對 staged `template/` 檔案 fail-closed，阻擋私人 env、secret-like pattern、dogfood business hints 與未標記 starter-only 文件污染。
- 提供 root 層離線 audit script，讓 apply / commit / CI 可以用同一組檢查語彙掃完整 `template/` tree。
- 補 root `CLAUDE.md` 的邊界段落，要求跨層 Spectra change 在 design/tasks 標明 root path vs `template/` path。
- 用 ADR 記錄防污染三層治理：防線 A 邊界、後續防線 B 投影、後續防線 C 驗證。

**Non-Goals:**

- 不動 `template/.claude/rules/`、`.agents/`、`.codex/` 等投影產物。
- 不把 strip manifest、create-clean、validate-starter CI gate 合進本 change。
- 不改 `template/packages/create-nuxt-starter/src/*.ts`、scaffolder presets、Nuxt runtime、database schema 或 UI。
- 不在本 change 定義完整 dogfood keyword taxonomy；只建立保守的第一版 block / warn 清單與可擴充 scanner 結構。

## Decisions

### Root meta rule is the starter hygiene source of truth

新增 root 層 `../.claude/rules/starter-hygiene.md`，frontmatter 遵守既有 rule 慣例：`description` 說明 starter hygiene 邊界治理，`globs` 覆蓋 `CLAUDE.md`、`template/**`、`scripts/**`、`.husky/**` 與 `openspec/changes/**`。內容使用現有 rules 的語氣與違反回報格式，並明確分成 MUST / NEVER / Violation detection。

此 rule 是 nuxt-supabase-starter meta repo 自身治理，不是 clade shared rule，也不是 `template/.claude/rules/` projection。若 apply 時 root `.claude/` 不存在，先建立 root `.claude/rules/`；不得把這份 rule 寫到 `template/.claude/rules/`。

Alternatives considered:

- 直接改 `template/.claude/rules/`：拒絕，因為它是 clade-managed LOCKED projection，而且會被 scaffold 帶走。
- 只補 `CLAUDE.md`：拒絕，因為缺少可被 hook / review 引用的規則 SoT。

### Fail-closed pre-commit hook protects staged template files

新增或更新 root 層 `../.husky/pre-commit`。Hook 先收集 `git diff --cached --name-only --diff-filter=ACMR` 中 `template/` 開頭的 staged paths；若沒有 template staged paths，快速通過並保留既有 hook 行為。若有 template staged paths，hook 用 bash-only 檢查：

- private env path：阻擋 `template/.env`、`template/.env.local`、`template/**/.env`、`template/**/.env.local`，但允許 `.env.example`。
- secret-like content：阻擋 `sk-` token、Bearer token、JWT-shaped string、known cloud/API key prefix、疑似真實 private key block。
- personal identifier：阻擋非 placeholder 的 email / tenant / UUID pattern，允許 `example.com`、`example.test`、`localhost`、`00000000-0000-0000-0000-000000000000` 這類 placeholder。
- starter-only docs：對 `template/**/*.md` 中不在 `template/.examples/` 或 `template/.starter/` 的檔案掃描 `starter-only`、`internal-only`、`do not scaffold`、`dogfood` 等 marker；命中時 block，要求改成 `*.starter.md` 或移到 `template/.starter/` / `template/.examples/`。
- dogfood schema/page hints：對 `template/supabase/migrations/**` 與 `template/app/pages/**` 掃描 business-specific entity hints，命中時 block 並要求移到 root docs / examples / playground 或另開 change 評估。

Hook 錯誤訊息使用 `[Starter Hygiene] <檢查名> 不通過`，並包含問題、證據、修正方式、繞過方式四段。Hook 的預設策略是 fail-closed：檢查本身出錯或讀 staged blob 失敗時 block commit，避免污染靜默進 history。

Alternatives considered:

- 只做全樹 grep script，不接 pre-commit：拒絕，因為污染會先進 commit history。
- 用 Node script 實作 hook：暫不採用，因 root meta repo 不一定有 package entrypoint；bash-only 啟動成本與依賴面最小。

### Audit script reuses hook semantics for full-tree scans

新增 root 層 `../scripts/audit-template-hygiene.sh`，與 hook 使用同一組分類名稱與 stderr 格式，但掃描範圍是完整 `template/` tree。Script 必須支援 repo root 執行，也必須從 `template/` cwd 執行時能正確定位 repo root。Exit code 0 表示無 finding；非 0 表示至少一個 finding；scanner internal error 也非 0 並列出失敗原因。

Script 應提供最少兩種用法：預設掃描真實 `template/`，以及測試用的 fixture root override（例如 env var 或 flag）讓 unit test 可以建立乾淨與污染 fixture。未來 Change 2 的 validate-starter CI gate 可以直接呼叫這支 script，而不需要重新定義規則。

Alternatives considered:

- Hook 與 audit script 各自維護 pattern：拒絕，因為 rule/hook/audit 會 drift。
- 等 Change 2 才加 script：拒絕，因為本 change 的手動驗證與 archive gate 需要離線稽核入口。

### Root CLAUDE documents the meta vs template boundary

更新 root `../CLAUDE.md`，在現有 Project Structure 後補「Meta vs Template 邊界」段落。段落內容包含：

- root meta repo 與 `template/` starter seed 的責任表。
- 改檔流程：先判斷 root meta、`template/` seed、或跨層 change；跨層時在 design/tasks 寫清楚路徑層級。
- `template/CLAUDE.md` 的 Source Of Truth 只管理 template 內 agent projection；不要把 root meta 維護腳本邏輯混進 `template/scripts/`。
- 防污染三層治理引用：防線 A 邊界（本 change）、防線 B 投影（strip manifest）、防線 C 驗證（validate-starter / CI）。

Alternatives considered:

- 只在 new rule 記錄邊界：拒絕，因 Claude session 入口先讀 `CLAUDE.md`，入口文件必須指向 rule。

### ADR and roadmap sync preserve the governance decision

新增 `docs/decisions/2026-05-10-starter-meta-template-boundary.md`（相對 `template/`，也就是 `template/docs/decisions/...`），用 ADR 記錄：問題、決策、範圍、後續防線 B/C 依賴。Archive 後同步 `openspec/ROADMAP.md` MANUAL `## Done` 區塊，標記 Change 1 已完成，讓 Next Moves 的 Change 2 可依賴此 change。

Alternatives considered:

- 只讓 Spectra archive 當歷史：拒絕，因這是 repo hygiene 決策，未來 scaffold/validate 變更需要短路徑引用。

## Risks / Trade-offs

- [Risk] Regex false positive 阻擋合法 starter 範例。→ Mitigation: rule 明確允許 placeholder domain / UUID / `.env.example`，hook stderr 要求用 `template/.examples/`、`template/.starter/` 或 `*.starter.md` 標記。
- [Risk] Regex false negative 漏掉新型 secret 或 business entity。→ Mitigation: audit script pattern 集中化，未來 Change 2 可以把 validate-starter CI gate 接上，同時新增 regression fixture。
- [Risk] Root `.husky/pre-commit` 若不存在，新增 Husky hook 但沒有 install 流程。→ Mitigation: tasks 先檢查 root 是否已有 `.husky/` / package script；若沒有，建立可直接被 git hooks path 使用的 root hook，並在 ADR 記錄目前 enforcement 的啟用前提。
- [Risk] `openspec/ROADMAP.md` auto 區塊被手動改壞。→ Mitigation: 只更新 MANUAL `## Done` 區塊；auto 區塊仍交給 spectra sync scripts。
- [Risk] Root rule 與 hook drift。→ Mitigation: tasks 要求 rule 的 Violation detection 與 hook check names 一一對齊，並在 audit test fixtures 覆蓋每個 check name。

## Migration Plan

1. 新增 root meta rule，確認 frontmatter 與現有 `.claude/rules/*.md` 慣例一致。
2. 新增或更新 root pre-commit hook，保留既有 hook 行為並在 hygiene fail 時提早 exit。
3. 更新 root `CLAUDE.md` 的邊界指引。
4. 新增 audit script 與 fixture-based test。
5. 執行 audit script、hook fake staged file 測試、clean staged file 測試。
6. 新增 ADR，archive 後同步 ROADMAP Done。

Rollback strategy：移除 root `.claude/rules/starter-hygiene.md`、還原 root `CLAUDE.md` 段落、移除 hook 中 `[Starter Hygiene]` block、移除 audit script 與 ADR。因無 runtime / schema 變更，不需要 database rollback。

## Open Questions

None.
