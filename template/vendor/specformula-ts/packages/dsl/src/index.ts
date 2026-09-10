// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/index.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/index.ts
// SpecFormula DSL（ADR-0024 / ADR-0025）
// 提供 DSL 規格載入、Expander、Preprocessor 之 TypeScript 實作。

export type { DslSpec, DslDefinition, DslSubStep } from './DslModels.js';
export { DslYmlReader, extractCaptureNames, extractTemplateRefs } from './DslYmlReader.js';
export {
  DslExpander,
  blockToGherkinLines,
  type ExpandedGherkinBlock,
  type ExpansionResult,
} from './DslExpander.js';
export { DslPreprocessor } from './DslPreprocessor.js';
export {
  isNamePlaceholderFormat,
  isShorthandFormat,
  extractPlaceholderNames,
  expandNamePlaceholderFormat,
} from './FormatUtils.js';
export { IsaInstructionCatalog, type IsaInstruction } from './IsaInstructionCatalog.js';
export {
  DSL_SPEC_GLOBS,
  ISA_SPEC_GLOBS,
  DSL_FEATURE_SUFFIX,
  ancestorChain,
  findDslSpecsInDir,
  findIsaSpecsInDir,
  findDslFeatureFiles,
} from './discovery.js';
export { dslPlugin, default } from './DslPlugin.js';
