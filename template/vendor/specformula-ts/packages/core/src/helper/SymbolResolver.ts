// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/SymbolResolver.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/SymbolResolver.ts
import type { ScenarioContext } from '../context/ScenarioContext.js';
import { getNestedValue } from './utils/nested-path.js';
import { TimeService } from './TimeService.js';
import { asString } from './utils/string-coerce.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaLookupError,
  SpecFormulaStateError,
  SpecFormulaError,
} from '../error/SpecFormulaError.js';

/** Reserved variable names that cannot be used as context keys. */
const RESERVED_KEYS = new Set(['now']);

/**
 * SymbolResolver — VAR subsystem.
 *
 * Responsibilities:
 *  - parseContextKeys: identify >contextKey columns in a header row
 *  - extractAndStoreVariables: extract <executionKey values from result and store in context
 *  - resolveValue: resolve $var, ${var} interpolation, quoted strings, time expressions
 */
export class SymbolResolver {
  constructor(private readonly context: ScenarioContext) {}

  // ─── Context Key Parsing ──────────────────────────────────────────────────

  /**
   * Parse header row and return a map of column index → context key name.
   * Only columns starting with '>' are included.
   * Throws ArgumentError for empty keys or reserved names.
   */
  parseContextKeys(headers: Array<string | null>): Map<number, string> {
    const map = new Map<number, string>();

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header) continue; // skip null / empty

      if (header.startsWith('>')) {
        const key = header.slice(1);

        if (key === '') {
          throw new SpecFormulaArgumentError({
            code: 'SYMBOL_VAR_HEADER_MISSING_NAME',
            details: { column_index: i + 1 },
          });
        }

        if (RESERVED_KEYS.has(key)) {
          throw new SpecFormulaArgumentError({
            code: 'SYMBOL_VAR_RESERVED_NAME',
            details: { name: key },
          });
        }

        map.set(i, key);
      }
    }

    return map;
  }

  // ─── Variable Extraction & Storage ────────────────────────────────────────

  /**
   * Extract values from executionVariable using <executionKey references and store
   * them in the ScenarioContext under their corresponding >contextKey names.
   *
   * Rules:
   *  - Every >contextKey column must have a <executionKey in the data row at the same index
   *  - Every <executionKey in the data row must have a >contextKey in the header
   *  - < with no name is invalid
   *  - executionVariable must not be null when extraction is needed
   */
  extractAndStoreVariables(
    contextKeys: Map<number, string>,
    headers: Array<string | null>,
    dataRow: Array<string | null>,
    executionVariable: unknown,
  ): void {
    // Validate: every >contextKey must pair with a <executionKey at same column
    for (const [colIdx, _contextKey] of contextKeys.entries()) {
      const dataValue = colIdx < dataRow.length ? dataRow[colIdx] : null;

      if (!dataValue || !dataValue.startsWith('<')) {
        throw new SpecFormulaArgumentError({
          code: 'SYMBOL_VAR_BINDINGS_MISMATCH',
          details: {},
        });
      }
    }

    // Validate: every <executionKey must pair with a >contextKey at same column
    for (let i = 0; i < dataRow.length; i++) {
      const cell = dataRow[i];
      if (!cell || !cell.startsWith('<')) continue;

      const keyName = cell.slice(1);
      if (keyName === '') {
        throw new SpecFormulaArgumentError({
          code: 'SYMBOL_VAR_EXECUTION_KEY_EMPTY',
          details: { column_index: i + 1 },
        });
      }

      if (!contextKeys.has(i)) {
        throw new SpecFormulaArgumentError({
          code: 'SYMBOL_VAR_BINDINGS_MISMATCH',
          details: {},
        });
      }
    }

    // If there are no context keys, nothing to extract
    if (contextKeys.size === 0) return;

    // executionVariable must not be null when there are keys to extract
    if (executionVariable === null || executionVariable === undefined) {
      throw new SpecFormulaStateError({
        code: 'SYMBOL_VAR_EXECUTION_VARIABLE_NULL',
        details: {},
      });
    }

    // Extract each value
    for (const [colIdx, contextKey] of contextKeys.entries()) {
      if (colIdx >= dataRow.length) continue;

      const executionKey = dataRow[colIdx];
      if (!executionKey || !executionKey.startsWith('<')) continue;

      const keyPath = executionKey.slice(1);
      const isSingleSegment = !keyPath.includes('.') && !keyPath.includes('[');

      let value: unknown;
      try {
        value = getNestedValue(executionVariable, keyPath, { strict: !isSingleSegment });
      } catch (err) {
        if (err instanceof SpecFormulaError) {
          throw err;
        }
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_PATH_FIELD_NOT_FOUND',
          details: { path: keyPath, segment: keyPath },
          cause: err instanceof Error ? err : undefined,
        });
      }

      if (value === undefined) {
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_EXECUTION_KEY_NOT_FOUND',
          details: { key: keyPath },
        });
      }

      this.context.set(contextKey, value);
    }
  }

  // ─── Value Resolution ─────────────────────────────────────────────────────

  /**
   * Resolve a cell value:
   *  - null → null
   *  - quoted string ("..." or '...') → strip quotes (no variable resolution inside quotes)
   *  - ${VAR} interpolation → replace with context values
   *  - $varName → look up in context (or return $now as DateTimeTZ)
   *  - plain string → return as-is
   */
  resolveValue(cell: unknown): unknown {
    if (cell === null || cell === undefined) {
      return null;
    }

    if (typeof cell !== 'string') {
      return cell;
    }

    const trimmed = cell.trim();

    if (trimmed === '') return trimmed;

    // Quoted string — strip quotes, no variable resolution inside
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    // ${VAR} interpolation — only when the string contains ${
    if (trimmed.includes('${')) {
      return this.interpolate(trimmed);
    }

    // $varName — simple variable reference
    if (trimmed.startsWith('$')) {
      return this.resolveVariable(trimmed.slice(1));
    }

    return trimmed;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Interpolate ${VAR} placeholders in a string.
   * Placeholders that refer to missing variables are left unchanged.
   * Empty ${} is left unchanged.
   * Unclosed ${ is left unchanged.
   */
  private interpolate(str: string): string {
    const result: string[] = [];
    let i = 0;

    while (i < str.length) {
      const dollarBrace = str.indexOf('${', i);

      if (dollarBrace === -1) {
        result.push(str.slice(i));
        break;
      }

      // Append text before ${
      result.push(str.slice(i, dollarBrace));

      const closeBrace = str.indexOf('}', dollarBrace + 2);
      if (closeBrace === -1) {
        // Unclosed — leave as-is
        result.push(str.slice(dollarBrace));
        break;
      }

      const varName = str.slice(dollarBrace + 2, closeBrace);

      if (varName === '') {
        // Empty ${} — leave as-is
        result.push('${}');
        i = closeBrace + 1;
        continue;
      }

      const value = this.context.get(varName);
      if (value !== undefined) {
        result.push(asString(value));
      } else {
        // Variable not found — leave placeholder intact
        result.push(`\${${varName}}`);
      }

      i = closeBrace + 1;
    }

    return result.join('');
  }

  /**
   * Resolve a variable name from context.
   * Special case: $now returns a DateTimeTZ (current time or mock).
   * If the variable is in context, return its value.
   * Otherwise throw lookup error for missing variable keys.
   */
  private resolveVariable(name: string): unknown {
    // Check context first (even for 'now' — user may have stored a string)
    if (this.context.has(name)) {
      return this.context.get(name);
    }

    // Special: $now → return DateTimeTZ
    if (name === 'now') {
      return TimeService.getNow(this.context);
    }

    throw new SpecFormulaLookupError({
      code: 'SYMBOL_VAR_KEY_NOT_FOUND',
      details: { key: name },
    });
  }
}
