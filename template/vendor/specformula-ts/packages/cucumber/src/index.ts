// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/index.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/index.ts
// @specformula/cucumber — Layer 3: Cucumber.js step registration
export {
  StepDefinitionFactory,
  bridgeVariableResolver,
  type StepRegistrationOptions,
} from './StepDefinitionFactory.js';
export { registerSpecFormulaHooks } from './SpecFormulaSupportCode.js';
export { builtinInstructionsPlugin } from './BuiltinInstructionsPlugin.js';
export { CucumberStepInvocation } from './CucumberStepInvocation.js';
export {
  loadSpecFormulaPlugins,
  type LoadSpecFormulaPluginsOptions,
} from './bootstrapPlugins.js';
