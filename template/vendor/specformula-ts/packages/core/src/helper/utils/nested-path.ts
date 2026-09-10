// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/utils/nested-path.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/utils/nested-path.ts
/**
 * Nested path utilities for accessing values in nested objects/arrays.
 * Supports dot notation and array index notation: "user.items[0].id", "[0].id"
 */

import {
  SpecFormulaArgumentError,
  SpecFormulaLookupError,
} from '../../error/SpecFormulaError.js';

export interface NestedValueOptions {
  /**
   * 預設 false（向後相容）：找不到 field/index 回傳 undefined，僅型別不符或索引越界拋
   * SpecFormulaLookupError。
   * true：所有找不到、型別不符、索引越界皆拋 SpecFormulaLookupError，帶 ADR-0026 §6.1
   * canonical details（path / parent / segment / index / length / expected_type）。
   */
  strict?: boolean;
}

/**
 * Parse a path string into segments, handling array indices and top-level array access.
 * Examples:
 *   "user.name"                -> ["user", "name"]
 *   "items[0].id"              -> ["items", "0", "id"]
 *   "[0].journeyId"            -> ["0", "journeyId"]
 *   "data.categories[0].name"  -> ["data", "categories", "0", "name"]
 */
function parsePath(path: string): string[] {
  const segments: string[] = [];

  // Handle top-level array index: "[0]" or "[0].something"
  const topArrayMatch = /^\[(\d+)\](.*)/.exec(path);
  if (topArrayMatch) {
    segments.push(topArrayMatch[1]);
    const rest = topArrayMatch[2];
    if (rest.startsWith('.')) {
      segments.push(...parsePath(rest.slice(1)));
    } else if (rest.length > 0) {
      segments.push(...parsePath(rest));
    }

    return segments;
  }

  const parts = path.split('.');

  for (const part of parts) {
    // Handle array index in part: "items[0]" or "items[0][1]"
    let remaining = part;
    const nameMatch = /^([^\[]+)/.exec(remaining);
    if (nameMatch) {
      segments.push(nameMatch[1]);
      remaining = remaining.slice(nameMatch[1].length);
    }

    // Extract array indices
    const indexRegex = /\[(\d+)\]/g;
    let indexMatch;
    while ((indexMatch = indexRegex.exec(remaining)) !== null) {
      segments.push(indexMatch[1]);
    }
  }

  return segments;
}

function assertValidPathFormat(path: string): void {
  if (path === '' || path.includes('..') || path.startsWith('.') || path.endsWith('.')) {
    throw new SpecFormulaArgumentError({
      code: 'SYMBOL_VAR_PATH_FORMAT_INVALID',
      details: { path },
    });
  }

  const invalidArrayIndex = /\[[^\]\d]+\]/.exec(path);
  if (invalidArrayIndex) {
    throw new SpecFormulaArgumentError({
      code: 'SYMBOL_VAR_ARRAY_INDEX_FORMAT_INVALID',
      details: { path },
    });
  }
}

/**
 * Get a value from a nested object/array using a path string.
 *
 * 預設行為（opts.strict !== true）：
 *   - 找不到 field / index 或中途遇到 non-object 時回傳 undefined
 *   - 型別不符（如 array 上做 property、non-array 上做 index）或索引越界仍拋 StateError
 *
 * Strict 模式（opts.strict === true）：
 *   - 找不到 field：拋 SpecFormulaLookupError code=SYMBOL_VAR_PATH_FIELD_NOT_FOUND
 *   - 型別不符：拋 SpecFormulaLookupError code=SYMBOL_VAR_PATH_TYPE_MISMATCH
 *   - 索引越界：拋 SpecFormulaLookupError code=SYMBOL_VAR_PATH_INDEX_OUT_OF_BOUNDS
 *   details 對齊 ADR-0026 §6.1 canonical（{ path, parent?, segment?, index?, length?, expected_type? }）。
 */
export function getNestedValue(
  obj: unknown,
  path: string,
  opts: NestedValueOptions = {},
): unknown {
  assertValidPathFormat(path);
  const segments = parsePath(path);
  const strict = opts.strict === true;
  let current: unknown = obj;
  let parentName = '';
  let traversed = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (current === null || current === undefined) {
      if (strict) {
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_PATH_FIELD_NOT_FOUND',
          details: { path, segment },
        });
      }
      return undefined;
    }

    if (/^\d+$/.test(segment)) {
      const index = parseInt(segment, 10);
      if (!Array.isArray(current)) {
        const parent = parentName || segment;
        // ADR-0026 §G5：type-mismatch 在 strict / non-strict 皆改用 typed-error；
        // 註冊代碼一致為 SYMBOL_VAR_PATH_TYPE_MISMATCH（registry lookup category）。
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_PATH_TYPE_MISMATCH',
          details: { path, parent, expected_type: 'List' },
        });
      }
      if (index < 0 || index >= current.length) {
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_PATH_INDEX_OUT_OF_BOUNDS',
          details: { path, index, length: current.length },
        });
      }
      traversed = traversed ? `${traversed}[${index}]` : `[${index}]`;
      parentName = traversed;
      current = current[index];
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) {
        if (strict) {
          const parent = parentName || segment;
          throw new SpecFormulaLookupError({
            code: 'SYMBOL_VAR_PATH_TYPE_MISMATCH',
            details: { path, parent, expected_type: 'Map' },
          });
        }
        return undefined;
      }
      const record = current as Record<string, unknown>;
      if (!(segment in record)) {
        if (strict) {
          throw new SpecFormulaLookupError({
            code: 'SYMBOL_VAR_PATH_FIELD_NOT_FOUND',
            details: { path, segment },
          });
        }
        return undefined;
      }
      traversed = traversed ? `${traversed}.${segment}` : segment;
      parentName = segment;
      current = record[segment];
    }
  }

  return current;
}

/**
 * Set a value in a nested object/array using a path string.
 * Creates intermediate objects as needed.
 */
export function setNestedValue(obj: unknown, path: string, value: unknown): void {
  const segments = parsePath(path);

  if (segments.length === 0) {
    return;
  }

  let current: unknown = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];

    if (/^\d+$/.test(segment)) {
      const index = parseInt(segment, 10);
      if (!Array.isArray(current)) {
        throw new Error(`Cannot access index ${index} on non-array`);
      }
      while ((current as unknown[]).length <= index) {
        (current as unknown[]).push(null);
      }
      if ((current as unknown[])[index] === null || (current as unknown[])[index] === undefined) {
        (current as unknown[])[index] = /^\d+$/.test(nextSegment) ? [] : {};
      }
      current = (current as unknown[])[index];
    } else {
      const record = current as Record<string, unknown>;
      if (!(segment in record) || record[segment] === null || record[segment] === undefined) {
        record[segment] = /^\d+$/.test(nextSegment) ? [] : {};
      }
      current = record[segment];
    }
  }

  const lastSegment = segments[segments.length - 1];
  if (/^\d+$/.test(lastSegment)) {
    const index = parseInt(lastSegment, 10);
    if (!Array.isArray(current)) {
      throw new Error(`Cannot access index ${index} on non-array`);
    }
    while ((current as unknown[]).length <= index) {
      (current as unknown[]).push(null);
    }
    (current as unknown[])[index] = value;
  } else {
    (current as Record<string, unknown>)[lastSegment] = value;
  }
}
