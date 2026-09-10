// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TestcontainerSchemaStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TestcontainerSchemaStepDefs.ts
import { Given, When, Then, After, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert';
import {
  startContainer,
  stopContainer,
  createDataSourceForContainer,
  type ContainerInfo,
} from '@specformula/testcontainer';
import type { DataSource } from '@specformula/node';

// 真實 Testcontainer 啟動可能超過預設 5s，放寬至 120s。
setDefaultTimeout(120_000);

/**
 * ADR-0020 真實 DB 整合測試（@slow）— schema routing step definitions
 * （csharp-0005 §2 / ts-0011 §4）。啟動真實 PostgreSQL Testcontainer，
 * 以 admin 建立 schema，再以套用 search_path 的連線工廠驗證未限定 schema
 * 名稱的 SQL 操作落於指定 schema。僅由 `test:bdd:slow` 執行（需 Docker）。
 */
interface SchemaRoutingWorld {
  _srInfo?: ContainerInfo;
  _srDs?: DataSource;
}

function getWorld(this_: unknown): SchemaRoutingWorld {
  return this_ as SchemaRoutingWorld;
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

// 每個 scenario 結束後停止容器並關閉連線，避免容器外洩。
After(async function () {
  const w = getWorld(this);
  if (w._srDs) {
    await w._srDs.close();
    w._srDs = undefined;
  }
  if (w._srInfo) {
    await stopContainer(w._srInfo);
    w._srInfo = undefined;
  }
});

Given('啟動 PostgreSQL container', async function () {
  const w = getWorld(this);
  assert.ok(!w._srInfo, 'A container is already started for this scenario');
  w._srInfo = await startContainer('postgresql');
});

Given('建立 schema {string}', async function (schema: string) {
  const w = getWorld(this);
  assert.ok(w._srInfo, 'Expected a started container');
  const admin = await createDataSourceForContainer(w._srInfo, { database: w._srInfo.dbName });
  try {
    await runSqlBlock(admin, `CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    await admin.close();
  }
});

Given('使用 schema {string} 建立連線工廠', async function (schema: string) {
  const w = getWorld(this);
  assert.ok(w._srInfo, 'Expected a started container');
  assert.ok(!w._srDs, 'A connection factory already exists for this scenario');
  // createPostgresDataSource 以 search_path 套用 schema（ADR-0020 §4）。
  w._srDs = await createDataSourceForContainer(w._srInfo, {
    database: w._srInfo.dbName,
    schema,
  });
});

Given('使用無 schema 的連線工廠', async function () {
  const w = getWorld(this);
  assert.ok(w._srInfo, 'Expected a started container');
  assert.ok(!w._srDs, 'A connection factory already exists for this scenario');
  w._srDs = await createDataSourceForContainer(w._srInfo, { database: w._srInfo.dbName });
});

When('在連線上執行 SQL:', async function (docString: string) {
  const w = getWorld(this);
  assert.ok(w._srDs, 'Expected a connection factory');
  await runSqlBlock(w._srDs, docString.trim());
});

Then('查詢 {string} 應回傳 {string}', async function (sql: string, expected: string) {
  const w = getWorld(this);
  assert.ok(w._srDs, 'Expected a connection factory');
  const conn = w._srDs.getConnection();
  try {
    const result = await conn.execute(sql);
    assert.ok(result.rows.length > 0, `Expected scalar result from "${sql}" but got no rows`);
    const actual = String(Object.values(result.rows[0])[0]);
    assert.strictEqual(actual, expected, `Expected "${expected}" from "${sql}" but got "${actual}"`);
  } finally {
    conn.close();
  }
});

Then('以 admin 連線查詢 {string} schema 應存在資料表 {string}', async function (schema: string, table: string) {
  const w = getWorld(this);
  assert.ok(w._srInfo, 'Expected a started container');
  const admin = await createDataSourceForContainer(w._srInfo, { database: w._srInfo.dbName });
  try {
    const result = await admin.getConnection().execute(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}'`,
    );
    assert.ok(
      result.rows.length > 0,
      `Expected table "${table}" to exist in schema "${schema}"`,
    );
  } finally {
    await admin.close();
  }
});

Then('以 admin 連線查詢 {string} schema 不應存在資料表 {string}', async function (schema: string, table: string) {
  const w = getWorld(this);
  assert.ok(w._srInfo, 'Expected a started container');
  const admin = await createDataSourceForContainer(w._srInfo, { database: w._srInfo.dbName });
  try {
    const result = await admin.getConnection().execute(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}'`,
    );
    assert.ok(
      result.rows.length === 0,
      `Expected table "${table}" NOT to exist in schema "${schema}"`,
    );
  } finally {
    await admin.close();
  }
});
