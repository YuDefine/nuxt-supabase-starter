// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TestcontainerFkDependencySortingStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TestcontainerFkDependencySortingStepDefs.ts
import { Given, When, Then, After, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  startContainer,
  stopContainer,
  createDataSourceForContainer,
  createDatabase,
  type ContainerInfo,
} from '@specformula/testcontainer';
import { EntityDdlReader } from '@specformula/core';
import type { DataSource } from '@specformula/node';

// 真實 Testcontainer 啟動可能超過預設 5s，放寬至 120s。
setDefaultTimeout(120_000);

/**
 * ADR-0020 真實 DB 整合測試（@slow）— FK 依賴拓撲排序 step definitions
 * （csharp-0005 §4 / ts-0011 §4）。以 isa.yml 驅動，將 SQL 檔案寫入暫存目錄，
 * 以 EntityDdlReader.sortByForeignKeyDependency 排序後於真實容器執行，
 * 驗證被參考的表先建立、無 FK constraint violation。僅由 `test:bdd:slow` 執行。
 */
interface FkSortingWorld {
  _fkDbType?: string;
  _fkDsName?: string;
  _fkResourcePath?: string;
  _fkInfo?: ContainerInfo;
  _fkTempDir?: string;
  _fkSchemaException?: Error;
}

function getWorld(this_: unknown): FkSortingWorld {
  return this_ as FkSortingWorld;
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

// 每個 scenario 結束後停止容器並清理暫存目錄，避免容器外洩。
After(async function () {
  const w = getWorld(this);
  if (w._fkInfo) {
    await stopContainer(w._fkInfo);
    w._fkInfo = undefined;
  }
  if (w._fkTempDir) {
    try {
      fs.rmSync(w._fkTempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    w._fkTempDir = undefined;
  }
});

Given('存在一個 FK 測試 isa.yml:', function (docString: string) {
  const w = getWorld(this);
  const yaml = docString;
  const dbTypeMatch = /db_type:\s*(\w+)/.exec(yaml);
  w._fkDbType = dbTypeMatch ? dbTypeMatch[1] : undefined;
  const nameMatch = /name:\s*(\w+)/.exec(yaml);
  w._fkDsName = nameMatch ? nameMatch[1] : 'fktest';
  // api 區塊也有 resource_path，故比對「後接 project_path 再 db_type」的 source 區塊。
  const resourcePathMatch = /resource_path:\s*(\S+)\s*\r?\n\s*project_path:\s*\S+\s*\r?\n\s*db_type:/.exec(
    yaml,
  );
  w._fkResourcePath = resourcePathMatch ? resourcePathMatch[1] : undefined;
});

Given('存在一個 SQL 檔案 {string}:', function (filePath: string, docString: string) {
  const w = getWorld(this);
  w._fkTempDir ??= path.join(os.tmpdir(), `fk-sort-test-${randomUUID()}`);
  const fullPath = path.join(w._fkTempDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, docString);
});

When('啟動 Testcontainer 並執行 schema', async function () {
  const w = getWorld(this);
  w._fkSchemaException = undefined;
  try {
    assert.ok(w._fkDbType, 'Expected db_type parsed from isa.yml');
    assert.ok(w._fkDsName, 'Expected a data source name');
    assert.ok(w._fkResourcePath, 'Expected resource_path parsed from isa.yml');
    assert.ok(w._fkTempDir, 'Expected SQL files to be provided first');

    w._fkInfo = await startContainer(w._fkDbType);
    await createDatabase(w._fkInfo, w._fkDbType, w._fkDsName);

    const sqlDir = path.join(w._fkTempDir, w._fkResourcePath);
    const sqlFiles = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).map((f) => path.join(sqlDir, f));

    // 依 FK 依賴拓撲排序（EntityDdlReader）。
    const sortedFiles = EntityDdlReader.sortByForeignKeyDependency(sqlFiles);

    const ds = await createDataSourceForContainer(w._fkInfo, { database: w._fkDsName });
    try {
      for (const file of sortedFiles) {
        const content = fs.readFileSync(file, 'utf8');
        await runSqlBlock(ds, content);
      }
    } finally {
      await ds.close();
    }
  } catch (e) {
    w._fkSchemaException = e as Error;
  }
});

Then('應該成功建立所有表', function () {
  const w = getWorld(this);
  assert.ok(
    !w._fkSchemaException,
    `Schema 初始化失敗（FK 排序可能不正確）: ${w._fkSchemaException?.message}`,
  );
});
