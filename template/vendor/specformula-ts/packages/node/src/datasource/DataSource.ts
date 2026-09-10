// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/datasource/DataSource.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/datasource/DataSource.ts
/**
 * DataSource and DatabaseConnection abstractions for the Node.js bridge layer.
 * DataSource represents a named database connection pool or single connection factory.
 * DatabaseConnection represents a single logical connection for executing SQL.
 */
export interface DatabaseConnection {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): void;
}

export interface DataSource {
  getConnection(): DatabaseConnection;
  close(): Promise<void>;
}
