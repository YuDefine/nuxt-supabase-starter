// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/error/index.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/error/index.ts
export { SpecFormulaErrorCategory } from './SpecFormulaErrorCategory.js';
export {
  SpecFormulaErrorCode,
  SpecFormulaErrorCodeCategory,
} from './SpecFormulaErrorCode.js';
export {
  SpecFormulaError,
  SpecFormulaArgumentError,
  SpecFormulaStateError,
  SpecFormulaLookupError,
  SpecFormulaAssertionError,
  ERROR_CLASS_MAPPING,
  isSpecFormulaError,
  type SpecFormulaErrorOptions,
  type SpecFormulaErrorClassName,
} from './SpecFormulaError.js';
export {
  MessageRegistry,
  type MessageRegistryEntry,
} from './MessageRegistry.js';
export { buildErrorFromRegistry } from './buildErrorFromRegistry.js';
