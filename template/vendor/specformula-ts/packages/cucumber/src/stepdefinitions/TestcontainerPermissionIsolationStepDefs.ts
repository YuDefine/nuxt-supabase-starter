// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TestcontainerPermissionIsolationStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TestcontainerPermissionIsolationStepDefs.ts
import { Given, When, Then, After, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert';
import {
  startContainer,
  stopContainer,
  createContainer,
  createDataSourceForContainer,
  createDatabase,
  createIsolatedUserForDatabase,
  type ContainerInfo,
  type IsolatedCredentials,
} from '@specformula/testcontainer';
import type { DataSource } from '@specformula/node';

// 真實 Testcontainer 啟動可能超過預設 5s，放寬至 120s。
setDefaultTimeout(120_000);

/**
 * ADR-0020 真實 DB 整合測試（@slow）— permission isolation step definitions
 * （csharp-0005 §3 / ts-0011 §4）。以 isa.yml 驅動，在單一容器上建立多個
 * 資料庫與 per-db 隔離使用者，驗證 isolated（無法跨庫）與 shared（可跨庫）
 * 行為。僅由 `test:bdd:slow` 執行（需 Docker）。
 */
interface PermissionIsolationWorld {
  _piIsaYaml?: string;
  _piInfo?: ContainerInfo;
  _piDbType?: string;
  _piIsolated?: boolean;
  _piDataSources: Record<string, DataSource>;
  _piCredentials: Record<string, IsolatedCredentials>;
  _piLastErr?: Error;
  _piQuerySuccess?: boolean;
}

function getWorld(this_: unknown): PermissionIsolationWorld {
  const w = this_ as PermissionIsolationWorld;
  if (!w._piDataSources) w._piDataSources = {};
  if (!w._piCredentials) w._piCredentials = {};
  return w;
}

/** 以 ';' 分割並逐句執行 SQL 區塊。 */
async function runSqlBlock(ds: DataSource, sqlBlock: string): Promise<void> {
  const conn = ds.getConnection();
  try {
    for (const stmt of sqlBlock.split(';')) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      await conn.execute(trimmed);
    }
  } finally {
    conn.close();
  }
}

// 每個 scenario 結束後關閉所有 DataSource 並停止容器，避免容器外洩。
After(async function () {
  const w = getWorld(this);
  for (const ds of Object.values(w._piDataSources)) {
    try {
      await ds.close();
    } catch {
      // ignore per-ds close errors
    }
  }
  w._piDataSources = {};
  if (w._piInfo) {
    await stopContainer(w._piInfo);
    w._piInfo = undefined;
  }
});

Given('存在一個 isa.yml 檔:', function (docString: string) {
  const w = getWorld(this);
  w._piIsaYaml = docString;
  w._piIsolated = docString.includes('permission: isolated');
  const dbTypeMatch = /db_type:\s*(\w+)/.exec(docString);
  w._piDbType = dbTypeMatch ? dbTypeMatch[1] : undefined;
});

Given('啟動 Testcontainer 並建立所有 DataSource', async function () {
  const w = getWorld(this);
  assert.ok(w._piDbType, 'Expected db_type parsed from isa.yml');
  assert.ok(w._piIsaYaml, 'Expected isa.yml to be provided first');
  w._piInfo = await startContainer(w._piDbType);

  // 從 isa.yml 解析 source 名稱（data source 區塊的 `- name:`）。
  const sourceNames = [...w._piIsaYaml.matchAll(/-\s+name:\s*(\w+)/g)].map((m) => m[1]);

  for (const name of sourceNames) {
    await createDatabase(w._piInfo, w._piDbType, name);

    if (w._piIsolated) {
      // 在既有容器上為此資料庫建立專屬隔離使用者（user_{name}）。
      const creds = await createIsolatedUserForDatabase(w._piInfo, w._piDbType, name);
      w._piCredentials[name] = creds;
      w._piDataSources[name] = await createDataSourceForContainer(w._piInfo, {
        database: name,
        username: creds.username,
        password: creds.password,
      });
    } else {
      // shared 模式：使用容器預設使用者（可跨庫存取）。
      w._piCredentials[name] = {
        username: w._piInfo.defaultUser,
        password: w._piInfo.defaultPass,
      };
      w._piDataSources[name] = await createDataSourceForContainer(w._piInfo, {
        database: name,
        username: w._piInfo.defaultUser,
        password: w._piInfo.defaultPass,
      });
    }
  }
});

Given('啟動 embedded DataSource', function () {
  // embedded（SQLite in-memory）無跨庫概念；此 scenario 標記 @ignore，不執行。
  throw new Error('embedded (SQLite) DataSource is not supported in this step set');
});

// 直接走 createContainer 的 isolated 路徑（issue #451 故障處：MSSQL 建庫 / CREATE SCHEMA / 密碼政策）。
// 回傳的 DataSource 由 wrapWithLifecycle 綁定容器生命週期，close() 即停止容器。
Given('以 createContainer 建立 {string} isolated DataSource 於 schema {string}', async function (dbType: string, schema: string) {
  const w = getWorld(this);
  w._piDataSources['main'] = await createContainer(dbType, {
    permission: 'isolated',
    schema,
  });
});

Given('以 createContainer 建立 {string} isolated DataSource', async function (dbType: string) {
  const w = getWorld(this);
  w._piDataSources['main'] = await createContainer(dbType, {
    permission: 'isolated',
  });
});

Given('在 {string} 執行 SQL:', async function (dsName: string, docString: string) {
  const w = getWorld(this);
  const ds = w._piDataSources[dsName];
  assert.ok(ds, `Expected a DataSource named "${dsName}"`);
  await runSqlBlock(ds, docString.trim());
});

When('使用 {string} 的連線查詢 {string}', async function (dsName: string, sql: string) {
  const w = getWorld(this);
  w._piLastErr = undefined;
  w._piQuerySuccess = false;
  const ds = w._piDataSources[dsName];
  assert.ok(ds, `Expected a DataSource named "${dsName}"`);
  try {
    const conn = ds.getConnection();
    try {
      await conn.execute(sql);
    } finally {
      conn.close();
    }
    w._piQuerySuccess = true;
  } catch (e) {
    w._piLastErr = e as Error;
  }
});

When('使用 {string} 的憑證連線到 {string}', async function (fromDb: string, targetDb: string) {
  const w = getWorld(this);
  w._piLastErr = undefined;
  w._piQuerySuccess = false;
  assert.ok(w._piInfo, 'Expected a started container');
  const creds = w._piCredentials[fromDb];
  assert.ok(creds, `Expected credentials for "${fromDb}"`);
  // 建立連線本身（含 pool connect）也可能因權限不足失敗，故納入 try 以擷取錯誤。
  try {
    const ds = await createDataSourceForContainer(w._piInfo, {
      database: targetDb,
      username: creds.username,
      password: creds.password,
    });
    try {
      const conn = ds.getConnection();
      try {
        await conn.execute('SELECT 1');
      } finally {
        conn.close();
      }
      w._piQuerySuccess = true;
    } catch (e) {
      w._piLastErr = e as Error;
    } finally {
      await ds.close();
    }
  } catch (e) {
    w._piLastErr = e as Error;
  }
});

Then('應該成功存取', function () {
  const w = getWorld(this);
  assert.ok(!w._piLastErr, `Expected query to succeed but got: ${w._piLastErr?.message}`);
  assert.ok(w._piQuerySuccess, 'Expected query to succeed');
});

Then('應該拋出權限不足的錯誤', function () {
  const w = getWorld(this);
  assert.ok(w._piLastErr, 'Expected a permission error but query succeeded');
  const message = w._piLastErr.message.toLowerCase();
  const matched =
    message.includes('permission') ||
    message.includes('denied') ||
    message.includes('authentication') ||
    message.includes('password') ||
    message.includes('login failed') ||
    message.includes('access denied') ||
    message.includes('not able to access') ||
    message.includes('does not exist');
  assert.ok(matched, `Expected a permission error but got: ${w._piLastErr.message}`);
});

Then('應該拋出資料表不存在的錯誤', function () {
  const w = getWorld(this);
  assert.ok(w._piLastErr, 'Expected a table-not-found error but query succeeded');
  const message = w._piLastErr.message.toLowerCase();
  const matched =
    message.includes('no such table') ||
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes("doesn't exist") ||
    message.includes('unknown');
  assert.ok(matched, `Expected a table-not-found error but got: ${w._piLastErr.message}`);
});
