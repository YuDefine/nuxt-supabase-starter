// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/index.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/index.ts
// SpecFormula Plugin SPI（ADR-0027 / ts-0010）
// 純介面層，零內部依賴。第三方 plugin 套件僅需 peerDependencies 此 package。

export { DataFormat, dataFormatFromString } from './DataFormat.js';
export type { InstructionDescriptor } from './InstructionDescriptor.js';
export { payloadFormatOf } from './InstructionDescriptor.js';
export type { PayloadView } from './PayloadView.js';
export { NONE_PAYLOAD } from './PayloadView.js';
export type { StepInvocation } from './StepInvocation.js';
export { buildNamedGroups } from './StepInvocation.js';
export { namesIn } from './NamedCaptureParser.js';
export type { IsaStepExecutor } from './IsaStepExecutor.js';
export type { SpecRegistry } from './SpecRegistry.js';
export type { DirtyTracker } from './DirtyTracker.js';
export type { PluginContext } from './PluginContext.js';
export type { ScenarioContext } from './ScenarioContext.js';
export type { Instruction } from './Instruction.js';
export type { LifecycleHook } from './LifecycleHook.js';
export type { SpecSource } from './SpecSource.js';
export type { SpecReader } from './SpecReader.js';
export type { SpecFormulaPlugin } from './SpecFormulaPlugin.js';
export {
  BUILTIN_PLUGIN_TAG,
  isBuiltinPlugin,
  type BuiltinPluginBrand,
} from './BuiltinPlugin.js';
