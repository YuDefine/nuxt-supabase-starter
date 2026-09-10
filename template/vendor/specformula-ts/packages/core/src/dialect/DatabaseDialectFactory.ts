// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/dialect/DatabaseDialectFactory.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/dialect/DatabaseDialectFactory.ts
import type { DatabaseDialect } from './DatabaseDialect.js';
import { H2CompatDialect } from './H2CompatDialect.js';
import { PostgresDialect } from './PostgresDialect.js';
import { MysqlDialect } from './MysqlDialect.js';
import { MssqlDialect } from './MssqlDialect.js';

/**
 * Factory for creating database dialect instances by dbType string.
 * Mirrors Java's DatabaseDialectFactory.
 *
 * ADR-0028 hard rename：embedded 為唯一支援的 in-process backend 詞彙；'h2'
 * 不再接受（caller 應已由 IsaSpecReader.VALID_DB_TYPES 攔下，本層 default
 * 落到 H2CompatDialect 僅為 defensive fallback）。
 */
export function createDialect(dbType: string | null | undefined): DatabaseDialect {
  switch (dbType?.toLowerCase()) {
    case 'mssql':
    case 'sqlserver':
      return new MssqlDialect();
    case 'postgresql':
    case 'postgres':
      return new PostgresDialect();
    case 'mysql':
    case 'mariadb':
      return new MysqlDialect();
    case 'embedded':
    case undefined:
    case '':
      return new H2CompatDialect();
    default:
      return new H2CompatDialect();
  }
}
