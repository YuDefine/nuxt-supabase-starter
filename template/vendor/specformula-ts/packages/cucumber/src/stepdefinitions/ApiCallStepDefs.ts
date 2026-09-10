// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ApiCallStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ApiCallStepDefs.ts
/**
 * ApiCall step definitions — DataTable format.
 */
import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import {
  MapScenarioContext,
  ApiSpec,
  ApiCall,
  asString,
  evaluateConstraints,
} from '@specformula/core';
import type { ScenarioContext, HttpClientAdapter, TestRequest, TestResponse, ApiResponse, TimeFormat } from '@specformula/core';
import { ApiSpecReader } from '@specformula/core';
import assert from 'node:assert/strict';
import { getBracketValue } from '@specformula/core';
import { parseSimplifiedApiSpecJson } from '../simplified-api-spec.js';

// ─── World ───────────────────────────────────────────────────────────────────

interface ApiCallWorld {
  ctx: ScenarioContext;
  apiSpec: ApiSpec;
  mockResponses: Map<string, { status: number; body: unknown; headers: Record<string, string> }>;
  lastRequest: TestRequest | null;
  lastResponse: TestResponse | null;
  lastError: unknown;
  timeFormat: string;
}


// ─── Given — ApiSpec setup ────────────────────────────────────────────────────

Given('api-call ApiSpec:', function (this: ApiCallWorld, docString: string) {
  this.ctx = new MapScenarioContext();
  this.mockResponses = new Map();
  this.lastRequest = null;
  this.lastResponse = null;
  this.lastError = undefined;
  this.timeFormat = 'ISO';
  this.apiSpec = parseApiSpecJson(docString);
});

Given('api-call ApiSpec OpenAPI:', function (this: ApiCallWorld, docString: string) {
  this.ctx = new MapScenarioContext();
  this.mockResponses = new Map();
  this.lastRequest = null;
  this.lastResponse = null;
  this.lastError = undefined;
  this.timeFormat = 'ISO';
  this.apiSpec = ApiSpecReader.parseFromString(docString.trim());
});

Given('api-call ApiSpec timeFormat {string}:', function (this: ApiCallWorld, timeFormat: string, docString: string) {
  this.ctx = new MapScenarioContext();
  this.mockResponses = new Map();
  this.lastRequest = null;
  this.lastResponse = null;
  this.lastError = undefined;
  this.timeFormat = timeFormat;
  this.apiSpec = parseApiSpecJson(docString);
});

Given('api-call {string} 端點回應 {int}:', function (this: ApiCallWorld, summary: string, status: number, docString: string) {
  const body = JSON.parse(docString);
  const existing = this.mockResponses.get(summary);
  this.mockResponses.set(summary, {
    status,
    body,
    headers: existing?.headers ?? {},
  });
});

Given('api-call {string} 端點回應 {int} headers:', function (this: ApiCallWorld, summary: string, status: number, dataTable: DataTable) {
  const rows = dataTable.raw();
  const headers: Record<string, string> = {};
  // First row is header names, second row is values
  if (rows.length >= 2) {
    const headerNames = rows[0];
    const values = rows[1];
    for (let i = 0; i < headerNames.length; i++) {
      if (headerNames[i] && values[i] !== undefined) {
        headers[headerNames[i]] = values[i];
      }
    }
  } else if (rows.length === 1) {
    // Single row as key-value pairs
    const row = rows[0];
    if (row.length >= 2) {
      headers[row[0]] = row[1];
    }
  }
  const existing = this.mockResponses.get(summary);
  this.mockResponses.set(summary, {
    status: existing?.status ?? status,
    body: existing?.body ?? null,
    headers,
  });
});

Given('api-call ScenarioContext 設定變數 {string} 為 {string}', function (this: ApiCallWorld, key: string, value: string) {
  if (!this.ctx) this.ctx = new MapScenarioContext();
  this.ctx.set(key, value);
});


// ─── When — Execute ───────────────────────────────────────────────────────────

When('api-call {string} WithActor token {string}:', async function (this: ApiCallWorld, summary: string, token: string, dataTable: DataTable) {
  this.lastError = undefined;
  try {
    const result = await executeApiCall(this, summary, token, dataTable);
    this.lastResponse = result;
  } catch (err) {
    this.lastError = err;
  }
});

When('api-call {string} WithoutActor:', async function (this: ApiCallWorld, summary: string, dataTable: DataTable) {
  this.lastError = undefined;
  try {
    const result = await executeApiCall(this, summary, null, dataTable);
    this.lastResponse = result;
  } catch (err) {
    this.lastError = err;
  }
});

When('api-call {string} WithoutActor 應拋出錯誤:', async function (this: ApiCallWorld, summary: string, dataTable: DataTable) {
  this.lastError = undefined;
  try {
    await executeApiCall(this, summary, null, dataTable);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── Then — Request assertions ────────────────────────────────────────────────

Then('api-call 請求的 path 為 {string}', function (this: ApiCallWorld, expectedPath: string) {
  assert.ok(this.lastRequest, 'No request was made');
  // Compare path part only (without query string)
  const actualPath = this.lastRequest.url.split('?')[0];
  assert.strictEqual(actualPath, expectedPath);
});

Then('api-call 請求的 path 包含 {string}', function (this: ApiCallWorld, fragment: string) {
  assert.ok(this.lastRequest, 'No request was made');
  assert.ok(
    this.lastRequest.url.includes(fragment),
    `Expected path to contain "${fragment}", got: ${this.lastRequest.url}`,
  );
});

Then('api-call 請求參數:', function (this: ApiCallWorld, dataTable: DataTable) {
  assert.ok(this.lastRequest, 'No request was made');
  const rows = dataTable.raw();
  assert.strictEqual(rows.length, 2, '請求參數 table must have 1 header row + 1 value row');
  const [headers, values] = rows;
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    const expected = values[i] ?? '';
    const actual = resolveRequestTarget(this.lastRequest, key);
    if (expected.startsWith('&')) {
      evaluateConstraints(actual, expected, this.ctx, key, 'api-call');
    } else {
      const actualText = canonical(actual);
      assert.ok(actualText !== null, `請求參數 "${key}" should exist`);
      assert.strictEqual(actualText, expected, `請求參數 "${key}": expected "${expected}", got "${actualText}"`);
    }
  }
});

function resolveRequestTarget(request: TestRequest, key: string): unknown {
  if (key.startsWith('Q:')) {
    return request.queryParams[key.slice(2)] ?? null;
  }
  if (key.startsWith('H:')) {
    const name = key.slice(2);
    if (name in request.headers) {
      return request.headers[name];
    }
    const found = Object.keys(request.headers).find((h) => h.toLowerCase() === name.toLowerCase());
    return found !== undefined ? request.headers[found] : null;
  }
  throw new Error(`Unknown 請求參數 key: ${key}`);
}

Then('api-call 請求的 body nested {string} 為 {string}', function (this: ApiCallWorld, path: string, expectedValue: string) {
  assert.ok(this.lastRequest, 'No request was made');
  const body = this.lastRequest.body;
  assert.ok(body !== null && body !== undefined, 'Request body is null/undefined');
  const actual = getBracketValue(body, path);
  assert.strictEqual(String(actual), expectedValue, `Body nested "${path}": expected "${expectedValue}", got "${String(actual)}"`);
});

Then('api-call 請求的 body 符合:', function (this: ApiCallWorld, docString: string) {
  assert.ok(this.lastRequest, 'No request was made');
  const body = this.lastRequest.body;
  assert.ok(body !== null && body !== undefined, 'Request body is null/undefined');
  const expected: unknown = JSON.parse(docString.trim());
  assertBodyMatches(expected, body, '$', this.ctx);
});

/**
 * 遞迴比對：物件為宣告子集、陣列為長度＋逐元素全量、純量以 canonical 字串寬鬆比對；
 * 字串值以 & 開頭時走 CAS 約束評估（對 canonical 字串形式評估，因四語言 body 純量型別不一致）。
 */
function assertBodyMatches(expected: unknown, actual: unknown, path: string, ctx: ScenarioContext): void {
  if (typeof expected === 'string' && expected.startsWith('&')) {
    evaluateConstraints(canonical(actual), expected, ctx, path, 'api-call');
    return;
  }
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    assert.ok(
      actual !== null && typeof actual === 'object' && !Array.isArray(actual),
      `Body path "${path}" should be object, got: ${JSON.stringify(actual)}`,
    );
    for (const [key, expectedChild] of Object.entries(expected as Record<string, unknown>)) {
      const actualRecord = actual as Record<string, unknown>;
      assert.ok(key in actualRecord, `Body path "${path}.${key}" not found`);
      assertBodyMatches(expectedChild, actualRecord[key], `${path}.${key}`, ctx);
    }
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `Body path "${path}" should be array, got: ${JSON.stringify(actual)}`);
    assert.strictEqual(actual.length, expected.length, `Array "${path}" size mismatch`);
    for (let i = 0; i < expected.length; i++) {
      assertBodyMatches(expected[i], actual[i], `${path}[${i}]`, ctx);
    }
    return;
  }
  assert.strictEqual(canonical(actual), canonical(expected), `Body path "${path}" mismatch`);
}

/** 純量之 canonical 字串形式（boolean/number/string 一致化，null 保持 null）。 */
function canonical(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

Then('api-call 請求不包含 body', function (this: ApiCallWorld) {
  assert.ok(this.lastRequest, 'No request was made');
  const body = this.lastRequest.body;
  assert.ok(
    body === null || body === undefined,
    `Expected no body but got: ${JSON.stringify(body)}`,
  );
});

// ─── Then — Response assertions ────────────────────────────────────────────────

Then('api-call ScenarioContext 的 lastResponse 狀態碼為 {int}', function (this: ApiCallWorld, expectedStatus: number) {
  assert.ok(this.lastResponse, 'No response available');
  assert.strictEqual(this.lastResponse.status, expectedStatus);
});

Then('api-call ScenarioContext 變數 {string} 為 {string}', function (this: ApiCallWorld, key: string, expectedValue: string) {
  const actual = this.ctx.get(key);
  assert.strictEqual(String(actual), expectedValue, `Context variable "${key}": expected "${expectedValue}", got "${String(actual)}"`);
});

Then('api-call ScenarioContext 的 lastResponse 不為 null', function (this: ApiCallWorld) {
  const lastResp = this.ctx.getLastResponse();
  assert.ok(lastResp !== null && lastResp !== undefined, 'lastResponse is null/undefined');
});

// ─── Then — Error assertions ──────────────────────────────────────────────────

Then('api-call 應拋出例外訊息包含 {string}', function (this: ApiCallWorld, expectedMsg: string) {
  assert.ok(
    this.lastError instanceof Error,
    `Expected an error but got: ${String(this.lastError)}`,
  );
  assert.ok(
    (this.lastError).message.includes(expectedMsg),
    `Expected error message to contain "${expectedMsg}", got: "${(this.lastError).message}"`,
  );
});


// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseApiCallSpecJson(docString: string) {
  return parseSimplifiedApiSpecJson(docString);
}

function parseApiSpecJson(docString: string) {
  return parseSimplifiedApiSpecJson(docString);
}

async function executeApiCall(
  world: ApiCallWorld,
  summary: string,
  token: string | null,
  dataTable: DataTable,
): Promise<TestResponse> {
  const raw = dataTable.raw();

  // Record last request via mock client
  let capturedRequest: TestRequest | null = null;
  const mockClient: HttpClientAdapter = {
    execute(req: TestRequest): Promise<TestResponse> {
      capturedRequest = req;
      const resp = world.mockResponses.get(summary);
      if (resp) {
        return Promise.resolve({
          status: resp.status,
          headers: resp.headers,
          body: resp.body,
          rawBody: JSON.stringify(resp.body),
        });
      }
      return Promise.resolve({ status: 200, headers: {}, body: null, rawBody: '' });
    },
  };

  const timeFormat = (world.timeFormat ?? 'ISO') as TimeFormat;
  const apiCall = new ApiCall(mockClient, world.ctx, timeFormat);

  let headers: Array<string | null>;
  let rows: Array<Array<string | null>>;

  if (raw.length === 0) {
    headers = [];
    rows = [];
  } else if (raw.length === 1) {
    headers = raw[0];
    rows = [];
  } else {
    headers = raw[0];
    rows = raw.slice(1);
  }

  const response = await apiCall.executeFromDataTable(
    world.apiSpec,
    summary,
    headers,
    rows,
    token,
  );

  world.lastRequest = capturedRequest;
  return response;
}
