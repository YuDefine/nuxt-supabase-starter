// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/datasource/SqliteDataSource.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/datasource/SqliteDataSource.ts
import Database from 'better-sqlite3';
import type { DataSource, DatabaseConnection } from './DataSource.js';

/**
 * SQLite in-memory DataSource using better-sqlite3.
 * Used as the H2-compatible dialect for local/test execution.
 */
export class SqliteDataSource implements DataSource {
  private db: Database.Database | null = null;

  private ensureDb(): Database.Database {
    if (!this.db) {
      this.db = new Database(':memory:');
      this.db.pragma('foreign_keys = ON');
      this.db.defaultSafeIntegers(true);
    }
    return this.db;
  }

  getConnection(): DatabaseConnection {
    const db = this.ensureDb();
    return new SqliteConnection(db);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async wraps sync throws into rejected promises
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

class SqliteConnection implements DatabaseConnection {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async wraps sync throws into rejected promises
  async execute(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const stmt = this.db.prepare(sql);
    const trimmed = sql.trimStart().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
      const rows = stmt.all(...params) as Record<string, unknown>[];
      return { rows };
    } else if (trimmed.startsWith('PRAGMA')) {
      // PRAGMA queries (e.g. PRAGMA table_info) return rows; setters (e.g. PRAGMA foreign_keys = ON) do not
      if (stmt.reader) {
        const rows = stmt.all(...params) as Record<string, unknown>[];
        return { rows };
      } else {
        stmt.run(...params);
        return { rows: [] };
      }
    } else {
      stmt.run(...params);
      return { rows: [] };
    }
  }

  close(): void {
    // better-sqlite3 connections are lightweight wrappers — db is shared; no-op here
  }
}
