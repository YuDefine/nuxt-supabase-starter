// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/dialect/H2CompatDialect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/dialect/H2CompatDialect.ts
import type { DatabaseDialect, CleanupPlan, TableCleanupInfo } from './DatabaseDialect.js';

/**
 * SQLite/H2-compatible cleanup dialect.
 * Mirrors Java's H2Dialect: uses DELETE FROM + FK disable via PRAGMA.
 * Auto-increment reset uses sqlite_sequence.
 */
export class H2CompatDialect implements DatabaseDialect {
  buildCleanupPlan(tables: readonly TableCleanupInfo[]): CleanupPlan {
    const disableFkSql: string[] = [];
    const enableFkSql: string[] = [];
    const tableCleanupSql = new Map<string, string[]>();

    let hasFk = false;

    for (const table of tables) {
      const qualifiedName = table.qualifiedTableName;
      const stmts: string[] = [];

      stmts.push(`DELETE FROM ${qualifiedName}`);

      for (const col of table.columns) {
        if (col.isAutoIncrement) {
          stmts.push(`DELETE FROM sqlite_sequence WHERE name='${table.tableName}'`);
        }
        if (!hasFk && col.foreignKey != null && col.foreignKey !== '') {
          hasFk = true;
        }
      }

      tableCleanupSql.set(table.tableName, stmts);
    }

    if (hasFk) {
      disableFkSql.push('PRAGMA foreign_keys = OFF');
      enableFkSql.push('PRAGMA foreign_keys = ON');
    }

    return {
      disableFkSql,
      enableFkSql,
      tableCleanupSql,
    };
  }
}
