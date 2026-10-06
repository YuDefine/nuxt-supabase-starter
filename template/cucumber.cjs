// SpecFormula / aixbdd Gherkin runner（TD-026 D5）。從 repo root 執行：pnpm test:bdd
//
// import 順序有意義：environment.ts 在 module load 時就跑
// loadSpecFormulaPlugins() → IsaSpecReader().read() → StepDefinitionFactory.register()，
// cucumber 必須在載 feature 之前看到那些 step definition，NEVER 搬進 BeforeAll。
module.exports = {
  default: {
    // feature 只有一份，就是 truth 那一份（rules/core/specformula.md § Truth 佈局）
    paths: ['specs/truth/features/backend/**/*.feature'],
    import: [
      'features/support/environment.ts',
      // custom step：只放內建指令表達不了的句型（規約 NEVER 1）
      'features/steps/**/*.ts',
    ],
    // 規約 MUST：@unverified 的 feature 預設不跑；@slow 保留給需要額外資源的 scenario
    tags: 'not @unverified and not @slow',
    format: ['progress'],
  },
}
