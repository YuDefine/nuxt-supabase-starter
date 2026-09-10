// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ErrorAssertionStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/ErrorAssertionStepDefs.ts
/**
 * ADR-0026 §6.1 typed Then 共用 step definitions：
 *   - `<subject> 應拋出 SpecFormula(Argument|State|Lookup|Assertion)Error`
 *   - `錯誤碼為 "<code>"`
 *   - `錯誤詳情 "<key>" 為 "<value>"`
 *   - `錯誤詳情 "<key>" 包含 "<substring>"`
 *
 * 各 instruction stepdef 將 lastError 儲存於 world.lastError 或 world.<slot>.lastError；
 * 本檔的 helper 兩處都會掃描。
 */
import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  ERROR_CLASS_MAPPING,
  type SpecFormulaErrorClassName,
  type SpecFormulaError,
} from '@specformula/core';

type WorldLike = Record<string, unknown> & { lastError?: unknown };

function isSpecFormulaErrorLike(v: unknown): v is SpecFormulaError {
  return v instanceof Error && 'code' in v && 'details' in v && 'category' in v;
}

/**
 * 各 instruction step def 之 World 結構不同：
 *   - VarStepDefs / ApiCallStepDefs / TimeControlStepDefs / ResponseValidateStepDefs：
 *     直接 this.lastError = err
 *   - EntitySetup / EntityValidate / EntityNonExistenceValidate：
 *     world._entitySetup.lastError / _entityValidate.lastError / _entityNonExistence.lastError
 *   - SpecReader (api / isa / entity ddl)：world._apiError / _isaError / _ddlError
 * 此 helper 依序檢索三類來源，回傳第一個非 null/undefined 的 Error。
 */
const ERROR_SLOT_NAMES = new Set([
  'lastError',
  '_apiError',
  '_isaError',
  '_ddlError',
  '_entityError',
]);

function findLastError(world: WorldLike): unknown {
  if (world.lastError !== undefined && world.lastError !== null) return world.lastError;
  for (const key of Object.keys(world)) {
    const v = world[key];
    if (v instanceof Error && ERROR_SLOT_NAMES.has(key)) {
      return v;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      for (const slot of ERROR_SLOT_NAMES) {
        const candidate = obj[slot];
        if (candidate !== undefined && candidate !== null) return candidate;
      }
    }
  }
  return undefined;
}

/**
 * ADR-0026 §6.1 canonical stringification — 錯誤詳情 value 限制為
 * string / int / bool / null（禁止 float / decimal / date / 集合）。
 */
function canonicalString(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) {
      throw new Error(
        `錯誤詳情 value 必須為 int/string/bool/null（ADR-0026 §6.1 canonical），實際為 float: ${String(v)}`,
      );
    }
    return String(v);
  }
  if (typeof v === 'bigint') return v.toString(10);
  if (typeof v === 'string') return v;
  throw new Error(
    `錯誤詳情 value 型別不支援（ADR-0026 §6.1 canonical），實際為 ${typeof v}: ${JSON.stringify(v)}`,
  );
}

// ─── Then '<subject> 應拋出 SpecFormula(Argument|State|Lookup|Assertion)Error' ──

Then(
  /^(?:.+) 應拋出 (SpecFormula(?:Argument|State|Lookup|Assertion)Error)$/,
  function (className: string) {
    const world = this as WorldLike;
    const err = findLastError(world);
    assert.ok(
      err !== undefined && err !== null,
      `預期拋出 ${className}，但 lastError 為 undefined`,
    );
    const expectedCtor = ERROR_CLASS_MAPPING[className as SpecFormulaErrorClassName];
    assert.ok(
      expectedCtor !== undefined,
      `未知的 error class 名稱: ${className}`,
    );
    assert.ok(
      err instanceof expectedCtor,
      `預期 ${className}，實際為 ${(err as Error)?.constructor?.name ?? typeof err}: ${String((err as Error)?.message ?? err)}`,
    );
  },
);

// ─── Then '錯誤碼為 "<code>"' ────────────────────────────────────────────────

Then(/^錯誤碼為 "([^"]+)"$/, function (expectedCode: string) {
  const world = this as WorldLike;
  const err = findLastError(world);
  assert.ok(
    isSpecFormulaErrorLike(err),
    `預期 SpecFormula error（含 code 欄位），實際為 ${String((err as Error)?.constructor?.name ?? typeof err)}: ${String((err as Error)?.message ?? err)}`,
  );
  assert.strictEqual(
    err.code,
    expectedCode,
    `錯誤碼不匹配：預期 "${expectedCode}"，實際 "${err.code}"`,
  );
});

// ─── Then '錯誤詳情 "<key>" 為 "<value>"' ───────────────────────────────────

Then(
  /^錯誤詳情 "([^"]+)" 為 "((?:[^"\\]|\\.)*)"$/,
  function (key: string, expectedValueRaw: string) {
    const expectedValue = unescapeGherkinString(expectedValueRaw);
    const world = this as WorldLike;
    const err = findLastError(world);
    assert.ok(
      isSpecFormulaErrorLike(err),
      `預期 SpecFormula error（含 details 欄位），實際為 ${String((err as Error)?.constructor?.name ?? typeof err)}`,
    );
    assert.ok(
      key in err.details,
      `錯誤詳情缺少 key "${key}"；現有 keys: [${Object.keys(err.details).join(', ')}]`,
    );
    const actualValue = canonicalString(err.details[key]);
    assert.strictEqual(
      actualValue,
      expectedValue,
      `錯誤詳情 "${key}" 不匹配：預期 "${expectedValue}"，實際 "${actualValue}"`,
    );
  },
);

function unescapeGherkinString(s: string): string {
  return s.replace(/\\(.)/g, (_m, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    return ch;
  });
}

// ─── Then '錯誤詳情 "<key>" 包含 "<substring>"' ─────────────────────────────

Then(
  /^錯誤詳情 "([^"]+)" 包含 "((?:[^"\\]|\\.)*)"$/,
  function (key: string, expectedSubstringRaw: string) {
    const expectedSubstring = unescapeGherkinString(expectedSubstringRaw);
    const world = this as WorldLike;
    const err = findLastError(world);
    assert.ok(
      isSpecFormulaErrorLike(err),
      `預期 SpecFormula error（含 details 欄位），實際為 ${String((err as Error)?.constructor?.name ?? typeof err)}`,
    );
    assert.ok(
      key in err.details,
      `錯誤詳情缺少 key "${key}"；現有 keys: [${Object.keys(err.details).join(', ')}]`,
    );
    const actualValue = canonicalString(err.details[key]);
    assert.ok(
      actualValue.includes(expectedSubstring),
      `錯誤詳情 "${key}" 不包含 "${expectedSubstring}"；實際 "${actualValue}"`,
    );
  },
);
