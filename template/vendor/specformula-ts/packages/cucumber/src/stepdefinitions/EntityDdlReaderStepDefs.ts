// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntityDdlReaderStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntityDdlReaderStepDefs.ts
import { Given, When, Then } from '@cucumber/cucumber';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert';
import {
  EntityDdlReader,
  TableDefinition,
  SpecFormulaError,
  buildErrorFromRegistry,
} from '@specformula/core';
import type { DatabaseSchema } from '@specformula/core';
import { parseJsonObject } from '@specformula/core';

/**
 * 將 SpecFormulaError 之 details 中所有等於 `tmpDir` 之字串值替換為 `logical`。
 * 用於 spec-reader BDD：features 假設 path / directory 為 stable logical path
 * （e.g. `/test/data/`），但 step def 實際以 mkdtempSync 之 host tmp 隔離。
 */
function maskTmpDir(e: unknown, tmpDir: string, logical: string): Error {
  if (!(e instanceof SpecFormulaError)) {
    return e instanceof Error ? e : new Error(String(e));
  }
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e.details)) {
    masked[k] = v === tmpDir ? logical : v;
  }
  return buildErrorFromRegistry(e.code, masked);
}

interface EntityDdlWorld {
  _ddlTmpDir?: string;
  _ddlDataSourceConfig?: { name: string; db_type: string };
  _ddlSchema?: DatabaseSchema;
  _ddlError?: Error;
  _ddlTableDef?: TableDefinition;
}

function getWorld(this_: unknown): EntityDdlWorld {
  return this_ as EntityDdlWorld;
}

function ensureTmpDir(world: EntityDdlWorld): string {
  if (!world._ddlTmpDir) {
    world._ddlTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specformula-ddl-'));
  }
  return world._ddlTmpDir;
}

export function parseDataSourceConfigJson(source: string): { name: string; db_type: string } {
  const config = parseJsonObject(source, 'data source config');
  const name = config['name'];
  const dbType = config['db_type'];
  if (typeof name !== 'string' || typeof dbType !== 'string') {
    throw new Error('invalid data source config');
  }
  return { name, db_type: dbType };
}

Given('spec.data IsaDataSourceConfig 為:', function (docString: string) {
  const w = getWorld(this);
  const config = parseDataSourceConfigJson(docString.trim());
  w._ddlDataSourceConfig = config;
  // Reset tmp dir for each new config
  w._ddlTmpDir = undefined;
  w._ddlSchema = undefined;
  w._ddlError = undefined;
  w._ddlTableDef = undefined;
});

Given('spec.data 資料目錄下存在檔案 {string}:', function (filename: string, content: string) {
  const w = getWorld(this);
  const dir = ensureTmpDir(w);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
});

Given('spec.data 資料目錄是空目錄', function () {
  const w = getWorld(this);
  ensureTmpDir(w);
  w._ddlSchema = undefined;
  w._ddlError = undefined;
});

Given(
  'spec.data TableDefinition 為 {string} 包含欄位:',
  function (tableName: string, dataTable: { hashes: () => Array<Record<string, string>> }) {
    const w = getWorld(this);
    const rows = dataTable.hashes();
    const columns = rows.map((row) => ({
      name: row['name'],
      type: row['type'],
      primaryKey: row['primaryKey'] === 'true',
      autoIncrement: row['autoIncrement'] === 'true',
      notNull: false,
      unique: false,
      defaultValue: null,
      foreignKey: null,
      checkConstraint: null,
      comment: null,
    }));
    const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);
    const queryColumns = columns.filter((c) => !c.primaryKey).map((c) => c.name);

    // Strip surrounding quotes from tableName (e.g. '"order"' -> '"order"' stays as-is in SQL)
    // The table name passed includes the quotes literally for quoted-identifier tests
    w._ddlTableDef = new TableDefinition({
      tableName,
      comment: null,
      columns,
      pkColumns,
      queryColumns,
    });
  },
);

When('spec.data 讀取 Entity DDL', function () {
  const w = getWorld(this);
  const cfg = w._ddlDataSourceConfig!;
  const dir = ensureTmpDir(w);
  const reader = new EntityDdlReader({
    name: cfg.name,
    resource_path: dir,
    db_type: cfg.db_type,
  });
  try {
    w._ddlSchema = reader.read();
    w._ddlError = undefined;
  } catch (e: unknown) {
    // ADR-0026 §6.1：跨語言 feature 假設 `directory` 為 stable logical path
    // （/test/data/）；但 step def 為隔離測試用 mkdtempSync 之 host tmp dir。
    // 攔截後以 logical path 重建 SpecFormulaError 之 details，保留 code / category。
    w._ddlError = maskTmpDir(e, dir, '/test/data/');
    w._ddlSchema = undefined;
  }
});

When(
  'spec.data 設定查詢欄位為:',
  function (dataTable: { hashes: () => Array<Record<string, string>> }) {
    const w = getWorld(this);
    const rows = dataTable.hashes();
    const cols = rows.map((r) => r['column']).filter(Boolean);
    w._ddlTableDef!.setQueryColumns(cols);
  },
);

When('spec.data 新增欄位 {string} 類型 {string}', function (column: string, type: string) {
  const w = getWorld(this);
  w._ddlTableDef!.addColumn(column, type);
});

Then('spec.data DatabaseSchema 的解析結果為:', function (docString: string) {
  const w = getWorld(this);
  assert.ok(w._ddlSchema, `Expected DatabaseSchema but got error: ${w._ddlError?.message}`);
  const expected = JSON.parse(docString.trim());
  const actual = JSON.parse(JSON.stringify(w._ddlSchema));
  assert.deepStrictEqual(actual, expected);
});

Then('spec.data 解析應拋出例外訊息包含 {string}', function (keyword: string) {
  const w = getWorld(this);
  assert.ok(
    w._ddlError,
    `Expected an error containing "${keyword}" but no error was thrown`,
  );
  assert.ok(
    w._ddlError.message.includes(keyword),
    `Expected error message to contain "${keyword}" but got: "${w._ddlError.message}"`,
  );
});

Then('spec.data selectSql 應為:', function (docString: string) {
  const w = getWorld(this);
  const expected = docString.trim();
  assert.strictEqual(w._ddlTableDef!.selectSql, expected);
});

Then('spec.data selectByValuesSql 應為:', function (docString: string) {
  const w = getWorld(this);
  const expected = docString.trim();
  assert.strictEqual(w._ddlTableDef!.selectByValuesSql, expected);
});

Then(
  'spec.data selectByValuesIndex 應包含:',
  function (dataTable: { hashes: () => Array<Record<string, string>> }) {
    const w = getWorld(this);
    const rows = dataTable.hashes();
    const index = w._ddlTableDef!.selectByValuesIndex;
    for (const row of rows) {
      const col = row['column'];
      const expectedIndices = row['indices'].split(',').map((s) => parseInt(s.trim(), 10));
      const actualIndices = index.get(col);
      assert.ok(actualIndices, `selectByValuesIndex should contain column "${col}"`);
      assert.deepStrictEqual(actualIndices, expectedIndices);
    }
  },
);

Then('spec.data selectWhereColumnIndex 大小應為 {int}', function (n: number) {
  const w = getWorld(this);
  assert.strictEqual(w._ddlTableDef!.selectWhereColumnIndex.size, n);
});

Then('spec.data selectWhereColumnIndex 應包含 {string}', function (column: string) {
  const w = getWorld(this);
  assert.ok(
    w._ddlTableDef!.selectWhereColumnIndex.has(column),
    `selectWhereColumnIndex should contain "${column}"`,
  );
});

Then('spec.data selectSql 應包含 {string}', function (substring: string) {
  const w = getWorld(this);
  assert.ok(
    w._ddlTableDef!.selectSql.includes(substring),
    `selectSql "${w._ddlTableDef!.selectSql}" should include "${substring}"`,
  );
});
