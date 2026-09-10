// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/SpecFormulaBridge.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/SpecFormulaBridge.ts
import type { HttpClientAdapter, Authenticator, DatabaseSchema, CleanupPlan } from '@specformula/core';
import {
  MapScenarioContext,
  createDialect,
  EntitySetup,
  EntityValidate,
  EntityNonExistenceValidate,
  ApiCall,
  ResponseValidate,
  TimeControl,
} from '@specformula/core';
import type { ScenarioContext, TimeFormat } from '@specformula/core';
import type { ApiSpec } from '@specformula/core';
import type { DataSource, DatabaseConnection } from './datasource/DataSource.js';
import { DataSourceManager } from './datasource/DataSourceManager.js';
import { SqliteDataSource } from './datasource/SqliteDataSource.js';

export interface BridgeConfig {
  readonly schemaMap: Map<string, DatabaseSchema>;
  readonly apiSpec: ApiSpec;
  readonly timeFormat: string;
}

/**
 * Central wiring singleton for SpecFormula test infrastructure.
 * Connects DataSources, HTTP clients, authenticators, and scenario lifecycle.
 */
const VALID_TIME_FORMATS = new Set<TimeFormat>(['ISO', 'TIMESTAMP', 'EPOCH', 'DATE_ONLY', 'TIME_ONLY']);

export class SpecFormulaBridge {
  private static instance: SpecFormulaBridge | null = null;

  private config: BridgeConfig | null = null;
  private validatedTimeFormat: TimeFormat = 'ISO';
  private httpClient: HttpClientAdapter | null = null;
  private authenticator: Authenticator | null = null;
  private readonly dsManager = new DataSourceManager();
  private currentContext: MapScenarioContext | null = null;

  private constructor() {}

  static getInstance(): SpecFormulaBridge {
    if (!SpecFormulaBridge.instance) {
      SpecFormulaBridge.instance = new SpecFormulaBridge();
    }
    return SpecFormulaBridge.instance;
  }

  static setInstance(bridge: SpecFormulaBridge): void {
    SpecFormulaBridge.instance = bridge;
  }

  // ─── DataSource management ────────────────────────────────────────────────

  setDataSource(name: string, dataSource: DataSource): void {
    this.dsManager.register(name, dataSource);
  }

  getConnection(name: string): DatabaseConnection {
    return this.dsManager.getConnection(name);
  }

  /**
   * Ensure a DataSource exists for the given name.
   * If not registered, auto-creates an in-memory SqliteDataSource (H2 equivalent).
   */
  ensureDataSource(name: string): void {
    if (!this.dsManager.has(name)) {
      this.dsManager.register(name, new SqliteDataSource());
    }
  }

  // ─── HTTP ─────────────────────────────────────────────────────────────────

  setHttpClient(client: HttpClientAdapter): void {
    this.httpClient = client;
  }

  getHttpClient(): HttpClientAdapter {
    if (!this.httpClient) {
      throw new Error('HttpClientAdapter not configured. Call setHttpClient() first.');
    }
    return this.httpClient;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  setAuthenticator(auth: Authenticator): void {
    this.authenticator = auth;
  }

  getAuthenticator(): Authenticator {
    if (!this.authenticator) {
      throw new Error('Authenticator not configured. Call setAuthenticator() first.');
    }
    return this.authenticator;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  initialize(config: BridgeConfig): void {
    const tf = (config.timeFormat ?? 'iso').toUpperCase();
    if (!VALID_TIME_FORMATS.has(tf as TimeFormat)) {
      throw new Error(
        `Invalid timeFormat: '${config.timeFormat}'. Must be one of: ${[...VALID_TIME_FORMATS].join(', ')}`,
      );
    }
    this.validatedTimeFormat = tf as TimeFormat;
    this.config = config;
  }

  newScenario(): ScenarioContext {
    const ctx = new MapScenarioContext();
    this.currentContext = ctx;
    return ctx;
  }

  async endScenario(): Promise<void> {
    const config = this.config;
    if (!config) return;

    const dirtyBySource = this.dsManager.getAllDirtyTables();
    if (dirtyBySource.size === 0) {
      this.currentContext = null;
      return;
    }

    for (const [sourceName, dirtyTableNames] of dirtyBySource) {
      const schema = config.schemaMap.get(sourceName);
      if (!schema) continue;

      const dialect = createDialect(schema.dbType);
      const tableInfos = buildTableCleanupInfos(schema, dirtyTableNames);
      if (tableInfos.length === 0) continue;

      const plan = dialect.buildCleanupPlan(tableInfos);
      const conn = this.dsManager.getConnection(sourceName);

      await executeCleanupPlan(conn, plan);
    }

    this.dsManager.clearAllDirtyTables();
    this.currentContext = null;
  }

  async closeAllDataSources(): Promise<void> {
    await this.dsManager.closeAll();
    this.currentContext = null;
  }

  // ─── Instruction wiring ──────────────────────────────────────────────────

  getEntitySetup(): EntitySetup {
    return new EntitySetup(this.requireScenarioContext('getEntitySetup'));
  }

  getEntityValidate(): EntityValidate {
    return new EntityValidate(this.requireScenarioContext('getEntityValidate'));
  }

  getEntityNonExistenceValidate(): EntityNonExistenceValidate {
    return new EntityNonExistenceValidate(
      this.requireScenarioContext('getEntityNonExistenceValidate'),
    );
  }

  getResponseValidate(): ResponseValidate {
    return new ResponseValidate(this.requireScenarioContext('getResponseValidate'));
  }

  getTimeControl(): TimeControl {
    return new TimeControl(this.requireScenarioContext('getTimeControl'));
  }

  getApiCall(): ApiCall {
    const ctx = this.requireScenarioContext('getApiCall');
    const httpClient = this.getHttpClient();
    return new ApiCall(httpClient, ctx, this.validatedTimeFormat);
  }

  private requireScenarioContext(method: string): ScenarioContext {
    if (!this.currentContext) {
      throw new Error(
        `SpecFormulaBridge.${method}(): no active scenario — call newScenario() first.`,
      );
    }
    return this.currentContext;
  }

  /**
   * Returns the current scenario context (set by `newScenario()`).
   * Throws if no scenario is active.
   */
  getCurrentContext(): ScenarioContext {
    return this.requireScenarioContext('getCurrentContext');
  }

  getConfig(): BridgeConfig | null {
    return this.config;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

import type { TableCleanupInfo } from '@specformula/core';

function buildTableCleanupInfos(
  schema: DatabaseSchema,
  dirtyTableNames: Set<string>,
): TableCleanupInfo[] {
  const result: TableCleanupInfo[] = [];
  for (const table of schema.tables) {
    if (!dirtyTableNames.has(table.tableName)) continue;
    result.push({
      tableName: table.tableName,
      qualifiedTableName: table.schemaName
        ? `${table.schemaName}.${table.tableName}`
        : table.tableName,
      schemaName: table.schemaName,
      dbType: schema.dbType,
      columns: table.columns.map((col) => ({
        name: col.name,
        isAutoIncrement: col.autoIncrement,
        foreignKey: col.foreignKey ?? undefined,
      })),
    });
  }
  return result;
}

async function executeCleanupPlan(
  conn: DatabaseConnection,
  plan: CleanupPlan,
): Promise<void> {
  for (const sql of plan.disableFkSql) {
    await conn.execute(sql);
  }
  for (const stmts of plan.tableCleanupSql.values()) {
    for (const sql of stmts) {
      await conn.execute(sql);
    }
  }
  for (const sql of plan.enableFkSql) {
    await conn.execute(sql);
  }
}
