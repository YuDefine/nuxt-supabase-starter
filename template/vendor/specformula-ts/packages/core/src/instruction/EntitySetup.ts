// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/instruction/EntitySetup.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/instruction/EntitySetup.ts
import type { ScenarioContext } from '../context/ScenarioContext.js';
import type { InstructionDatabaseConnection } from './DatabaseConnection.js';
import { SymbolResolver } from '../helper/SymbolResolver.js';
import { TimeService } from '../helper/TimeService.js';
import { camelToSnake, snakeToCamel } from '../helper/utils/naming.js';
import { setNestedValue } from '../helper/utils/nested-path.js';
import { flattenJsonDocument } from '../helper/JsonDocFlattener.js';
import { applyConstraints } from '../helper/ConstraintEngine.js';
import { asString } from '../helper/utils/string-coerce.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaAssertionError,
} from '../error/SpecFormulaError.js';

export interface DdlColumnSpec {
  column: string;
  type: string;
  pk: string;
  notnull: string;
  default: string;
  auto: string;
  fk: string;
}

export interface TableSpec {
  tableName: string;
  columns: DdlColumnSpec[];
}

/**
 * EntitySetup — dynamic table creation and INSERT with VAR-System capture.
 */
export class EntitySetup {
  private readonly resolver: SymbolResolver;

  constructor(private readonly context: ScenarioContext) {
    this.resolver = new SymbolResolver(context);
  }

  // ─── Table creation ────────────────────────────────────────────────────────

  async createTable(conn: InstructionDatabaseConnection, spec: TableSpec): Promise<void> {
    const pkCols = spec.columns.filter((c) => c.pk === 'Y');
    const hasAutoPk = pkCols.some((c) => c.auto === 'Y');
    const compositePk = pkCols.length > 1 && !hasAutoPk;

    const colDefs = spec.columns.map((col) => {
      const colName = camelToSnake(col.column);
      const parts: string[] = [colName, mapType(col.type)];
      if (!compositePk && col.pk === 'Y') {
        if (col.auto === 'Y') {
          parts.push('PRIMARY KEY AUTOINCREMENT');
        } else {
          parts.push('PRIMARY KEY');
        }
      }
      if (col.notnull === 'Y') parts.push('NOT NULL');
      if (col.default) parts.push(`DEFAULT ${col.default}`);
      if (col.fk) {
        const dotIdx = col.fk.lastIndexOf('.');
        const fkTable = col.fk.slice(0, dotIdx);
        const fkCol = col.fk.slice(dotIdx + 1);
        parts.push(`REFERENCES ${fkTable}(${fkCol})`);
      }
      return parts.join(' ');
    });

    if (compositePk) {
      const pkColNames = pkCols.map((c) => camelToSnake(c.column)).join(', ');
      colDefs.push(`PRIMARY KEY (${pkColNames})`);
    }

    await conn.execute('PRAGMA foreign_keys = OFF');
    await conn.execute(`DROP TABLE IF EXISTS ${spec.tableName}`);
    const sql = `CREATE TABLE ${spec.tableName} (${colDefs.join(', ')})`;
    await conn.execute(sql);
    await conn.execute('PRAGMA foreign_keys = ON');
  }

  // ─── INSERT rows ───────────────────────────────────────────────────────────

  async insertRows(
    conn: InstructionDatabaseConnection,
    tableName: string,
    tableColumns: DdlColumnSpec[],
    headers: string[],
    rows: string[][],
  ): Promise<void> {
    const contextKeys = this.resolver.parseContextKeys(headers);
    for (const row of rows) {
      await this.insertOneRow(conn, tableName, tableColumns, headers, row, contextKeys);
    }
  }

  /**
   * Insert row(s) from a JSON DocString payload.
   *
   * A root object → one row; a root array → one row per element. The document
   * is flattened to DataTable-style (headers, rows) — camelCase top keys map to
   * snake_case columns, nested structures become JSON-path headers serialized
   * into a JSONB column — and then flows through the same INSERT pipeline as the
   * DataTable variant, so `>`/`<`/`$`/`@time` symbols resolve identically.
   */
  async insertRowsFromJson(
    conn: InstructionDatabaseConnection,
    tableName: string,
    tableColumns: DdlColumnSpec[],
    docString: string,
  ): Promise<void> {
    const { headers, rows } = flattenJsonDocument(docString);
    if (headers.length === 0) return;
    await this.insertRows(conn, tableName, tableColumns, headers, rows);
  }

  private async insertOneRow(
    conn: InstructionDatabaseConnection,
    tableName: string,
    tableColumns: DdlColumnSpec[],
    headers: string[],
    row: string[],
    contextKeys: Map<number, string>,
  ): Promise<void> {
    {
      // Validate: non->-header cell starting with < is a type conversion error
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] ?? '';
        const cell = row[i] ?? '';
        if (header.startsWith('>') || header.startsWith('<')) continue;
        if (cell.startsWith('<')) {
          const colName = camelToSnake(header);
          const colSpec = tableColumns.find((c) => c.column === colName);
          const typeName = colSpec?.type ?? 'UNKNOWN';
          if (String(typeName).toUpperCase() === 'XML' && cell.startsWith('<') && cell.includes('>')) {
            continue;
          }
          throw new SpecFormulaArgumentError({
            code: 'EXEC_ENTITY_TYPE_CONVERSION_FAILED',
            details: { value: cell, type: String(typeName) },
          });
        }
      }

      const data: Record<string, unknown> = {};
      const jsonPathGroups: Record<string, unknown[] | Record<string, unknown>> = {};

      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] ?? '';
        const cell = row[i] ?? '';

        if (!header) continue;
        if (header.startsWith('>') || header.startsWith('<')) continue;
        if (cell === '') continue; // empty = skip (treat as NULL / use DEFAULT)

        const resolved = this.resolveCell(cell);

        // JSON path header: contains . or [ (but not only camelCase)
        if (isJsonPathHeader(header)) {
          const topKey = getJsonTopKey(header);
          const snakeTop = camelToSnake(topKey);
          const relPath = header.slice(topKey.length).replace(/^\./, '');
          if (!jsonPathGroups[snakeTop]) {
            // Initialize as array if the relative path starts with an array index
            jsonPathGroups[snakeTop] = relPath.startsWith('[') ? [] : {};
          }
          setNestedValue(jsonPathGroups[snakeTop], relPath, coerceJsonValue(toDbPrimitive(resolved, '')));
        } else {
          const colName = camelToSnake(header);
          const colSpec = tableColumns.find((c) => c.column === colName);
          data[colName] = toDbPrimitive(resolved, colSpec?.type ?? '');
        }
      }

      // Serialize JSON path groups as JSON strings
      for (const [key, val] of Object.entries(jsonPathGroups)) {
        data[key] = JSON.stringify(val);
      }

      if (Object.keys(data).length === 0) {
        // No explicit columns — rely on DEFAULT VALUES
        await conn.execute(`INSERT INTO ${tableName} DEFAULT VALUES`);
        if (contextKeys.size > 0) {
          const last = await conn.execute(
            buildFetchInsertedRowSql(tableName, tableColumns, undefined),
          );
          if (last.rows.length > 0) {
            const camelRow = rowToCamel(last.rows[0]);
            const normRow = normalizeExecutionKeys(row);
            this.resolver.extractAndStoreVariables(contextKeys, headers, normRow, camelRow);
          }
        }
        return;
      }

      const cols = Object.keys(data);
      const placeholders = cols.map(() => '?').join(', ');
      await conn.execute(
        `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`,
        Object.values(data),
      );

      if (contextKeys.size > 0) {
        const last = await conn.execute(
          buildFetchInsertedRowSql(tableName, tableColumns, data),
        );
        if (last.rows.length > 0) {
          const camelRow = rowToCamel(last.rows[0]);
          const normRow = normalizeExecutionKeys(row);
          this.resolver.extractAndStoreVariables(contextKeys, headers, normRow, camelRow);
        }
      }
    }
  }

  // ─── Assert table has data ─────────────────────────────────────────────────

  async assertTableHasData(
    conn: InstructionDatabaseConnection,
    tableName: string,
    headers: string[],
    rows: string[][],
  ): Promise<void> {
    for (const row of rows) {
      const whereParts: string[] = [];
      const whereValues: unknown[] = [];

      // Track JSON columns separately — compare post-fetch rather than in WHERE
      const jsonExpected: Array<{ header: string; expected: string }> = [];

      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] ?? '';
        const cell = row[i] ?? '';
        if (!header || cell === '' || cell.startsWith('&')) continue;

        const resolved = this.resolveCell(cell);
        const dbVal = coerceForWhere(toDbPrimitive(resolved, ''));

        // JSON columns: defer to post-fetch comparison
        if (typeof dbVal === 'string' && (dbVal.startsWith('{') || dbVal.startsWith('['))) {
          jsonExpected.push({ header, expected: dbVal });
          continue;
        }

        whereParts.push(`${header} = ?`);
        whereValues.push(dbVal);
      }

      let sql = `SELECT * FROM ${tableName}`;
      if (whereParts.length > 0) {
        sql += ` WHERE ${whereParts.join(' AND ')}`;
      }

      const result = await conn.execute(sql, whereValues);
      if (result.rows.length === 0) {
        const conditionsJson = JSON.stringify(
          Object.fromEntries(whereParts.map((p, i) => [p, whereValues[i]])),
        );
        throw new SpecFormulaAssertionError({
          code: 'ASSERT_ENTITY_SHOULD_EXIST',
          details: { name: tableName, conditions: conditionsJson },
        });
      }

      // Post-fetch JSON column comparison (numeric-tolerant deep equal)
      if (jsonExpected.length > 0) {
        const matchedRow = result.rows.find((dbRow) =>
          jsonExpected.every(({ header, expected }) => {
            const actual = dbRow[header];
            return jsonEqual(actual, expected);
          }),
        );
        if (!matchedRow) {
          const firstExpected = jsonExpected[0];
          throw new SpecFormulaAssertionError({
            code: 'ASSERT_ENTITY_FIELD_MISMATCH',
            details: {
              entity: tableName,
              field: firstExpected.header,
              expected: firstExpected.expected,
              actual: JSON.stringify(result.rows[0]?.[firstExpected.header] ?? ''),
            },
          });
        }
      }

      // Check constraint cells
      const constraintHeaders: Array<{ header: string; constraint: string }> = [];
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] ?? '';
        const cell = row[i] ?? '';
        if (header && cell.startsWith('&')) {
          constraintHeaders.push({ header, constraint: cell });
        }
      }

      if (constraintHeaders.length > 0) {
        let found = false;
        for (const dbRow of result.rows) {
          const camelRow = rowToCamel(dbRow);
          let allPass = true;
          for (const { header, constraint } of constraintHeaders) {
            const actual = camelRow[snakeToCamel(header)] ?? dbRow[header];
            const actualNum = normalizeForConstraint(actual);
            if (!applyConstraints(actualNum, constraint, this.context)) {
              allPass = false;
              break;
            }
          }
          if (allPass) { found = true; break; }
        }
        if (!found) {
          const first = constraintHeaders[0];
          throw new SpecFormulaAssertionError({
            code: 'ASSERT_CAS_CONSTRAINT_FAILED',
            details: {
              json_path: first.header,
              constraint: first.constraint,
              actual_value: JSON.stringify(result.rows[0]?.[first.header] ?? ''),
            },
          });
        }
      }
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

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

function buildFetchInsertedRowSql(
  tableName: string,
  tableColumns: DdlColumnSpec[],
  insertedData: Record<string, unknown> | undefined,
): string {
  const autoPk = tableColumns.find((column) => column.pk === 'Y' && column.auto === 'Y');
  if (autoPk) {
    return `SELECT * FROM ${tableName} ORDER BY ${camelToSnake(autoPk.column)} DESC LIMIT 1`;
  }

  if (insertedData && Object.keys(insertedData).length > 0) {
    const whereClause = Object.keys(insertedData)
      .map((column) => `${column} = ${sqlLiteral(insertedData[column])}`)
      .join(' AND ');
    return `SELECT * FROM ${tableName} WHERE ${whereClause} LIMIT 1`;
  }

  return `SELECT * FROM ${tableName} LIMIT 1`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${asString(value).replace(/'/g, "''")}'`;
}

// ─── Module-level helpers ──────────────────────────────────────────────────────

/** Map feature DDL types to SQLite-compatible types */
function mapType(type: string): string {
  const upper = type.toUpperCase();
  // Pass through most types — SQLite is type-flexible
  // JSONB -> TEXT in SQLite
  if (upper === 'JSONB') return 'TEXT';
  if (upper === 'BOOLEAN') return 'INTEGER';
  if (upper === 'SERIAL') return 'INTEGER';
  if (upper === 'BIGINT') return 'INTEGER';
  // NVARCHAR(MAX) / VARCHAR(MAX) -> TEXT
  if (/^N?VARCHAR\s*\(\s*MAX\s*\)$/i.test(type)) return 'TEXT';
  // NVARCHAR(n) -> VARCHAR(n)
  if (/^NVARCHAR\s*\(/i.test(type)) return type.replace(/^NVARCHAR/i, 'VARCHAR');
  return type;
}

/** Detect JSON path headers (dot or bracket notation) */
function isJsonPathHeader(header: string): boolean {
  return header.includes('.') || header.includes('[');
}

/** Get the top-level column name from a JSON path header */
function getJsonTopKey(header: string): string {
  const dotIdx = header.indexOf('.');
  const bracketIdx = header.indexOf('[');
  const first = Math.min(
    dotIdx === -1 ? Infinity : dotIdx,
    bracketIdx === -1 ? Infinity : bracketIdx,
  );
  return header.slice(0, first);
}

/** Convert resolved value to a DB-storable primitive */
export function toDbPrimitive(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;

  // Time objects (DateTimeTZ, DateOnly, TimeOnly have .dt property)
  if (typeof value === 'object' && 'dt' in (value)) {
    return (value as { toString(): string }).toString();
  }

  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);

  if (typeof value === 'string') {
    const typeUpper = type.toUpperCase();
    // Convert string integers for integer columns
    if (/^(BIGINT|INT|SMALLINT|TINYINT|MEDIUMINT|INTEGER|SERIAL)/.test(typeUpper)) {
      const n = Number(value);
      if (!isNaN(n) && value.trim() !== '') return n;
    }
  }

  return value;
}

/** Convert DB row keys to both snake_case and camelCase */
export function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    // Normalize BigInt from better-sqlite3
    const normalized = typeof val === 'bigint' ? Number(val) : val;
    result[key] = normalized;
    result[snakeToCamel(key)] = normalized;
  }
  return result;
}

/** Normalize execution key cells (<snake_case) to camelCase */
function normalizeExecutionKeys(row: string[]): string[] {
  return row.map((cell) => {
    if (cell && cell.startsWith('<')) {
      return '<' + snakeToCamel(cell.slice(1));
    }
    return cell;
  });
}

/** Normalize BigInt to number for constraint evaluation */
function normalizeForConstraint(val: unknown): unknown {
  if (typeof val === 'bigint') return Number(val);
  return val;
}

/**
 * Coerce WHERE binding values: numeric strings → numbers so SQLite INTEGER
 * columns compare correctly when defaultSafeIntegers is enabled.
 */
function coerceForWhere(val: unknown): unknown {
  if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) {
    return Number(val);
  }
  return val;
}

/**
 * Coerce JSON path values: numeric strings → numbers so JSON.stringify produces
 * numeric values (e.g. {"productId":5} instead of {"productId":"5"}).
 */
function coerceJsonValue(val: unknown): unknown {
  if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) {
    return Number(val);
  }
  return val;
}

/**
 * Compare two JSON values with numeric-string tolerance.
 * Parses both sides if they are strings, then does deep equal with number coercion.
 */
function jsonEqual(actual: unknown, expected: string): boolean {
  let parsedActual: unknown = actual;
  let parsedExpected: unknown;

  try {
    parsedExpected = JSON.parse(expected);
  } catch {
    // Not valid JSON — fall back to string comparison
    return String(actual) === expected;
  }

  if (typeof parsedActual === 'string') {
    try {
      parsedActual = JSON.parse(parsedActual);
    } catch {
      return false;
    }
  }

  return jsonDeepEqual(parsedActual, parsedExpected);
}

/** Deep equality with numeric coercion (string "110" == number 110) */
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;

  // Numeric coercion
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => jsonDeepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => jsonDeepEqual(aObj[k], bObj[k]));
  }

  return asString(a) === asString(b);
}
