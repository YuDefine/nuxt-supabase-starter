// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ResponseValidateStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ResponseValidateStepDefs.ts
/**
 * ResponseValidate step definitions — DataTable format.
 */
import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import {
  MapScenarioContext,
  ApiSpec,
  ResponseValidate,
  SpecFormulaAssertionError,
  asString,
} from '@specformula/core';
import type { ScenarioContext, LastResponseData, ApiResponse } from '@specformula/core';
import { ApiSpecReader } from '@specformula/core';
import { parseSimplifiedApiSpecJson } from '../simplified-api-spec.js';
import assert from 'node:assert/strict';

// ─── World ───────────────────────────────────────────────────────────────────

interface ResponseValidateWorld {
  ctx: ScenarioContext;
  apiSpec: ApiSpec;
  mockResponses: Map<string, { status: number; body: unknown; headers: Record<string, string> }>;
  lastValidationError: string | null;
  lastValidationPassed: boolean;
  lastError?: SpecFormulaAssertionError;
}

/**
 * 剝除字串外層 JSON-stringify 引號（若有）：
 * `"abc"` → `abc`；無引號則保留原值。
 */
function stripOuterQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 將 ResponseValidate compareFieldValue 對 null/undefined 之預設輸出 `""` 轉為
 * canonical `null` 字面，與 ADR-0026 §6.1 之 details.actual / actual_value 對齊。
 */
function normalizeNullActual(s: string): string {
  if (s === '' || s === 'undefined') return 'null';
  return s;
}

/**
 * ADR-0026 §6.1 — ASSERT_CAS_CONSTRAINT_FAILED 之 json_path 應為 JSON Path 表示。
 * ResponseValidate 對 bare body 採 `B:` 前綴；轉為 JSON Path 之 root `$`。
 */
function normalizeJsonPath(pathOrPrefix: string): string {
  if (pathOrPrefix === 'B:') return '$';
  return pathOrPrefix;
}

/**
 * ADR-0026 §6.1 — actual_value 為 canonical string（int/string/bool/null）。
 * 對於 `&size(N)` 之 collection constraint，BDD 期望 actual_value 為 array 長度
 * 之十進位數字字串，而非整個 JSON 序列化。其他 constraint 維持原值。
 */
function canonicalActualForConstraint(constraint: string, rawActual: string): string {
  if (/^&size\(/.test(constraint) || /^&length\(/.test(constraint)) {
    try {
      const parsed: unknown = JSON.parse(rawActual);
      if (Array.isArray(parsed)) return String(parsed.length);
      if (typeof parsed === 'string') return String(parsed.length);
    } catch {
      // 解析失敗回退原值
    }
  }
  return rawActual;
}

/**
 * ADR-0026 §6.1 — 將 ResponseValidate 字串型 error 對應到 typed-error。
 * code + details 之還原採訊息字串模式比對；理想上應由 ResponseValidate 直接
 * 返回結構化錯誤，待 Phase 3 重構。
 */
function buildResponseAssertionError(errorMsg: string): SpecFormulaAssertionError {
  // ASSERT_RESPONSE_STATUS_MISMATCH: "HTTP 狀態碼不匹配: 預期 X, 實際 Y"
  const statusMatch = /HTTP 狀態碼不匹配: 預期 (\d+), 實際 (\d+)/.exec(errorMsg);
  if (statusMatch) {
    return new SpecFormulaAssertionError({
      code: 'ASSERT_RESPONSE_STATUS_MISMATCH',
      details: {
        expected: parseInt(statusMatch[1], 10),
        actual: parseInt(statusMatch[2], 10),
      },
    });
  }

  // ASSERT_RESPONSE_TYPE_MISMATCH: "型別不符 at 'X': 預期 Y, 實際 Z"
  const typeMatch = /型別不符 at '([^']*)': 預期 (\w+), 實際 (\w+)/.exec(errorMsg);
  if (typeMatch) {
    return new SpecFormulaAssertionError({
      code: 'ASSERT_RESPONSE_TYPE_MISMATCH',
      details: {
        field: typeMatch[1],
        expected_type: typeMatch[2],
        actual_type: typeMatch[3],
      },
    });
  }

  // ASSERT_RESPONSE_FIELD_MISMATCH: "值不匹配 at 'X': 預期 Y, 實際 Z" or CAS / other
  const fieldMatch = /值不匹配 at '([^']*)': 預期 (.+?), 實際 (.+?)$/.exec(errorMsg);
  if (fieldMatch) {
    return new SpecFormulaAssertionError({
      code: 'ASSERT_RESPONSE_FIELD_MISMATCH',
      details: {
        field: fieldMatch[1],
        expected: stripOuterQuotes(fieldMatch[2]),
        actual: normalizeNullActual(stripOuterQuotes(fieldMatch[3])),
      },
    });
  }

  const casMatch = /^(.+?): CAS 驗證失敗 \((.+?)\), 實際值: (.+?)$/.exec(errorMsg);
  if (casMatch) {
    const constraint = casMatch[2];
    const rawActual = normalizeNullActual(stripOuterQuotes(casMatch[3]));
    return new SpecFormulaAssertionError({
      code: 'ASSERT_CAS_CONSTRAINT_FAILED',
      details: {
        json_path: normalizeJsonPath(casMatch[1]),
        constraint,
        actual_value: canonicalActualForConstraint(constraint, rawActual),
      },
    });
  }

  // Fallback — generic field mismatch
  return new SpecFormulaAssertionError({
    code: 'ASSERT_RESPONSE_FIELD_MISMATCH',
    details: { field: '(unknown)', expected: '', actual: errorMsg },
  });
}

// ─── Given — Setup ────────────────────────────────────────────────────────────

Given('response-validate 回應驗證 ApiSpec:', function (this: ResponseValidateWorld, docString: string) {
  this.ctx = new MapScenarioContext();
  this.mockResponses = new Map();
  this.lastValidationError = null;
  this.lastValidationPassed = false;
  this.apiSpec = parseApiSpecJson(docString);
});

Given('response-validate 回應驗證 ApiSpec OpenAPI:', function (this: ResponseValidateWorld, docString: string) {
  this.ctx = new MapScenarioContext();
  this.mockResponses = new Map();
  this.lastValidationError = null;
  this.lastValidationPassed = false;
  this.apiSpec = ApiSpecReader.parseFromString(docString.trim());
});

Given('response-validate 設定回應 {string} 狀態碼 {int}:', function (this: ResponseValidateWorld, summary: string, status: number, docString: string) {
  const body = parseResponseBody(docString);
  const existing = this.mockResponses.get(summary);
  this.mockResponses.set(summary, {
    status,
    body,
    headers: existing?.headers ?? {},
  });
});

Given('response-validate 設定回應 {string} 狀態碼 {int} headers:', function (this: ResponseValidateWorld, summary: string, status: number, dataTable: DataTable) {
  const rows = dataTable.raw();
  const headers: Record<string, string> = {};
  for (const row of rows) {
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

Given('response-validate ScenarioContext 預設變數 {string} 為 {string}', function (this: ResponseValidateWorld, key: string, value: string) {
  if (!this.ctx) this.ctx = new MapScenarioContext();
  this.ctx.set(key, value);
});

// ─── When — Validate ──────────────────────────────────────────────────────────

When(/^response-validate 驗證 "([^"]+)" \((\d+)\), with Table:$/, function (this: ResponseValidateWorld, summary: string, statusStr: string, dataTable: DataTable) {
  const expectedStatus = parseInt(statusStr, 10);
  const mockResp = this.mockResponses.get(summary);
  if (!mockResp) {
    this.lastValidationPassed = false;
    this.lastValidationError = `No mock response configured for "${summary}"`;
    return;
  }

  const response: LastResponseData = {
    status: mockResp.status,
    headers: mockResp.headers,
    body: mockResp.body,
    rawBody: JSON.stringify(mockResp.body),
  };

  const raw = dataTable.raw();
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

  const validator = new ResponseValidate(this.ctx);
  try {
    const result = validator.validateFromDataTable(
      this.apiSpec,
      summary,
      expectedStatus,
      headers,
      rows,
      response,
    );

    this.lastValidationPassed = result.passed;
    this.lastValidationError = result.error;
    this.lastError = result.passed ? undefined : buildResponseAssertionError(result.error ?? '');
  } catch (err) {
    this.lastValidationPassed = false;
    this.lastValidationError = err instanceof Error ? err.message : String(err);
    // 保留 validator 拋出的原始 SpecFormulaAssertionError（含其 error code，例如
    // SYMBOL_VAR_EXECUTION_KEY_NOT_FOUND）；非結構化錯誤才退回 buildResponseAssertionError。
    this.lastError =
      err instanceof SpecFormulaAssertionError
        ? err
        : buildResponseAssertionError(this.lastValidationError);
  }
});

// ─── Then — Assertions ────────────────────────────────────────────────────────

Then('response-validate 通過', function (this: ResponseValidateWorld) {
  assert.ok(
    this.lastValidationPassed,
    `Expected validation to pass but it failed: ${this.lastValidationError}`,
  );
});

Then('response-validate 失敗, 訊息包含 {string}', function (this: ResponseValidateWorld, expectedMsg: string) {
  assert.ok(
    !this.lastValidationPassed,
    'Expected validation to fail but it passed',
  );
  assert.ok(
    this.lastValidationError !== null && this.lastValidationError.includes(expectedMsg),
    `Expected error to contain "${expectedMsg}", got: "${this.lastValidationError}"`,
  );
});

Then('response-validate ScenarioContext 應有變數 {string} 為 {string}', function (this: ResponseValidateWorld, key: string, expectedValue: string) {
  const actual = this.ctx.get(key);
  assert.strictEqual(
    String(actual),
    expectedValue,
    `Context variable "${key}": expected "${expectedValue}", got "${String(actual)}"`,
  );
});

Then('scenarioContext 的 {string} 應該等於 boolean {word}', function (this: ResponseValidateWorld, key: string, boolStr: string) {
  const expected = boolStr === 'true';
  const actual = this.ctx.get(key);
  assert.strictEqual(
    actual,
    expected,
    `Context variable "${key}": expected boolean ${expected}, got ${String(actual)}`,
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseResponseValidationSpecJson(docString: string) {
  return parseSimplifiedApiSpecJson(docString);
}

function parseApiSpecJson(docString: string) {
  return parseSimplifiedApiSpecJson(docString);
}

function parseResponseBody(docString: string): unknown {
  const trimmed = docString.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
