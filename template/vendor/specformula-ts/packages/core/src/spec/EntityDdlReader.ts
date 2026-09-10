// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/EntityDdlReader.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/EntityDdlReader.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import type { DatabaseSchema } from './model/DatabaseSchema.js';
import type { EntityTableMapping } from './model/EntityTableMapping.js';
import { entityTableMappingAsMap } from './model/EntityTableMapping.js';
import { TableDefinition } from './model/TableDefinition.js';
import type { ColumnDefinition } from './model/ColumnDefinition.js';
import type { IsaDataSourceConfig } from './model/IsaSpec.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaLookupError,
} from '../error/SpecFormulaError.js';

// --- Regex patterns (ported from Java EntityDdlReader) ---

const CREATE_TABLE_PATTERN =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"([^"]+)"|\[([^\]]+)\]|`([^`]+)`|(\w+))\.)?(?:"([^"]+)"|\[([^\]]+)\]|`([^`]+)`|(\w+))\s*\(/gi;

const TABLE_COMMENT_PATTERN = /\)\s*COMMENT\s+'([^']*)'/i;

const COLUMN_COMMENT_PATTERN = /COMMENT\s+'([^']*)'/i;

const DEFAULT_PATTERN = /DEFAULT\s+(\S+)/i;

const CHECK_PATTERN = /CHECK\s*\((.+)\)/i;

const COMPOSITE_PK_PATTERN = /PRIMARY\s+KEY\s*\(([^)]+)\)/i;

const FOREIGN_KEY_PATTERN =
  /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:(?:"[^"]+"|\\[[^\]]+\\]|\w+)\.)?(?:"([^"]+)"|\[([^\]]+)\]|(\w+))\s*\(([^)]+)\)/i;

// FK 依賴拓撲排序：萃取 REFERENCES 後被參考的表名（可帶 schema 前綴）。
// group 1=雙引號, 2=方括號, 3=反引號, 4=未引號。
const REFERENCES_PATTERN =
  /REFERENCES\s+(?:(?:"[^"]+"|\[[^\]]+\]|`[^`]+`|\w+)\.)?(?:"([^"]+)"|\[([^\]]+)\]|`([^`]+)`|(\w+))/gi;

export class EntityDdlReader {
  private readonly resourcePath: string;
  private readonly dataSourceName: string;
  private readonly dbType: string;

  constructor(dataSourceConfig: IsaDataSourceConfig | { name?: string; resource_path?: string; db_type?: string; resourcePath?: string }) {
    // Support both snake_case (IsaDataSourceConfig) and a plain object with resourcePath
    const cfg = dataSourceConfig as Record<string, unknown>;
    this.resourcePath = (cfg['resource_path'] ?? cfg['resourcePath'] ?? '') as string;
    this.dataSourceName = ((cfg['name'] as string | undefined) ?? 'default');
    // ADR-0028: db_type 為 'embedded' / 'postgresql' / 'mysql' / 'mssql'；hard rename，
    // 'h2' 不再接受（由 IsaSpecReader 之 VALID_DB_TYPES 在啟動期攔下）。
    this.dbType = (cfg['db_type'] as string | undefined) ?? 'embedded';
  }

  read(): DatabaseSchema {
    const dirPath = this.resourcePath;
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      throw new SpecFormulaLookupError({
        code: 'SPEC_ENTITY_MAPPING_NOT_FOUND',
        details: { directory: dirPath },
      });
    }
    return this.scanDirectory(dirPath);
  }

  private scanDirectory(dirPath: string): DatabaseSchema {
    const mappingFile = path.join(dirPath, 'entity_to_table_mapping.yml');
    if (!fs.existsSync(mappingFile)) {
      throw new SpecFormulaLookupError({
        code: 'SPEC_ENTITY_MAPPING_NOT_FOUND',
        details: { directory: dirPath },
      });
    }

    // Read .sql files (single-level only), sorted by filename
    const sqlFiles = fs
      .readdirSync(dirPath)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .sort()
      .map((f) => path.join(dirPath, f));

    if (sqlFiles.length === 0) {
      throw new SpecFormulaLookupError({
        code: 'SPEC_ENTITY_DDL_FILES_NOT_FOUND',
        details: { directory: dirPath },
      });
    }

    const tables: TableDefinition[] = [];
    for (const file of sqlFiles) {
      const sql = fs.readFileSync(file, 'utf-8');
      const parsed = this.parseDdl(sql);
      for (const t of parsed) {
        t.dbType = this.dbType;
        tables.push(t);
      }
    }

    // Check duplicate table names
    const seen = new Set<string>();
    for (const t of tables) {
      if (seen.has(t.tableName)) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ENTITY_TABLE_DUPLICATE',
          details: { table_name: t.tableName },
        });
      }
      seen.add(t.tableName);
    }

    // Read entity_to_table_mapping.yml
    const mappingRaw = fs.readFileSync(mappingFile, 'utf-8');
    const entityTableMapping = yaml.load(mappingRaw) as EntityTableMapping;

    // Validate mapping against SQL table names
    const sqlTableNames = new Set(seen);
    const mappingMap = entityTableMappingAsMap(entityTableMapping);
    for (const [entity, mappedTable] of mappingMap.entries()) {
      const stripped = stripQuotes(mappedTable);
      if (!sqlTableNames.has(stripped)) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ENTITY_MAPPING_TABLE_MISMATCH',
          details: { table: mappedTable, entity },
        });
      }
    }

    return {
      tables,
      entityTableMapping,
      dataSourceName: this.dataSourceName,
      dbType: this.dbType,
    };
  }

  parseDdl(sql: string): TableDefinition[] {
    const tables: TableDefinition[] = [];
    // Reset lastIndex since we use /gi flag
    CREATE_TABLE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CREATE_TABLE_PATTERN.exec(sql)) !== null) {
      // schema: group 1=quoted, 2=bracketed, 3=backtick, 4=unquoted
      // table:  group 5=quoted, 6=bracketed, 7=backtick, 8=unquoted
      const schemaName =
        match[1] ?? match[2] ?? match[3] ?? match[4] ?? undefined;
      const tableName =
        match[5] ?? match[6] ?? match[7] ?? match[8] ?? '';

      const bodyStart = match.index + match[0].length; // position after '('

      const bodyEnd = findMatchingParen(sql, bodyStart - 1);
      if (bodyEnd < 0) {
        // Invalid SQL — throw error mentioning table name
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ENTITY_DDL_PARSE_ERROR',
          details: { name: tableName, reason: '缺少右括號' },
        });
      }

      const body = sql.substring(bodyStart, bodyEnd);

      // Parse table-level COMMENT after closing ')'
      const afterBody = sql.substring(bodyEnd, Math.min(bodyEnd + 200, sql.length));
      let tableComment: string | null = null;
      const tableCommentMatch = TABLE_COMMENT_PATTERN.exec(')' + afterBody);
      if (tableCommentMatch) {
        tableComment = tableCommentMatch[1];
      }

      const columns: ColumnDefinition[] = [];
      const pkColumnsSet: string[] = [];

      const segments = splitByTopLevelComma(body);
      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        // Remove inline comment before judging constraint type
        const cleaned = trimmed.replace(/--.*$/gm, '').trim();
        if (!cleaned) continue;

        const upper = cleaned.toUpperCase();

        // Skip standalone constraint lines
        if (
          upper.startsWith('INDEX ') ||
          upper.startsWith('INDEX(') ||
          upper.startsWith('UNIQUE ') ||
          upper.startsWith('UNIQUE(') ||
          upper.startsWith('CHECK ') ||
          upper.startsWith('CHECK(')
        ) {
          continue;
        }

        if (
          upper.startsWith('FOREIGN KEY') ||
          (upper.startsWith('CONSTRAINT') && upper.includes('FOREIGN KEY'))
        ) {
          applyForeignKey(cleaned, columns);
          continue;
        }

        if (
          upper.startsWith('PRIMARY KEY') ||
          (upper.startsWith('CONSTRAINT') && upper.includes('PRIMARY KEY'))
        ) {
          applyCompositePrimaryKey(cleaned, columns, pkColumnsSet);
          continue;
        }

        const col = parseColumn(trimmed);
        if (col != null) {
          columns.push(col);
        }
      }

      // Collect pkColumns from inline PRIMARY KEY columns
      for (const col of columns) {
        if (col.primaryKey && !pkColumnsSet.includes(col.name)) {
          pkColumnsSet.push(col.name);
        }
      }

      // queryColumns: non-PK columns excluding high-precision types
      const queryColumns = columns
        .filter((c) => !c.primaryKey && !isHighPrecisionType(c.type))
        .map((c) => c.name);

      tables.push(
        new TableDefinition({
          tableName,
          schemaName,
          comment: tableComment,
          columns,
          pkColumns: pkColumnsSet,
          queryColumns,
        }),
      );
    }

    return tables;
  }

  /**
   * Sort SQL files by FOREIGN KEY (REFERENCES) dependency using topological sort
   * (Kahn's algorithm). Self-references and intra-file references are excluded.
   * Falls back to filename sort on circular dependency.
   * Mirrors C# `EntityDdlReader.SortByForeignKeyDependency` (fk-dependency-sorting).
   */
  static sortByForeignKeyDependency(sqlFiles: string[]): string[] {
    if (sqlFiles.length <= 1) return [...sqlFiles];

    // 1. Parse each file: tables it defines, tables it references.
    const fileDefines = new Map<string, Set<string>>();
    const fileDependsOn = new Map<string, Set<string>>();

    for (const file of sqlFiles) {
      const defines = new Set<string>();
      const dependsOn = new Set<string>();
      const content = fs.readFileSync(file, 'utf-8');

      CREATE_TABLE_PATTERN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CREATE_TABLE_PATTERN.exec(content)) !== null) {
        const tableName = m[5] ?? m[6] ?? m[7] ?? m[8];
        if (tableName) defines.add(tableName);
      }

      REFERENCES_PATTERN.lastIndex = 0;
      while ((m = REFERENCES_PATTERN.exec(content)) !== null) {
        const refTable = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (!defines.has(refTable)) {
          dependsOn.add(refTable);
        }
      }

      fileDefines.set(file, defines);
      fileDependsOn.set(file, dependsOn);
    }

    // 2. Build table → file map.
    const tableToFile = new Map<string, string>();
    for (const [file, tables] of fileDefines) {
      for (const table of tables) {
        if (!tableToFile.has(table)) {
          tableToFile.set(table, file);
        }
      }
    }

    // 3. Build file dependency graph (depCount + dependents).
    const depCount = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const file of sqlFiles) {
      depCount.set(file, 0);
      dependents.set(file, []);
    }

    for (const [file, deps] of fileDependsOn) {
      for (const depTable of deps) {
        const depFile = tableToFile.get(depTable);
        if (depFile && depFile !== file) {
          depCount.set(file, (depCount.get(file) ?? 0) + 1);
          dependents.get(depFile)!.push(file);
        }
      }
    }

    // 4. Kahn's algorithm.
    const sorted: string[] = [];
    const sortedSet = new Set<string>();
    while (sorted.length < sqlFiles.length) {
      const ready = sqlFiles
        .filter((f) => !sortedSet.has(f) && (depCount.get(f) ?? 0) === 0)
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

      if (ready.length === 0) {
        // Circular dependency — fallback to filename sort.
        return sqlFiles
          .slice()
          .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
      }

      for (const file of ready) {
        sorted.push(file);
        sortedSet.add(file);
        for (const dependent of dependents.get(file) ?? []) {
          depCount.set(dependent, (depCount.get(dependent) ?? 0) - 1);
        }
      }
    }

    return sorted;
  }
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseColumn(line: string): ColumnDefinition | null {
  // Remove inline comment
  const cleaned = line.replace(/--.*$/gm, '').trim();
  if (!cleaned) return null;

  // Extract and remove COMMENT 'xxx' first
  let comment: string | null = null;
  let rest = cleaned;
  const commentMatch = COLUMN_COMMENT_PATTERN.exec(rest);
  if (commentMatch) {
    comment = commentMatch[1];
    rest = rest.replace(COLUMN_COMMENT_PATTERN, '').trim();
  }

  // Column name is the first token (possibly quoted)
  let name: string;
  let afterName: string;

  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return null;
    name = rest.substring(1, end);
    afterName = rest.substring(end + 1).trim();
  } else if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end < 0) return null;
    name = rest.substring(1, end);
    afterName = rest.substring(end + 1).trim();
  } else if (rest.startsWith('`')) {
    const end = rest.indexOf('`', 1);
    if (end < 0) return null;
    name = rest.substring(1, end);
    afterName = rest.substring(end + 1).trim();
  } else {
    const spaceIdx = rest.search(/\s/);
    if (spaceIdx < 0) return null;
    name = rest.substring(0, spaceIdx);
    afterName = rest.substring(spaceIdx).trim();
  }

  if (!name || name.toUpperCase() === 'CONSTRAINT') return null;

  const type = extractType(afterName);
  const constraints = afterName.substring(type.length).trim();
  const upperConstraints = constraints.toUpperCase();

  const notNull = upperConstraints.includes('NOT NULL');
  const isPk =
    upperConstraints.includes('PRIMARY KEY') || type.toUpperCase().endsWith('SERIAL');
  const isUnique = upperConstraints.includes('UNIQUE');
  const autoIncrement =
    upperConstraints.includes('IDENTITY') || type.toUpperCase().endsWith('SERIAL');

  let defaultValue: string | null = null;
  const defaultMatch = DEFAULT_PATTERN.exec(constraints);
  if (defaultMatch) {
    let dv = defaultMatch[1];
    if (dv.startsWith("'") && dv.endsWith("'") && dv.length >= 2) {
      dv = dv.slice(1, -1);
    }
    defaultValue = dv;
  }

  let checkConstraint: string | null = null;
  const checkMatch = CHECK_PATTERN.exec(constraints);
  if (checkMatch) {
    checkConstraint = checkMatch[1];
  }

  return {
    name,
    type,
    notNull,
    primaryKey: isPk,
    autoIncrement,
    unique: isUnique,
    defaultValue,
    foreignKey: null,
    checkConstraint,
    comment,
  };
}

function applyCompositePrimaryKey(
  segment: string,
  columns: ColumnDefinition[],
  pkColumns: string[],
): void {
  const m = COMPOSITE_PK_PATTERN.exec(segment);
  if (!m) return;
  const pkColNames = m[1].split(',');
  for (const raw of pkColNames) {
    const name = raw.trim();
    pkColumns.push(name);
    for (const col of columns) {
      if (col.name.toLowerCase() === name.toLowerCase()) {
        (col as { primaryKey: boolean }).primaryKey = true;
      }
    }
  }
}

function applyForeignKey(segment: string, columns: ColumnDefinition[]): void {
  const m = FOREIGN_KEY_PATTERN.exec(segment);
  if (!m) return;
  const fkColName = m[1].trim();
  const refTable = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  const refCol = m[5].trim();
  for (const col of columns) {
    if (col.name.toLowerCase() === fkColName.toLowerCase()) {
      (col as { foreignKey: string | null }).foreignKey = `${refTable}.${refCol}`;
    }
  }
}

function extractType(rest: string): string {
  const typePattern = /^(\w+(?:\s*\([^)]*\))?)/;
  const m = typePattern.exec(rest);
  if (m) return m[1];
  return rest.split(/\s+/)[0] ?? '';
}

function isHighPrecisionType(type: string): boolean {
  const upper = type.toUpperCase();
  return (
    upper.startsWith('TIMESTAMP') ||
    upper.startsWith('DATETIME') ||
    upper.startsWith('DATE') ||
    upper.startsWith('TIME') ||
    upper.startsWith('INTERVAL')
  );
}

function findMatchingParen(sql: string, openParenIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  for (let i = openParenIndex; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && !inSingleQuote) {
      inSingleQuote = true;
    } else if (c === "'" && inSingleQuote) {
      inSingleQuote = false;
    } else if (!inSingleQuote) {
      if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function splitByTopLevelComma(body: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let inSingleQuote = false;
  let inLineComment = false;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];

    if (inLineComment) {
      if (c === '\n' || c === '\r') inLineComment = false;
      continue;
    }

    if (c === '-' && i + 1 < body.length && body[i + 1] === '-' && !inSingleQuote) {
      inLineComment = true;
      continue;
    }

    if (c === "'" && !inSingleQuote) {
      inSingleQuote = true;
    } else if (c === "'" && inSingleQuote) {
      inSingleQuote = false;
    } else if (!inSingleQuote) {
      if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
      } else if (c === ',' && depth === 0) {
        segments.push(body.substring(start, i));
        start = i + 1;
      }
    }
  }

  if (start < body.length) {
    segments.push(body.substring(start));
  }
  return segments;
}
