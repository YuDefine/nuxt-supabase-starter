// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/datasource/TrackingConnection.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/datasource/TrackingConnection.ts
import type { DatabaseConnection } from './DataSource.js';

/**
 * Wraps a DatabaseConnection and intercepts INSERT statements to track dirty tables.
 * Used during scenario cleanup to know which tables need to be reset.
 */
export class TrackingConnection implements DatabaseConnection {
  private readonly delegate: DatabaseConnection;
  private readonly dirtyTables = new Set<string>();

  constructor(delegate: DatabaseConnection) {
    this.delegate = delegate;
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    const trimmed = sql.trimStart().toUpperCase();
    if (trimmed.startsWith('INSERT INTO')) {
      const tableName = extractTableName(sql);
      if (tableName) {
        this.dirtyTables.add(tableName);
      }
    }
    return this.delegate.execute(sql, params);
  }

  close(): void {
    this.delegate.close();
  }

  getDirtyTables(): Set<string> {
    return new Set(this.dirtyTables);
  }

  clearDirtyTables(): void {
    this.dirtyTables.clear();
  }
}

/**
 * Extract the table name from an INSERT INTO statement.
 * Handles: INSERT INTO table_name ..., INSERT INTO "schema"."table" ...
 * Returns the raw token after INSERT INTO (preserving quotes).
 */
function extractTableName(sql: string): string | null {
  // Match INSERT INTO followed by optional whitespace and the table reference
  const match = /INSERT\s+INTO\s+([`"\[]?\w+[`"\]]?(?:\.[`"\[]?\w+[`"\]]?)?)/i.exec(sql);
  if (!match) return null;
  // Strip any surrounding quotes/brackets for storage
  return match[1].replace(/[`"[\]]/g, '');
}
