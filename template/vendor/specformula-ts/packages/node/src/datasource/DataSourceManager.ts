// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/datasource/DataSourceManager.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/datasource/DataSourceManager.ts
import type { DataSource } from './DataSource.js';
import { TrackingConnection } from './TrackingConnection.js';

/**
 * Named DataSource registry that wraps each connection with a TrackingConnection.
 * Maintains the map of DataSource name → TrackingConnection for dirty-table tracking.
 */
export class DataSourceManager {
  private readonly sources = new Map<string, DataSource>();
  private readonly activeConnections = new Map<string, TrackingConnection>();

  register(name: string, ds: DataSource): void {
    this.sources.set(name, ds);
  }

  has(name: string): boolean {
    return this.sources.has(name);
  }

  getConnection(name: string): TrackingConnection {
    const existing = this.activeConnections.get(name);
    if (existing) return existing;

    const ds = this.sources.get(name);
    if (!ds) {
      throw new Error(`DataSource not registered: ${name}`);
    }
    const tracking = new TrackingConnection(ds.getConnection());
    this.activeConnections.set(name, tracking);
    return tracking;
  }

  getAllDirtyTables(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const [name, conn] of this.activeConnections) {
      const dirty = conn.getDirtyTables();
      if (dirty.size > 0) {
        result.set(name, dirty);
      }
    }
    return result;
  }

  clearAllDirtyTables(): void {
    for (const conn of this.activeConnections.values()) {
      conn.clearDirtyTables();
    }
  }

  async closeAll(): Promise<void> {
    for (const conn of this.activeConnections.values()) {
      conn.close();
    }
    this.activeConnections.clear();
    for (const ds of this.sources.values()) {
      await ds.close();
    }
    this.sources.clear();
  }
}
