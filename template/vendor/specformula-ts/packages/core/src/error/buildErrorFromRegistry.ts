// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/error/buildErrorFromRegistry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/error/buildErrorFromRegistry.ts
/**
 * buildErrorFromRegistry — 依 code 從 registry 推導 category，再構造對應 SpecFormulaError subclass。
 *
 * 此 helper 與 MessageRegistry 共生但獨立於同一檔案，避免 ES module 循環依賴
 * （MessageRegistry → SpecFormulaError → MessageRegistry）造成 runtime
 * ReferenceError: Cannot access 'X' before initialization。
 *
 * 主要消費端：spec-error/error-message-rendering.feature 之 `spec.error 構造例外` step。
 */
import { SpecFormulaErrorCategory } from './SpecFormulaErrorCategory.js';
import type { SpecFormulaErrorCode } from './SpecFormulaErrorCode.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaStateError,
  SpecFormulaLookupError,
  SpecFormulaAssertionError,
} from './SpecFormulaError.js';
import type {
  SpecFormulaError,
  SpecFormulaErrorOptions,
} from './SpecFormulaError.js';
import { MessageRegistry } from './MessageRegistry.js';

interface ErrorCtor {
  new (opts: SpecFormulaErrorOptions): SpecFormulaError;
}

const ERROR_CLASS_BY_CATEGORY: Record<SpecFormulaErrorCategory, ErrorCtor> = {
  [SpecFormulaErrorCategory.ARGUMENT]: SpecFormulaArgumentError,
  [SpecFormulaErrorCategory.STATE]: SpecFormulaStateError,
  [SpecFormulaErrorCategory.LOOKUP]: SpecFormulaLookupError,
  [SpecFormulaErrorCategory.ASSERTION]: SpecFormulaAssertionError,
};

export function buildErrorFromRegistry(
  code: SpecFormulaErrorCode,
  details: Readonly<Record<string, unknown>>,
): SpecFormulaError {
  const category = MessageRegistry.get().getCategory(code);
  const cls = ERROR_CLASS_BY_CATEGORY[category];
  if (!cls) {
    throw new Error(`buildErrorFromRegistry: 未知 category '${category}'`);
  }
  return new cls({ code, details });
}
