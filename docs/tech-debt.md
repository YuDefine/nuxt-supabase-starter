# Maintainer Tech Debt Register

> 本檔追蹤 **starter 維護倉本身** 的技術債（CI workflow、scaffolder、meta scripts），不會被 scaffold 帶到新建專案。
> 新建專案使用的 follow-up register 在 `template/docs/tech-debt.md`；兩者不要混。
>
> 本輪清理（2026-09-06）：仍需行動的 6 條留在本檔；已由原始記錄與實際驗收證實結案的 6 條移至
> `docs/archives/tech-debt-closed-2026-09.md`。編號不重用。

## Index

| ID | Title | Priority | Status | Discovered |
| --- | --- | --- | --- | --- |
| TD-004 | Spectra roadmap drift check 在 CI 的 structural diff | mid | in-progress | 2026-05-10 |
| TD-005 | meta-monorepo 下 pre-push checks 靜默 no-op | high | open | 2026-08-19 |
| TD-008 | `validate-starter` 維護工具會被 scaffold 帶走 | mid | open | 2026-08-19 |
| TD-010 | 參考 app email 登入被 nuxt-security CSRF 擋下 | mid | open | 2026-08-24 |
| TD-011 | clade 投影 auth 文件仍寫舊套件名 | low | open | 2026-08-24 |
| TD-012 | `lint` script guard 吃不掉 pnpm 附加參數 | mid | open | 2026-08-29 |

## TD-004 — Spectra roadmap drift check 在 CI 的 structural diff

**Status**: in-progress（2026-08-19 起診斷模式）
**Priority**: mid
**Discovered**: 2026-05-10 — v0.31.0 release 後 Template CI 反覆報 stale
**Location**: `template/scripts/spectra-advanced/roadmap-sync.ts`、`.github/workflows/template-ci.yml`

### Problem

CI 執行 `vp run spectra:roadmap --check` 時曾持續報 stale，即使 local 已同步並提交 `ROADMAP.md`。
目前已驗證 timestamp normalization、Spectra CLI 不在 PATH、`.spectra/claims/` 缺失，以及 manual drift input
都不足以重現差異；本機 working tree、shallow clone、Node 24 且 CLI 不在 PATH 的模擬均 PASS。剩餘未知點是
active-change progress、parallelism mutex 排序，或 empty/missing input 的 render 差異。

### Workaround

`.github/workflows/template-ci.yml` 暫時保留 drift step 但使用 `continue-on-error: true`，stale 時輸出
committed 與 CI-synced 的 unified diff；local hook 仍維持同步。

### Fix approach

1. 依 CI 實際 unified diff 定位 structural difference。
2. 修正 `roadmap-sync.ts` 的對應 collect/render path。
3. 連續 5 次 main push 的 check 都 PASS 後，移除 `continue-on-error`，恢復真正 gate。

### Acceptance

- CI 重新啟用 `vp run spectra:roadmap --check`，連續 5 次 main push 都 PASS。
- 不再需要診斷用 diff 或 `continue-on-error`。

## TD-005 — meta-monorepo 下 pre-push checks 靜默 no-op

耐久 brief（含完整重現與判準）：`~/.cache/clade/briefs/td-005-prepush-project-root.md`。

**Status**: open
**Priority**: high
**Discovered**: 2026-08-19 — clade convention 對齊掃描
**Location**: clade 的 `vendor/scripts/pre-push/runner.sh` 與 7 支 `checks/*.sh`；consumer 端 `template/.vite-hooks/pre-push`

### Problem

runner 與每支 check 都以 `git rev-parse --show-toplevel` 當 project root。scaffold 後專案這樣做正確，
但在此 meta-monorepo 會跳到 repo root；Nuxt app 實際在 `template/`，所以 7 支 check 全部判定不適用、
exit 0 且無輸出。實測 `bash template/scripts/pre-push/runner.sh` 為 exit 0、stdout 0 bytes。

### Fix approach

1. 在 runner 與 7 支 check 使用 `PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"`。
2. 由 `template/.vite-hooks/pre-push` 傳入 `CLADE_PROJECT_ROOT="$PWD"`。
3. 這是 clade vendor source 與 starter consumer wiring 的跨 repo 工作；先在 clade source 修正並 publish/propagate，
   再在本 repo 驗收，並檢查 `.husky` 是否留下不會被呼叫的重複 hook。

### Acceptance

- `CLADE_PROJECT_ROOT="$PWD/template" bash template/scripts/pre-push/runner.sh` 有輸出，7 支 check 各自回報結果。
- 對 `template/**` 置入 review-rules-ratchet 可識別的違規時，pre-push 會阻擋。
- 未設 `CLADE_PROJECT_ROOT` 時，既有 consumer 行為維持不變。

## TD-008 — `validate-starter` 維護工具會被 scaffold 帶走

**Status**: open
**Priority**: mid
**Discovered**: 2026-08-19 — starter public hygiene L3 commands 審查
**Location**: `template/scripts/validate-starter.mjs`、`template/package.json`、`template/presets/_base/strip-manifest.json`

### Problem

`validate-starter` 只服務維護倉：它會找上一層 `REPO_ROOT`、執行 `packages/create-nuxt-starter` scaffold simulation，
並把 fixture 寫入 `template/temp/validate-starter/`。但 script 與 `validate:starter` command 會被帶進 scaffold output；
新專案沒有這些路徑，因此該公開 command 必然失敗。現有 hygiene audit 與 strip manifest 都沒涵蓋它。

### Fix approach

選定並完整落地一條路徑：

- **移到 root**：搬到 `scripts/validate-starter-scaffold.mjs`，同步 workflow 與 package script；或
- **留在 template、剝除輸出**：在 strip manifest 加入 script 與 `validate:starter` 的 package script rewrite，並補齊
  create-clean / scaffolder 的 rewriting 支援。

同時在 `scripts/audit-template-hygiene.sh` 與 fixture test 補上 `maintenance-script-misplacement` 覆蓋。

### Acceptance

- scaffold output 沒有 `scripts/validate-starter.mjs`，且 package.json 沒有指向它的 `validate:starter`。
- `.github/workflows/validate-starter.yml` 仍可完成 preset scaffold simulation。
- strip-manifest test 與 `bash scripts/audit-template-hygiene.test.sh` 都 PASS。

## TD-010 — 參考 app email 登入被 nuxt-security CSRF 擋下

**Status**: open
**Priority**: mid
**Discovered**: 2026-08-24 — TD-009 遷移後實測發現；根因與遷移無關
**Location**: `template/nuxt.config.ts` 的 `security.csrf`、`template/app/pages/auth/login.vue`

### Problem

`security.csrf: true` 會擋住 Better Auth client 的 `POST /api/auth/sign-in/email`，因該 fetch 沒有 nuxt-security
CSRF token；已觀察到 `403 CSRF Token Mismatch`。CI 目前漏測，因真實登入缺少 `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`
時會 skip，而 auth setup 使用 server-side `/api/_dev/login`。

### Fix approach

先確認本專案 Better Auth 的 origin/cookie 防護，再擇一：對 `/api/auth/**` 建立明確 exclusion，或讓 client 帶
nuxt-security token。不得關閉全域 `security.csrf`。

### Acceptance

- dev server 使用有效帳密由登入頁完成登入，不再出現 CSRF token error。
- 至少一條其他 `POST /api/**` 在無 token 時仍回 403。
- 有測試帳號時 `e2e/auth.spec.ts` 的真實登入路徑 PASS。

## TD-011 — clade 投影 auth 文件仍寫舊套件名

**Status**: open（clade scope）
**Priority**: low
**Discovered**: 2026-08-24 — TD-009 收尾掃殘留
**Location**: clade-managed `template/.claude/rules/auth.md`、`template/.claude/skills/document-writer/SKILL.md`、對應 `template/.cursor/` 投影

### Problem

投影文件仍提到 `@onmax/nuxt-better-auth`，與目前 `@nuxtjs/better-auth@0.1.x` 參考 app 及 scaffold API 不一致。
這些檔案由 clade checksum 管理，直接在 starter 改會被下一次 `hub:sync` 覆蓋。

### Fix approach

在 `~/offline/clade` 的 source rule/skill 修正舊套件名與相應 API，完成 clade 自家驗證後 publish + propagate；
starter 端只驗收到貨的投影，不直接修改 managed files。

### Acceptance

- starter 的 auth rule、document-writer skill、cursor projection 不再出現舊套件名。
- `hub:check` 與 clade checksum audit PASS，且 `@nuxtjs/better-auth` / 0.1.x API 說明一致。

## TD-012 — `lint` script guard 吃不掉 pnpm 附加參數

與 `dd2b122e`（heavy gate guard 改 `sh -c` 形式）同型；修法照那筆。

**Status**: open
**Priority**: mid
**Discovered**: 2026-08-29 — TD-685 heavy gate guard 回歸修正時發現
**Location**: `template/package.json` 的 `lint` script

### Problem

`lint` 是裸 `if … fi` shell guard；pnpm 將 `pnpm lint <args>` 的附加參數接在整條 script 尾端，造成
`sh: 1: Syntax error: word unexpected`。`pnpm lint` 不帶參數才正常；typecheck、test、build 已用同形狀修正，
lint 因原工作 scope 刻意留下。

### Fix approach

把整條 script 包進 `sh -c '…' --`，兩個分支都把 `"$@"` 傳給底層命令，並使用 `exec` 穿透 exit code 與 signal：

```json
"lint": "sh -c 'if test -x .clade/bin/clade-gate; then exec .clade/bin/clade-gate run lint -- vp lint --deny-warnings \"$@\"; else exec vp lint --deny-warnings \"$@\"; fi' --"
```

### Acceptance

- `pnpm lint --help` 顯示 `vp lint` help，沒有 shell syntax error。
- `pnpm lint` 不帶參數仍 exit 0。
- 刻意造成 lint failure 時 exit code 為非零，證明 `exec` 穿透。

## TD-013 — scaffolder ↔ clade registry seam test 撞 manifest schema 收緊

**Status**: open
**Priority**: mid
**Discovered**: 2026-09-09 — P7 capability 宣告的 `/commit` 0-C 跑出來
**Location**: `template/packages/create-nuxt-starter/test/clade-registry-seam.test.ts:44`

### Problem

該測試的 fixture 寫死 `.claude/hub.json` 為 `{"version":"0.0.0","modules":{},"localHooks":[]}`，
clade `scripts/register-consumer.ts` 現在拒收：`invalid consumer manifest: $.modules: no anyOf schema branch matched`。
2 個 test case 失敗（`pnpm test` 2 failed / 343 passed），與本 repo 的產品碼無關 —— fixture 建在 `/tmp`，
不讀本 repo 的 manifest。clade 的 `manifest.schema.json` 對 `modules` 的 anyOf 分支已收緊到空物件不合法。

### Fix approach

把 fixture 的 `modules` 補成能通過現行 schema 的最小合法組合（照 `manifest.schema.json` 的 anyOf 分支選一條），
或改由 scaffolder 自己產生 manifest 再餵給 register-consumer，讓測試跟著 schema 走而不是寫死。
**NEVER** 為了讓測試綠而放寬 clade 的 schema。

### Acceptance

- `pnpm test --filter scaffolder` 對 `clade-registry-seam.test.ts` 5 個 case 全綠（目前 2 failed / 1 skipped）。
- 修法不動 clade `manifest.schema.json`。

## TD-014 — clade capability plugin 尚未通過 PUBLIC consumer 的 runtime projection 契約

**Status**: open
**Priority**: mid
**Discovered**: 2026-09-09 — P7 宣告 `specformula` + `aixbdd` capability 後
**Location**: clade `plugins/hub-capabilities-{aixbdd,specformula}/skills/**`、`plugins/hub-core/scripts/{codex-review-safe,gh-ci-watch}.sh`、`plugins/hub-core/skills/subagent-dev/SKILL.md`

### Problem

宣告雙 capability 後，canonical 投影入口對本 repo 回 blocked：

```bash
node ~/offline/clade/scripts/project-runtime-capabilities.ts \
  --clade-root ~/offline/clade --targets claude,codex,cursor --visibility public --dry-run
# status=blocked appliedChanges=0
```

24 條 error，分三類：

1. **21 支 capability skill 缺 `clade-targets` 宣告** → `native delivery is unavailable`
   （`aixbdd` 17 支、`specformula` 4 支）。其中 `sdd-start/SKILL.md` 另有
   `common skill frontmatter key homepage is runtime-specific`。
2. **`hub-core/scripts/{codex-review-safe,gh-ci-watch}.sh`** → `Resource source is not safe for
   this visibility profile`（PUBLIC）。此二條與 capability 無關，宣告前即存在。
3. **`hub-core/skills/subagent-dev/SKILL.md`** → `permission_tier` 放錯層。

實際投影仍由較舊的 `sync-rules` + `sync-to-{codex,cursor}` 路徑完成，Claude 端 skill 可被發現
（`sdd-start` / `specformula-*` 已出現在 skill 清單）；Codex / Cursor 的 native delivery 未驗證。

另兩條同源的 PUBLIC 洩漏面（由 0-A.2 裁決者指出，皆 HEAD 既存、非本次引入）：

- clade `hub-core/skills/design/SKILL.md` 硬寫維護者網域；投影去識別化成
  `https://review-gui.<maintainer-domain>/decisions` 後，scaffold 出去的使用者沒有解析步驟。
  同形問題在本 repo HEAD 已有 7 個 tracked rule 檔 / 14 處。
- clade `hub-core/skills/yudefine-deploy/SKILL.md:216-217` 的 `CLOUDFLARE_ACCOUNT_ID` /
  `CLOUDFLARE_ZONE_ID` 是可反查的真實 identifier，`audit-template-hygiene.sh` 目前不抓 32-hex。

### Fix approach

全部三類都是 clade 標準層，**本 repo 不修**。在 clade 補 `clade-targets` 宣告、把
runtime-specific frontmatter 移進 adapter fragment、處理 PUBLIC visibility 的 resource 安全宣告，
再 propagate。`<maintainer-domain>` 需要在 clade 源檔給出解析說明（或改成 consumer 可設定的值）；
CF identifier 需去識別化並補 32-hex 掃描規則。**NEVER** 為了讓本 repo 綠而還原真實網域或 identifier。

### Acceptance

- 上述 `project-runtime-capabilities … --visibility public --dry-run` 對本 repo 回非 blocked。
- `node scripts/audit-public-hygiene.mjs` 與 `bash scripts/audit-template-hygiene.sh` 維持 0 violation。
- scaffold 出去的專案讀得懂 `<maintainer-domain>` 該填什麼。

## Cross-repo pointers

- `nuxt-edge-agentic-rag` `docs/tech-debt.md` **TD-069** 是本 repo scaffolder gap 的 consumer-side 鏡像（該專案手動切完 NuxtHub 但沒跑 `migrations:create`）。本條在該 repo 追蹤，此處只保留入口。
