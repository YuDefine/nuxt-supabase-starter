// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/index.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/index.ts
// Context
export type { ScenarioContext, LastResponseData } from './context/ScenarioContext.js';
export { ScenarioContextImpl } from './context/ScenarioContextImpl.js';
export { MapScenarioContext } from './context/MapScenarioContext.js';

// Helper — VAR System
export { SymbolResolver } from './helper/SymbolResolver.js';

// Plugin SPI implementation（ADR-0027 / ts-0010）
export {
  DefaultPluginContext,
  DefaultScenarioContext,
  DefaultSpecRegistry,
  DefaultDirtyTracker,
  InstructionRegistry,
  LifecycleHookRegistry,
  SpecReaderRegistry,
  PluginLoader,
  parsePackageJson,
  type PluginLoaderOptions,
} from './plugin/index.js';

// Error — ADR-0026 framework error taxonomy
export {
  SpecFormulaError,
  SpecFormulaArgumentError,
  SpecFormulaStateError,
  SpecFormulaLookupError,
  SpecFormulaAssertionError,
  SpecFormulaErrorCategory,
  SpecFormulaErrorCode,
  SpecFormulaErrorCodeCategory,
  ERROR_CLASS_MAPPING,
  isSpecFormulaError,
  MessageRegistry,
  buildErrorFromRegistry,
  type SpecFormulaErrorOptions,
  type SpecFormulaErrorClassName,
  type MessageRegistryEntry,
} from './error/index.js';

// Helper — CAS System
export {
  ConstraintEngine,
  applyConstraints,
  evaluateConstraints,
  parseConstraints,
} from './helper/ConstraintEngine.js';

// Helper — TIME System
export { TimeService, DateTimeTZ, DateOnly, TimeOnly } from './helper/TimeService.js';

// Helper — Utils
export { getNestedValue, setNestedValue } from './helper/utils/nested-path.js';
export { camelToSnake, snakeToCamel } from './helper/utils/naming.js';
export {
  isRecord,
  expectJsonObject,
  expectJsonObjectArray,
  parseJsonObject,
  parseJsonString,
  parseStringRecord,
} from './helper/JsonBoundary.js';

// HTTP
export type {
  HttpClientAdapter,
  TestRequest,
  TestResponse,
} from './http/HttpClientAdapter.js';

// Dialect
export type {
  DatabaseDialect,
  CleanupPlan,
  TableCleanupInfo,
  ColumnCleanupInfo,
} from './dialect/DatabaseDialect.js';
export { quoteIdentifier, quoteQualifiedName } from './dialect/IdentifierUtils.js';
export { H2CompatDialect } from './dialect/H2CompatDialect.js';
export { PostgresDialect } from './dialect/PostgresDialect.js';
export { MysqlDialect } from './dialect/MysqlDialect.js';
export { MssqlDialect } from './dialect/MssqlDialect.js';
export { createDialect } from './dialect/DatabaseDialectFactory.js';

// Auth
export type { Authenticator } from './auth/Authenticator.js';

// Spec — Models
export type { ColumnDefinition } from './spec/model/ColumnDefinition.js';
export type { EntityTableMapping } from './spec/model/EntityTableMapping.js';
export { entityTableMappingAsMap } from './spec/model/EntityTableMapping.js';
export { TableDefinition } from './spec/model/TableDefinition.js';
export type { TableDefinitionData } from './spec/model/TableDefinition.js';
export type { DatabaseSchema } from './spec/model/DatabaseSchema.js';
export type { ApiInfo } from './spec/model/ApiInfo.js';
export type { ApiSchema } from './spec/model/ApiSchema.js';
export type { ApiParameter } from './spec/model/ApiParameter.js';
export type { ApiRequestBody } from './spec/model/ApiRequestBody.js';
export type { ApiResponse } from './spec/model/ApiResponse.js';
export type { ApiOperation } from './spec/model/ApiOperation.js';
export { ApiSpec } from './spec/model/ApiSpec.js';
export type {
  IsaApiConfig,
  IsaDataSourceConfig,
  IsaDataConfig,
  IsaConfig,
  IsaInstruction,
  IsaSpec,
} from './spec/model/IsaSpec.js';

// Spec — Readers
export { EntityDdlReader } from './spec/EntityDdlReader.js';
export { ApiSpecReader } from './spec/ApiSpecReader.js';
export { IsaSpecReader } from './spec/IsaSpecReader.js';

// Instructions
export { ApiCall } from './instruction/ApiCall.js';
export type { TimeFormat, ParsedJsonDoc } from './instruction/ApiCall.js';
export { ResponseValidate } from './instruction/ResponseValidate.js';
export type { ValidationResult } from './instruction/ResponseValidate.js';
export { TimeControl } from './instruction/TimeControl.js';
export { EntitySetup } from './instruction/EntitySetup.js';
export type { DdlColumnSpec, TableSpec } from './instruction/EntitySetup.js';
export { EntityValidate } from './instruction/EntityValidate.js';
export { EntityNonExistenceValidate } from './instruction/EntityNonExistenceValidate.js';

// Helper — Utils
export { parseColumnPrefix } from './helper/utils/column-prefix.js';
export type { ColumnPrefixInfo } from './helper/utils/column-prefix.js';
export { parseBracketPath, setBracketValue, getBracketValue } from './helper/utils/bracket-path.js';
export type { PathSegment } from './helper/utils/bracket-path.js';

export { asString } from './helper/utils/string-coerce.js';
