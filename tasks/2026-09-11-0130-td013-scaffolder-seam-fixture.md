# TD-013 — scaffolder ↔ clade registry seam test fixture 撞 manifest schema 收緊

## 你是繼任者，不是 worker

**本 session 把整個位置交給你**，不是派你去做一件子工作。交棒理由：前一段工作（starter native
cutover 收尾）已全部完成並收斂，本 session context 已長，剩下的 TD-013 該由乾淨 context 接手。

- **in-flight dispatch：無。** 本 session 沒有未結的 handshake，沒有等待回收的 worker。
- **背景行程：無**（本 session 自己啟動的）。
- **parent worktree：無**，cwd 一直是 main checkout。

## repo 與 cwd

- **main checkout**：`/home/charles/offline/nuxt-supabase-starter`（monorepo，app root 在 `template/`）
- 測試所在套件：`template/packages/create-nuxt-starter`
- 開發規約：`cd template/` 後讀 `template/CLAUDE.md`；root meta 與 `template/` 的邊界見 root `CLAUDE.md` 與 `.claude/rules/starter-hygiene.md`

## 這件事是什麼（登記在 `docs/tech-debt.md` TD-013）

`template/packages/create-nuxt-starter/test/clade-registry-seam.test.ts:44` 的 fixture 寫死
`.claude/hub.json` 為 `{"version":"0.0.0","modules":{},"localHooks":[]}`，而 clade
`scripts/register-consumer.ts` 現在拒收：

```
invalid consumer manifest: $.modules: no anyOf schema branch matched
```

clade 的 `manifest.schema.json` 對 `modules` 的 anyOf 分支已收緊到**空物件不合法**。

## 本 session 實測到的（2026-09-11 01:2x，不是推論）

```bash
cd template/packages/create-nuxt-starter && npx vitest run test/clade-registry-seam.test.ts
# Tests  2 failed | 2 passed | 1 skipped (5)
```

與 TD-013 登記的數字逐字一致 —— **這條仍然成立，不是已經被別人修掉的舊帳**。

fixture 建在 `/tmp`，**不讀本 repo 的 manifest**，所以這 2 個 failure 與本 repo 產品碼無關。

## 兩條修法（TD-013 自己列的，未拍板）

1. 把 fixture 的 `modules` 補成能通過現行 schema 的最小合法組合（照 `manifest.schema.json`
   的 anyOf 分支選一條）
2. 改由 scaffolder 自己產生 manifest 再餵給 `register-consumer`，讓測試跟著 schema 走而不是寫死

2 比 1 耐用（schema 再收緊時不會重演），但動到 scaffolder 與測試的介面，**MUST 先確認呼叫端**。
選 2 之前先讀 `template/packages/create-nuxt-starter/src/` 裡 manifest 是怎麼產的。

**NEVER 為了讓測試綠而放寬 clade 的 `manifest.schema.json`。** clade 是唯讀參考
（`/home/charles/offline/clade`），本趟不改它；若判出根因真在 clade 標準層，**回報並等 Charles
決定**，不要自己切過去改 + propagate。

## Acceptance（TD-013 逐字）

- `clade-registry-seam.test.ts` 5 個 case 全綠（目前 2 failed / 2 passed / 1 skipped）
- 修法不動 clade `manifest.schema.json`

## 開工前值得知道的三件事

1. **`CLADE_WORK_ID` 是髒的**：ambient 值是 `W-2026-09-10-always-load-diet`，那是更早的 session
   留下來的，與 starter 完全無關，本 session 也沒碰過它。**NEVER** 對它 emit `work.done`
   —— 沒有任何實跑證據支持那件事已完成，而 `--verification` 是 fail-closed 欄位。
2. **TD-014 只剩一項，且不歸本 repo 修**：24 條 blocked error 已於 2026-09-11 全清
   （clade TD-1019 / TD-1066 + v1.12.46）。剩下的是 `<maintainer-domain>` 佔位符在
   `template/.claude/` + `template/.cursor/` 的 22 檔 58 處**無解析說明**，scaffold 出去的
   使用者解不開它。修在 clade 源檔，本 repo 只驗收。不擋任何 gate。
3. **starter 的 clade 投影層現在是健康的**：`.clade/projections/` 8/8、manifest v1.12.46、
   `sync-rules --check` exit 0 `✓ no drift, no orphans`。**如果你看到它退化，那是新問題**，
   不是這條 TD 的一部分。

## 一件卡在 Charles 身上、你接手後由你持有

TDMS 的 nuxt dev server（PID 2247035，整棵樹含子行程 1.7 GB，底下掛著一支 `cloudflared tunnel`
PID 2249216）要不要殺掉。更早之前他一度授權殺掉另一支 3.0 GB 的（PID 2134757），但**授權當下
的前提已不成立**——那支已自行結束，記憶體也回到 available 28 Gi。**他還沒重新答**。
如果他沒再提，不用主動追；那條 tunnel 可能有人正在用，**NEVER** 自行殺掉。

## 本 session 已完成、不要重做

- starter native cutover 收尾：`.clade/projections/` 0/8 → **8/8**，manifest 1.12.37 → **1.12.46**
- clade TD-1019（public profile 對 resource 註解 fail-closed）已解並隨 v1.12.46 散播
- clade TD-1066（sanitizer 認不出不透明 ID；含一筆已公開三週的實際洩漏）已解，
  洩漏檔已移出 starter `origin/main`（Charles 裁示：只移除 HEAD、不改寫歷史、Notion 不輪換）
- clade TD-1014 已結案（11/11 consumer 到 v1.12.46）
- 本 repo TD-014 已收斂範圍、ROADMAP 同步（`88bbea82`）

---

## 結果（2026-09-11 01:30，繼任者 session）

> 本節與下方 `## /commit ceremony 的產出` 的相對路徑一律以
> `template/packages/create-nuxt-starter/` 為基準（`template/vitest.config.ts` 這類明寫的除外）；
> clade 的檔案一律明寫 clade。

**TD-013 已結案**，採第 2 條修法（跟著產生器走），已移入 `docs/archives/tech-debt-closed-2026-09.md`。

### 呼叫端確認（選 2 之前的必要步驟）


`src/post-scaffold.ts` 的 `runInitConsumer()` 才是 scaffold 真實產生 manifest 的那一步——
它不是 scaffolder 自己寫 JSON，而是用一組 argv 呼叫 clade `scripts/init-consumer.ts`，
由 clade 寫出 canonical `.clade/manifest.json`（`.claude/hub.json` 只在已存在時作為相容別名保留）。
clade 的 `scripts/register-consumer.ts` 兩者接受其一（該檔 243-244 行）。
所以「讓測試跟著 schema 走」= fixture 也走 init-consumer，而不是自己拼 modules。

### 改了什麼

1. `src/post-scaffold.ts`：從 `runInitConsumer()` 抽出匯出的 `buildInitConsumerArgs(script, mods)`，
   與既有的 `buildRegisterConsumerArgs` 同一個形狀。`runInitConsumer` 改呼叫它，行為不變。
2. `test/clade-registry-seam.test.ts`：`makeFakeConsumer` 不再寫死 hub.json，改用
   `buildInitConsumerArgs` 實跑 clade init-consumer 產生 manifest；`seamAvailable` 同時要求
   init 與 register 兩支腳本都在。
3. `test/post-scaffold.test.ts`：新增 `buildInitConsumerArgs` 的兩條 argv 單元測試
   （五軸形狀、`--local-hooks` 併成單一 argv 元素）。

**順帶補上的覆蓋**：init 這一半的 argv 原本沒有任何測試看著——與 register 側同一類 bug
（clade 改 flag 名 → 只有真人跑完整個 scaffold 才會發現）。現在兩半都在 seam gate 內。

### 驗證（實跑）

- `npx vitest run test/clade-registry-seam.test.ts` → **4 passed | 1 skipped**（原 2 failed）。
  那 1 skipped 是 `describe.skipIf(seamAvailable)` 的「找不到 clade checkout」互斥分支，
  有 clade 在時本來就該 skip——**不是**未修好的 case。
- 套件全量 `npx vitest run` → 198 passed | 2 skipped，17 test files passed。
- `npx tsc --noEmit` exit 0；`vp lint --deny-warnings` 0 warnings 0 errors；`vp fmt` 已套用。
- `bash scripts/audit-template-hygiene.sh` → `No starter hygiene findings detected in template/.`
- clade `manifest.schema.json` **未變動**（`git -C ~/offline/clade status` 乾淨，本趟只讀不寫）。

### 順帶修掉的文件漂移

`docs/tech-debt.md` 的 Index 表原本漏列 TD-013 與 TD-014（body 有、表格沒有）。TD-013 結案移入
archive，TD-014 補進 Index。`ROADMAP.md` 的 TD-013 條目一併移除。

### 未做 / 留給下一手

- 前一手交棒時提到的 TDMS nuxt dev server（PID 2247035）+ `cloudflared tunnel`（PID 2249216）
  仍未處置，Charles 未重新表態，本 session 未碰。
- TD-014 剩下的 `<maintainer-domain>` 佔位符無解析說明，修在 clade 源檔，不歸本 repo。

---

## /commit ceremony 的產出（同一趟，2026-09-11 01:3x–01:5x）

### 0-A.0 simplify 改掉的 4 件事

1. 測試不再自抄一份 `resolveCladeRoot()`，改用 src 已匯出的 `findCladeRoot()`（兩者原本逐字相同）。
2. fixture 的 argv 追加 test-only 的 `--skip-baseline`：init 收尾的 baseline 會再 spawn 8 支
   audit，對空的 tmp fixture 每支都只回 none。seam 測試 **2.31s → 0.75s**，覆蓋不變
   （baseline 跑在 manifest 驗證**之後**，跳掉不會遮住 schema 回歸）。
3. skip 理由改成講真話：原本三種不可用（沒 checkout / 缺 register-consumer / 缺 init-consumer）
   都印「找不到 Clade checkout」。
4. 收掉檔頭與函式註解重複的那段理由。

### 0-A.1 抓到並修掉的 Major（我自己在第 3 點引入的）

`describe.skipIf(seamAvailable)` 的區塊**只在 seam 不可用時執行**，我卻把斷言寫成
`expect(unavailableReason).toBeUndefined()` —— 在唯一會執行它的情況下必定失敗。實證：

```bash
env -u CLADE_HOME HOME=<空目錄> npx vitest run test/clade-registry-seam.test.ts
# 修正前：1 failed | 4 skipped   ← 沒有 clade checkout 的 CI 會紅
# 修正後：1 passed | 4 skipped
```

修法是把理由放進**測試名**（報告裡看得到的載體），斷言改成會過的那一邊 `toBeDefined()`。
教訓：`skipIf` 區塊裡的斷言方向與區塊的執行條件是綁在一起的，改其中一個就要重判另一個。

**這條之前沒被任何人跑過**——原始 acceptance「5 個 case 全綠」只在有 clade 的機器上驗過，
無 clade 組態從來沒跑。現在兩種組態都實測。

### 0-C 撞到既有 gate 紅燈 → 開 TD-015，同日解掉並結案

`pnpm run doctor` exit 1（`--max-warnings 0`，1 warn + 6 info），全部不在本次 diff 內；
`vite-doctor` 自 `ef94e035` 起釘在 0.0.10，最近三個 commit 都在這個 gate 紅著時落地且**未登記**。
**沒有 bypass，直接修掉了**（Charles 指示「立刻分析處理」）：

1. **升版這條路不通**：`npm view vite-doctor versions` 共 13 版，`0.0.10` 就是 latest。
2. **誤判證實成立，而且不是推測**：`sentryCloudflareNitroPlugin` 的 callback 簽名是
   `(nitroApp: NitroApp) => CloudflareOptions`（`@sentry/nuxt` 的
   `runtime/plugins/sentry-cloudflare.server.d.ts`）—— 拿到的是 NitroApp 不是 H3Event，
   而且在 Nitro 啟動時只跑一次。`useRuntimeConfig(event)` 在此無從呼叫，也不該呼叫。
3. **抑制不必動 clade**：vite-doctor 有兩種抑制入口 —— 一個叫 doctor.config.json 的宣告檔
   （CLI 會自動從 cwd 載入，consumer 自有；本 repo 沒有建立這個檔）與 inline
   `doctor-disable-next-line <ruleId> -- <reason>`。選 inline —— 理由
   寫在被打的那一行旁邊，下一個讀到的人不必翻到別的檔才知道為什麼。clade 管理的
   `vendor/doctor-shared/` 完全沒動。
4. **踩到一個會靜默失效的坑**：抑制註解的比對窗只看**上方 3 行**。第一版我把理由寫成 6 行，
   token 掉出窗外，抑制無聲失效（doctor 照樣 exit 1）。已在該處留下 MUST 警告。
5. 順帶清掉 6 條 `VUE0023` info（`:loading="loading"` → `:loading`，Vue 3.5.31 支援
   same-name shorthand），其中 4 條在 scaffolder / scripts template 內。

結果：`pnpm run doctor` → `status: clean`、`blocker:0 error:0 warn:0 info:0`、**exit 0**
（原本 exit 1、`warn:1 info:6`）。TD-015 同日結案，已移入
`docs/archives/tech-debt-closed-2026-09.md`。**未動** Sentry plugin 的取值方式。

### 0-A.2 深度 review 的 4 條 Minor（全部修掉）

1. seam **可用**時那個 skipped 測試的名字會渲染成「…未驗證：undefined」——`describe.skipIf(true)`
   仍會執行 factory 收集子項，所以樣板字串照樣求值。改成 `?? '(seam 可用，本區塊不適用)'`。
2. 測試名只有 verbose reporter 印得出來，CI 跑的是預設 reporter（`vp test --coverage`），
   只會看到總計那兩行。**修好了，但我一開始判錯**：先試 `console.warn`（module scope 與測試
   體內各一次）都不印，我就下了「沒有更大聲的做法」的結論，把程式碼移除、只留一段限制說明。
   裁決者指出那個前提沒有立住 —— 實測證明它是錯的：

   | 寫法 | 非 TTY 預設 reporter |
   | --- | --- |
   | `console.warn`（module scope / 測試體內） | **不印**（vitest 攔截 console） |
   | `process.stdout.write`（module scope / 測試體內） | **會印** |

   改用 `process.stdout.write`，現在無 clade 的執行會在 CI log 裡直接看到
   `[clade-registry-seam] 跨 repo seam 本次未驗證：找不到 Clade checkout（…）`。
   檔頭與尾段那兩句自相矛盾的註解一併改掉。

   **NEVER** 為了讓它變大聲就把斷言改成會失敗的那一邊 —— 那正是 0-A.1 抓到的那個 Major。
   教訓：「試了兩種都不行」不等於「做不到」，把它寫成結論就是把自己的取樣範圍當成事實。
3. `test/post-scaffold.test.ts` 的 import 順序：我上一輪宣稱修好但其實沒有（把
   `formatGeneratedProject` 搬進了 `build*` 群組中間）。這次真的排好了。
4. TD-015 的 body 被放到 `## Cross-repo pointers` 之後，跟其他 TD 不一致；已移到前面。

### 0-C 的第二個發現：`pnpm test` 把 `.pi/` 底下整個 clade checkout 收進來

`cd template && pnpm test` 是 **exit 1**，571 個 test **檔**失敗、6 個 test 失敗 ——
但逐一比對後，**571 個失敗檔 100% 都在 `template/.pi/git/github.com/YuDefine/clade/` 底下**，
那 6 個失敗 test 也是。本 repo 自己的測試 0 失敗。

`.pi/` 是 gitignore 的執行期快取（`template/.gitignore:106` `.pi/*`），底下躺著一份完整的
clade checkout；`template/vitest.config.ts` 的 `unit` project exclude 清單沒有它，於是 vitest
把另一個 repo 的測試全收了，而它們的相對 import 在這裡一律解析失敗。

CI 上沒有 `.pi/`（gitignore = 不會被 clone），所以這是純本機現象 —— 也就是本機與 CI 的
0-C 結果長期對不起來。**已在本次一併修掉**：exclude 補 `.pi/**`。

> 我一開始把它讀成「有失敗卻 exit 0」——那是誤讀，`exit=$?` 取到的是複合指令最後一段
> （`grep -c`）的碼。單獨跑 `pnpm test` 是 exit 1，gate 本身沒有壞。

### 0-A.2 跨模型裁決（VERDICT: PASS，0 Critical / 0 Major）

前兩輪的 findings 逐條裁定：Major 與 6 條 Minor/Info 全部 resolved 並附證據；只有「skip 理由在
CI 看不到」那條被判為 **real issue, NOT resolved**，理由是我的「沒有更大聲的做法」是斷言而非
證明 —— 已如上修掉。裁決者另外找到 3 條前兩輪都漏掉的：

- **N1（已修）**：`.github/workflows/template-ci.yml` 的 path filter **不含**
  `template/vitest.config.ts` 與 `template/packages/**`，所以本次改到的測試 gate 自己不會觸發
  Template CI。連帶推翻我先前那句「沒有 clade checkout 的 CI 會紅」—— 對**這一批**而言不會，
  它會潛伏到之後某個動 `template/app/**` 的無關 PR 才爆，那時看起來跟成因毫無關係。
  已補上 `template/test/**`、`template/packages/**`、`template/vitest.config.ts` 三條。
- **N2（不成立，已用實測駁回）**：裁決者認為 `makeFakeConsumer` 的 `stdio: 'pipe'` 會吞掉 clade
  的 stderr。實測 `execFileSync` 失敗時 child stderr **同時**進到 `error.message` 與
  `error.stderr`（各印一次 `true` 驗過），診斷沒有遺失。不改。
- **N3 / N6（記錄不改）**：`scripts/register-consumer.ts` 的路徑仍在三處手工 join（`src` 兩處
  + 測試一處），與本檔那條「不要抄一份」的註解同型，但屬既有且跨檔，不塞進本批；
  `template/.pi/settings.json` 被追蹤且指向 private repo，root 的 `scripts/create-clean.sh` 就地跑會留下它 ——
  既有問題，本次未觸碰，記在這裡免得下次被當成新發現。

### TD-015 修法的 delta review：抓到我兩個事實錯誤

派了獨立 reviewer 只看 doctor 那段 delta，回 **BLOCK / 2 Major**，兩條都成立，我自己驗過：

1. **「callback 在啟動時只跑一次」是錯的。** 讀 `@sentry/nuxt` 的
   `runtime/plugins/sentry-cloudflare.server.js`：`optionsOrFn(nitroApp)` 被包在
   `nitroApp.localFetch` 的 Proxy `apply` 裡，**每個 request 都會跑**。我寫反了，而且把同一句
   錯誤複製到 TD-015 的 archive 條目。兩處都已更正。
   抑制的**結論**不受影響 —— 真正的理由是簽名裡從頭到尾沒有 H3Event，加上規則只看
   「`server/` 底下有沒有零引數 `useRuntimeConfig()`」不分 plugin 與 handler。
2. **「上方 3 行」是 off-by-one。** `findSuppression` 取 `lines.slice(line-3, line+1)`，換算成
   1-based 是 **[L−2, L+1]**。實測三種距離：

   | token 位置 | NITRO0008 |
   | --- | --- |
   | 上方 1 行 | 抑制成功 |
   | 上方 2 行 | 抑制成功 |
   | **正好上方 3 行** | **仍然報 —— 靜默失效** |

   我原本寫「MUST 貼在 3 行內」，那句話會把下一個人推進我正在警告的那個坑。已改成
   「上方 1 或 2 行」並附實測。

reviewer 另外指出零引數 `useRuntimeConfig()` 的 snapshot 時機問題 —— 已釘死機制、登記為
**TD-016**（實際後果要一次真實 Cloudflare 部署才判得出來）。**沒有**照它建議把 `config.appEnv`
換成 `process.env.NUXT_APP_ENV`：`deploy-env-identity` 規約指名 server / nitro plugin 就是要讀
runtime config 的 `appEnv`，那是 clade 標準層的接線，consumer 不能自行偏離；若實測後成立，
根因在 clade，回報那邊決定。

順帶踩到並登記 **TD-017**：`validate-starter` 留在 `temp/` 的 scaffold 產物會讓 doctor 從
exit 0 變 exit 1（3 條 `NUXT0054`），錯誤訊息指向 generated 檔，第一眼很容易誤讀成自己改壞了。

