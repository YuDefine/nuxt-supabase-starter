// 🔒 LOCKED — managed by clade · Source: vendor/oxc-shared/preset.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/oxc-shared/preset.ts
// vendor/oxc-shared/preset.ts — clade-governed oxlint + oxfmt baseline preset
//
// Single source of truth for `vite.config.ts` lint/fmt rules across:
//   - clade itself
//   - <consumer-a> / <consumer-b> / <consumer-c> / <consumer-d> / nuxt-supabase-starter
//
// Consumer usage:
//
//   import { defineConfig } from 'vite-plus'
//   import { lintBase, fmtBase } from './vendor/oxc-shared/preset.ts'
//
//   export default defineConfig({
//     resolve: { alias: [...] },                         // consumer build config
//     lint: {
//       ...lintBase,
//       rules: { ...lintBase.rules, /* business overrides */ },
//       ignorePatterns: [...lintBase.ignorePatterns, /* extra paths */],
//     },
//     fmt: {
//       ...fmtBase,
//       experimentalTailwindcss: { stylesheet: './app/assets/css/main.css' },
//       ignorePatterns: [...fmtBase.ignorePatterns, /* extra paths */],
//     },
//   })
//
// fleet 的 pre-commit 只收斂到一條路徑（TD-776，2026-09-22）：hook 呼叫
// `bash scripts/pre-commit/runner.sh` → `checks/vp-staged.sh`，它經
// `scripts/pre-commit/staged-targets.ts` 讀本檔的 `isStagedExcluded` 決定哪些 staged 檔
// 進 `vp lint` / `vp fmt`。**NEVER** 在 hook 另外呼叫 `vp staged` / `lint-staged`——那會讓
// 下面的 `staged:` 區塊變成第二個 lint 入口。
//
// 還沒收斂的 consumer（hook 直接跑 `vp staged`）在過渡期仍讀 `vite.config.ts` 的 `staged:`。
// 那一格的排除清單 MUST 追溯得到 `PROJECTION_EXCLUDES`，NEVER 手寫一份平行的。
// 形狀是直接用 preset 匯出的 `stagedBase`（一行，不必自己組 filter）：
//
//   import { fmtBase, lintBase, stagedBase } from './vendor/oxc-shared/preset.ts'
//
//   export default defineConfig({ /* … */ staged: stagedBase })
//
// glob 要客製（例如 `'*': 'vp check --fix'` 那種形狀）時改用 `isStagedExcluded`（NEVER 只用
// `isProjectionPath`——它漏掉 `STAGED_ONLY_EXCLUDES` 的 root `scripts/**` 與 LOCKED `AGENTS.md`）：
//
//   import { isStagedExcluded } from './vendor/oxc-shared/preset.ts'
//   staged: {
//     '*': (files) => {
//       const t = files.filter((f) => !isStagedExcluded(f))
//       // 逐檔加引號（含空白的路徑不加就被 string-argv 拆錯）、空的回 `[]` 不回 `['true']`
//       return t.length > 0 ? [`vp check --fix ${t.map((f) => JSON.stringify(f)).join(' ')}`] : []
//     },
//   }
//
//   `vp lint` / `vp fmt` 對「輸入路徑全被 ignore」回 **exit 1**，而投影層本來就在上面兩個
//   ignorePatterns 內。所以只要 staged 檔裡有一個投影檔、而 hook 沒把它濾掉，整個
//   pre-commit 就掛 —— 症狀是 `No files found to lint`，看起來像路徑打錯，不像被 ignore。
//   手寫平行清單必然漂移：nuxt-supabase-starter 的 staged filter 排了 `.claude/skills/`
//   `.agents/` `.codex/` 卻漏掉 `vendor/`，連續擋掉 clade v1.4.388 / v1.4.389 / v1.4.409
//   三次交付（TD-310）。這裡的 `PROJECTION_EXCLUDES` 一改，所有讀它的 consumer 自動跟上。
//
//   `.agents/` `.codex/` `.cursor/` 也在這份清單裡（2026-08-24 起），所以 staged filter
//   **NEVER** 再另外維護一份 agent 投影目錄的手寫陣列。
//
// Why a preset (not inline rule duplication):
//   `rules/core/code-style.md` § MUST documents these fields as required, but
//   text-only governance does not lock structure — 5 consumers had drifted
//   (trailingComma 'es5' vs 'all', missing categories/plugins on <consumer-d>, etc.).
//   This preset turns the rule into an importable artifact; changing the
//   baseline = edit this file in clade + propagate.

/**
 * clade-projected paths. In a consumer these are LOCKED copies (chmod 444)
 * written by `scripts/propagate.ts` — a consumer *cannot* fix a lint or fmt
 * hit inside them, because the fix has to land in clade and propagate back.
 * So whether these paths get checked is a decision the shared baseline has to
 * make; leaving it to each consumer means whichever consumer forgets to
 * re-inline the list gets a red CI it has no way to resolve locally.
 *
 * 2026-07-28: that is exactly how `nuxt-supabase-starter` Template CI broke on
 * `vp fmt --check` over `vendor/snippets/manual-review-enforcement/patterns.json`
 * — <consumer-j> and co-purchase had each independently patched `vendor/**`
 * into their own vite.config.ts, which hid the gap instead of closing it.
 * `scripts/audit-governance-drift.ts` check 10 now fails on any config that
 * re-inlines one of these, so the next gap surfaces before a consumer does.
 *
 * clade itself is the source of truth for `vendor/`, so its own vite.config.ts
 * filters `vendor/**` back out — that one exception is deliberate and local.
 *
 * 2026-08-24 (TD-626): the three agent projection dirs joined this list. They had
 * been sitting only in lintBase/fmtBase.ignorePatterns, which the `staged` filter
 * never reads — so every consumer hand-wrote its own parallel copy, the exact
 * drift the comment at the top of this file exists to ban.
 */
export const PROJECTION_EXCLUDES = [
  '.claude/**',
  '.clade/**',
  '.spectra/**',
  'vendor/**',
  // specformula 訊息 catalog 是唯一落在 consumer repo root（不在 vendor/ 底下）的 clade
  // mirror，理由同 vendor/**：staged filter 得看得到它才不會把上游 mirror 誤判成 consumer
  // 自己的檔案去 lint/fmt。
  'specs/errors/**',
  // Agent 投影面：`.agents/` `.codex/` 由 scripts/sync-to-codex.ts 生成，`.cursor/` 由
  // scripts/sync-to-cursor.ts 生成（2026-08-24 起，先前是人工快照）。三者與上面四條同性質
  // —— consumer 端是產生物，裡面的 lint / fmt 違規只能回 clade 修。先前它們只躺在下面的
  // lintBase / fmtBase.ignorePatterns，沒進這份清單，所以讀 PROJECTION_EXCLUDES 的 staged
  // filter 看不到它們，每個 consumer 只好各自手寫一份平行清單（TD-626）。
  '.agents/**',
  '.codex/**',
  '.cursor/**',
]

/**
 * The slice of `vendor/` that stays excluded even in clade, where `vendor/` is
 * real source rather than a projection: snippet corpora are cookbook examples
 * (several deliberately demonstrate the anti-pattern a rule exists to ban), and
 * review-gui.ts embeds an HTML template oxfmt/oxlint both mangle.
 * clade's own vite.config.ts drops `vendor/**` and adds these back.
 */
export const CLADE_VENDOR_EXCLUDES = [
  'vendor/snippets/**',
  // SpecFormula：`vendor/specformula/` 是 git submodule（上游 repo 全文），
  // `vendor/specformula-ts/` 是 scripts/sync-upstream-mirrors.ts 生成的 mirror。
  // 兩者都不是 clade 手寫源碼 —— 上游用自己的 eslint/prettier baseline，在這裡 lint 它
  // 只會產生一批沒有人能修的 finding（修法在上游 repo，不在 clade）。
  'vendor/specformula/**',
  'vendor/specformula-ts/**',
  'vendor/specformula-errors/**',
  // aixbdd 同理：`vendor/aixbdd/` 是 git submodule（上游 repo 全文），mirror 只有 markdown
  // 與 template，落在 plugins/ 底下不進 lint 面。
  'vendor/aixbdd/**',
]

/**
 * 上游 mirror 的落點（`registry/upstream-submodules.json` 的 `mirror.skillsTo` 與其 plugin 根）。
 *
 * 這些目錄的內容是 `scripts/sync-upstream-mirrors.ts` 逐字複製上游的產物 —— 上游用自己的
 * lint / fmt baseline，這裡報出來的每一個 finding 都**沒有人能在 clade 修**（修法在上游 repo），
 * 而 oxfmt 一旦改寫它們，`--check` 就永遠紅。實證：aixbdd 的
 * `api-plan/templates/openapi.yaml` 是帶 `{{PLACEHOLDER}}` 的模板，YAML parser 直接 SyntaxError。
 *
 * 代價是 clade 自己寫的補充文件（`specformula-config/nuxt.md`）也一起不進 fmt 面。
 * 這是刻意的：把 mirror 目錄切成「這幾個檔要檢查、那幾個不要」需要一份與 registry 平行
 * 維護的清單，而那份清單會漂開。
 */
export const CLADE_MIRROR_EXCLUDES = [
  'capabilities/modules/capabilities/aixbdd/**',
  'capabilities/modules/capabilities/specformula/skills/**',
  // `reference/**` 是 mirror.extraDirs 的落點（specformula-docs 的 Gherkin/ISA .mdx）。
  // **NEVER 把這一列併回上面那列的 `skills/**` 去猜一個共同前綴**：plugin 根底下還有
  // clade 自己寫的 README / PIN.json，整個 plugin 排除掉會連它們一起放生。
  // 2026-09-08 實證：本目錄第一次落地當天就被一次 `vp fmt` 改寫（markdown 表格對齊 ＋
  // frontmatter 後補空行），22 個檔全數 drift，`sync-upstream-mirrors --check` 從 0 變 2。
  'capabilities/modules/capabilities/specformula/reference/**',
]

/**
 * Shipped-template lint 規則子集（TD-1003）—— `scripts/audit-shipped-template-lint.ts`
 * 餵給 vite-doctor `--rules` 的 rule id 清單。
 *
 * 為什麼需要它：`vendor/snippets/**` 在 `CLADE_VENDOR_EXCLUDES` 內（template 刻意不完整，
 * 全套 lint 會假陽性爆炸），於是 clade 自己的 `vp check` 對出貨 template 結構性 0 命中 ——
 * 但同一份檔經 vendor-targets 投影進每個 non-public consumer，由 consumer 的 vite-doctor
 * 擋（2026-09-07 <consumer-b> 實測：`time-service.template.ts` 的
 * `globalThis as unknown as FrozenHolder` 觸發 TS0001，擋掉該 repo 每一次 /commit）。
 * 本子集是「在 publish 前置先現形」的那道檢查。
 *
 * 收錄判準（兩條都要中，NEVER 放寬）：
 *   1. severity = error —— 只有 error 會讓 consumer `pnpm doctor` exit 非 0；warn / info
 *      不構成「出貨會現形」的失敗模式，收進來只放大假陽性面
 *   2. 純語法層 —— 判定只讀單檔 AST，不依賴專案上下文（import 解析、framework
 *      detection、檔案角色、env / worker / SSR-entry 判定）。template 刻意不完整，
 *      需要上下文的規則在這裡恆假陽性
 *
 * `pnpm doctor` 預設只在 error+ 失敗（warn 要 --max-warnings 才擋），所以本清單就是
 * consumer doctor 的 blocking 面 ∩ 語法層規則：template 中了任何一條，在 consumer 端
 * 就是 error —— publish 必須先擋。
 *
 * NEVER 直接套 `doctorRules`（vendor/doctor-shared/preset.ts）當子集：那是完整 consumer
 * 規則集，絕大多數條目需要 Nuxt 專案上下文，對 template 恆假陽性 —— 而一個吵到要被
 * 關掉的 gate 就是一個不存在的 gate。
 */
export const SHIPPED_TEMPLATE_LINT_RULES = [
  // TS0001 — 鏈式 type assertion 製造型別證據。觸發 TD-1003 的實際條目。
  'typescript/evidence/no-chained-type-assertions',
  // TS0004 — generic 簽名讓 caller 自選 result type，同屬型別證據製造家族。
  'typescript/evidence/no-caller-chosen-result-type',
  // JSON.parse 之類的輸出未經驗證直接當可信型別用。
  'typescript/boundaries/no-unvalidated-deserialization',
  // import.meta.glob 帶動態 pattern —— 純語法層缺陷（只認靜態字串 glob）。
  'vite/imports/require-static-glob-pattern',
]

/**
 * `PROJECTION_EXCLUDES` 的目錄前綴形式（`'.clade/**'` → `'.clade/'`），給逐檔比對用。
 * glob 形式餵不了 staged hook —— hook 拿到的是 `git diff --name-only` 的相對路徑字串。
 */
export const projectionPrefixes = PROJECTION_EXCLUDES.map((p) => p.replace(/\/\*\*$/, '/'))

/**
 * repo root 的絕對路徑。lint-staged 依版本 / 設定可能餵**絕對路徑**進來，而投影判定
 * 只在 repo-relative 座標下才有意義（見 `isProjectionPath` 的註解）。
 *
 * `process.cwd()` 在 pre-commit 情境就是 repo root（husky / vp staged 都從那裡起 hook）。
 * 拿不到就回空字串，此時 `toRepoRelative` 原樣返回 —— 退化成純相對比對，不會誤殺。
 */
function repoRoot(): string {
  try {
    const cwd = globalThis.process?.cwd?.()
    return typeof cwd === 'string' && cwd.length > 0 ? cwd.replace(/\/+$/, '') + '/' : ''
  } catch {
    return ''
  }
}

/**
 * 把可能是絕對路徑的 staged 檔名相對化到 repo root。已是相對路徑就原樣返回。
 * 前導 `./` 一併去掉 —— `./vendor/x.ts` 與 `vendor/x.ts` 是同一個檔。
 */
export function toRepoRelative(file: string): string {
  const root = repoRoot()
  let f = file
  if (root && f.startsWith(root)) f = f.slice(root.length)
  while (f.startsWith('./')) f = f.slice(2)
  return f
}

/**
 * 這個 staged 檔路徑是不是投影層（LOCKED、chmod 444、consumer 端改不動）。
 *
 * **先相對化到 repo root，再做前綴比對** —— NEVER 對原始字串做 `includes('/' + dir)`
 * 片段比對。2026-08-28（TD-770）：舊實作是
 * `file.startsWith(dir) || file.includes('/' + dir)`，而 lint-staged 餵進來的是絕對
 * 路徑。checkout 落在 `~/vendor/<repo>` / `~/.claude/<repo>` 這類**祖先目錄同名**的位置
 * 時，`includes('/vendor/')` 對**每一個**業務檔為真 → 全部被當投影排除 → `vp lint` /
 * `vp fmt` 一個都不跑，pre-commit **無聲**放行。那個失敗與「lint 真的沒發現問題」在
 * 任何輸出上同形，所以它不會被任何人發現。repo 內的巢狀同名目錄（`app/vendor/`）同樣誤殺。
 *
 * 巢狀投影落點由下面第二條前綴段覆蓋：相對化之後才允許 `/<dir>` 片段比對，此時分母
 * 已經被限制在 repo 內，不會再撞到 repo 外的祖先目錄。**repo 內**的同名目錄仍會命中，
 * 這是刻意取捨不是漏修 —— starter 真的有 `template/vendor/`、`template/.claude/`、
 * `scripts/vendor/` 三處巢狀投影，與假想的業務目錄 `app/vendor/` 在路徑形狀上不可區分。
 * 多濾一個業務目錄的症狀是 loud（那些檔沒過 lint）；漏濾一個投影目錄的症狀是整個
 * pre-commit 被 `No files found to lint` exit 1 擋死（TD-310 / TD-670）。
 *
 * 型別必須寫成 TS 註記，NEVER 只留 JSDoc `@param {string}`：本檔副檔名是 `.ts`，
 * JSDoc 型別只有 `.js` 檔（allowJs + checkJs）才會被採納。consumer 端跑
 * `noImplicitAny` 的 typecheck 時，未標註的參數一律 TS7006，投影過去就把對方的
 * pre-push 擋死（v1.11.86 實際擋住 <consumer-a>）。
 *
 * @param file staged 檔路徑（相對或絕對皆可）
 */
export function isProjectionPath(file: string): boolean {
  const rel = toRepoRelative(file)
  // 相對化之後仍是絕對路徑 = 這個檔根本不在本 repo 內。投影判定對它沒有意義，
  // 而片段比對在這裡正是誤殺的來源 —— 一律回 false，交給下游工具自己處理。
  if (rel.startsWith('/')) return false
  return projectionPrefixes.some((dir) => rel.startsWith(dir) || rel.includes(`/${dir}`))
}

/**
 * **只有 pre-commit staged 過濾**需要、而 lint / fmt 的 ignorePatterns **不能**要的排除。
 *
 * `scripts/**`：clade 的 `vendor/scripts/**` 在 consumer 端投影到 repo root 的 `scripts/`
 * （`scripts/lib/vendor-targets.ts`），與 consumer 自家的 script 共用同一個目錄。
 * - 它**不能**進 `PROJECTION_EXCLUDES`：那份清單被展開進 `lintBase` / `fmtBase` 的
 *   ignorePatterns，放進去等於 consumer 的整倉 `vp check` / CI 從此看不到自家 script。
 * - 它**要**留在 staged 過濾：propagate 的 delivery commit 帶的是整批投影 script，
 *   pre-commit 對它們跑 `vp lint --fix` + `vp fmt` 再 `git add`，任何一次改寫都會把
 *   偏離源檔的內容 commit 進投影（v1.4.349 實證同型：sanitize 改寫後 fmt 想改就整個
 *   commit 掛掉）。consumer 端判不出「`scripts/` 底下哪幾支是投影」—— 那份清單只在
 *   clade 的 vendor-targets，`.claude/.hub-state.json` 只記 plugin scripts —— 所以只能
 *   整個目錄排除。代價：consumer 自家 `scripts/` 的檔在 commit 當下不跑 lint / fmt，
 *   靠整倉 `vp check`（CI / pre-push）兜住。
 *
 * 2026-09-22（TD-777）前這條只躺在 `vp-staged.sh` 的手寫 `CLADE_MANAGED_PREFIXES`，
 * 與 `PROJECTION_EXCLUDES` 雙向漂移（缺 `.spectra/` `.cursor/`、`.claude/` 只列 5 個子目錄）。
 * 同一批手寫清單裡的 `codex/` 沒有搬過來：已廢止目錄（`gitignore-governance.ts` 的
 * `DEPRECATED_ENTRIES`）。
 *
 * `AGENTS.md`：sync-to-codex 產出、consumer 端 chmod 444 的 LOCKED 檔。TD-777 當時判
 * 「`fmtBase.ignorePatterns` 的 `**\/*.md` 已蓋到」而不收——但那只在 consumer 的 fmt
 * ignore **展開了 `fmtBase.ignorePatterns`** 時成立；consumer 自訂 fmt ignore 沒帶
 * `**\/*.md` 時，`vp fmt` 會真的去寫這個 444 檔 → EACCES → 整個 commit 掛掉
 * （PR #175 0-A；與 `scripts/` 的 v1.4.349 同型）。它與 `scripts/**` 同屬「只有
 * staged 過濾需要」的排除——`AGENTS.md` 不能進 `PROJECTION_EXCLUDES`：那份清單會
 * 展開進 lintBase.ignorePatterns，而 repo root 的 `AGENTS.md` 在 **clade 自己**是
 * 手寫源檔（本檔 AGENTS.md 不是 sync 產物），整倉 lint 還是要看得到它。
 * 只比 repo root 的單檔，不比巢狀——`docs/AGENTS.md` 是 consumer 自己的檔。
 */
export const STAGED_ONLY_EXCLUDES = ['scripts/**', 'AGENTS.md']

/**
 * `STAGED_ONLY_EXCLUDES` 的比對形式：`/**` 收尾的取目錄前綴（`scripts/**` → `scripts/`），
 * 其餘視為 repo root 的**單檔精確比對**（`AGENTS.md`）。目錄只比起頭，NEVER 片段比對 ——
 * `app/scripts/` 是業務檔。
 */
const stagedOnlyPrefixes = STAGED_ONLY_EXCLUDES.map((p) => p.replace(/\/\*\*$/, '/'))

/**
 * pre-commit staged 過濾的**唯一**判定式：投影層（`PROJECTION_EXCLUDES`）∪ `STAGED_ONLY_EXCLUDES`。
 *
 * fleet 的兩個讀者都走這一支，NEVER 各自組 filter（TD-776 / TD-777）：
 *   - `scripts/pre-commit/checks/vp-staged.sh`（經 `scripts/pre-commit/staged-targets.ts` 橋接）——
 *     fleet 收斂後唯一會執行的 pre-commit 路徑
 *   - 下方的 `stagedBase`（`vp staged` 路徑，收斂前的過渡期讀者）
 *
 * @param file staged 檔路徑（相對或絕對皆可）
 */
export function isStagedExcluded(file: string): boolean {
  if (isProjectionPath(file)) return true
  const rel = toRepoRelative(file)
  if (rel.startsWith('/')) return false
  // `scripts/` 是目錄前綴；`AGENTS.md` 是 repo-root 單檔精確比對（`docs/AGENTS.md` 是業務檔）
  return stagedOnlyPrefixes.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))
}

/**
 * consumer `vite.config.ts` 的 `staged` 現成值 —— 直接 `staged: stagedBase` 即可，
 * NEVER 再自己抄一份 filter（那正是本檔檔頭那條 MUST 要禁的漂移）。
 *
 * 為什麼一定要濾：`vp lint` / `vp fmt` 對「輸入路徑**全部**被 ignore」回 exit 1，訊息是
 * `No files found to lint`，長得像路徑打錯。而 `propagate.ts` 走
 * `git commit --only -- <clade-paths>`，它 commit 的**必然全是投影檔** —— 沒濾的 consumer
 * 每一趟 propagate 都站在觸發線上（2026-08-26 v1.11.84：co-purchase 整個 pre-commit 掛，
 * propagate 回 failed，TD-670）。
 *
 * **NEVER 在這裡加 `'*.md'` 那一格**：`fmtBase.ignorePatterns` 含 `'**\/*.md'`，所以
 * markdown 對 `vp fmt` 永遠是空輸入 → 每次純 md commit 都 exit 1。那不是投影層的洞，
 * 是同一個空輸入語義的另一個入口（2026-08-26 實測 <consumer-c> 就有這一格）。
 *
 * glob 不含 `*.d.ts` 的排除是刻意的：`.d.ts` 在 `lintBase.ignorePatterns` 內、卻不在
 * `fmtBase` 內，所以它要進 fmt、不能進 lint。
 *
 * 需要自訂 glob（例如 `'*': 'vp check --fix'` 那種形狀）時改用 `isProjectionPath`
 * 自己組，一樣算接上這條 MUST。
 */
/**
 * 逐個檔名加引號再串成一條命令的引數列。
 *
 * lint-staged 把回傳字串交給 string-argv 依空白拆 —— 含空白的路徑不加引號就被拆成
 * 兩個不存在的檔（TD-770 第 2 條）。consumer 的舊手寫 config 普遍用 `JSON.stringify`
 * 加這層引號，換裝到 `stagedBase` 時不能把它掉了。
 *
 * 用 `JSON.stringify` 而非手動包單引號：它同時逃逸引號與反斜線，對 string-argv 的
 * double-quote 語法是正確的。
 */
function quoteArgs(files: readonly string[]): string {
  return files.map((f) => JSON.stringify(f)).join(' ')
}

export const stagedBase = {
  '*.{js,ts,mjs,cjs,vue}': (files: readonly string[]) => {
    const fmtable = files.filter((f) => !isStagedExcluded(f))
    const lintable = fmtable.filter((f) => !f.endsWith('.d.ts'))
    const cmds = []
    if (lintable.length > 0) cmds.push(`vp lint --fix ${quoteArgs(lintable)}`)
    if (fmtable.length > 0) cmds.push(`vp fmt ${quoteArgs(fmtable)}`)
    // 全被濾掉時回**空陣列** —— lint-staged 對空任務列的語義就是「這格沒事做」，照過。
    // NEVER 回 `['true']`：那是一個 shell 依賴（原生 Windows 無 coreutils 就失敗），
    // 而它換來的只是語義上看起來明確一點（TD-770 第 3 條）。
    return cmds
  },
}

// 同 oxlint 的 DummyRule：OxlintConfig rules map 的 index signature 收這個形狀，
// overrides spread 進 defineConfig 才過型別（Record<string, unknown> 不行）。
type LintLevel = 'allow' | 'off' | 'warn' | 'error' | 'deny' | number
type LintRule = LintLevel | [LintLevel, ...unknown[]]

/** @type {import('oxlint').OxlintConfig} */
export const lintBase = {
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    pedantic: 'off',
    perf: 'warn',
    style: 'off',
    restriction: 'off',
    nursery: 'off',
  },
  rules: {
    'no-console': 'off',
    'no-debugger': 'warn',
    'no-alert': 'error',
    'no-undef': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    eqeqeq: ['error', 'always'],
    'no-await-in-loop': 'off',
    // 2026-05-31: newer oxlint (CI via unpinned setup-vp@v1) surfaces
    // unicorn/consistent-function-scoping in an on-category; local oxlint 1.63.0
    // does not yet. clade/consumer scripts use nested helpers by design
    // (e.g. `function git` in publish.ts / wt-helper.ts) — this rule is
    // stylistic noise here. Explicit pin off prevents CI lint drift on oxlint
    // version bumps (same pattern as no-underscore-dangle below).
    'unicorn/consistent-function-scoping': 'off',
    // <consumer-a> 2026-05-14: oxlint ^0.1.21 patch upgrade flipped this from warn→error.
    // Explicit pin keeps `_serviceClient` / fixture private prefix conventions
    // from breaking CI lint gate on lockfile regen. `allow` covers:
    //   __dirname / __filename — Node ESM reconstructions (via fileURLToPath)
    //   _serviceClient — Supabase admin-client private convention (<consumer-a> / <consumer-d>)
    //   _samples / _corrupt / _evlogFlushPromise — internal audit/digest fields
    //     in vendor/scripts/*, capabilities/core/scripts/commit-lock.mjs, and
    //     vendor/snippets/evlog-drain-pipeline/* (all propagate to consumers).
    'no-underscore-dangle': [
      'warn',
      {
        allow: [
          '__dirname',
          '__filename',
          '_serviceClient',
          '_samples',
          '_corrupt',
          '_evlogFlushPromise',
        ],
      },
    ],
    // === Coupling / cohesion gate（規約見 rules/core/coupling-cohesion.md）===
    // 這兩條是「SOLID 在 functional TS 語境」唯一機械可判定的部分：cycle =
    // 兩個模組互相依賴具體實作（DIP），barrel = 隱性依賴聚合。
    //
    // 刻意 NOT 收錄 max-lines-per-function / complexity / max-depth / max-params：
    // 它們量的是分支密度與規模，不是職責內聚，而 microsoft/TypeScript、vuejs/core、
    // vitejs/vite、facebook/react、nuxt/nuxt、antfu/eslint-config、xo 八個對照對象
    // 無一啟用。實測 <consumer-b> 862 violations / 542 檔（其中 88% 近 30 天仍在改），
    // 訊號雜訊比不足以進 gate。
    //
    // no-cycle 依賴 plugins 的 'import'（已在下方啟用），不需 CLI flag。已驗證
    // 它在只 lint 單一 staged 檔時仍能遞迴追出 cycle，且解得到 Nuxt 的 `~/` alias
    // （tsconfig extends chain 與 project references 兩種形狀皆可）。
    'import/no-cycle': 'error',
    'oxc/no-barrel-file': 'error',
  },
  plugins: ['typescript', 'unicorn', 'import', 'promise'],
  env: {
    browser: true,
    node: true,
    es2024: true,
  },
  ignorePatterns: [
    'node_modules/',
    '.nuxt/',
    '.output/',
    'dist/',
    'coverage/',
    'supabase/',
    '.vite-doctor/',
    '*.d.ts',
    // `.claude/` `.clade/` `.agents/` `.codex/` `.cursor/` 全部由 PROJECTION_EXCLUDES 帶入。
    ...PROJECTION_EXCLUDES,
  ],
  // 上方 JSDoc @type 對 .ts 不生效、oxlint 又不是直接 dep（無法 import type），
  // 所以 overrides 在這裡顯式宣告型別，consumer 才能 `...(lintBase.overrides ?? [])` 往後接。
  overrides: [] as { files: string[]; rules: Record<string, LintRule> }[],
}

/** @type {import('oxfmt').OxfmtConfig} */
export const fmtBase = {
  semi: false,
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  trailingComma: 'all',
  quoteProps: 'as-needed',
  arrowParens: 'always',
  endOfLine: 'lf',
  htmlWhitespaceSensitivity: 'css',
  vueIndentScriptAndStyle: true,
  experimentalSortPackageJson: {
    sortScripts: true,
  },
  ignorePatterns: [
    '**/*.md',
    'coverage/**',
    '.nuxt/**',
    '.output/**',
    'pnpm-lock.yaml',
    // evlog map 的產出（tracked 是為了當 ratchet baseline）。工具每次重生都會寫出
    // 非 canonical 形式，不排除的話每次更新 baseline 都要多跑一次 fmt，且 lint-staged
    // 會在 commit 當下偷改內容並 re-stage。與上面的 lockfile 同類：tracked 的產生物。
    '**/evlog.map.json',
    '.vite-doctor/**',
    // 投影面（`.claude/` `.clade/` `.spectra/` `vendor/` `.agents/` `.codex/` `.cursor/`）
    // 一律由 PROJECTION_EXCLUDES 帶入 —— consumer 不必在自己的 fmt.ignorePatterns 再列一次。
    ...PROJECTION_EXCLUDES,
  ],
}

/**
 * Vitest 的 `defaultExclude` 逐字複本（v4.1.11 實測）。
 *
 * **為什麼是複本而不是 `import { defaultExclude } from 'vite-plus'`**：本檔目前**零 import**，
 * 而它的消費端不只有 `vite.config.ts` —— 實際會 import 本檔的純 node 腳本包括
 * `scripts/audit-typecheck-projection-face.ts`；`vendor/review-gui-web/{nuxt,vite}.config.ts`
 * 也在建置期載入。頂層 import vite-plus 會讓這些非 vite 執行路徑（尤其是 audit script
 * 這類會在 vite-plus 尚未安裝的新 consumer onboarding 途中被跑到的腳本）連帶付出載入成本。
 *
 * 複本的代價是會與上游漂開，**所以它由測試釘住**：`test/preset-test-base.test.ts` 直接
 * export 本陣列，與 `vite-plus` 實際 re-export 的 `defaultExclude` 逐項 `deepEqual`，
 * 不一致就紅。**NEVER** 手動增刪本陣列來「修好」那個測試 —— 它紅代表上游改了預設，
 * 該做的是同步複本並重新判斷 `AGENT_CACHE_TEST_EXCLUDES` 有沒有哪一條變成多餘。
 */
export const VITEST_DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**']

/**
 * Agent runtime 在 consumer working tree 留下的 cache／投影目錄。
 *
 * 這裡面的「測試檔」**不是這個 repo 的測試** —— `.pi/git/` 底下是 Pi 為了做 code review
 * 而 clone 的**外部 repo 全文**（實測 2026-09-10：<consumer-g> 的 `.pi/git/` 有 114 MB、
 * 578 支測試檔，全部屬於 `github.com/YuDefine/clade`，而該 repo 自有測試檔為 **0**）。
 * 跑它們的結果是 107 失敗 → `vp test` exit 1，而紅綠取決於「這棵樹有沒有被 Pi clone 過」。
 *
 * **Vitest 的預設 exclude 擋不住，而且原因不直觀**：v4 的 `defaultExclude` 逐字只有
 * `['**\/node_modules/**', '**\/.git/**']`。Pi 的 clone 落在 `.pi/git/`，那個 segment 是
 * `git` 不是 `.git` —— 差一個點，`**\/.git/**` 完全不命中。**NEVER** 以為「vitest 本來就會
 * 跳過 git 目錄」。
 *
 * **NEVER 期待 `.gitignore` 會順便解掉它**：vitest 不讀 `.gitignore`。TD-1053 的 review 那一面
 * 是靠治理層的 gitignore 條目解的（`git ls-files --others --exclude-standard` 吃 gitignore），
 * test 這一面**沒有**共用機制，它要的是 `test.exclude`。兩面同根因、不同修法。
 *
 * 逐台實測的命中面（2026-09-10，`*.{test,spec}.{ts,js}` 計數）：
 * `.pi/` 五台全中（408–592 支）、`.clade/` <consumer-a> 4 支、`.claude/` <consumer-b> 60 支。
 * `vendor/` 三台皆 0，**刻意不列** —— clade 自己的 `vendor/` 是真源碼不是投影，
 * 列進去會把 clade 本身的測試面挖掉一塊。
 */
export const AGENT_CACHE_TEST_EXCLUDES = [
  // Pi 的 repo cache（TD-1053 的主因）。用 `.pi/**` 而非 `.pi/git/**`：cache 佈局是 Pi 的
  // 實作細節，釘死子路徑等於把別人的內部結構寫進我們的 gate。
  '**/.pi/**',
  // 以下與 PROJECTION_EXCLUDES 同一批投影面。裡面若有測試，那是**產生它的那個 repo** 的測試，
  // 修法在源頭不在這裡 —— 與 lint/fmt 對投影面的處置同一個理由。
  '**/.clade/**',
  '**/.claude/**',
  '**/.agents/**',
  '**/.codex/**',
  '**/.cursor/**',
  '**/.spectra/**',
]

/**
 * Consumer `vite.config.ts` 的共用 `test` 設定。
 *
 * **`test.exclude` 是覆蓋語義，不是合併** —— 直接寫 `exclude: ['**\/.pi/**']` 會把 vitest
 * 自己的 `node_modules` / `.git` 排除一起清掉，於是 `node_modules` 底下數以萬計的測試全部
 * 進掃描面。所以本 base 自己就把 vitest 的預設展開進去（見 `VITEST_DEFAULT_EXCLUDE`）。
 *
 * Consumer 用法（`test` 是 consumer 自有 `vite.config.ts` 的欄位，clade 只出這個 base）：
 *
 *   import { testBase } from './vendor/oxc-shared/preset.ts'
 *
 *   export default defineConfig({
 *     test: {
 *       ...testBase,
 *       exclude: [...testBase.exclude, 'e2e/**'],   // 要加自己的就展開，NEVER 直接覆寫
 *     },
 *   })
 *
 * clade 自己**不消費本 base**：它的 `test.include` 收窄成 `vp-tests/**\/*.vp.ts`，
 * 掃描面本來就進不到 `.pi/`。**NEVER** 拿「clade 沒事」推論 consumer 也沒事 ——
 * fleet 現況不齊一：<consumer-f>／<consumer-i>／<consumer-k> 已收窄 `test.include`（同樣免疫，
 * 但理由跟 clade 一樣是 include 收窄，不是本 base）；<consumer-b>／<consumer-c> 則是
 * consumer 自己手寫 `test.exclude`（如 `['e2e/**', 'node_modules/**', '.nuxt/**', '.output/**']`），
 * 這正是本檔開頭警告的覆蓋語義事故現場 —— 手寫版把 `**\/.git/**` 弄丟了、`node_modules/**`
 * 也沒有 `**\/` 前綴。這兩台是 `testBase` 目前最需要落地的目標，接手要先確認它們真的換成
 * `...testBase.exclude` 展開，而不是自己再補幾條。
 */
export const testBase = {
  exclude: [...VITEST_DEFAULT_EXCLUDE, ...AGENT_CACHE_TEST_EXCLUDES],
}
