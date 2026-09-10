// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/testcontainer/src/TestcontainerFactory.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/testcontainer/src/TestcontainerFactory.ts
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  SqliteDataSource,
  createPostgresDataSource,
  createMysqlDataSource,
  createMssqlDataSource,
} from '@specformula/node';
import type { DataSource } from '@specformula/node';

const POSTGRES_IMAGE = 'postgres:16-alpine';
const MYSQL_IMAGE = 'mysql:8.0';
const MSSQL_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest';

const POSTGRES_PORT = 5432;
const MYSQL_PORT = 3306;
const MSSQL_PORT = 1433;

const DEFAULT_DB = 'specformula_test';
const DEFAULT_USER = 'specformula';
const DEFAULT_PASS = 'specformula_pw';
const MSSQL_SA_PASS = 'SpecFormula_test_1';

// ADR-0020 isolated 模式：以容器本身憑證為 admin，建立專屬隔離使用者並授權。
const ISOLATED_USER = 'specformula_iso';
// SQL Server 密碼政策要求「四類字元（大小寫/數字/符號）取三類」，否則 CREATE LOGIN 必失敗。
const ISOLATED_PASS = 'IsoPw_1#2024';

export interface ContainerOptions {
  /** ADR-0020：DataSource 預設 schema（PostgreSQL search_path / MSSQL DEFAULT_SCHEMA）。 */
  schema?: string | null;
  /** ADR-0020：'isolated' 建立專屬使用者並授權；'shared' 以 admin 連線。 */
  permission?: string | null;
  /** isolated 模式建立使用者後回呼，供測試取得 ProvisionContext（如冪等性驗證）。 */
  onProvisioned?: (ctx: ProvisionContext) => void;
}

/** isolated 模式授權所需之連線情境。 */
export interface ProvisionContext {
  dbType: string;
  host: string;
  port: number;
  dbName: string;
  adminUser: string;
  adminPass: string;
  schema?: string | null;
}

/** isolated 模式建立之專屬使用者憑證。 */
export interface IsolatedCredentials {
  username: string;
  password: string;
}

/**
 * 已啟動之 Testcontainer 連線資訊。單一容器可承載多個資料庫（permission-isolation
 * 測試），並以 admin 憑證執行 DDL（CREATE DATABASE / CREATE USER）。
 */
export interface ContainerInfo {
  dbType: string;
  host: string;
  port: number;
  /** 預設資料庫（postgres/mysql 為容器建立之 DB；mssql 為 specformula_test）。 */
  dbName: string;
  /** 具 DDL 權限之 admin 憑證（mysql 為 root）。 */
  adminUser: string;
  adminPass: string;
  /** 容器預設應用使用者（shared 模式連線用）。 */
  defaultUser: string;
  defaultPass: string;
  container: StartedTestContainer;
}

/**
 * ADR-0020 isolated 模式：以 admin 連線建立專屬隔離使用者並授予 schema 權限。
 * 使用者已存在則跳過（重複執行不出錯）。
 * - postgresql：admin 連到目標 DB，建立 role + schema 授權
 * - mysql：admin 為 root，建立 user + 對 db.* 授權（schema 忽略）
 * - mssql：admin（sa）連 master 建立 login，另連目標 DB 建立 user + db_owner
 *   + schema authorization
 */
export async function provisionIsolatedUser(
  ctx: ProvisionContext,
): Promise<IsolatedCredentials> {
  switch (ctx.dbType.toLowerCase()) {
    case 'postgresql':
    case 'postgres':
      return provisionPostgres(ctx);
    case 'mysql':
    case 'mariadb':
      return provisionMysql(ctx);
    case 'mssql':
    case 'sqlserver':
      return provisionMssql(ctx);
    default:
      throw new Error(`provisionIsolatedUser: unsupported dbType '${ctx.dbType}'`);
  }
}

async function provisionPostgres(ctx: ProvisionContext): Promise<IsolatedCredentials> {
  const admin = await createPostgresDataSource({
    host: ctx.host,
    port: ctx.port,
    database: ctx.dbName,
    username: ctx.adminUser,
    password: ctx.adminPass,
  });
  try {
    const exists = await queryScalar(admin, `SELECT 1 FROM pg_roles WHERE rolname = '${ISOLATED_USER}'`);
    if (exists == null) {
      await runSql(admin, [
        `CREATE USER "${ISOLATED_USER}" WITH PASSWORD '${ISOLATED_PASS}';`,
        `GRANT CONNECT ON DATABASE "${ctx.dbName}" TO "${ISOLATED_USER}";`,
        `GRANT ALL PRIVILEGES ON DATABASE "${ctx.dbName}" TO "${ISOLATED_USER}";`,
        `GRANT ALL ON SCHEMA public TO "${ISOLATED_USER}";`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${ISOLATED_USER}";`,
      ]);
    }
    if (ctx.schema) {
      await runSql(admin, [
        `CREATE SCHEMA IF NOT EXISTS "${ctx.schema}";`,
        `GRANT ALL ON SCHEMA "${ctx.schema}" TO "${ISOLATED_USER}";`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA "${ctx.schema}" GRANT ALL ON TABLES TO "${ISOLATED_USER}";`,
      ]);
    }
  } finally {
    await admin.close();
  }
  return { username: ISOLATED_USER, password: ISOLATED_PASS };
}

async function provisionMysql(ctx: ProvisionContext): Promise<IsolatedCredentials> {
  const admin = await createMysqlDataSource({
    host: ctx.host,
    port: ctx.port,
    database: ctx.dbName,
    username: ctx.adminUser,
    password: ctx.adminPass,
  });
  try {
    const exists = await queryScalar(
      admin,
      `SELECT 1 FROM mysql.user WHERE User = '${ISOLATED_USER}'`,
    );
    if (exists == null) {
      await runSql(admin, [
        `CREATE USER '${ISOLATED_USER}'@'%' IDENTIFIED BY '${ISOLATED_PASS}';`,
        `GRANT ALL PRIVILEGES ON \`${ctx.dbName}\`.* TO '${ISOLATED_USER}'@'%';`,
        'FLUSH PRIVILEGES;',
      ]);
    }
  } finally {
    await admin.close();
  }
  return { username: ISOLATED_USER, password: ISOLATED_PASS };
}

async function provisionMssql(ctx: ProvisionContext): Promise<IsolatedCredentials> {
  const master = await createMssqlDataSource({
    host: ctx.host,
    port: ctx.port,
    database: 'master',
    username: ctx.adminUser,
    password: ctx.adminPass,
  });
  try {
    await runSql(master, [
      `IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '${ISOLATED_USER}') ` +
        `CREATE LOGIN [${ISOLATED_USER}] WITH PASSWORD = '${ISOLATED_PASS}';`,
    ]);
  } finally {
    await master.close();
  }

  const db = await createMssqlDataSource({
    host: ctx.host,
    port: ctx.port,
    database: ctx.dbName,
    username: ctx.adminUser,
    password: ctx.adminPass,
  });
  try {
    await runSql(db, [
      `IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${ISOLATED_USER}') ` +
        `CREATE USER [${ISOLATED_USER}] FOR LOGIN [${ISOLATED_USER}];`,
      `ALTER ROLE db_owner ADD MEMBER [${ISOLATED_USER}];`,
    ]);
    if (ctx.schema) {
      // T-SQL 規定 CREATE SCHEMA 必須是 batch 第一句，不能包在 IF NOT EXISTS 內。
      // 先查 sys.schemas，不存在才單獨執行 CREATE SCHEMA（與 createIsolatedUserForDatabase 一致）。
      const exists = await queryScalar(
        db,
        `SELECT 1 FROM sys.schemas WHERE name = '${ctx.schema}'`,
      );
      if (exists == null) {
        await runSql(db, [
          `CREATE SCHEMA [${ctx.schema}] AUTHORIZATION [${ISOLATED_USER}];`,
          `ALTER USER [${ISOLATED_USER}] WITH DEFAULT_SCHEMA = [${ctx.schema}];`,
        ]);
      } else {
        await runSql(db, [`ALTER USER [${ISOLATED_USER}] WITH DEFAULT_SCHEMA = [${ctx.schema}];`]);
      }
    }
  } finally {
    await db.close();
  }
  return { username: ISOLATED_USER, password: ISOLATED_PASS };
}

/** 依序執行多個 SQL 語句（用於 isolated 模式授權）。 */
async function runSql(ds: DataSource, statements: string[]): Promise<void> {
  const conn = ds.getConnection();
  try {
    for (const sql of statements) {
      await conn.execute(sql);
    }
  } finally {
    conn.close();
  }
}

/** 查詢單一純量值（不存在時回傳 null）。 */
async function queryScalar(ds: DataSource, sql: string): Promise<unknown> {
  const conn = ds.getConnection();
  try {
    const result = await conn.execute(sql);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return Object.values(row)[0] ?? null;
  } finally {
    conn.close();
  }
}

/**
 * 啟動一個資料庫 Testcontainer 並回傳連線資訊（不建立 DataSource）。
 * 供多資料庫 / 多 DataSource 情境（permission-isolation、fk-dependency-sorting）
 * 在單一容器上建立多個資料庫與隔離使用者。
 */
export async function startContainer(dbType: string): Promise<ContainerInfo> {
  switch (dbType.toLowerCase()) {
    case 'postgresql':
    case 'postgres':
      return startPostgresContainer();
    case 'mysql':
    case 'mariadb':
      return startMysqlContainer();
    case 'mssql':
    case 'sqlserver':
      return startMssqlContainer();
    default:
      throw new Error(`startContainer: unsupported dbType '${dbType}'`);
  }
}

/** 停止容器（釋放資源）。 */
export async function stopContainer(info: ContainerInfo): Promise<void> {
  await info.container.stop();
}

/**
 * 在已啟動的容器上建立一個 DataSource（不綁定容器生命週期，由 caller 管理）。
 * `database` / `username` / `password` 未指定時使用容器預設值。
 */
export async function createDataSourceForContainer(
  info: ContainerInfo,
  opts: {
    database?: string;
    username?: string;
    password?: string;
    schema?: string | null;
  } = {},
): Promise<DataSource> {
  const database = opts.database ?? info.dbName;
  const username = opts.username ?? info.defaultUser;
  const password = opts.password ?? info.defaultPass;
  const schema = opts.schema ?? null;
  switch (info.dbType) {
    case 'postgresql':
    case 'postgres':
      return createPostgresDataSource(
        { host: info.host, port: info.port, database, username, password },
        schema,
      );
    case 'mysql':
    case 'mariadb':
      return createMysqlDataSource({ host: info.host, port: info.port, database, username, password });
    case 'mssql':
    case 'sqlserver':
      return createMssqlDataSource({ host: info.host, port: info.port, database, username, password });
    default:
      throw new Error(`createDataSourceForContainer: unsupported dbType '${info.dbType}'`);
  }
}

/**
 * 在已啟動的容器上建立資料庫（冪等）。MySQL 以 root 建立並授權預設使用者
 * （shared 模式跨庫存取需要）；MSSQL 連 master 建立。
 */
export async function createDatabase(
  info: ContainerInfo,
  dbType: string,
  databaseName: string,
): Promise<void> {
  const lower = dbType.toLowerCase();
  if (lower === 'postgresql' || lower === 'postgres') {
    const admin = await createPostgresDataSource({
      host: info.host,
      port: info.port,
      database: info.dbName,
      username: info.adminUser,
      password: info.adminPass,
    });
    try {
      const exists = await queryScalar(
        admin,
        `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`,
      );
      if (exists == null) {
        await runSql(admin, [`CREATE DATABASE "${databaseName}"`]);
      }
    } finally {
      await admin.close();
    }
    return;
  }

  if (lower === 'mysql' || lower === 'mariadb') {
    const admin = await createMysqlDataSource({
      host: info.host,
      port: info.port,
      database: info.dbName,
      username: info.adminUser,
      password: info.adminPass,
    });
    try {
      const exists = await queryScalar(
        admin,
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = '${databaseName}'`,
      );
      if (exists == null) {
        await runSql(admin, [`CREATE DATABASE \`${databaseName}\``]);
        if (info.defaultUser && info.defaultUser !== info.adminUser) {
          await runSql(admin, [
            `GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${info.defaultUser}'@'%';`,
            'FLUSH PRIVILEGES;',
          ]);
        }
      }
    } finally {
      await admin.close();
    }
    return;
  }

  if (lower === 'mssql' || lower === 'sqlserver') {
    const admin = await createMssqlDataSource({
      host: info.host,
      port: info.port,
      database: 'master',
      username: info.adminUser,
      password: info.adminPass,
    });
    try {
      const exists = await queryScalar(
        admin,
        `SELECT 1 FROM sys.databases WHERE name = '${databaseName}'`,
      );
      if (exists == null) {
        await runSql(admin, [`CREATE DATABASE [${databaseName}]`]);
      }
    } finally {
      await admin.close();
    }
    return;
  }

  throw new Error(`createDatabase: unsupported dbType '${dbType}'`);
}

/**
 * 在已啟動的容器上為指定資料庫建立專屬隔離使用者（user_{databaseName}），
 * 僅授權該資料庫（冪等）。回傳隔離使用者憑證。比照 C# DatabaseContainerFactory
 * CreateIsolatedUserForDatabase（csharp-0005 §3）。
 */
export async function createIsolatedUserForDatabase(
  info: ContainerInfo,
  dbType: string,
  databaseName: string,
  schema?: string | null,
): Promise<IsolatedCredentials> {
  const lower = dbType.toLowerCase();
  const username = `user_${databaseName}`;
  const password = `Pass_${databaseName}!0`;

  if (lower === 'postgresql' || lower === 'postgres') {
    const admin = await createPostgresDataSource({
      host: info.host,
      port: info.port,
      database: info.dbName,
      username: info.adminUser,
      password: info.adminPass,
    });
    try {
      const exists = await queryScalar(
        admin,
        `SELECT 1 FROM pg_roles WHERE rolname = '${username}'`,
      );
      if (exists == null) {
        await runSql(admin, [
          `CREATE USER "${username}" WITH PASSWORD '${password}';`,
          `REVOKE CONNECT ON DATABASE "${databaseName}" FROM PUBLIC;`,
          `GRANT CONNECT ON DATABASE "${databaseName}" TO "${username}";`,
          `GRANT ALL PRIVILEGES ON DATABASE "${databaseName}" TO "${username}";`,
        ]);
      }
      // schema 建立與授權每次執行（本身冪等），即使使用者已存在也重新授權，
      // 與 provisionPostgres 的語意一致。
      const db = await createPostgresDataSource({
        host: info.host,
        port: info.port,
        database: databaseName,
        username: info.adminUser,
        password: info.adminPass,
      });
      try {
        await runSql(db, [
          `GRANT ALL ON SCHEMA public TO "${username}";`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${username}";`,
        ]);
        if (schema) {
          await runSql(db, [
            `CREATE SCHEMA IF NOT EXISTS "${schema}";`,
            `GRANT ALL ON SCHEMA "${schema}" TO "${username}";`,
            `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON TABLES TO "${username}";`,
          ]);
        }
      } finally {
        await db.close();
      }
    } finally {
      await admin.close();
    }
    return { username, password };
  }

  if (lower === 'mysql' || lower === 'mariadb') {
    const admin = await createMysqlDataSource({
      host: info.host,
      port: info.port,
      database: info.dbName,
      username: info.adminUser,
      password: info.adminPass,
    });
    try {
      const exists = await queryScalar(
        admin,
        `SELECT 1 FROM mysql.user WHERE User = '${username}'`,
      );
      if (exists == null) {
        await runSql(admin, [
          `CREATE USER '${username}'@'%' IDENTIFIED BY '${password}';`,
          `GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${username}'@'%';`,
          'FLUSH PRIVILEGES;',
        ]);
      }
    } finally {
      await admin.close();
    }
    return { username, password };
  }

  if (lower === 'mssql' || lower === 'sqlserver') {
    const master = await createMssqlDataSource({
      host: info.host,
      port: info.port,
      database: 'master',
      username: info.adminUser,
      password: info.adminPass,
    });
    try {
      await runSql(master, [
        `IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '${username}') ` +
          `CREATE LOGIN [${username}] WITH PASSWORD = '${password}';`,
      ]);
    } finally {
      await master.close();
    }

    const db = await createMssqlDataSource({
      host: info.host,
      port: info.port,
      database: databaseName,
      username: info.adminUser,
      password: info.adminPass,
    });
    try {
      await runSql(db, [
        `IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${username}') ` +
          `CREATE USER [${username}] FOR LOGIN [${username}];`,
        `ALTER ROLE db_owner ADD MEMBER [${username}];`,
      ]);
      if (schema) {
        const exists = await queryScalar(
          db,
          `SELECT 1 FROM sys.schemas WHERE name = '${schema}'`,
        );
        if (exists == null) {
          await runSql(db, [
            `CREATE SCHEMA [${schema}] AUTHORIZATION [${username}];`,
            `ALTER USER [${username}] WITH DEFAULT_SCHEMA = [${schema}];`,
          ]);
        } else {
          await runSql(db, [`ALTER USER [${username}] WITH DEFAULT_SCHEMA = [${schema}];`]);
        }
      }
    } finally {
      await db.close();
    }
    return { username, password };
  }

  throw new Error(`createIsolatedUserForDatabase: unsupported dbType '${dbType}'`);
}

/**
 * Factory for creating DataSource instances backed by Testcontainers.
 *
 * ADR-0028 hard rename：db_type 'h2' 已語言中立化為 'embedded'，不保留 alias。
 *
 * - 'embedded' / undefined / unknown → in-memory SqliteDataSource (no container)
 * - 'postgresql' / 'postgres'        → starts postgres container
 * - 'mysql' / 'mariadb'              → starts mysql container
 * - 'mssql' / 'sqlserver'            → starts mssql container
 *
 * 未知 db_type 仍 fallback 至 SqliteDataSource，但 caller 應已由 IsaSpecReader
 * 之 VALID_DB_TYPES 於啟動期攔下；本層僅為 defensive default。
 *
 * ADR-0020：`permission: 'isolated'` 時以 admin 連線建立專屬使用者並授予 schema
 * 權限（PostgreSQL / MSSQL / MySQL），使用者已存在則跳過；`schema` 傳給
 * `createPostgresDataSource` 套用 search_path（MSSQL 依隔離使用者 DEFAULT_SCHEMA）。
 */
export async function createContainer(
  dbType: string | undefined,
  options: ContainerOptions = {},
): Promise<DataSource> {
  const schema = options.schema ?? null;
  const isolated = options.permission === 'isolated';
  const onProvisioned = options.onProvisioned;
  const lower = dbType?.toLowerCase();

  if (lower === 'embedded' || lower === undefined || lower === '') {
    return new SqliteDataSource();
  }
  if (
    lower !== 'postgresql' &&
    lower !== 'postgres' &&
    lower !== 'mysql' &&
    lower !== 'mariadb' &&
    lower !== 'mssql' &&
    lower !== 'sqlserver'
  ) {
    return new SqliteDataSource();
  }

  const info = await startContainer(lower);

  if (isolated) {
    // MSSQL image 無建庫 env，目標 DB（info.dbName）需先由 admin 建立，否則
    // provisionMssql 與最終連線都會因 DB 不存在而失敗。postgres/mysql 由容器
    // 啟動環境已建立預設 DB，不需額外處理。
    if (lower === 'mssql' || lower === 'sqlserver') {
      await createDatabase(info, lower, info.dbName);
    }
    const ctx: ProvisionContext = {
      dbType: info.dbType,
      host: info.host,
      port: info.port,
      dbName: info.dbName,
      adminUser: info.adminUser,
      adminPass: info.adminPass,
      schema,
    };
    onProvisioned?.(ctx);
    const creds = await provisionIsolatedUser(ctx);
    return wrapWithLifecycle(
      await createDataSourceForContainer(info, {
        database: info.dbName,
        username: creds.username,
        password: creds.password,
        schema,
      }),
      info.container,
    );
  }

  // shared 模式：MSSQL 以 sa 連 master；其餘以容器預設使用者連預設 DB。
  const database = lower === 'mssql' || lower === 'sqlserver' ? 'master' : info.dbName;
  return wrapWithLifecycle(
    await createDataSourceForContainer(info, {
      database,
      username: info.defaultUser,
      password: info.defaultPass,
      schema,
    }),
    info.container,
  );
}

async function startPostgresContainer(): Promise<ContainerInfo> {
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_DB: DEFAULT_DB,
      POSTGRES_USER: DEFAULT_USER,
      POSTGRES_PASSWORD: DEFAULT_PASS,
    })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  return {
    dbType: 'postgresql',
    host: container.getHost(),
    port: container.getMappedPort(POSTGRES_PORT),
    dbName: DEFAULT_DB,
    adminUser: DEFAULT_USER,
    adminPass: DEFAULT_PASS,
    defaultUser: DEFAULT_USER,
    defaultPass: DEFAULT_PASS,
    container,
  };
}

async function startMysqlContainer(): Promise<ContainerInfo> {
  const container = await new GenericContainer(MYSQL_IMAGE)
    .withEnvironment({
      MYSQL_DATABASE: DEFAULT_DB,
      MYSQL_USER: DEFAULT_USER,
      MYSQL_PASSWORD: DEFAULT_PASS,
      MYSQL_ROOT_PASSWORD: DEFAULT_PASS,
    })
    .withExposedPorts(MYSQL_PORT)
    .withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306/, 1))
    .start();

  return {
    dbType: 'mysql',
    host: container.getHost(),
    port: container.getMappedPort(MYSQL_PORT),
    dbName: DEFAULT_DB,
    adminUser: 'root',
    adminPass: DEFAULT_PASS,
    defaultUser: DEFAULT_USER,
    defaultPass: DEFAULT_PASS,
    container,
  };
}

async function startMssqlContainer(): Promise<ContainerInfo> {
  const container = await new GenericContainer(MSSQL_IMAGE)
    .withEnvironment({
      ACCEPT_EULA: 'Y',
      MSSQL_SA_PASSWORD: MSSQL_SA_PASS,
    })
    .withExposedPorts(MSSQL_PORT)
    .withWaitStrategy(Wait.forLogMessage(/SQL Server is now ready for client connections/, 1))
    .start();

  const info: ContainerInfo = {
    dbType: 'mssql',
    host: container.getHost(),
    port: container.getMappedPort(MSSQL_PORT),
    dbName: DEFAULT_DB,
    adminUser: 'sa',
    adminPass: MSSQL_SA_PASS,
    defaultUser: 'sa',
    defaultPass: MSSQL_SA_PASS,
    container,
  };

  // SQL Server 在 log「ready for client connections」後仍可能短暫拒絕 SA 登入
  // （Login failed for user 'sa'）。輪詢連線直到可登入，避免測試啟動即失敗。
  await waitForMssqlReady(info);

  return info;
}

/** 輪詢 mssql 容器直到 SA 登入成功（最多 ~60s）。 */
async function waitForMssqlReady(info: ContainerInfo): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastErr: Error | undefined;
  while (Date.now() < deadline) {
    try {
      const ds = await createMssqlDataSource({
        host: info.host,
        port: info.port,
        database: 'master',
        username: info.adminUser,
        password: info.adminPass,
      });
      await ds.close();
      return;
    } catch (e) {
      lastErr = e as Error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(
    `MSSQL container did not accept SA login within 60s: ${lastErr?.message ?? 'unknown error'}`,
  );
}

/**
 * Wraps a DataSource so its `close()` also stops the underlying container.
 */
function wrapWithLifecycle(ds: DataSource, container: StartedTestContainer): DataSource {
  return {
    getConnection: () => ds.getConnection(),
    close: async () => {
      try {
        await ds.close();
      } finally {
        await container.stop();
      }
    },
  };
}
