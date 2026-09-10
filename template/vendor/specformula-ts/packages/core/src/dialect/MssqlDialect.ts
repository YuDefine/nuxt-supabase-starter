// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/dialect/MssqlDialect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/dialect/MssqlDialect.ts
import type { DatabaseDialect, CleanupPlan, TableCleanupInfo } from './DatabaseDialect.js';

/**
 * MSSQL (SQL Server) cleanup dialect.
 * Mirrors Java's MssqlDialect: DELETE FROM + NOCHECK/CHECK CONSTRAINT + DBCC CHECKIDENT.
 */
export class MssqlDialect implements DatabaseDialect {
  buildCleanupPlan(tables: readonly TableCleanupInfo[]): CleanupPlan {
    const disableFkSql: string[] = [];
    const enableFkSql: string[] = [];
    const tableCleanupSql = new Map<string, string[]>();

    let hasFk = false;

    for (const table of tables) {
      const qualifiedName = table.qualifiedTableName;
      const stmts: string[] = [];

      stmts.push(`DELETE FROM ${qualifiedName}`);

      let hasIdentity = false;
      for (const col of table.columns) {
        if (!hasIdentity && col.isAutoIncrement) {
          hasIdentity = true;
        }
        if (!hasFk && col.foreignKey != null && col.foreignKey !== '') {
          hasFk = true;
        }
      }

      if (hasIdentity) {
        stmts.push(`DBCC CHECKIDENT('${qualifiedName}', RESEED, 0)`);
      }

      tableCleanupSql.set(table.tableName, stmts);
    }

    if (hasFk) {
      for (const table of tables) {
        const qualifiedName = table.qualifiedTableName;
        disableFkSql.push(`ALTER TABLE ${qualifiedName} NOCHECK CONSTRAINT ALL`);
        enableFkSql.push(`ALTER TABLE ${qualifiedName} WITH CHECK CHECK CONSTRAINT ALL`);
      }
    }

    return {
      disableFkSql,
      enableFkSql,
      tableCleanupSql,
    };
  }
}
