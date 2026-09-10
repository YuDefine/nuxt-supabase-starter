# Maintainer Tech Debt Register

> 本檔追蹤 **starter 維護倉本身** 的技術債（CI workflow、scaffolder、meta scripts），不會被 scaffold 帶到新建專案。
> 新建專案使用的 follow-up register 在 `template/docs/tech-debt.md`；兩者不要混。
>
> 2026-09-06 那輪清理把當時已結案的 6 條移到 `docs/archives/tech-debt-closed-2026-09.md`，
> 留下當時仍需行動的 6 條。**這兩個數字是那一天的快照，之後有增有減**——現況一律以下方 Index
> 為準，不要拿這行對帳。編號不重用。

## Index

| ID | Title | Priority | Status | Discovered |
| --- | --- | --- | --- | --- |
| TD-004 | Spectra roadmap drift check 在 CI 的 structural diff | mid | in-progress | 2026-05-10 |
| TD-005 | meta-monorepo 下 pre-push checks 靜默 no-op | high | open | 2026-08-19 |
| TD-008 | `validate-starter` 維護工具會被 scaffold 帶走 | mid | open | 2026-08-19 |
| TD-010 | 參考 app email 登入被 nuxt-security CSRF 擋下 | mid | open | 2026-08-24 |
| TD-011 | clade 投影 auth 文件仍寫舊套件名 | low | open | 2026-08-24 |
| TD-012 | `lint` script guard 吃不掉 pnpm 附加參數 | mid | open | 2026-08-29 |
| TD-014 | clade capability plugin 尚未通過 PUBLIC consumer 的 runtime projection 契約 | low | open | 2026-09-09 |
| TD-016 | Cloudflare 上 `useRuntimeConfig()` 的 module-eval snapshot 是否讀得到注入的 `NUXT_APP_ENV` | mid | open | 2026-09-11 |
| TD-017 | `validate-starter` 留下的 `temp/` scaffold 產物會讓 doctor gate 轉紅 | low | open | 2026-09-11 |
| TD-018 | auto-commit 失敗會把 clade projection state 卡在半套用，後續 propagate 一律誤報 conflict | high | open | 2026-09-11 |
| TD-019 | `scaffold-smoke` 自 2026-08-24 起持續紅，剩餘 blocker 是 clade 投影未去識別化 | mid | open | 2026-09-11 |
| TD-020 | 選了 codex 的 scaffold 輸出靜默少掉 `.codex/` 與 `.agents/` | high | open | 2026-09-11 |

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

## TD-014 — clade capability plugin 尚未通過 PUBLIC consumer 的 runtime projection 契約

**Status**: open — **範圍已收斂到只剩 `<maintainer-domain>` 佔位符無解析說明**（2026-09-11）
**Priority**: low — 原本的 24 條 blocked error 已全數清除，剩下的是文件可讀性，不擋任何 gate
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

- ~~上述 `project-runtime-capabilities … --visibility public --dry-run` 對本 repo 回非 blocked。~~ **已達成**
- ~~`node scripts/audit-public-hygiene.mjs` 與 `bash scripts/audit-template-hygiene.sh` 維持 0 violation。~~ **已達成**
- scaffold 出去的專案讀得懂 `<maintainer-domain>` 該填什麼。**仍未達成**

### 2026-09-11 實測：三類 error 全清，CF identifier 那條已在 clade 修掉

```bash
cd template && node ~/offline/clade/scripts/project-runtime-capabilities.ts \
  --clade-root ~/offline/clade --targets claude,codex,cursor --visibility public --dry-run
# {"status":"dry-run","plannedArtifacts":815,"appliedChanges":0,"diagnostics":[]}
```

`status` 從 `blocked` 變 `dry-run`、**24 條 error 歸零**。兩支 audit 也都 0 violation
（public-hygiene PASS 0 violations / 115 warnings；template-hygiene no findings）。

三類的去向：

| 類 | 去向 |
| --- | --- |
| 21 支 capability skill 缺 `clade-targets` ＋ `subagent-dev` 的 `permission_tier` | clade 已補，隨 v1.12.46 到位 |
| `hub-core/scripts/{codex-review-safe,gh-ci-watch}.sh` 的 PUBLIC resource | clade **TD-1019** 已解：實證註解搬進 `docs/pitfalls/`、原地留 pointer，並補了一條 invariant test |
| CF `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID` 可反查 identifier | clade **TD-1066** 已解 |

**CF 那條的實情比本條原本記的嚴重，值得留著**：它不只是「`audit-template-hygiene.sh` 不抓
32-hex」，而是**已經洩漏**——`template/.cursor/skills/yudefine-deploy/SKILL.md` 自
`efa40c4f`（2026-08-24）起在公開 repo 存在約三週。已隨 `1220f672`（523 deletions / 0 additions）
移出 `origin/main`；依維護者裁示只移除 HEAD、不改寫歷史。clade 端修法有三層：源檔 ID 改指向
secrets 存放處、新增 skill 級 `<!-- clade-visibility: private -->` 讓投影層對 public consumer
整支略過、以及對 public 算繪產物的不透明 ID fail-closed 判定。

**為什麼 hygiene audit 當初沒抓到**：它掃的是**具名字串**，而 32 碼 hex 不在任何名冊上。
同一行的 `yudefine.com.tw` 被正確改寫成 `<maintainer-domain>`、緊鄰的 ID 原封不動。
**「sanitizer 輸出乾淨」NEVER 等於「沒有 private 識別碼」。**

### 剩下的唯一一項

`<maintainer-domain>` 佔位符在 `template/.claude/` + `template/.cursor/` 的 **22 個檔、58 處**
出現，且**沒有任何一處說明該填什麼**（實測 grep 無命中）。scaffold 出去的使用者會看到一個
自己解不開的佔位符。修在 clade 源檔（給解析說明，或改成 consumer 可設定的值），本 repo 只驗收。

## TD-016 — Cloudflare 上 `useRuntimeConfig()` 的 module-eval snapshot 是否讀得到注入的 `NUXT_APP_ENV`

**Status**: open — 機制已釘死，**實際後果未實測**（需要一次真實 Cloudflare 部署才判得出來）
**Priority**: mid — 若成立，Sentry 與 evlog 的 `environment` 在所有 Cloudflare 部署上恆為 `'unknown'`
**Discovered**: 2026-09-11 — TD-015 的 delta review 順出來的
**Location**: `template/server/plugins/sentry-cloudflare.ts`、`template/server/plugins/evlog-drain.ts`、`template/server/plugins/evlog-sentry-drain.ts`（後兩者為 clade-LOCKED 投影）

### Problem

`deploy-env-identity` 規約指名 server / nitro plugin 讀 runtime config 的 `config.appEnv`，理由是
「runtime 注入，改值不必重 build」。但 nitro 2.13.3 的 `runtime/internal/config.mjs` 裡：

```js
const _sharedRuntimeConfig = _deepFreeze(applyEnv(klona(_inlineRuntimeConfig), envOptions))
export function useRuntimeConfig(event) {
  if (!event) return _sharedRuntimeConfig      // ← module 載入當下就凍結的 snapshot
  ...                                          // 帶 event 才會 per-request 重跑 applyEnv
}
```

零引數版本回傳的是 **module evaluation 當下**算好的值。而 Cloudflare preset 是在每次 invocation
才把 env 掛上 `globalThis.__env__`（nitropack 的 `presets/cloudflare/runtime/_module-handler.mjs`，就在呼叫
`nitroApp.localFetch` 之前）。若 workerd 在 module 頂層還沒有 populate 原生 `process.env`，
那 `applyEnv` 在那個時點就看不到 wrangler 注入的 `NUXT_APP_ENV`，`config.appEnv` 會恆為
build 期的值 → 落到 `'unknown'`。

三件已釘死的事實：

- Sentry 的 options callback **每個 request 都跑**（包在 `nitroApp.localFetch` 的 Proxy `apply` 內），
  所以呼叫時 `__env__` 一定已經在了 —— 時機不對的是 `useRuntimeConfig()` 那一半，不是 callback。
- `wrangler.jsonc` 是 `compatibility_date: 2025-05-15` + `nodejs_compat`，理論上會 populate
  原生 `process.env`；**但「在 module 頂層就 populate」還是「只在 handler scope 內」沒有實測**。
- 同一個 repo 內另外兩支 evlog plugin 做一樣的零引數呼叫，只是因為檔頭帶 generated header
  被 vite-doctor 跳過，所以沒被這條規則打到 —— 它們有同樣的曝險。

### Fix approach

**NEVER** 為了繞過這條就把 `config.appEnv` 換成 `process.env.NUXT_APP_ENV` —— `deploy-env-identity`
指名了 runtime config 那條路徑，這是 clade 標準層的接線，consumer 不能自行偏離。

1. 先實測：部署一次到 Cloudflare，讀回 Sentry 事件的 `environment` 標籤。恆為 `'unknown'` 即成立。
2. 成立的話，這是 **clade 標準層的問題**（`deploy-env-identity` 的「server / nitro plugin →
   `config.appEnv`」那一列在 Cloudflare preset 上不成立），MUST 回報 clade 並在那裡決定接線，
   不在本 repo 端各修各的。
3. 規約自己要求「MUST 有機械 gate 釘住整條接線」；那個 gate 目前抓不到這一類（值讀得到、
   只是讀到舊的），gate 的形狀也要一起看。

### Acceptance

- 有一次真實 Cloudflare 部署的 `environment` 標籤讀數作為證據。
- 若成立：clade `deploy-env-identity` 的接線表對 Cloudflare preset 有明確答案，三支 plugin 一致。

## TD-017 — `validate-starter` 留下的 `temp/` scaffold 產物會讓 doctor gate 轉紅

**Status**: open
**Priority**: low — 有明確的手動解法（刪掉 `template/temp/`），但會浪費下一個人一輪除錯
**Discovered**: 2026-09-11 — TD-015 收尾時實際踩到
**Location**: `template/scripts/validate-starter.mjs`、`template/vendor/doctor-shared/run.mjs`（clade-LOCKED）

### Problem

`node scripts/validate-starter.mjs` 會在 `template/temp/validate-starter/` 下產出 4 份完整的
scaffold 專案並**保留**（`temp/` 在 `.gitignore` 內）。vite-doctor 不跳過它，於是接著跑
`pnpm run doctor` 會多出 3 條 `NUXT0054 no-secret-in-public-config` error（來自 generated
`nuxt.config.ts` 的 `runtimeConfig.public.key`），doctor 從 exit 0 變 exit 1。

實測序列：`doctor` clean → 跑 `validate-starter` → `doctor` 3 errors → `rm -rf temp/validate-starter`
→ `doctor` clean。

因為錯誤訊息指向的是 generated 檔的路徑，第一眼很容易誤讀成「我剛才改壞了 scaffold 輸出」。
這與 TD-013 順手修掉的 `.pi/**` 是同一類：gate 掃到了不屬於本 repo 原始碼的產物。

### Fix approach

兩條路擇一（或都做）：

1. `scripts/validate-starter.mjs` 收尾時清掉 `temp/validate-starter/`（或改用 mkdtemp 到系統暫存區）。
   保留產物對除錯有用，那就加一個 `--keep` 旗標，預設清掉。
2. 讓 doctor 跳過 `temp/**`。落點是 consumer 自有的 doctor.config.json 宣告檔，
   **NOT** clade-LOCKED 的 `vendor/doctor-shared/`。

### Acceptance

- 跑完 `validate-starter` 之後，`pnpm run doctor` 仍是 exit 0。

## TD-018 — auto-commit 失敗會把 clade projection state 卡在半套用，後續 propagate 一律誤報 conflict

**Status**: open — 落點在 clade（`~/offline/clade`），本 repo 只是受害面，這裡登記入口與復原程序
**Priority**: high — 一次 pre-commit 失敗就讓這台**永久**掉出 fleet，且錯誤訊息指向錯的方向
**Discovered**: 2026-09-11 — v1.12.47 propagate 對本 consumer failed 時追出來
**Location**: clade `scripts/lib/runtime-artifact-apply.ts`（conflict 判定）、clade auto-commit flow 的 rescue/revert 路徑

### Problem

clade 的 projection state 分兩層存放，而且**歸屬不同**：

| 層 | 路徑 | git |
| --- | --- | --- |
| runtime projection state（conflict 判定實際讀的那份） | `template/.clade/projections/*.json` | untracked |
| 投影出來的內容檔 | `template/.claude/**`、`template/.cursor/**` | tracked |

`applyRuntimeArtifactPlan()` 把兩者放在同一個 manifest transaction 裡寫，所以 apply 本身是原子的。
問題出在**之後**：auto-commit flow 的 `git commit` 若失敗，rescue 路徑會存下 patch
（`template/.clade/rescue/auto-commit-<ts>.patch`）並回捲 worktree。回捲是 git 層的，
**只還原 tracked 檔**——`.clade/projections/*.json` 是 untracked，原地留在新版 hash。

於是 state 記著新內容、磁碟是舊內容，下一趟 `hub-sync` 走到

```js
} else if (!previousHash || hashContent(before) !== previousHash) {
  throw new Error(`local or modified file conflict: ${rel}`)
}
```

就報 `local or modified file conflict`。這個標籤是錯的：沒有人在 consumer 端改過那個檔，
它就是 HEAD 的內容。訊息把人導向「找誰覆寫了投影」，而真正的狀態是「state 跑到磁碟前面了」。

實測（2026-09-11，v1.12.47）：
- `.claude/rules/session-tasks.operations.md` 磁碟 `70896178…`（= HEAD）
- `.clade/projections/claude.rules.json` 記 `b94a2f96…`
- 用 clade **新** source 重跑投影轉換（插 native-rule 註解 → `TDMS`→`<consumer-b>` → clade 絕對路徑→`<clade-central-repo>`）得到的 sha 逐位等於 `b94a2f96…`，證明 state 是 v1.12.47 的預期輸出，不是 consumer 改動。
- 同一趟共 4 個檔卡住（claude.rules 1、claude.capabilities 2、cursor.rules 1；codex 兩份 0，因為 codex 投影 gitignored 所以沒被回捲）。

**這不是單次意外**。本 consumer 從 v1.12.38 到 v1.12.45 連續 8 趟 propagate 都是同一形狀的
`projection unavailable`，中間只有 v1.12.46 綠過一次。觸發 `git commit` 失敗的原因每次不同——

| run | 觸發 commit 失敗的原因 |
| --- | --- |
| v1.12.45 16:05Z | root `.husky/pre-commit` 的 `[Starter Hygiene] real-tenant-identifier` 擋下 clade 自己未去識別化的投影（TD-006 ratchet） |
| v1.12.47 19:24Z | pre-commit 以 **134 / SIGABRT** 結束（見下） |

——但**後果永遠相同**：wedge 住，而且要人手動復原。

### 134 那一格

`✘ commit failed: Aborted (core dumped) | VITE+ - pre-commit script failed (code 134)`
是 `template/.vite-hooks/_/h` 這支 dispatcher 印的，代表 `template/.vite-hooks/pre-commit`
本身被 SIGABRT 打死。**沒有重現**：事後用同一組 staged 檔（7 個 .md/.json）手跑
`sh -e template/.vite-hooks/pre-commit`、真跑 `git commit`、以及 propagate `--resume`
的那趟 commit，三次都 rc=0（`commit_ms` 1.8s）。

沒有留下 core：apport 對同一個 `ExecutablePath` 只保留一份報告，`/var/crash` 現存三份都不是這次。
兩條**未證實**但值得下次帶著看的線索：

- `/usr/bin/timeout` 在這台是 uutils `rust-coreutils 0.8.0`，`/var/crash` 有它的
  `Signal: 6 / SIGABRT` 實例（2026-09-06，`timeout … vp check`）。目前查不到 pre-commit 路徑上有用到它。
- `NODE_COMPILE_CACHE=/home/charles/.cache/node-compile-cache` 是**全域單一目錄**，而
  `vp` 的 shim 明確呼叫 `module.enableCompileCache()`；propagate 跑 `concurrency: 4`，
  等於 4 個 consumer 的 node 併發讀寫同一份 V8 compile cache。

所以 134 目前只能當**間歇性 trigger**看，不是本條的 root cause——root cause 是「任何一次
commit 失敗都會 wedge」。修好 wedge，134 再發生也只會浪費一趟 propagate，不會擋住 fleet。

### Fix approach

落點在 clade，本 repo 不自行實作。三條擇一：

1. rescue/revert 路徑一起回捲 `.clade/projections/*.json`（存 patch 前先備份該目錄，回捲時一併還原）。
   最貼近「transaction 要嘛全成要嘛全退」的語義。
2. `applyRuntimeArtifactPlan()` 在 `hashContent(before) !== previousHash` 時多問一句：
   磁碟內容是否等於 `git show HEAD:<path>`。是 → 這是 state 跑在前面，改成重新投影而不是 throw；
   否 → 才是真的 consumer 覆寫，維持現在的訊息。
3. 至少把訊息分成兩種 —— `local or modified file conflict`（真覆寫）與
   `projection state ahead of worktree`（半套用），後者附上復原指令。

順帶：`--resume` 目前**不會**重試 `status: "failed"` 的 consumer 以外的東西，這點是對的；
但 failed 的 journal entry 留著不會自己好，所以 wedge 一旦形成就一定要人介入。

### 本 repo 的復原程序（已驗證）

已寫進 [`HUB_DRIFT_RUNBOOK.md`](HUB_DRIFT_RUNBOOK.md) 場景 F。摘要：找最新的
`template/.clade/rescue/auto-commit-*.patch` → `git apply` → 驗 projections 與磁碟 0 mismatch →
commit → 跑 `hub-sync` 確認綠。

### Acceptance

- clade 端：任一 consumer 的 auto-commit commit 失敗後，下一趟 propagate **不再**出現
  `local or modified file conflict`（而是重投影成功，或給出指名半套用狀態的訊息）。
- 本 repo：連續兩趟 propagate 對 `nuxt-supabase-starter/template` 不是 `failed`。

## TD-019 — `scaffold-smoke` 自 2026-08-24 起持續紅，剩餘 blocker 是 clade 投影未去識別化

**Status**: open — 兩層 blocker，第一層已修，第二層落點在 clade
**Priority**: mid — gate 紅了三週，實質上沒有人在讀它的結果
**Discovered**: 2026-09-11 — 修 setup-vp 那兩支時順帶查出來
**Location**: `scripts/smoke-scaffold.sh`（`scan_placeholders()`）、`template/vendor/**`、`template/scripts/**`

### Problem

`scaffold-smoke` 最後一次綠是 2026-08-18（`383e2408`），之後每一趟都紅。堆了兩層：

**第一層（已修，`50f001cd`；CI 實測已越過此關，改停在第二層）**：`scripts/smoke-scaffold.sh` 的必備資產清單還在斷言
scaffold 輸出要有 `.claude/commands/validate-starter.md`，但 `17f080cf` 依 L3 commands hygiene
把它判成 `starter-owned-relocate` 並移出 `template/`。斷言沒跟著改，gate 就永遠停在這裡，
**後面每一關都沒被執行過** —— 包含下面這層。

**第二層（未修）**：拿掉第一層之後，`placeholder scan` 接著紅。本機實跑 25 個命中，
**全部**落在 clade 投影出來的 `vendor/**` 與 `scripts/**`，app 程式碼零命中：

| 命中 | 數量 | 例子 |
| --- | --- | --- |
| 字面 `nuxt-supabase-starter` | 18 | `vendor/snippets/pitfalls/TEMPLATE.md`、`vendor/oxc-shared/preset.ts`、`scripts/pre-push/checks/*.sh` |
| `demo` | 7 | 其中數個是子字串誤判：`demonstrably`、`demonstrate` 也會中 |

兩個成因要分開看：

1. **真訊號** —— clade 投影把 starter 自己的 consumer id 寫進了會被 scaffold 帶走的
   `vendor/**`。這就是 `clade-starter-sanitization` / TD-006 的存量去識別化，
   落點在 clade（bootstrap 把 starter 自己當 consumer 投影）。
2. **scanner 缺陷** —— `scan_placeholders()` 的 pattern 裡 `demo` 沒有詞界，
   `demonstrate` / `demonstrably` 一律誤判。另外它 exclude 了 `.claude/**` 卻沒 exclude
   `vendor/**` 與 `scripts/**`，而這三者同樣都是 clade 投影面 —— 這個不對稱沒有寫下理由。

### Fix approach

**NEVER** 把 `vendor/**` / `scripts/**` 加進 exclude 名單來讓 CI 轉綠 —— 第 1 點是真訊號，
遮掉它等於用暫時修法繞過 root cause，而且遮掉的正好是唯一會被 scaffold 帶走的那半。

順序應該是：

1. `demo` 改成有詞界的 pattern（`\bdemo\b`），先把誤判從真訊號裡分離出來。分完之後
   剩下的命中數才是這條債的真實大小。
2. 等 `clade-starter-sanitization` 把 `vendor/**` 的存量去識別化做完（clade 側）。
3. 若確認 `.claude/**` 被 exclude 是有意的治理決定（那層由 audit-template-hygiene 與
   public-hygiene 各自守），就把同樣的理由寫進 `scan_placeholders()` 上方，讓下一個人
   看得出 exclude 名單的判準是什麼，而不是逐案累加。

### Acceptance

- `bash scripts/smoke-scaffold.sh temp/<name>` 跑到 `[PASS] placeholder scan clean` 之後才停。
- `scaffold-smoke` workflow 在 main 上轉綠。

## TD-020 — 選了 codex 的 scaffold 輸出靜默少掉 `.codex/` 與 `.agents/`

**Status**: open — 根因已驗證，但修法牽涉 hygiene 治理決定，需要拍板才動
**Priority**: high — 使用者選了 codex 卻拿到不完整的專案，而且沒有任何錯誤訊息
**Discovered**: 2026-09-11 — 修好 setup-vp 之後 Template CI 第一次跑到 Unit tests 才露出來
**Location**: `template/packages/create-nuxt-starter/src/assemble.ts:251-262`、
`template/packages/create-nuxt-starter/test/scaffold.test.ts:255-256`、`template/.gitignore:81,87`

### Problem

`copyTemplateCodexAssets()` 用 `existsSync` 守著兩個來源目錄再 copy：

```ts
const codexDir = join(STARTER_ROOT, '.codex')
if (existsSync(codexDir)) {
  copyDirectory(codexDir, join(targetDir, '.codex'))
}
const agentsDir = join(STARTER_ROOT, '.agents')
if (existsSync(agentsDir)) {
  copyDirectory(agentsDir, join(targetDir, '.agents'))
}
```

但 `template/.codex/` 與 `template/.agents/` 都在 `template/.gitignore` 內（第 81、87 行）——
它們是 `sync-to-codex` 從 `.claude/` 產生的可重生投影，**不進版控**。

後果：在**乾淨 clone 或 degit** 出來的樹上，兩個來源都不存在，`existsSync` 直接讓兩個 copy
變 no-op。使用者選了 codex，拿到的專案只有 `AGENTS.md`，沒有 `.codex/`、沒有 `.agents/`，
**而且沒有任何 warning 或 error**。在跑過 `sync-to-codex` 的開發機上則一切正常——這就是為什麼
`scaffold.test.ts:255` 在本機綠、在 CI 紅。

CI 實測（`50f001cd`，343 passed / 1 failed）：

```
❯ test/scaffold.test.ts:255:66
  expect(existsSync(join(targetDir, '.codex', 'config.toml'))).toBe(true)
  AssertionError: expected false to be true
```

第 256 行的 `.agents/skills/commit/SKILL.md` 是同一個成因，只是斷言在 255 就先掛了所以沒顯示。
`assemble.ts:1195` 的 `.agents/commands/spectra` 也屬同一類。

**這不只是測試過期**。測試斷言的是這個 case 自己宣告的行為（`supports codex + cursor
multi-select while keeping claude source assets`），實作則把「來源不存在」靜默降級成部分輸出。
先前 Template CI 死在 setup 那格，所以這條從來沒被執行到。

### Fix approach

**已收斂（2026-09-11，grok-4.6 / xai high 唯讀顧問，label `td020-codex-scaffold`，主線逐條核實過）。**
原本列的三條**全部否決**，採第四條。

#### 採用：從 target 的 `.claude/` 做薄投影

`assemble` 不再抄 starter 的 gitignore 快照，改成在 prune + `generateSettings` **之後**，
從**已經拷進 target** 的 `.claude/` 生成 `.agents/skills/` 與 `.codex/config.toml`。
不搬 clade 的 converter，也不把那兩棵樹收進版控。選了 `codex` 而源 `.claude/skills` 不存在 → throw。

決定性的證據是**同一支檔裡的不對稱**（已核實）：

| 函式 | 行 | 寫法 |
| --- | --- | --- |
| `copyTemplateClaudeAssets` | `assemble.ts:207-209` | 直接 `copyDirectory`，**沒有** `existsSync` —— 「這個源是契約」 |
| `copyTemplateCodexAssets` | `assemble.ts:251-263` | 兩個 `existsSync` 守門 —— 「有就拷、沒有算了」 |

使用者顯式 `--agents codex` 時，optional 模式就是錯的模式。而且 `.agents/skills/` 的內容
**本來就推導得出來**：`template/.claude/skills/` 的 83 個目錄全部出現在 `.agents/skills/` 內，
測試第 256 行要的 `template/.claude/skills/commit/SKILL.md` 是 **tracked**（已 `git ls-files` 核實）。
`.codex/config.toml` 則是 `.claude/settings.json` 那組欄位的 TOML 視圖，不是獨立的源。

順帶修正本 TD 原文三處不精準（顧問指出、主線核實）：
`copyTemplateCodexAssets` 是 **251-263** 不是 251-262；`.gitignore` 的「可重生投影」註解在
**第 86 行、只屬 `.agents/`**，`.codex/` 在第 81 行夾在 `.clade/runtime/` 旁邊、沒有那句註解；
`assemble.ts:1195` 的 `.agents/commands/spectra` 是 **prune（`rmSync`）不是 copy**，同一棵樹、方向相反。

#### 三條原文為什麼都輸

- **原文 1（搬 converter 進 seed）**：要搬的不是一支檔。clade `scripts/sync-to-codex.ts` 是
  **2506 行**、還 import 一串 `project-runtime-*` 內部模組（已核實）；`~/.claude/scripts/sync-to-codex.ts`
  那支 45 行 shim 自己就寫明它只負責定位 clade，理由是「避免 user-level 放一份會漂移、且無版控的副本」。
- **原文 2（收進版控）**：本機實測 `.agents/` 1111 檔 / 12M、`.codex/` 167 檔 / 2.1M，等於 `.claude/`
  的第三份副本；直接打臉 hygiene 前提且必須擴大 L3 掃描範圍，不擴大就是開洞。更糟的是抄出去的仍是
  **starter 快照**，會把還沒剝掉的 `local-supabase` MCP 烤進沒選 database 的專案——正是
  `post-scaffold.ts:879-881` 註解在防的那件事。
- **原文 3（改成大聲失敗）**：`post-scaffold.ts:1589-1593` **已經**在 warn 了，問題是文案寫
  「這代表專案不會有 Codex / Cursor 的投影檔。**只用 Claude Code 的話可以忽略。**」——對剛選了
  codex 的人這句是錯的。而且測試第 255-256 行斷的是**檔在**、不是 throw，改成 throw 不會讓 CI 綠。
  這是診斷，不是修法。

#### 真正的生成點綁錯機器（新發現）

`post-scaffold.ts` 的 `runSyncToAgents()`（1585-1604）找 `~/.claude/scripts/` 的 shim，
找不到就 warn 然後 return；`post-scaffold.ts:882-888` 在 pnpm 沒裝好時同樣直接略過。
也就是說**現有生成路徑預設使用者有 Claude Code ＋ clade**——而「選了 Codex、機器上沒有 clade」
的人正是這個選項的目標使用者。這條路對他們本來就過不去。

### 需要拍板：Codex 開箱契約要到哪裡

**這是產品格不是技術格**，落地形狀完全不同：

| | 意思 | 後果 |
| --- | --- | --- |
| **A**（顧問預設） | assemble 保證 `.codex/config.toml` + `.agents/skills/**`（含 `commit/SKILL.md`）+ tracked `AGENTS.md`；`.codex/rules` 等完整語義轉換有 clade 才升級 | 不改 hygiene 掃描範圍、不搬 converter、CI 單測可綠 |
| **B** | 選了 `codex` 就必須等同開發機跑過 `sync-to-codex`（含 `.codex/rules` 全部） | `runSyncToAgents` 在缺 shim/clade 時 **throw**；等於宣告「Codex scaffold 需要本機 clade」。**仍然不走原文 2** |

**未驗證的那一格**：沒有人驗過 Codex CLI 在只有 `AGENTS.md` + `.codex/config.toml` + `.agents/skills`、
**沒有** `.codex/rules` 時算不算可用專案。A 若在這格是假的，交付出去的會是「看起來有、實際不能用」的
codex 專案——比現在這個 bug 更安靜。**拍板前不實作。**

落地 A 之後要順帶改的一句話：`.claude/rules/starter-hygiene.md` § 掃描範圍 的
「不進版控 = **不會被 scaffold 帶走**」會半真半假——「不進版控」仍真，「不會被帶走」變假
（輸出裡會有，但是 scaffolder 生成的，不是 template 樹帶走的）。意思要改成「template git 樹仍不掃；
scaffold 輸出由 assemble 生成，不屬 L3 掃 template 的範圍」。**NEVER** 因此擴大 `SCAN_TARGETS`。

### 顧問 concerns 的處置

顧問以 `DONE_WITH_CONCERNS` 收尾，三條 concerns：

1. 「未獨立重跑 Template CI `50f001cd`」→ **已由主線的 CI log 消化**（343 passed / 1 failed，
   失敗行就是 `scaffold.test.ts:255`）。
2. 「未在乾淨 worktree 實跑 `assembleProject`，靜默 no-op 是從原始碼推的」→ **已由同一份 CI log 消化**：
   CI 的乾淨 clone 就是那個乾淨 worktree，實測結果與推論一致。
3. 「未驗證 Codex CLI 缺 `.codex/rules` 時可用與否」→ **仍然開著**，就是上面 A/B 那一格。

### Acceptance

- 在乾淨 clone（沒跑過 `sync-to-codex`）上以 `--agents codex,cursor` scaffold，輸出要嘛含
  `.codex/config.toml` 與 `.agents/skills/commit/SKILL.md`，要嘛當場失敗並說明原因。
- `Template CI` 的 Unit tests 在 main 上轉綠。

## Cross-repo pointers

- `nuxt-edge-agentic-rag` `docs/tech-debt.md` **TD-069** 是本 repo scaffolder gap 的 consumer-side 鏡像（該專案手動切完 NuxtHub 但沒跑 `migrations:create`）。本條在該 repo 追蹤，此處只保留入口。
