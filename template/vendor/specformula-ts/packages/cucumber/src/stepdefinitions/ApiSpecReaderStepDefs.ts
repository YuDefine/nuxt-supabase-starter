// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ApiSpecReaderStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ApiSpecReaderStepDefs.ts
import { Given, When, Then } from '@cucumber/cucumber';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert';
import {
  ApiSpecReader,
  ApiSpec,
  SpecFormulaError,
  buildErrorFromRegistry,
} from '@specformula/core';
import type { ApiOperation } from '@specformula/core';

/** 同 EntityDdlReaderStepDefs maskTmpDir — 將 tmp dir 替換為 stable logical path。 */
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

interface ApiSpecWorld {
  _apiTmpDir?: string;
  _apiSpec?: ApiSpec;
  _apiError?: Error;
  _apiFoundOp?: ApiOperation | null;
}

function getWorld(this_: unknown): ApiSpecWorld {
  return this_ as ApiSpecWorld;
}

function ensureTmpDir(world: ApiSpecWorld): string {
  if (!world._apiTmpDir) {
    world._apiTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specformula-api-'));
  }
  return world._apiTmpDir;
}

Given('spec.api 目標路徑下存在檔案 {string}:', function (filename: string, content: string) {
  const w = getWorld(this);
  const dir = ensureTmpDir(w);
  const filePath = path.join(dir, filename);
  // Create subdirectories if needed
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
});

Given('spec.api 目標路徑是空目錄', function () {
  const w = getWorld(this);
  w._apiTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specformula-api-'));
  w._apiSpec = undefined;
  w._apiError = undefined;
});

Given(
  '一個 ApiSpec 包含以下 operations:',
  function (dataTable: { hashes: () => Array<Record<string, string>> }) {
    const w = getWorld(this);
    const rows = dataTable.hashes();
    const spec = new ApiSpec('3.0.0', { title: 'Test', version: '1.0', description: null });
    for (const row of rows) {
      spec.addOperation({
        method: row['method'],
        path: row['path'],
        summary: row['summary'] ?? null,
        description: null,
        operationId: null,
        tags: null,
        parameters: null,
        requestBody: null,
        responses: null,
      });
    }
    w._apiSpec = spec;
  },
);

When('spec.api 讀取 API spec', function () {
  const w = getWorld(this);
  const dir = ensureTmpDir(w);
  const reader = new ApiSpecReader(dir);
  try {
    w._apiSpec = reader.read();
    w._apiError = undefined;
  } catch (e: unknown) {
    // 同 EntityDdlReaderStepDefs maskTmpDir — feature 假設 path 為 stable logical
    // path（e.g. `/empty/api/`）
    w._apiError = maskTmpDir(e, dir, '/empty/api/');
    w._apiSpec = undefined;
  }
});

When('使用 summary {string} 搜尋', function (summary: string) {
  const w = getWorld(this);
  w._apiFoundOp = w._apiSpec!.findBySummary(summary);
});

Then('spec.api ApiSpec 的解析結果為:', function (docString: string) {
  const w = getWorld(this);
  assert.ok(w._apiSpec, `Expected ApiSpec but got error: ${w._apiError?.message}`);
  const expected = JSON.parse(docString.trim());
  const actual = JSON.parse(JSON.stringify(w._apiSpec));
  assert.deepStrictEqual(actual, expected);
});

Then('spec.api 解析應拋出例外訊息包含 {string}', function (message: string) {
  const w = getWorld(this);
  assert.ok(
    w._apiError,
    `Expected an error containing "${message}" but no error was thrown`,
  );
  assert.ok(
    w._apiError.message.includes(message),
    `Expected error message to contain "${message}" but got: "${w._apiError.message}"`,
  );
});

Then(
  '應找到 operation 的 method 為 {string} 且 path 為 {string}',
  function (method: string, pathStr: string) {
    const w = getWorld(this);
    assert.ok(w._apiFoundOp, 'Expected to find an operation but got null');
    assert.strictEqual(w._apiFoundOp.method, method);
    assert.strictEqual(w._apiFoundOp.path, pathStr);
  },
);

Then('應找不到 operation', function () {
  const w = getWorld(this);
  assert.strictEqual(w._apiFoundOp, null);
});

Then(
  'spec.api 第 {int} 個 operation 的 requestBody contentType 為 {string}',
  function (index: number, contentType: string) {
    const w = getWorld(this);
    const ops = w._apiSpec!.operations;
    const op = ops[index - 1];
    assert.ok(op, `Expected operation at index ${index}`);
    assert.strictEqual(op.requestBody?.contentType, contentType);
  },
);

Then(
  'spec.api 第 {int} 個 operation 的 response {string} contentType 為 {string}',
  function (index: number, statusCode: string, contentType: string) {
    const w = getWorld(this);
    const ops = w._apiSpec!.operations;
    const op = ops[index - 1];
    assert.ok(op, `Expected operation at index ${index}`);
    const resp = op.responses?.[statusCode];
    assert.ok(resp, `Expected response with status code ${statusCode}`);
    assert.strictEqual(resp.contentType, contentType);
  },
);

Then(
  'spec.api 第 {int} 個 operation 的 response {string} contentType 為 null',
  function (index: number, statusCode: string) {
    const w = getWorld(this);
    const ops = w._apiSpec!.operations;
    const op = ops[index - 1];
    assert.ok(op, `Expected operation at index ${index}`);
    const resp = op.responses?.[statusCode];
    assert.ok(resp, `Expected response with status code ${statusCode}`);
    assert.strictEqual(resp.contentType, null);
  },
);

Then(
  'spec.api 第 {int} 個 operation 的 response {string} plainText 為 {word}',
  function (index: number, statusCode: string, plainTextStr: string) {
    const w = getWorld(this);
    const ops = w._apiSpec!.operations;
    const op = ops[index - 1];
    assert.ok(op, `Expected operation at index ${index}`);
    const resp = op.responses?.[statusCode];
    assert.ok(resp, `Expected response with status code ${statusCode}`);
    assert.strictEqual(resp.plainText, plainTextStr === 'true');
  },
);
