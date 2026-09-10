// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/dialect/IdentifierUtils.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/dialect/IdentifierUtils.ts
/**
 * Dialect-specific identifier quoting.
 * Port from Java IdentifierUtils.java.
 *
 * - PostgreSQL: "identifier"
 * - MySQL: `identifier`
 * - MSSQL: [identifier]
 * - H2/SQLite: no quoting (identifiers are case-insensitive)
 */
export function quoteIdentifier(identifier: string, dbType: string): string {
  switch (dbType.toLowerCase()) {
    case 'postgresql':
    case 'postgres':
      return `"${identifier}"`;
    case 'mysql':
    case 'mariadb':
      return `\`${identifier}\``;
    case 'mssql':
    case 'sqlserver':
      return `[${identifier}]`;
    default:
      return identifier;
  }
}

/**
 * Quote a qualified table name (schema.table) with dialect-specific quoting.
 */
export function quoteQualifiedName(
  tableName: string,
  schemaName: string | undefined,
  dbType: string,
): string {
  const quotedTable = quoteIdentifier(tableName, dbType);
  if (!schemaName) {
    return quotedTable;
  }
  return `${quoteIdentifier(schemaName, dbType)}.${quotedTable}`;
}
