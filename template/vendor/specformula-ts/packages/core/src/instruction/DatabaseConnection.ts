// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/instruction/DatabaseConnection.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/instruction/DatabaseConnection.ts
/**
 * Minimal database connection interface for instruction execution.
 * Implemented by @specformula/node's TrackingConnection.
 */
export interface InstructionDatabaseConnection {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
