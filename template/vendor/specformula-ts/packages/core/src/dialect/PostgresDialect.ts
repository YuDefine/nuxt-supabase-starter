// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/dialect/PostgresDialect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/dialect/PostgresDialect.ts
import type { DatabaseDialect, CleanupPlan, TableCleanupInfo } from './DatabaseDialect.js';
import { quoteIdentifier, quoteQualifiedName } from './IdentifierUtils.js';

/**
 * PostgreSQL cleanup dialect.
 * Mirrors Java's PostgresDialect: uses TRUNCATE CASCADE (no FK disable needed).
 * Sequence reset uses ALTER SEQUENCE RESTART WITH 1.
 */
export class PostgresDialect implements DatabaseDialect {
  buildCleanupPlan(tables: readonly TableCleanupInfo[]): CleanupPlan {
    const tableCleanupSql = new Map<string, string[]>();

    for (const table of tables) {
      const quotedName = quoteQualifiedName(table.tableName, table.schemaName, table.dbType);
      const stmts: string[] = [];

      // TRUNCATE CASCADE handles FK constraints automatically — no disable/enable needed
      stmts.push(`TRUNCATE TABLE ${quotedName} CASCADE`);

      // SERIAL convention: {qualifiedTable}_{column}_seq
      for (const col of table.columns) {
        if (col.isAutoIncrement) {
          const seqName = `${table.qualifiedTableName}_${col.name}_seq`;
          stmts.push(
            `ALTER SEQUENCE ${quoteIdentifier(seqName, table.dbType)} RESTART WITH 1`,
          );
        }
      }

      tableCleanupSql.set(table.tableName, stmts);
    }

    return {
      disableFkSql: [],
      enableFkSql: [],
      tableCleanupSql,
    };
  }
}
