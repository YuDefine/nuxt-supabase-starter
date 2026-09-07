## Context

`nuxt-supabase-starter` 現在同時有 root meta 維護層與 `template/` starter seed。Change 1 已建立 starter hygiene A 防線：root rule、pre-commit enforcement、full-tree audit script，以及 8 個固定 check names。Change 3 已把 NuxtHub D1 納入 scaffolder first-class DB stack，並補了 baseline、d-pattern-audit、nuxthub-ai、none 四條 audit regression path。

剩下的缺口是 B/C 防線：`../scripts/create-clean.sh` 與 `packages/create-nuxt-starter/src/assemble.ts` 都會影響「新專案最後帶走哪些檔案」，但目前沒有共用 manifest；fresh scaffold audit regression 也還沒有升級成每次 PR 必跑的 validate-starter gate。

## Goals / Non-Goals

**Goals:**

- 建立 `presets/_base/strip-manifest.json`，讓 create-clean 與 scaffolder 共用同一份 meta-only strip 判準。
- 讓 root `../scripts/create-clean.sh` 與 scaffolder assembly 都以 manifest 為 SoT，避免各自硬編清單 drift。
- 把 baseline、d-pattern-audit、nuxthub-ai、none 四條 fresh scaffold audit regression 包成可由 apply、commit、CI 共用的 validate-starter command。
- 新增 GitHub Actions workflow，讓 PR 直接跑 fresh scaffold + audit gate。
- 保持 backend-only scope，不新增 UI view、browser journey、migration、auth 或 audit script check-name 擴張。

**Non-Goals:**

- 不改 `../scripts/audit-template-hygiene.sh` 的 scanner vocabulary、regex、reporting format 或 8 個 check names。
- 不改 NuxtHub D1 overlay 的核心 manifest schema、migration SQL 或 dbStack implied behavior。
- 不把 `template/.claude/rules/` 當作 source of truth；clade-managed projection 仍不可直接改。
- 不把 Git hook 當作 CI gate 的替代品；hook 只擋 local commit，CI gate 才是 PR contract。
- 不做 generated app runtime 行為、database schema、RLS、auth provider 或 browser UI 變更。

## Decisions

### Decision 1: Single strip-manifest.json as SoT

選擇 `presets/_base/strip-manifest.json` 作為 single source of truth。這個位置在 `template/` 內，scaffolder 可以透過 `STARTER_ROOT` 穩定讀取，root `../scripts/create-clean.sh` 也可以從 repo root resolve 到 `template/presets/_base/strip-manifest.json`。

替代方案是放在 `packages/create-nuxt-starter/templates/_base/strip-manifest.json`。這會讓 scaffolder 讀取直覺，但 root `create-clean.sh` 會變成反向依賴 package internals；而且 degit / clean 路徑的治理資料更接近 starter seed 本身，放在 `presets/_base` 比較容易被 ADR 與 release checklist 發現。

### Decision 2: create-clean.sh and scaffolder both source the manifest

`../scripts/create-clean.sh` 與 `packages/create-nuxt-starter/src/assemble.ts` 都必須讀同一份 manifest。shell 腳本不應手寫第二份 JSON parser；apply 階段可用 Node one-liner 或小型 shared script 解析 JSON 後輸出要移除的 path list，再由 shell 執行刪除。

scaffolder 端新增 `packages/create-nuxt-starter/src/strip-manifest.ts`，負責 schema validation、path normalization、applicability filter 與 fail-closed error。`assembleProject()` 在完成 shared assets、scripts、Spectra config、db overlay、evlog preset 後執行 strip cleanup，確保任何前面步驟複製出的 meta-only 檔案都會被統一處理。

替代方案是把 strip helper 寫進 `assemble.ts`。拒絕，因為 `assemble.ts` 已經負責 copy/generate/overlay 多種工作，strip schema 與 fail-closed contract 需要獨立測試。

### Decision 3: validate-starter wraps the four audit regression paths

validate-starter 應提供單一 CLI entrypoint，例如 `node scripts/validate-starter.mjs` 與 package script `validate:starter`。它產生四條 fresh scaffold fixture：baseline、d-pattern-audit、nuxthub-ai、none，執行 audit，並檢查 expected signals。

現有 `packages/create-nuxt-starter/test/scaffold-audit-regression.test.ts` 可以保留作為 focused Vitest regression，但 CI gate 不應只依賴 `describe.skipIf(!existsSync(AUDIT_SCRIPT))` 的測試。apply 階段要讓 validator 自己檢查 audit script availability；缺 audit script 是 gate failure，不是 silent skip。

替代方案是只把現有 test 加進 CI。拒絕，因為 CI gate 需要穩定 exit-code/report contract，且要能在 apply 階段直接以一個命令取得四條 path 的 evidence。

### Decision 4: GitHub Actions is the CI gate

新增 `.github/workflows/validate-starter.yml`，在 pull_request 與 main push 上安裝依賴並執行 validate-starter。pre-push hook 不能取代 GitHub Actions，因為 hook 不保證所有 contributor 都會跑，也無法在 PR 上提供 reviewable job evidence。

workflow 應維持窄 scope：checkout、setup pnpm / Node、install、run `pnpm validate:starter`。若 repo 既有 workflow 已有 install/cache pattern，apply 階段應沿用既有 pattern，避免建立第二套 divergent CI bootstrap。

### Decision 5: Manifest schema follows overlay-manifest discipline

strip manifest 採 versioned JSON schema，核心欄位建議為：

- `schema_version`: 固定版本，例如 `1`。
- `entries`: array，每筆含 `path` 或 `glob`、`consumers`、`reason`、`required`。
- `consumers`: 至少支援 `create-clean` 與 `scaffolder`，避免某些 path 只該在 clean path 移除卻被 scaffolder 誤刪。
- `reason`: 對齊 Change 1 check names 或明確 meta-only 類型，例如 `maintenance-script-misplacement`、`projection-metadata`、`scaffolder-package`.

不採用簡單 patterns array，因為它無法描述 consumer 差異與治理原因；也不直接沿用 Change 3 overlay `add/remove/package_json` schema，因為 strip manifest 只描述 removal contract，不負責 file add 或 package delta。

### Decision 6: Strip cleanup fails closed but absent paths are allowed

manifest missing、JSON malformed、unknown schema version、path traversal、absolute path、consumer unknown 都必須 fail closed。manifest entry 指到不存在 path 時則允許通過並列為 skipped，因為不同 feature/dbStack/preset 會產生不同 output tree。

這個策略讓真正的 governance drift 不能被忽略，同時避免 optional generated files 造成 false failure。

### Decision 7: CI evidence stays backend-only

本 change 的 evidence 來自 CLI output、fixture file tree、audit JSON signals、workflow syntax validation，不需要 screenshot 或 browser e2e。tasks.md 必須把這些放進 `## 6. Backend Verification Evidence`，`## 人工檢查` 只保留 backend-only 例外宣告固定文字。

## Risks / Trade-offs

- [Risk] manifest 初版 strip 過度，誤刪 generated project 需要的 agent runtime assets。Mitigation: 四條 fresh scaffold audit regression 加 file presence/absence assertions，並把 consumers 欄位設計成 allowlist。
- [Risk] manifest 初版 strip 不足，meta-only artifacts 仍漏進 scaffold。Mitigation: validator assert 代表性 root meta paths absent，並把 Change 1 8 個 check names 作為 reason vocabulary。
- [Risk] create-clean 在獨立專案中執行時找不到 template manifest。Mitigation: apply 階段定義 standalone fallback：若 manifest 已被 strip，create-clean 先使用嵌入的 generated path list 或以清楚錯誤要求從 starter repo 執行；不允許靜默跳過。
- [Risk] CI workflow 與既有 install/check workflow drift。Mitigation: 沿用既有 package-manager setup pattern，workflow 只新增 validate-starter command，不重寫其他 gates。
- [Risk] validator runtime 過長。Mitigation: validator 只跑四條 scoped fresh scaffold + audit，不跑 browser e2e、db reset 或 production-like deployment。

## Migration Plan

1. 建立 `presets/_base/strip-manifest.json` 與 `packages/create-nuxt-starter/src/strip-manifest.ts`，先讓 manifest schema validation 與 path normalization 有 focused tests。
2. 將 `../scripts/create-clean.sh` 接到 manifest，移除重複硬編 meta-only strip list，並驗證 clean output 與 scaffolder strip expectation 對齊。
3. 將 `assembleProject()` 接到 strip helper，補 scaffolder unit test，確認 manifest-declared meta-only paths 不會出現在 generated output。
4. 建立 `scripts/validate-starter.mjs` 與 `validate:starter` script，跑 baseline、d-pattern-audit、nuxthub-ai、none 四條 path，固定 exit-code/report contract。
5. 新增 `.github/workflows/validate-starter.yml` 並做 workflow syntax pass；本地跑 validator 後，把 evidence 貼回 tasks.md 的 Backend Verification Evidence。

## Open Questions

(none)

## Resolved Questions

- Manifest 位置：採 `presets/_base/strip-manifest.json`。
- validate-starter scope：固定四條 fresh scaffold audit regression path，不包含 browser screenshot 或 app e2e。
- CI gate 型態：使用 GitHub Actions，不用 pre-push hook 取代。
