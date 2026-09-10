// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/SpecErrorStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/SpecErrorStepDefs.ts
/**
 * ADR-0026 §7.3 — spec-error/error-message-rendering.feature 對應 step defs。
 *
 * 三組 step：
 *   Given spec.error 給定錯誤碼 "<code>" 與詳情: <json doc>
 *   When  spec.error 構造例外
 *   Then  例外錯誤碼為 "<code>"
 *   And   例外類別為 <error_class>
 *   And   例外訊息為 "<expected>"
 *
 * MessageRegistry 自 specs/errors/zh-TW 載入 86 codes；構造後比對 byte-identical
 * 之 (code, error_class, message) 三項斷言（跨語言契約）。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  MessageRegistry,
  buildErrorFromRegistry,
  SpecFormulaError,
  SpecFormulaArgumentError,
  SpecFormulaStateError,
  SpecFormulaLookupError,
  SpecFormulaAssertionError,
  parseJsonObject,
} from '@specformula/core';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface SpecErrorWorld {
  _specError?: {
    code?: string;
    details?: Record<string, unknown>;
    constructed?: SpecFormulaError;
  };
}

function getState(world: SpecErrorWorld): NonNullable<SpecErrorWorld['_specError']> {
  if (!world._specError) world._specError = {};
  return world._specError;
}

// instanceof guard 用 — 各 concrete subclass 之 class object（透過 Symbol.hasInstance
// 進行 brand check）。型別放寬為 unknown class 避免 constructor signature 對齊衝突。
type AnyErrorClass = abstract new (...args: never[]) => unknown;
const ERROR_CLASS_BY_NAME: Record<string, AnyErrorClass> = {
  SpecFormulaError: SpecFormulaError,
  SpecFormulaArgumentError: SpecFormulaArgumentError,
  SpecFormulaStateError: SpecFormulaStateError,
  SpecFormulaLookupError: SpecFormulaLookupError,
  SpecFormulaAssertionError: SpecFormulaAssertionError,
};

/**
 * 從 cwd 往上找 specs/errors/zh-TW；BDD 由 specformula-ts/ 啟動，向上一層即為 repo root。
 */
function resolveRegistryDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'specs', 'errors', 'zh-TW');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), 'specs', 'errors', 'zh-TW');
}

export function parseErrorDetailsJson(source: string): Record<string, unknown> {
  return parseJsonObject(source, 'error details');
}

Given(
  /^spec\.error 給定錯誤碼 "([^"]+)" 與詳情:$/,
  function (this: SpecErrorWorld, code: string, docString: string) {
    const state = getState(this);
    state.code = code;
    state.details = parseErrorDetailsJson(docString);
    state.constructed = undefined;
  },
);

When(/^spec\.error 構造例外$/, function (this: SpecErrorWorld) {
  const state = getState(this);
  if (!state.code) {
    throw new Error('spec.error: 必須先給定錯誤碼');
  }
  // Ensure registry loaded
  MessageRegistry.reset();
  MessageRegistry.get(resolveRegistryDir());
  // state.code 為使用者於 Given step 提供之字串，由 buildErrorFromRegistry 之 registry
  // 校驗負責驗證；此處用 type assertion 過 TS compile 即可（registry runtime check 攔錯字）。
  state.constructed = buildErrorFromRegistry(
    state.code as never,
    state.details ?? {},
  );
});

Then(/^例外錯誤碼為 "([^"]+)"$/, function (this: SpecErrorWorld, expectedCode: string) {
  const state = getState(this);
  assert.ok(state.constructed, '尚未構造 SpecFormula error');
  assert.strictEqual(state.constructed.code, expectedCode);
});

Then(/^例外類別為 (SpecFormula\w+Error)$/, function (this: SpecErrorWorld, className: string) {
  const state = getState(this);
  assert.ok(state.constructed, '尚未構造 SpecFormula error');
  const cls = ERROR_CLASS_BY_NAME[className];
  assert.ok(cls, `未知的 error class: ${className}`);
  assert.ok(
    state.constructed instanceof cls,
    `預期 ${className}，實際為 ${state.constructed.constructor.name}`,
  );
});

Then(/^例外訊息為 "(.*)"$/, function (this: SpecErrorWorld, expectedMessage: string) {
  const state = getState(this);
  assert.ok(state.constructed, '尚未構造 SpecFormula error');
  assert.strictEqual(state.constructed.message, expectedMessage);
});
