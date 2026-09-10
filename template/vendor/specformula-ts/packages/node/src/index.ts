// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/index.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/index.ts
// @specformula/node — Layer 2: Node.js framework bridge

// DataSource abstractions
export type { DataSource, DatabaseConnection } from './datasource/DataSource.js';
export { TrackingConnection } from './datasource/TrackingConnection.js';
export { DataSourceManager } from './datasource/DataSourceManager.js';
export { SqliteDataSource } from './datasource/SqliteDataSource.js';
export {
  createPostgresDataSource,
  createMysqlDataSource,
  createMssqlDataSource,
  type JdbcDataSourceConfig,
} from './datasource/ExternalDataSources.js';

// HTTP adapters
export { FetchHttpClientAdapter } from './adapters/FetchHttpClientAdapter.js';
export { SupertestHttpClientAdapter } from './adapters/SupertestHttpClientAdapter.js';

// Bridge
export { SpecFormulaBridge } from './SpecFormulaBridge.js';
export type { BridgeConfig } from './SpecFormulaBridge.js';
