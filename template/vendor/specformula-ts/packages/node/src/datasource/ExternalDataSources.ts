// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/datasource/ExternalDataSources.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/datasource/ExternalDataSources.ts
import type { Pool as PgPoolType } from 'pg';
import { Pool as PgPool } from 'pg';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import type { DataSource, DatabaseConnection } from './DataSource.js';

export interface JdbcDataSourceConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export async function createPostgresDataSource(
  config: JdbcDataSourceConfig,
  schema?: string | null,
): Promise<DataSource> {
  const pool = new PgPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    // ADR-0020: 連線層級 schema search path（PostgreSQL）。未限定 schema 的
    // CREATE TABLE / INSERT 會落到此 schema；保留 public 作為後備。
    ...(schema ? { options: `-c search_path="${schema}",public` } : {}),
  });
  await pool.query('SELECT 1');
  return new PostgresDataSource(pool);
}

export async function createMysqlDataSource(
  config: JdbcDataSourceConfig,
): Promise<DataSource> {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
  });
  await pool.query('SELECT 1');
  return new MysqlDataSource(pool);
}

export async function createMssqlDataSource(
  config: JdbcDataSourceConfig,
): Promise<DataSource> {
  const pool = await new mssql.ConnectionPool({
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  }).connect();
  return new MssqlDataSource(pool);
}

class PostgresDataSource implements DataSource {
  constructor(private readonly pool: PgPoolType) {}

  getConnection(): DatabaseConnection {
    return new PostgresConnection(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgresConnection implements DatabaseConnection {
  constructor(private readonly pool: PgPoolType) {}

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const rewritten = rewriteQuestionPlaceholders(sql, '$');
    const result = await this.pool.query(rewritten, params);
    return { rows: result.rows as Record<string, unknown>[] };
  }

  close(): void {}
}

class MysqlDataSource implements DataSource {
  constructor(private readonly pool: mysql.Pool) {}

  getConnection(): DatabaseConnection {
    return new MysqlConnection(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class MysqlConnection implements DatabaseConnection {
  constructor(private readonly pool: mysql.Pool) {}

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const [rows] = await this.pool.query(sql, params);
    if (!Array.isArray(rows)) {
      return { rows: [] };
    }
    return {
      rows: rows.map((row) => ({ ...(row as Record<string, unknown>) })),
    };
  }

  close(): void {}
}

class MssqlDataSource implements DataSource {
  constructor(private readonly pool: mssql.ConnectionPool) {}

  getConnection(): DatabaseConnection {
    return new MssqlConnection(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}

class MssqlConnection implements DatabaseConnection {
  constructor(private readonly pool: mssql.ConnectionPool) {}

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const request = this.pool.request();
    params.forEach((value, index) => {
      request.input(`p${index + 1}`, normalizeMssqlParam(value));
    });
    const rewritten = rewriteLimitOneForMssql(rewriteQuestionPlaceholders(sql, '@p'));
    const result = await request.query(rewritten);
    return { rows: (result.recordset ?? []) as Record<string, unknown>[] };
  }

  close(): void {}
}

function rewriteQuestionPlaceholders(sql: string, prefix: '$' | '@p'): string {
  let result = '';
  let inSingleQuote = false;
  let placeholderIndex = 1;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (ch === "'") {
      const next = sql[i + 1];
      result += ch;
      if (inSingleQuote && next === "'") {
        result += next;
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (ch === '?' && !inSingleQuote) {
      result += prefix === '$' ? `$${placeholderIndex}` : `@p${placeholderIndex}`;
      placeholderIndex += 1;
      continue;
    }

    result += ch;
  }

  return result;
}

function normalizeMssqlParam(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

function rewriteLimitOneForMssql(sql: string): string {
  const match = sql.match(/^SELECT\s+\*\s+FROM\s+(.+?)\s+ORDER\s+BY\s+(.+?)\s+DESC\s+LIMIT\s+1\s*$/i);
  if (match) {
    return `SELECT TOP 1 * FROM ${match[1]} ORDER BY ${match[2]} DESC`;
  }

  const limitOnlyMatch = sql.match(/^SELECT\s+\*\s+FROM\s+(.+?)\s+LIMIT\s+1\s*$/i);
  if (limitOnlyMatch) {
    return `SELECT TOP 1 * FROM ${limitOnlyMatch[1]}`;
  }

  const whereLimitMatch = sql.match(/^SELECT\s+\*\s+FROM\s+(.+?)\s+WHERE\s+(.+?)\s+LIMIT\s+1\s*$/i);
  if (whereLimitMatch) {
    return `SELECT TOP 1 * FROM ${whereLimitMatch[1]} WHERE ${whereLimitMatch[2]}`;
  }

  return sql;
}
