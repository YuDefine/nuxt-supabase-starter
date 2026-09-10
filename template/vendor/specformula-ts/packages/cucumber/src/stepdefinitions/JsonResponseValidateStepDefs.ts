// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/JsonResponseValidateStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/JsonResponseValidateStepDefs.ts
/**
 * JsonResponseValidate step definitions — JSON DocString format.
 */
import { When } from '@cucumber/cucumber';
import {
  ResponseValidate,
  SpecFormulaAssertionError,
} from '@specformula/core';
import type { ScenarioContext, LastResponseData } from '@specformula/core';
import type { ApiSpec } from '@specformula/core';

// Re-use world interface shape
interface ResponseValidateWorld {
  ctx: ScenarioContext;
  apiSpec: ApiSpec;
  mockResponses: Map<string, { status: number; body: unknown; headers: Record<string, string> }>;
  lastValidationError: string | null;
  lastValidationPassed: boolean;
  lastError?: SpecFormulaAssertionError;
}

function stripOuterQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

function normalizeNullActual(s: string): string {
  if (s === '' || s === 'undefined') return 'null';
  return s;
}

function normalizeJsonPath(pathOrPrefix: string): string {
  if (pathOrPrefix === 'B:') return '$';
  return pathOrPrefix;
}

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
 * ADR-0026 §6.1 — JSON DocString 之數值精度保留：
 * JS native JSON.parse 對 `1500.00` 會返回 number 1500，丟失尾零；當 BDD details
 * 期望保留 lexical（e.g. `expected: "1500.00"`）時，由 DocString 提取原始 numeric
 * literal source text，作為 detail expected 的覆寫來源。
 *
 * 抽取規則：對每個 `"key": <num>` 對，建立 key → source-text map。為簡化僅支援
 * 頂層 key（夠覆蓋 reviewer P0 #3 失敗的 2 個 numeric BDD scenarios）；nested
 * path 之精度保留需 lossless JSON parser，留待 ADR / 後續 PR。
 */
function extractNumericLiterals(docString: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /"([^"\\]+)"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docString)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * 若 field 對應之 DocString 原文 numeric literal 與當前 expected 解析後數值相等，
 * 但 source text 含小數尾零或科學記號，採 source text 覆寫 expected。
 */
function preserveLexicalExpected(
  field: string,
  expected: string,
  literals: Map<string, string>,
): string {
  const source = literals.get(field);
  if (source === undefined) return expected;
  // 解析比對，只在數值相等時才用 source 覆寫（避免覆寫到不相干的字串 expected）
  const e = Number(expected);
  const s = Number(source);
  if (Number.isFinite(e) && Number.isFinite(s) && e === s) {
    return source;
  }
  return expected;
}

/**
 * ADR-0026 §6.1 — 將 ResponseValidate 字串型 error 對應到 typed-error。
 * 與 ResponseValidateStepDefs.ts 之 buildResponseAssertionError 同步維護。
 */
function buildAssertion(
  errorMsg: string,
  numericLiterals: Map<string, string> = new Map(),
): SpecFormulaAssertionError {
  const statusMatch = /HTTP 狀態碼不匹配: 預期 (\d+), 實際 (\d+)/.exec(errorMsg);
  if (statusMatch) {
    return new SpecFormulaAssertionError({
      code: 'ASSERT_RESPONSE_STATUS_MISMATCH',
      details: { expected: parseInt(statusMatch[1], 10), actual: parseInt(statusMatch[2], 10) },
    });
  }
  const typeMatch = /型別不符 at '([^']*)': 預期 (\w+), 實際 (\w+)/.exec(errorMsg);
  if (typeMatch) {
    return new SpecFormulaAssertionError({
      code: 'ASSERT_RESPONSE_TYPE_MISMATCH',
      details: { field: typeMatch[1], expected_type: typeMatch[2], actual_type: typeMatch[3] },
    });
  }
  const fieldMatch = /值不匹配 at '([^']*)': 預期 (.+?), 實際 (.+?)$/.exec(errorMsg);
  if (fieldMatch) {
    const field = fieldMatch[1];
    const expectedRaw = stripOuterQuotes(fieldMatch[2]);
    return new SpecFormulaAssertionError({
      code: 'ASSERT_RESPONSE_FIELD_MISMATCH',
      details: {
        field,
        expected: preserveLexicalExpected(field, expectedRaw, numericLiterals),
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
  return new SpecFormulaAssertionError({
    code: 'ASSERT_RESPONSE_FIELD_MISMATCH',
    details: { field: '(unknown)', expected: '', actual: errorMsg },
  });
}

// ─── When — Validate JSON ─────────────────────────────────────────────────────

When(/^response-validate 驗證 "([^"]+)" \((\d+)\), with Json:$/, function (this: ResponseValidateWorld, summary: string, statusStr: string, docString: string) {
  const expectedStatus = parseInt(statusStr, 10);
  const mockResp = this.mockResponses.get(summary);
  if (!mockResp) {
    const msg = `No mock response configured for "${summary}"`;
    this.lastValidationPassed = false;
    this.lastValidationError = msg;
    this.lastError = buildAssertion(msg);
    return;
  }

  const response: LastResponseData = {
    status: mockResp.status,
    headers: mockResp.headers,
    body: mockResp.body,
    rawBody: JSON.stringify(mockResp.body),
  };

  const validator = new ResponseValidate(this.ctx);
  const result = validator.validateFromJson(
    this.apiSpec,
    summary,
    expectedStatus,
    docString,
    response,
  );

  this.lastValidationPassed = result.passed;
  this.lastValidationError = result.error;
  this.lastError = result.passed
    ? undefined
    : buildAssertion(result.error ?? '', extractNumericLiterals(docString));
});
