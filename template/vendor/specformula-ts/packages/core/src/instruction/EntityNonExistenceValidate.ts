// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/instruction/EntityNonExistenceValidate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/instruction/EntityNonExistenceValidate.ts
import type { ScenarioContext } from '../context/ScenarioContext.js';
import type { InstructionDatabaseConnection } from './DatabaseConnection.js';
import { SymbolResolver } from '../helper/SymbolResolver.js';
import { TimeService } from '../helper/TimeService.js';
import { camelToSnake } from '../helper/utils/naming.js';
import { toDbPrimitive } from './EntitySetup.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaAssertionError,
} from '../error/SpecFormulaError.js';

/**
 * ADR-0026 §6.1 — conditions 為 "k=v, k2=v2" 之 canonical 字串形式。
 * Buffer 與 Date 不在 ADR §6.1 允許型別內，僅退而求其次以 JSON.stringify 表示。
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
 * EntityNonExistenceValidate — verifies that matching records do NOT exist in the DB.
 */
export class EntityNonExistenceValidate {
  private readonly resolver: SymbolResolver;

  constructor(private readonly context: ScenarioContext) {
    this.resolver = new SymbolResolver(context);
  }

  async validate(
    conn: InstructionDatabaseConnection,
    tableName: string,
    headers: string[],
    rows: string[][],
    entityName: string = tableName,
  ): Promise<void> {
    for (const row of rows) {
      const conditions: Record<string, unknown> = {}; // snake_case → DB primitive (for WHERE)
      const camelConditions: Record<string, unknown> = {}; // original header → resolved (for canonical detail)

      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] ?? '';
        const cell = row[i] ?? '';
        if (!header) continue;
        if (cell === '') continue;

        const resolved = this.resolveCell(cell);
        const colName = camelToSnake(header);
        conditions[colName] = toDbPrimitive(resolved, '');
        camelConditions[header] = resolved;
      }

      if (Object.keys(conditions).length === 0) {
        throw new SpecFormulaArgumentError({
          code: 'EXEC_ENTITY_CONDITIONS_MISSING',
          details: {},
        });
      }

      const whereParts = Object.keys(conditions).map((k) => `${k} = ?`);
      const sql = `SELECT 1 FROM ${tableName} WHERE ${whereParts.join(' AND ')} LIMIT 1`;
      const result = await conn.execute(sql, Object.values(conditions));

      if (result.rows.length > 0) {
        const conditionsStr = Object.entries(camelConditions)
          .map(([k, v]) => `${k}=${formatConditionValue(v)}`)
          .join(', ');
        throw new SpecFormulaAssertionError({
          code: 'ASSERT_ENTITY_SHOULD_NOT_EXIST',
          details: { name: entityName, conditions: conditionsStr },
        });
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
