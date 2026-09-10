// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/instruction/EntityValidate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/instruction/EntityValidate.ts
import type { ScenarioContext } from '../context/ScenarioContext.js';
import type { InstructionDatabaseConnection } from './DatabaseConnection.js';
import { SymbolResolver } from '../helper/SymbolResolver.js';
import { TimeService } from '../helper/TimeService.js';
import { camelToSnake, snakeToCamel } from '../helper/utils/naming.js';
import { getNestedValue } from '../helper/utils/nested-path.js';
import { applyConstraints } from '../helper/ConstraintEngine.js';
import { rowToCamel, toDbPrimitive } from './EntitySetup.js';
import { flattenJsonDocument } from '../helper/JsonDocFlattener.js';
import { asString } from '../helper/utils/string-coerce.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaAssertionError,
} from '../error/SpecFormulaError.js';

/**
 * ADR-0026 §6.1 — conditions 為 "k=v, k2=v2" 之 canonical 字串形式。
 */
function formatConditionValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString(10);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * 剝除 cell 之外層 quote（"..." / '...'）。當原 BDD 表格欄位以 quote 包覆 CAS
 * 表達式或字串字面時，typed-error 詳情應呈現未包覆的原始內容。
 */
function stripCellQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * EntityValidate — SELECT + assertion with VAR capture and DECIMAL scale tolerance.
 */
export class EntityValidate {
  private readonly resolver: SymbolResolver;

  constructor(private readonly context: ScenarioContext) {
    this.resolver = new SymbolResolver(context);
  }

  /**
   * Validate table data described by a JSON DocString.
   *
   * The document (single object → one row, array → N rows) is flattened to
   * DataTable-style (headers, rows) — same mapping/symbol/constraint semantics
   * as the DataTable variant — then validated via {@link validate}.
   */
  async validateFromJson(
    conn: InstructionDatabaseConnection,
    tableName: string,
    tableColumns: Array<{ column: string; type: string; pk: string; auto: string }>,
    docString: string,
    entityName: string = tableName,
  ): Promise<void> {
    const { headers, rows } = flattenJsonDocument(docString);
    await this.validate(conn, tableName, tableColumns, headers, rows, entityName);
  }

  async validate(
    conn: InstructionDatabaseConnection,
    tableName: string,
    tableColumns: Array<{ column: string; type: string; pk: string; auto: string }>,
    headers: string[],
    rows: string[][],
    entityName: string = tableName,
  ): Promise<void> {
    if (rows.length === 0) {
      throw new SpecFormulaArgumentError({
        code: 'EXEC_ENTITY_VALIDATE_DATATABLE_EMPTY',
        details: {},
      });
    }

    const contextKeys = this.resolver.parseContextKeys(headers);

    const pkCols = tableColumns
      .filter((c) => c.pk === 'Y')
      .map((c) => c.column);

    for (const row of rows) {
      // Build query conditions from non-constraint, non->, non-< header values
      const dataHeaders = headers.map((h) => (h.startsWith('>') ? null : h));

      // Find all PK column values in the row
      const pkConditions: Record<string, unknown> = {};
      // ADR-0026 §6.1 — `conditions` details 應呈現使用者於該 row 提供之**全部**欄位
      // （PK + 非 PK），而非只有 WHERE 之 PK 部分；以 camelCase 對齊 BDD 期望。
      const allRowConditions: Record<string, unknown> = {};
      for (let i = 0; i < dataHeaders.length; i++) {
        const header = dataHeaders[i];
        if (!header) continue;
        const cell = row[i] ?? '';
        if (cell === '' || cell.startsWith('&')) continue;
        const resolved = this.resolveCell(cell);
        allRowConditions[header] = resolved;
        const snakeHeader = camelToSnake(header);
        if (pkCols.includes(snakeHeader)) {
          pkConditions[snakeHeader] = normalizeTimestampValue(toDbPrimitive(resolved, ''));
        }
      }

      const hasPkConditions = Object.keys(pkConditions).length === pkCols.length && pkCols.length > 0;

      let dbRows: Record<string, unknown>[];

      if (hasPkConditions) {
        // Query by PK
        const whereParts = Object.keys(pkConditions).map((k) => `${k} = ?`);
        const sql = `SELECT * FROM ${tableName} WHERE ${whereParts.join(' AND ')}`;
        const result = await conn.execute(sql, Object.values(pkConditions));
        if (result.rows.length === 0) {
          const conditionsStr = Object.entries(allRowConditions)
            .map(([k, v]) => `${k}=${formatConditionValue(v)}`)
            .join(', ');
          throw new SpecFormulaAssertionError({
            code: 'ASSERT_ENTITY_SHOULD_EXIST',
            details: { name: entityName, conditions: conditionsStr },
          });
        }
        dbRows = result.rows;
      } else {
        // No complete PK — build conditions from non-constraint, non-empty, non-> cells
        const conditions: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i] ?? '';
          const cell = row[i] ?? '';
          if (header.startsWith('>') || header.startsWith('<')) continue;
          if (cell === '' || cell.startsWith('&')) continue;
          const resolved = this.resolveCell(cell);

          // Handle JSON path headers
          if (isJsonPathHeader(header)) continue; // skip for WHERE — match post-fetch

          const colName = camelToSnake(header);
          conditions[colName] = normalizeTimestampValue(toDbPrimitive(resolved, ''));
        }

        const hasContextKeys = contextKeys.size > 0;

        let result: { rows: Record<string, unknown>[] };
        if (Object.keys(conditions).length === 0) {
          if (!hasContextKeys) {
            // No > headers and no non-CAS conditions — throw expected error
            throw new SpecFormulaArgumentError({
              code: 'EXEC_ENTITY_CONDITIONS_MISSING',
              details: {},
            });
          }
          // Has > extraction keys but all non-> columns are CAS constraints — full table scan
          result = await conn.execute(`SELECT * FROM ${tableName}`);
          if (result.rows.length === 0) {
            throw new SpecFormulaAssertionError({
              code: 'ASSERT_ENTITY_SHOULD_EXIST',
              details: {
                name: entityName,
                conditions: '(table scan)',
              },
            });
          }
        } else {
          const whereParts = Object.keys(conditions).map((k) => `${k} = ?`);
          const sql = `SELECT * FROM ${tableName} WHERE ${whereParts.join(' AND ')}`;
          result = await conn.execute(sql, Object.values(conditions));
          if (result.rows.length === 0) {
            const conditionsStr = Object.entries(conditions)
              .map(([k, v]) => `${k}=${formatConditionValue(v)}`)
              .join(', ');
            throw new SpecFormulaAssertionError({
              code: 'ASSERT_ENTITY_SHOULD_EXIST',
              details: { name: entityName, conditions: conditionsStr },
            });
          }
        }
        dbRows = result.rows;
      }

      // Match the row against DB results
      const matched = this.findMatchingRow(dbRows, headers, row);
      if (!matched) {
        const mismatch = this.findFirstMismatch(dbRows, headers, row);
        if (mismatch) {
          throw new SpecFormulaAssertionError({
            code: 'ASSERT_ENTITY_FIELD_MISMATCH',
            details: {
              entity: entityName,
              field: mismatch.field,
              expected: mismatch.expected,
              actual: mismatch.actual,
            },
          });
        }
        // Fallback when no specific field can be isolated
        throw new SpecFormulaAssertionError({
          code: 'ASSERT_ENTITY_FIELD_MISMATCH',
          details: {
            entity: entityName,
            field: '(unknown)',
            expected: JSON.stringify(headers.map((h, i) => [h, row[i]])),
            actual: JSON.stringify(dbRows[0] ?? {}),
          },
        });
      }

      // VAR extraction from matched row
      if (contextKeys.size > 0) {
        const camelRow = rowToCamel(matched);
        // For extraction, we need to find execution keys in data row
        // The executionKey may be snake_case (like <order_id) — normalize to camelCase
        const normRow = normalizeExecutionKeysForExtraction(row, matched);
        this.resolver.extractAndStoreVariables(contextKeys, headers, normRow, camelRow);
      }
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private findMatchingRow(
    dbRows: Record<string, unknown>[],
    headers: string[],
    row: string[],
  ): Record<string, unknown> | null {
    for (const dbRow of dbRows) {
      const camelRow = rowToCamel(dbRow);
      if (this.rowMatches(camelRow, dbRow, headers, row)) {
        return dbRow;
      }
    }
    return null;
  }

  /**
   * 找出與第一筆 dbRow 比較時，第一個不符的欄位（含 expected/actual 字串）。
   * 用於建構 ASSERT_ENTITY_FIELD_MISMATCH 之 canonical details。
   * 回傳 null 表示無 dbRow 或所有欄位皆相符（理論上不會發生，呼叫端應已先確認 findMatchingRow 為 null）。
   */
  private findFirstMismatch(
    dbRows: Record<string, unknown>[],
    headers: string[],
    row: string[],
  ): { field: string; expected: string; actual: string } | null {
    if (dbRows.length === 0) return null;
    const dbRow = dbRows[0];
    const camelRow = rowToCamel(dbRow);

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] ?? '';
      const cell = row[i] ?? '';
      if (!header || !cell) continue;
      if (header.startsWith('>') || header.startsWith('<')) continue;

      const resolved = this.resolveCell(cell);

      // Resolve actual value for this header (same logic as rowMatches)
      const snakeKey = camelToSnake(header);
      let actual: unknown;

      if (isJsonPathHeader(header)) {
        const topKey = getJsonTopKey(header);
        const snakeTop = camelToSnake(topKey);
        const relPath = header.slice(topKey.length).replace(/^\./, '');
        const jsonVal = dbRow[snakeTop] ?? camelRow[snakeToCamel(snakeTop)];
        if (typeof jsonVal === 'string') {
          try {
            const parsed: unknown = JSON.parse(jsonVal);
            actual = getNestedValue(parsed, relPath);
          } catch {
            actual = undefined;
          }
        } else {
          actual = getNestedValue(jsonVal, relPath);
        }
      } else {
        actual = camelRow[snakeToCamel(snakeKey)] ?? dbRow[snakeKey] ?? camelRow[header];
        if (typeof actual === 'bigint') actual = Number(actual);
      }

      // CAS constraint failed → expected = constraint expression
      if (cell.startsWith('&')) {
        const normalizedActual = normalizeForConstraint(actual);
        if (!applyConstraints(normalizedActual, cell, this.context)) {
          return {
            field: header,
            // ADR-0026 §6.1 — &isNull 之 expected 以「null」呈現語意（與 isNull 在
            // entity-validate 失敗時的全域對齊）；其他 CAS 直接以 constraint 字面表示。
            expected: cell === '&isNull' ? 'null' : stripCellQuotes(cell),
            actual: actual == null ? 'null' : asString(actual),
          };
        }
        continue;
      }

      if (resolved === null || resolved === undefined) continue;
      if (!valuesEqual(actual, resolved)) {
        return {
          field: header,
          expected: stripCellQuotes(cell),
          actual: actual == null ? 'null' : asString(actual),
        };
      }
    }
    return null;
  }

  private rowMatches(
    camelRow: Record<string, unknown>,
    dbRow: Record<string, unknown>,
    headers: string[],
    row: string[],
  ): boolean {
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] ?? '';
      const cell = row[i] ?? '';
      if (!header || !cell) continue;
      if (header.startsWith('>') || header.startsWith('<')) continue;

      const resolved = this.resolveCell(cell);

      // Get actual value from DB row
      const snakeKey = camelToSnake(header);
      let actual: unknown;

      if (isJsonPathHeader(header)) {
        // JSON path access into JSONB column value
        const topKey = getJsonTopKey(header);
        const snakeTop = camelToSnake(topKey);
        const relPath = header.slice(topKey.length).replace(/^\./, '');
        const jsonVal = dbRow[snakeTop] ?? camelRow[snakeToCamel(snakeTop)];
        if (typeof jsonVal === 'string') {
          try {
            const parsed: unknown = JSON.parse(jsonVal);
            actual = getNestedValue(parsed, relPath);
          } catch {
            actual = undefined;
          }
        } else {
          actual = getNestedValue(jsonVal, relPath);
        }
      } else {
        actual = camelRow[snakeToCamel(snakeKey)] ?? dbRow[snakeKey] ?? camelRow[header];
        // Normalize BigInt
        if (typeof actual === 'bigint') actual = Number(actual);
      }

      if (cell.startsWith('&')) {
        // CAS constraint
        const normalizedActual = normalizeForConstraint(actual);
        if (!applyConstraints(normalizedActual, cell, this.context)) {
          return false;
        }
      } else if (resolved !== null && resolved !== undefined) {
        // Exact / numeric comparison
        if (!valuesEqual(actual, resolved)) {
          return false;
        }
      }
    }
    return true;
  }

  private resolveCell(cell: string): unknown {
    if (
      cell.startsWith('@time(') ||
      cell.startsWith('@date(') ||
      cell.startsWith('@localtime(')
    ) {
      return TimeService.resolveTimeExpression(cell, this.context);
    }
    return this.resolver.resolveValue(cell);
  }
}

// ─── Module-level helpers ──────────────────────────────────────────────────────

function isJsonPathHeader(header: string): boolean {
  return header.includes('.') || header.includes('[');
}

function getJsonTopKey(header: string): string {
  const dotIdx = header.indexOf('.');
  const bracketIdx = header.indexOf('[');
  const first = Math.min(
    dotIdx === -1 ? Infinity : dotIdx,
    bracketIdx === -1 ? Infinity : bracketIdx,
  );
  return header.slice(0, first);
}

function normalizeForConstraint(val: unknown): unknown {
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') {
    const n = Number(val);
    if (!isNaN(n) && val.trim() !== '') return n;
  }
  return val;
}

/**
 * Compare actual DB value with expected string value.
 * Handles: numeric scale mismatch (DECIMAL "1000.00" == 1000), boolean 0/1, string equality.
 */
export function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined) return expected === null || expected === undefined;
  if (expected === null || expected === undefined) return false;

  // Normalize BigInt
  if (typeof actual === 'bigint') actual = Number(actual);

  // Time objects — compare as strings
  if (typeof expected === 'object' && 'dt' in (expected)) {
    const expStr = (expected as { toString(): string }).toString();
    return String(actual) === expStr || normalizeTimestamp(String(actual)) === normalizeTimestamp(expStr);
  }

  // Both strings — direct compare first
  if (typeof actual === 'string' && typeof expected === 'string') {
    if (actual === expected) return true;
    // Try numeric comparison for decimal scale mismatch
    return tryNumericEqual(actual, expected);
  }

  // actual is number/bigint, expected is string
  if (typeof actual === 'number' && typeof expected === 'string') {
    if (String(actual) === expected) return true;
    return tryNumericEqual(String(actual), expected);
  }

  // actual is string, expected is number
  if (typeof actual === 'string' && typeof expected === 'number') {
    return tryNumericEqual(actual, String(expected));
  }

  // Boolean in SQLite stored as 0/1
  if (typeof actual === 'number' && typeof expected === 'boolean') {
    return actual === (expected ? 1 : 0);
  }
  if (typeof expected === 'string' && (expected === 'true' || expected === 'false')) {
    const boolVal = expected === 'true';
    if (typeof actual === 'number') return actual === (boolVal ? 1 : 0);
    if (typeof actual === 'boolean') return actual === boolVal;
  }

  return asString(actual) === asString(expected);
}

/** Try comparing two string values as numbers (handles DECIMAL scale mismatch) */
function tryNumericEqual(a: string, b: string): boolean {
  const na = Number(a.trim());
  const nb = Number(b.trim());
  if (isNaN(na) || isNaN(nb)) return false;
  return na === nb;
}

/** Normalize timestamp strings for comparison (strip fractional seconds and timezone offset) */
function normalizeTimestamp(s: string): string {
  // Strip fractional seconds: T10:00:00.000 → T10:00:00
  // Strip timezone offset: T10:00:00+08:00 or T10:00:00Z → T10:00:00
  return s.replace(/(\d{2}:\d{2}:\d{2})\.?\d*([Z+-].*)?$/, '$1');
}

/**
 * Normalize a DB binding value: strip timezone from timestamp strings so SQLite
 * WHERE comparisons match columns stored without timezone info.
 */
function normalizeTimestampValue(val: unknown): unknown {
  if (typeof val === 'string' && /T\d{2}:\d{2}:\d{2}/.test(val)) {
    return val.replace(/(\d{2}:\d{2}:\d{2})\.?\d*([Z+-].*)?$/, '$1');
  }
  return val;
}

/**
 * For VAR extraction: find the actual snake_case column name in DB row
 * and map execution keys like <orderId -> <order_id when DB has order_id
 */
function normalizeExecutionKeysForExtraction(
  row: string[],
  dbRow: Record<string, unknown>,
): string[] {
  return row.map((cell) => {
    if (!cell || !cell.startsWith('<')) return cell;
    const keyName = cell.slice(1);
    const camelKey = keyName; // already in camelCase from test
    // Check if DB has the camelCase key or snake_case version
    const snakeKey = camelToSnake(camelKey);
    if (snakeKey in dbRow) {
      return '<' + snakeToCamel(snakeKey);
    }
    if (camelKey in dbRow) {
      return '<' + camelKey;
    }
    // Try as-is
    return cell;
  });
}
