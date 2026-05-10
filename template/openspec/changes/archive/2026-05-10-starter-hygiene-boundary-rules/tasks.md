## 1. Boundary Rule（root .claude/rules/starter-hygiene.md）

- [x] 1.1 建立 root path `../.claude/rules/starter-hygiene.md`，落實 design 決策「Root meta rule is the starter hygiene source of truth」與 spec requirement「Meta and template boundary rule」。
- [x] 1.2 在 `../.claude/rules/starter-hygiene.md` 定義 root meta repo、`template/` starter seed、`template/.examples/`、`template/.starter/`、`*.starter.md` 的責任邊界，明確寫出哪些改動屬 root meta、哪些改動會被 scaffold 帶走。
- [x] 1.3 在 `../.claude/rules/starter-hygiene.md` 列舉 starter pollution 類型：dogfood 業務碼、私人 env、secret-like pattern、真實 email / tenant identifier、未標記 starter-only 文件、root 維護腳本誤放進 `template/scripts/`。
- [x] 1.4 在 `../.claude/rules/starter-hygiene.md` 寫入 Spectra session 分流規則：跨 root 與 `template/` 的 change 必須在 proposal / design / tasks 標註 path 層級；只改 root meta、只改 starter seed、或需另開 change 的情境要分開判斷。
- [x] 1.5 在 `../.claude/rules/starter-hygiene.md` 定義「Starter hygiene violation reporting format」，讓 rule、hook、audit script 都使用 `[Starter Hygiene] <check name> 不通過`，並包含問題、證據、修正方式、繞過方式。

## 2. Pre-commit Hook Enforcement（root .husky/pre-commit）

- [x] 2.1 建立或更新 root path `../.husky/pre-commit`，落實 design 決策「Fail-closed pre-commit hook protects staged template files」與 spec requirement「Staged template hygiene pre-commit enforcement」；若已有 hook，保留既有行為。
- [x] 2.2 在 `../.husky/pre-commit` 偵測 staged `template/.env`、`template/.env.local`、`template/**/.env`、`template/**/.env.local` 並必擋；`template/.env.example` 僅允許 placeholder 值。
- [x] 2.3 在 `../.husky/pre-commit` 偵測 secret pattern 並必擋，至少涵蓋 API key prefix、`Bearer` token、JWT-shaped token、Slack webhook URL、private key block；stderr 不得印出完整 secret value。
- [x] 2.4 在 `../.husky/pre-commit` 偵測未標記 starter-only 文件，依 `../.claude/rules/starter-hygiene.md` 的 rule 決定 warn 或 block；block 時要求改成 `*.starter.md` 或移入 `template/.starter/` / `template/.examples/`。
- [x] 2.5 在 `../.husky/pre-commit` 偵測 dogfood schema/page hints、真實 email、tenant identifier、非 placeholder UUID；命中時使用 spec requirement「Starter hygiene violation reporting format」輸出既有 rule violation 回報格式。
- [x] 2.6 在 `../.husky/pre-commit` 保留 fail-closed 行為：staged blob 讀取失敗、scanner error、或 rule/hook check name 對不上時一律 exit non-zero，避免污染靜默進 git history。

## 3. Audit Script（root scripts/audit-template-hygiene.sh）

- [x] 3.1 建立 root path `../scripts/audit-template-hygiene.sh`，落實 design 決策「Audit script reuses hook semantics for full-tree scans」與 spec requirement「Full-tree template hygiene audit script」；script 必須可獨立 CLI 執行。
- [x] 3.2 在 `../scripts/audit-template-hygiene.sh` 支援從 repo root 或 `template/` cwd 執行時定位 repo root，並掃描完整 `template/` tree，而不是只看 staged files。
- [x] 3.3 在 `../scripts/audit-template-hygiene.sh` 掃描私人 env、secret-like pattern、真實 email、tenant identifier、非 placeholder UUID、未標記 starter-only 文件、dogfood schema/page hints。
- [x] 3.4 在 `../scripts/audit-template-hygiene.sh` 明寫 report 格式為人類可讀格式；每個 finding 依 check name 分組，包含檔案路徑、pattern category、修正方式，且不得印出完整 secret value。
- [x] 3.5 在 `../scripts/audit-template-hygiene.sh` 實作 exit code contract：exit 0 = 乾淨；非 0 = 有 finding 或 scanner error；scanner error 必須列出失敗原因。
- [x] 3.6 建立 root path `../scripts/audit-template-hygiene.test.sh` 或等效 fixture runner，覆蓋乾淨 template、fake `.env`、secret-like token、真實 email / tenant identifier、未標記 starter-only 文件、從 `template/` cwd 執行 root detection。

## 4. Root CLAUDE.md 補邊界指引

- [x] 4.1 更新 root path `../CLAUDE.md`，落實 design 決策「Root CLAUDE documents the meta vs template boundary」與 spec requirement「Root agent guidance for meta versus template work」，在現有 root `CLAUDE.md` 補「Meta vs Template 邊界」段落。
- [x] 4.2 在 `../CLAUDE.md` 加入常見決策表：要改 root meta、要改 `template/`、要新建 Spectra change、要登記 tech debt / ROADMAP 的情境各一列。
- [x] 4.3 在 `../CLAUDE.md` 引用 `../.claude/rules/starter-hygiene.md`，並明確說明 `template/.claude/rules/` 是 clade-managed projection，不是 root meta hygiene rule 的落點。
- [x] 4.4 在 `../CLAUDE.md` 補跨層 Spectra 指引：root paths 以 repo root 或 `../` 標註；`template/` paths 以 Spectra cwd 為準；proposal / design / tasks 不得混淆 path 層級。

## 5. ADR（template/docs/decisions/2026-05-10-starter-meta-template-boundary.md）

- [x] 5.1 建立 `docs/decisions/2026-05-10-starter-meta-template-boundary.md`，落實 design 決策「ADR and roadmap sync preserve the governance decision」與 spec requirement「Governance artifact sync」。
- [x] 5.2 在 ADR 寫入 Context：`nuxt-supabase-starter` root 是 meta 維護層、`template/` 是會被 scaffold / degit 帶走的 starter seed，因此需要明確邊界。
- [x] 5.3 在 ADR 寫入 Decision：三層治理 A/B/C，其中 A = 本次 starter hygiene boundary rule + hook + audit；B = 後續 strip manifest / projection cleanup；C = 後續 validate-starter / CI gate，本次只做 A。
- [x] 5.4 在 ADR 寫入 Alternatives：DB-only enforcement、只合併到既有 commit hook、不新增 root rule、只靠文件提醒，並說明拒絕理由。
- [x] 5.5 在 ADR 寫入 Trade-offs：fail-closed 會影響開發節奏、regex 可能 false positive，但相對於污染所有新 scaffold 專案的風險，應優先阻擋並提供可追溯繞過方式。

## 6. Backend Verification Evidence

- [x] 6.1 apply 階段 Claude 自跑、自貼證據：模擬 staged `template/.env.local`，執行 root `../.husky/pre-commit`，預期 hook exit non-zero 並貼 stderr，stderr 必須含 `[Starter Hygiene] private env file 不通過` 或 rule 定義的同名 check。 (verified-by-codex-phase-b: 隔離 GIT_INDEX_FILE 測試於 root meta repo cwd 內 — `template/.env.local` 被 `[Starter Hygiene] private-env-file 不通過` 擋下、Bearer token 被 `secret-like-content` 擋下)
- [x] 6.2 apply 階段 Claude 自跑、自貼證據：模擬 staged 乾淨 starter-safe 檔案，執行 root `../.husky/pre-commit`，預期 hook exit 0，且不需要啟動 Node / package manager。 (verified-by-codex-phase-b: 隔離測試「乾淨 markdown 通過」+ Phase B Codex Report 確認 `bash -n` 與目前 staged 狀態通過)
- [x] 6.3 apply 階段 Claude 自跑、自貼證據：在乾淨 template tree 執行 `bash ../scripts/audit-template-hygiene.sh` 或從 repo root 執行 `bash scripts/audit-template-hygiene.sh`，預期 exit 0，並貼人類可讀 report 的 clean 摘要。 (verified: 主線 `bash ../scripts/audit-template-hygiene.sh` exit 0 + stdout `[Starter Hygiene] No starter hygiene findings detected in template/.`)
- [x] 6.4 apply 階段 Claude 自跑、自貼證據：對 fixture（含 fake `.env`、fake secret-like token、fake starter-only 文件）執行 `bash ../scripts/audit-template-hygiene.sh` 或等效 fixture runner，預期 exit non-zero，並貼 finding 分組摘要。 (verified: 主線 `bash ../scripts/audit-template-hygiene.test.sh` 全 6 cases 通過 — clean / private env / secret-like / real email + tenant / unmarked starter-only doc / template cwd root detection 全綠)

## 7. 人工檢查

_本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 `## 6. Backend Verification Evidence`）；deploy 前無使用者人工檢查項目。_
