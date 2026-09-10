// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/dialect/MysqlDialect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/dialect/MysqlDialect.ts
import type { DatabaseDialect, CleanupPlan, TableCleanupInfo } from './DatabaseDialect.js';

/**
 * MySQL/MariaDB cleanup dialect.
 * Mirrors Java's MysqlDialect: DELETE FROM + SET FOREIGN_KEY_CHECKS + AUTO_INCREMENT reset.
 */
export class MysqlDialect implements DatabaseDialect {
  buildCleanupPlan(tables: readonly TableCleanupInfo[]): CleanupPlan {
    const disableFkSql: string[] = [];
    const enableFkSql: string[] = [];
    const tableCleanupSql = new Map<string, string[]>();

    let hasFk = false;

    for (const table of tables) {
      const qualifiedName = table.qualifiedTableName;
      const stmts: string[] = [];

      stmts.push(`DELETE FROM ${qualifiedName}`);

      let hasAutoInc = false;
      for (const col of table.columns) {
        if (!hasAutoInc && col.isAutoIncrement) {
          hasAutoInc = true;
        }
        if (!hasFk && col.foreignKey != null && col.foreignKey !== '') {
          hasFk = true;
        }
      }

      if (hasAutoInc) {
        stmts.push(`ALTER TABLE ${qualifiedName} AUTO_INCREMENT = 1`);
      }

      tableCleanupSql.set(table.tableName, stmts);
    }

    if (hasFk) {
      disableFkSql.push('SET FOREIGN_KEY_CHECKS=0');
      enableFkSql.push('SET FOREIGN_KEY_CHECKS=1');
    }

    return {
      disableFkSql,
      enableFkSql,
      tableCleanupSql,
    };
  }
}
