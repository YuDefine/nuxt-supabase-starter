// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/dialect/DatabaseDialect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/dialect/DatabaseDialect.ts
/**
 * Database dialect abstraction for cleanup SQL generation.
 * Each dialect (H2Compat/SQLite, PostgreSQL, MySQL, MSSQL) implements this.
 * Mirrors Java's DatabaseDialect interface.
 */
export interface DatabaseDialect {
  buildCleanupPlan(tables: readonly TableCleanupInfo[]): CleanupPlan;
}

export interface TableCleanupInfo {
  readonly tableName: string;
  readonly qualifiedTableName: string;
  readonly schemaName?: string;
  readonly dbType: string;
  readonly columns: readonly ColumnCleanupInfo[];
}

export interface ColumnCleanupInfo {
  readonly name: string;
  readonly isAutoIncrement: boolean;
  readonly foreignKey?: string;
}

/**
 * Ordered set of SQL statements for per-scenario cleanup.
 * Mirrors Java's CleanupPlan (Builder pattern).
 */
export interface CleanupPlan {
  readonly disableFkSql: readonly string[];
  readonly enableFkSql: readonly string[];
  readonly tableCleanupSql: ReadonlyMap<string, readonly string[]>;
}
