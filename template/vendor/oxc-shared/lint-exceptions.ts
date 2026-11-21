// 🔒 LOCKED — managed by clade · Source: vendor/oxc-shared/lint-exceptions.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/oxc-shared/lint-exceptions.ts
// vendor/oxc-shared/lint-exceptions.ts — 全 fleet lint／fmt 例外的唯一登記處
//
// `vendor/oxc-shared/preset.ts` 是基準；任何 repo 的 `vite.config.ts` 或 preset 本身偏離基準
// （關規則、改嚴重度、排除目錄、改 fmt 選項），都要在這裡有一筆。
//
// 每筆 MUST 有理由與撤除條件。範圍盡量窄：能用 override 限定檔案就不要整個 repo 關。
// 本檔由 clade 投影到 consumer（LOCKED），要加例外回 clade 改，再 publish／propagate。

export type LintExceptionKind =
  | 'adoption'
  | 'category'
  | 'plugin'
  | 'rule'
  | 'lint-option'
  | 'override'
  | 'lint-ignore'
  | 'lint-ignore-removed'
  | 'fmt-option'
  | 'fmt-ignore'
  | 'fmt-ignore-removed'

export interface LintException {
  /** registry 的 repo 名（git remote 的最後一段）；`*` 表示 preset 本身的決定，全 fleet 適用 */
  repo: string
  kind: LintExceptionKind
  /**
   * rule 名、category 名、ignore pattern、fmt 選項；override 寫成 `<files>::<rule>`；lint-option 寫成 `<頂層欄位>.<鍵>`（extends 只寫 `extends`）。
   * 寫正規化後的值：rule 名去掉 `eslint/` 前綴、`@typescript-eslint/` 改寫成 `typescript/`（其餘 plugin 前綴保留，`typescript/x` 與 `x` 是兩條規則），pattern 去掉開頭 `./` 與結尾 `/**`、`/`。
   */
  target: string
  reason: string
  removeWhen: string
  /** 因上游誤報或缺陷而設的例外，附 issue 連結 */
  upstream?: string
}

export const LINT_EXCEPTIONS: LintException[] = [
  {
    repo: '*',
    kind: 'rule',
    target: 'no-undef',
    reason:
      'TypeScript 已檢查未定義識別字；實測 <consumer-a>、clade 的命中幾乎全是 Nuxt auto-import 與 vitest 全域，開了只有誤報',
    removeWhen: 'oxlint 能讀 Nuxt auto-import 宣告時重新評估',
  },
  {
    repo: '*',
    kind: 'rule',
    target: 'no-console',
    reason: '遷移過渡：fleet 尚有 5297 筆，各 repo 修到綠前先維持關閉',
    removeWhen: '各 repo 的 lint-fmt-unify 件合入後由 preset 打開',
  },
  {
    repo: '*',
    kind: 'rule',
    target: 'no-await-in-loop',
    reason: '遷移過渡：fleet 尚有 4540 筆，循序 await 的合理處要逐行判定',
    removeWhen: '各 repo 的 lint-fmt-unify 件合入後由 preset 打開',
  },
  {
    repo: '*',
    kind: 'rule',
    target: 'unicorn/consistent-function-scoping',
    reason: '遷移過渡：fleet 尚有 3169 筆，各 repo 修到綠前先維持關閉',
    removeWhen: '各 repo 的 lint-fmt-unify 件合入後由 preset 打開',
  },
  {
    repo: '*',
    kind: 'category',
    target: 'pedantic',
    reason: '遷移過渡：逐條判定見 plan，採用的規則修到綠後整類打開，不採用的逐條登記',
    removeWhen: '各 repo 修到綠後由 preset 打開整類',
  },
  {
    repo: '*',
    kind: 'category',
    target: 'style',
    reason: '遷移過渡：逐條判定見 plan，採用的規則修到綠後整類打開，不採用的逐條登記',
    removeWhen: '各 repo 修到綠後由 preset 打開整類',
  },
  {
    repo: '*',
    kind: 'category',
    target: 'restriction',
    reason:
      '此類多為互斥或限制語言功能的規則（如禁 async、禁 optional chaining），不適合整類開，改逐條挑選',
    removeWhen: 'oxlint 拆分此類或 fleet 改採整類政策時重新評估',
  },
  {
    repo: '*',
    kind: 'category',
    target: 'nursery',
    reason: 'oxlint 標示規則仍不穩定，整類打開會隨版本誤報；穩定且有價值者個別挑選',
    removeWhen: 'oxlint 將規則移出 nursery 時改由所屬類別涵蓋',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'no-shadow',
    reason: 'clade 比基準先行採用的較嚴規則，投影到 consumer 前在源頭先擋',
    removeWhen: '規則併入 preset 後移除',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'preserve-caught-error',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-clade-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-clade-20261118 合入',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'unicorn/no-array-sort',
    reason: 'clade 比基準先行採用的較嚴規則，投影到 consumer 前在源頭先擋',
    removeWhen: '規則併入 preset 後移除',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'unicorn/prefer-array-find',
    reason: 'clade 比基準先行採用的較嚴規則，投影到 consumer 前在源頭先擋',
    removeWhen: '規則併入 preset 後移除',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'unicorn/prefer-string-starts-ends-with',
    reason: 'clade 比基準先行採用的較嚴規則，投影到 consumer 前在源頭先擋',
    removeWhen: '規則併入 preset 後移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'capabilities/modules/capabilities/aixbdd',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'capabilities/modules/capabilities/specformula/skills',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'capabilities/modules/capabilities/specformula/reference',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'capabilities/modules/capabilities/skill-engineering/skills',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore-removed',
    target: 'vendor',
    reason: 'clade 是這些投影的撰寫源頭，要檢查；consumer 端才是 LOCKED 副本',
    removeWhen: '這些檔不再由 clade 撰寫時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'vendor/snippets',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'vendor/specformula',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'vendor/specformula-ts',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'vendor/specformula-errors',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'vendor/aixbdd',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'vendor/aixbdd-course',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'vendor/snippets',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'vendor/specformula',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'vendor/specformula-ts',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'vendor/specformula-errors',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'vendor/aixbdd',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'vendor/aixbdd-course',
    reason:
      'clade 是 vendor 的作者端，移除 preset 的 vendor 排除後重新納入；這幾個是 snippet／規格語料（CLADE_VENDOR_EXCLUDES），不是本 repo 撰寫、要過 lint／fmt 的程式',
    removeWhen: '該目錄移出 vendor/，或內容改成能過 lint／fmt 時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore-removed',
    target: 'commitlint.config.ts',
    reason: 'clade 是這些投影的撰寫源頭，要檢查；consumer 端才是 LOCKED 副本',
    removeWhen: '這些檔不再由 clade 撰寫時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore-removed',
    target: '**/utils/assert-never.ts',
    reason: 'clade 是這些投影的撰寫源頭，要檢查；consumer 端才是 LOCKED 副本',
    removeWhen: '這些檔不再由 clade 撰寫時移除',
  },
  {
    repo: 'clade',
    kind: 'override',
    target: 'vendor/scripts/**::preserve-caught-error',
    reason: '遷移前既有設定，尚未修到可移除（override）；由 lint-fmt-unify-clade-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-clade-20261118 合入',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'capabilities/modules/capabilities/aixbdd',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'capabilities/modules/capabilities/specformula/skills',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'capabilities/modules/capabilities/specformula/reference',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'capabilities/modules/capabilities/skill-engineering/skills',
    reason: '上游 mirror 逐字複製，修法在上游 repo，clade 改寫會造成 mirror 漂移',
    removeWhen: '該 mirror 移出 repo 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'claude-md',
    reason: '手寫中文規則文件，oxfmt 會插入跳脫字元並散播到 consumer',
    removeWhen: 'oxfmt 能正確處理這些 Markdown 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'rules',
    reason: '手寫中文規則文件，oxfmt 會插入跳脫字元並散播到 consumer',
    removeWhen: 'oxfmt 能正確處理這些 Markdown 時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'specs/plans/*/evidence',
    reason: 'runner 寫出的機器產物，格式化會讓工作樹一直變髒',
    removeWhen: '產物改放 repo 外時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'registry/estimate-hours/capacity-calibration.json',
    reason: '腳本產生的 JSON，條目格式由產生器決定，oxfmt 會改寫成另一種形狀',
    removeWhen: '產生器改輸出 oxfmt 格式時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'registry/rule-recurrence/clauses.json',
    reason: '腳本產生的 JSON，條目格式由產生器決定，oxfmt 會改寫成另一種形狀',
    removeWhen: '產生器改輸出 oxfmt 格式時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore',
    target: 'test/fixtures/presale-legacy-render',
    reason: '逐字比對的 golden 檔，格式化後就比不上',
    removeWhen: 'golden 不再逐字比對時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore-removed',
    target: 'vendor',
    reason: 'clade 是這些投影的撰寫源頭，要檢查；consumer 端才是 LOCKED 副本',
    removeWhen: '這些檔不再由 clade 撰寫時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore-removed',
    target: 'commitlint.config.ts',
    reason: 'clade 是這些投影的撰寫源頭，要檢查；consumer 端才是 LOCKED 副本',
    removeWhen: '這些檔不再由 clade 撰寫時移除',
  },
  {
    repo: 'clade',
    kind: 'fmt-ignore-removed',
    target: '**/utils/assert-never.ts',
    reason: 'clade 是這些投影的撰寫源頭，要檢查；consumer 端才是 LOCKED 副本',
    removeWhen: '這些檔不再由 clade 撰寫時移除',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-unsafe-type-assertion',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描7187 筆既存命中，strict:false 下以 `as` 收 JSON／unknown 是慣例；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '命中歸零或 tsconfig 開 strict 後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-unnecessary-type-assertion',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描8921 筆既存命中，autofix 一次動 1154 檔；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: 'autofix 分批落地、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-base-to-string',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描342 筆既存命中，待逐筆判讀；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '逐筆判讀完、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/restrict-template-expressions',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描190 筆既存命中，待逐筆判讀；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '逐筆判讀完、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/require-array-sort-compare',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描185 筆既存命中，多為字串陣列，待逐筆判讀；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '逐筆判讀完、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-unnecessary-type-conversion',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描537 筆既存命中（風格，可 autofix）；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: 'autofix 落地、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-unnecessary-boolean-literal-compare',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描441 筆既存命中（風格，可 autofix）；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: 'autofix 落地、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-unnecessary-template-expression',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描97 筆既存命中（風格，可 autofix）；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: 'autofix 落地、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/consistent-return',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描106 筆既存命中（風格）；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-misused-spread',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描60 筆既存命中，待逐筆判讀；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '逐筆判讀完、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/unbound-method',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描58 筆既存命中，待逐筆判讀；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '逐筆判讀完、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-redundant-type-constituents',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描37 筆既存命中，待逐筆判讀；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '逐筆判讀完、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-unnecessary-type-parameters',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描16 筆既存命中，改型別簽名風險較高；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '逐筆確認簽名可改、命中歸零後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'rule',
    target: 'typescript/no-useless-default-assignment',
    reason:
      'type-aware（tsrs，clade#5728）首次全 repo 掃描14 筆既存命中；`(x, y = undefined)` 是 strict:false 下宣告可省略參數的慣用寫法，拿掉會 TS2554；不是 tsrs 誤報，分批收斂見 W-2026-11-19-tsrs-type-aware-rule-convergence',
    removeWhen: '改用明確 `y?:` 簽名或上游改判後刪 vite.config.ts 該行並移除本筆',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'ops/dev-node/claude-mods/taskbar',
    reason:
      'type-aware lint 要讀每個 tsconfig；此目錄的 tsconfig extends 一份 gitignore、由 Claude Code plugin 生成的 types，乾淨 checkout（CI）讀不到會報 tsconfig-error 擋整個 lint',
    removeWhen: '該 tsconfig 不再依賴未追蹤的生成檔時移除',
  },
  {
    repo: 'clade',
    kind: 'lint-ignore',
    target: 'specs/plans/W-2026-10-06-taskbar-mod/evidence/mod-api-probe',
    reason:
      'type-aware lint 要讀每個 tsconfig；此目錄的 tsconfig extends 一份 gitignore、由 Claude Code plugin 生成的 types，乾淨 checkout（CI）讀不到會報 tsconfig-error 擋整個 lint',
    removeWhen: '該 tsconfig 不再依賴未追蹤的生成檔或目錄歸檔時移除',
  },
  {
    repo: 'clade',
    kind: 'override',
    target: '**/*.test.{ts,mjs,js},test/**,vp-tests/**::typescript/no-floating-promises',
    reason:
      '27229 筆：node:test 頂層 test()／describe() 回傳 Promise 由 runner 收，不 await 是官方用法（tsrs 與 tsgolint 同判，非誤報）；副作用是測試內未 await 的 assert.rejects 也被放過',
    removeWhen:
      'test 檔改 void test(...) 或上游提供忽略 node:test 頂層呼叫選項後（W-2026-11-19-tsrs-type-aware-rule-convergence）',
  },
  {
    repo: 'clade',
    kind: 'override',
    target: '**/*.test.{ts,mjs,js},test/**,vp-tests/**::typescript/no-implied-eval',
    reason: '6 筆：test 內刻意以 new Function 取出被測原始碼片段',
    removeWhen:
      '改用 vm／明確 import 取代 new Function 後（W-2026-11-19-tsrs-type-aware-rule-convergence）',
  },
  {
    repo: 'clade',
    kind: 'override',
    target: 'specs/plans/**::typescript/no-floating-promises',
    reason: '77 筆：specs/plans 是凍結的歷史證據腳本，不回頭改',
    removeWhen: '該目錄整批歸檔或移出 lint 範圍後',
  },
  {
    repo: 'clade',
    kind: 'override',
    target: 'specs/plans/**::typescript/no-unsafe-unary-minus',
    reason: '1 筆：同一批凍結的歷史證據腳本',
    removeWhen: '該目錄整批歸檔或移出 lint 範圍後',
  },
  {
    repo: 'clade',
    kind: 'lint-option',
    target: 'options.typeAware',
    reason: 'type-aware lint（tsrs）先在本 repo 開，preset 尚未帶 typeAware',
    removeWhen: 'preset 帶 `options.typeAware: true` 後刪 vite.config.ts 那行並移除本筆',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore',
    target: '**/database.types.ts',
    reason:
      'supabase gen types 產生的型別檔；preset 不做全 fleet 排除（有 repo 的同名檔是手寫），由產生它的 repo 自行排除',
    removeWhen: '該 repo 不再以此路徑生成型別檔時移除',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: '**/database.types.ts',
    reason:
      'supabase gen types 產生的型別檔；preset 不做全 fleet 排除（有 repo 的同名檔是手寫），由產生它的 repo 自行排除',
    removeWhen: '該 repo 不再以此路徑生成型別檔時移除',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-option',
    target: 'env.browser',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-option',
    target: 'env.node',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-option',
    target: 'env.es2024',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'category',
    target: 'correctness',
    reason: '遷移前既有設定，尚未修到可移除（category）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'category',
    target: 'suspicious',
    reason: '遷移前既有設定，尚未修到可移除（category）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'category',
    target: 'perf',
    reason: '遷移前既有設定，尚未修到可移除（category）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'plugin',
    target: 'typescript',
    reason: '遷移前既有設定，尚未修到可移除（plugin）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'plugin',
    target: 'unicorn',
    reason: '遷移前既有設定，尚未修到可移除（plugin）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'plugin',
    target: 'import',
    reason: '遷移前既有設定，尚未修到可移除（plugin）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'plugin',
    target: 'promise',
    reason: '遷移前既有設定，尚未修到可移除（plugin）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'no-unused-vars',
    reason: '<consumer-f> 沿用遷移前自家設定，開 eslint 版 no-unused-vars（warn）',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'typescript/no-unused-vars',
    reason: '<consumer-f> 不 spread lintBase.rules，沒有 preset 的 typescript/no-unused-vars（warn）',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'no-debugger',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'no-alert',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'eqeqeq',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'no-underscore-dangle',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'import/no-cycle',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'rule',
    target: 'oxc/no-barrel-file',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: '.impeccable',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: 'scripts',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: '!scripts/prod-cutover.ts',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: '!scripts/prod-env-guard.ts',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: 'drizzle',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: 'specs/plans',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore',
    target: '**/evlog.map.json',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore-removed',
    target: '.nuxt',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore-removed',
    target: '.output',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore-removed',
    target: 'coverage',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore-removed',
    target: 'supabase',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore-removed',
    target: '.vite-doctor',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'lint-ignore-removed',
    target: '*.d.ts',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'indentWidth',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'lineWidth',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'semi',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'singleQuote',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'printWidth',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'tabWidth',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'useTabs',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'trailingComma',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'quoteProps',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'arrowParens',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'endOfLine',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'htmlWhitespaceSensitivity',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'vueIndentScriptAndStyle',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-option',
    target: 'experimentalSortPackageJson',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-option）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore',
    target: '.impeccable',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore',
    target: 'scripts',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore',
    target: '!scripts/prod-cutover.ts',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore',
    target: '!scripts/prod-env-guard.ts',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore',
    target: 'drizzle',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore',
    target: 'specs/plans',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore-removed',
    target: '**/*.md',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore-removed',
    target: 'coverage',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore-removed',
    target: '.nuxt',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore-removed',
    target: '.output',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore-removed',
    target: 'pnpm-lock.yaml',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-f>',
    kind: 'fmt-ignore-removed',
    target: '.vite-doctor',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore-removed）；由 lint-fmt-unify-<consumer-f>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-f>-20261118 合入',
  },
  {
    repo: '<consumer-b>',
    kind: 'fmt-ignore',
    target: '**/database.types.ts',
    reason:
      'supabase gen types 產生的型別檔；preset 不做全 fleet 排除（有 repo 的同名檔是手寫），由產生它的 repo 自行排除',
    removeWhen: '該 repo 不再以此路徑生成型別檔時移除',
  },
  {
    repo: '<consumer-b>',
    kind: 'rule',
    target: 'no-underscore-dangle',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-b>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-b>-20261118 合入',
  },
  {
    repo: '<consumer-b>',
    kind: 'rule',
    target: 'import/no-named-as-default',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-b>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-b>-20261118 合入',
  },
  {
    repo: '<consumer-b>',
    kind: 'rule',
    target: 'unicorn/no-thenable',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-b>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-b>-20261118 合入',
  },
  {
    repo: '<consumer-b>',
    kind: 'rule',
    target: 'preserve-caught-error',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-b>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-b>-20261118 合入',
  },
  {
    repo: '<consumer-b>',
    kind: 'lint-ignore',
    target: 'codex',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-b>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-b>-20261118 合入',
  },
  {
    repo: '<consumer-b>',
    kind: 'lint-ignore',
    target: 'screenshots',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-b>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-b>-20261118 合入',
  },
  {
    repo: '<consumer-b>',
    kind: 'fmt-ignore',
    target: 'infra/supabase/docker-compose.override.yml',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-b>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-b>-20261118 合入',
  },
  {
    repo: '<consumer-h>',
    kind: 'rule',
    target: 'typescript/no-unsafe-type-assertion',
    reason:
      'type-aware（tsrs）開啟後命中多為刻意收窄斷言（API 回應邊界、測試替身、白名單 literal union），屬風格嚴格度而非正確性',
    removeWhen: '<consumer-h> TD-011 逐筆改 type guard 後',
  },
  {
    repo: '<consumer-h>',
    kind: 'lint-option',
    target: 'options.typeAware',
    reason: 'type-aware lint（tsrs）先在本 repo 開，preset 尚未帶 typeAware',
    removeWhen: 'preset 帶 `options.typeAware: true` 後刪 vite.config.ts 那行並移除本筆',
  },
  {
    repo: '<consumer-j>',
    kind: 'fmt-ignore',
    target: 'app/types/database.generated.ts',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-j>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-j>-20261118 合入',
  },
  {
    repo: '<consumer-a>',
    kind: 'fmt-ignore',
    target: '**/database.types.ts',
    reason:
      'supabase gen types 產生的型別檔；preset 不做全 fleet 排除（有 repo 的同名檔是手寫），由產生它的 repo 自行排除',
    removeWhen: '該 repo 不再以此路徑生成型別檔時移除',
  },
  {
    repo: '<consumer-a>',
    kind: 'rule',
    target: 'no-underscore-dangle',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-a>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-a>-20261118 合入',
  },
  {
    repo: '<consumer-a>',
    kind: 'rule',
    target: 'unicorn/no-thenable',
    reason: '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-a>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-a>-20261118 合入',
  },
  {
    repo: '<consumer-a>',
    kind: 'lint-ignore',
    target: 'scripts/review-gui.mts',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-a>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-a>-20261118 合入',
  },
  {
    repo: '<consumer-a>',
    kind: 'fmt-ignore',
    target: 'codex',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-a>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-a>-20261118 合入',
  },
  {
    repo: '<consumer-a>',
    kind: 'fmt-ignore',
    target: 'AGENTS.md',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-a>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-a>-20261118 合入',
  },
  {
    repo: '<consumer-k>',
    kind: 'lint-ignore',
    target: 'scripts',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-k>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-k>-20261118 合入',
  },
  {
    repo: '<consumer-k>',
    kind: 'fmt-ignore',
    target: 'scripts',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-k>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-k>-20261118 合入',
  },
  {
    repo: '<consumer-k>',
    kind: 'fmt-ignore',
    target: 'AGENTS.md',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-k>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-k>-20261118 合入',
  },
  {
    repo: '<consumer-m>',
    kind: 'lint-ignore',
    target: 'content',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-m>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-m>-20261118 合入',
  },
  {
    repo: '<consumer-m>',
    kind: 'lint-ignore',
    target: '.data',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-m>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-m>-20261118 合入',
  },
  {
    repo: '<consumer-m>',
    kind: 'lint-ignore',
    target: '.void',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-m>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-m>-20261118 合入',
  },
  {
    repo: '<consumer-m>',
    kind: 'fmt-ignore',
    target: 'content',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-m>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-m>-20261118 合入',
  },
  {
    repo: '<consumer-m>',
    kind: 'fmt-ignore',
    target: '.data',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-m>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-m>-20261118 合入',
  },
  {
    repo: '<consumer-m>',
    kind: 'fmt-ignore',
    target: '.void',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-m>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-m>-20261118 合入',
  },
  {
    repo: '<consumer-d>',
    kind: 'rule',
    target: 'no-underscore-dangle',
    reason:
      '遷移前既有設定，尚未修到可移除（rule）；由 lint-fmt-unify-<consumer-d>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-d>-20261118 合入',
  },
  {
    repo: '<consumer-d>',
    kind: 'lint-ignore',
    target: 'scripts',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-d>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-d>-20261118 合入',
  },
  {
    repo: '<consumer-d>',
    kind: 'lint-ignore',
    target: '.agent',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-<consumer-d>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-d>-20261118 合入',
  },
  {
    repo: '<consumer-d>',
    kind: 'fmt-ignore',
    target: 'AGENTS.md',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-<consumer-d>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-d>-20261118 合入',
  },
  {
    repo: '<consumer-l>',
    kind: 'adoption',
    target: 'lint',
    reason:
      '遷移前既有設定，尚未修到可移除（adoption）；由 lint-fmt-unify-<consumer-l>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-l>-20261118 合入',
  },
  {
    repo: '<consumer-l>',
    kind: 'adoption',
    target: 'fmt',
    reason:
      '遷移前既有設定，尚未修到可移除（adoption）；由 lint-fmt-unify-<consumer-l>-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-<consumer-l>-20261118 合入',
  },
  {
    repo: 'nuxt-supabase-starter',
    kind: 'fmt-ignore',
    target: '**/database.types.ts',
    reason:
      'supabase gen types 產生的型別檔；preset 不做全 fleet 排除（有 repo 的同名檔是手寫），由產生它的 repo 自行排除',
    removeWhen: '該 repo 不再以此路徑生成型別檔時移除',
  },
  {
    repo: 'nuxt-supabase-starter',
    kind: 'lint-ignore',
    target: '.agent',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-nuxt-supabase-starter-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-nuxt-supabase-starter-20261118 合入',
  },
  {
    repo: 'nuxt-supabase-starter',
    kind: 'lint-ignore',
    target: 'presets',
    reason:
      '遷移前既有設定，尚未修到可移除（lint-ignore）；由 lint-fmt-unify-nuxt-supabase-starter-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-nuxt-supabase-starter-20261118 合入',
  },
  {
    repo: 'nuxt-supabase-starter',
    kind: 'fmt-ignore',
    target: '.agent',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-nuxt-supabase-starter-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-nuxt-supabase-starter-20261118 合入',
  },
  {
    repo: 'nuxt-supabase-starter',
    kind: 'fmt-ignore',
    target: '.github',
    reason:
      '遷移前既有設定，尚未修到可移除（fmt-ignore）；由 lint-fmt-unify-nuxt-supabase-starter-20261118 逐項處理',
    removeWhen: 'lint-fmt-unify-nuxt-supabase-starter-20261118 合入',
  },
]
