// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/error/SpecFormulaError.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/error/SpecFormulaError.ts
import { AssertionError } from 'node:assert';
import { SpecFormulaErrorCategory } from './SpecFormulaErrorCategory.js';
import { SpecFormulaErrorCodeCategory } from './SpecFormulaErrorCode.js';
import type { SpecFormulaErrorCode } from './SpecFormulaErrorCode.js';
import { MessageRegistry } from './MessageRegistry.js';

/**
 * ADR-0026 §6.1 — SpecFormula framework error 中立詞彙。
 *
 * 4 個 concrete subclass：
 *   - SpecFormulaArgumentError  — 值 / 格式 / 規格不適當
 *   - SpecFormulaStateError     — 執行狀態不允許此操作
 *   - SpecFormulaLookupError    — 符號 / 檔案 / 路徑 / 鍵 找不到
 *   - SpecFormulaAssertionError — Then 期望與實際不符（ADR §G4：須對映原生 AssertionError）
 *
 * ADR-0026 §G5 / §G6 / §G7 — constructor 必須帶入 typed code + details，message 由
 * MessageRegistry 之 template 渲染，**禁止 throw site 內聯 message**。category 由
 * code 自 SpecFormulaErrorCodeCategory 推導。Constructor 若 code 對應 category 與
 * 所構造 subclass 不一致 → 啟動拋 Error（contract 違反）。
 *
 * Reviewer 報告 P0 #4 對應修正：
 *   - code 由 optional string 改為 required SpecFormulaErrorCode 之 const literal
 *   - 移除 message 之 inline 傳入
 *   - 構造路徑由 registry 主導；category 一致性檢核
 */

const SPEC_FORMULA_ERROR_TAG: unique symbol = Symbol.for(
  '@specformula/core:SpecFormulaError',
);

export interface SpecFormulaErrorOptions {
  readonly code: SpecFormulaErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly cause?: Error;
}

const FROZEN_EMPTY: Readonly<Record<string, unknown>> = Object.freeze({});

function freezeDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (Object.keys(details).length === 0) return FROZEN_EMPTY;
  return Object.freeze({ ...details });
}

function assertCategoryMatches(
  code: SpecFormulaErrorCode,
  expected: SpecFormulaErrorCategory,
): void {
  const declared = SpecFormulaErrorCodeCategory[code];
  if (declared !== expected) {
    throw new Error(
      `ADR-0026 §6.1 contract violation: code '${code}' 之 category '${declared}' 與所構造 ` +
        `subclass 期望之 category '${expected}' 不一致。請改用對應 category 之 subclass。`,
    );
  }
}

/**
 * 抽象根。不可直接 `new`；以 brand + Symbol.hasInstance 統一守門
 * （見檔頭設計說明）。所有 4 個 concrete subclass 共享 brand。
 */
export class SpecFormulaError extends Error {
  readonly code: SpecFormulaErrorCode;
  readonly details: Readonly<Record<string, unknown>> = FROZEN_EMPTY;
  readonly category: SpecFormulaErrorCategory = SpecFormulaErrorCategory.ARGUMENT;
  readonly [SPEC_FORMULA_ERROR_TAG] = true as const;

  constructor(message: string, code: SpecFormulaErrorCode) {
    super(message);
    this.code = code;
    if (new.target === SpecFormulaError) {
      throw new Error(
        'SpecFormulaError is abstract per ADR-0026 §6.1; use one of the 4 concrete subclasses.',
      );
    }
    this.name = new.target.name;
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      SPEC_FORMULA_ERROR_TAG in value &&
      (value as { [SPEC_FORMULA_ERROR_TAG]?: unknown })[SPEC_FORMULA_ERROR_TAG] === true
    );
  }
}

abstract class SpecFormulaErrorBase extends SpecFormulaError {
  readonly details: Readonly<Record<string, unknown>>;
  abstract readonly category: SpecFormulaErrorCategory;

  protected constructor(opts: SpecFormulaErrorOptions, expectedCategory: SpecFormulaErrorCategory) {
    assertCategoryMatches(opts.code, expectedCategory);
    const message = MessageRegistry.get().render(opts.code, opts.details);
    super(message, opts.code);
    this.details = freezeDetails(opts.details);
    if (opts.cause) {
      this.cause = opts.cause;
    }
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

export class SpecFormulaArgumentError extends SpecFormulaErrorBase {
  readonly category = SpecFormulaErrorCategory.ARGUMENT;

  constructor(opts: SpecFormulaErrorOptions) {
    super(opts, SpecFormulaErrorCategory.ARGUMENT);
  }
}

export class SpecFormulaStateError extends SpecFormulaErrorBase {
  readonly category = SpecFormulaErrorCategory.STATE;

  constructor(opts: SpecFormulaErrorOptions) {
    super(opts, SpecFormulaErrorCategory.STATE);
  }
}

export class SpecFormulaLookupError extends SpecFormulaErrorBase {
  readonly category = SpecFormulaErrorCategory.LOOKUP;

  constructor(opts: SpecFormulaErrorOptions) {
    super(opts, SpecFormulaErrorCategory.LOOKUP);
  }
}

export class SpecFormulaAssertionError extends SpecFormulaErrorBase {
  readonly category = SpecFormulaErrorCategory.ASSERTION;

  constructor(opts: SpecFormulaErrorOptions) {
    super(opts, SpecFormulaErrorCategory.ASSERTION);
  }
}

/**
 * ADR-0026 §G4 native AssertionError 等效對映：
 * 將 SpecFormulaAssertionError.prototype 之 prototype 替換為 AssertionError.prototype，
 * 使 `err instanceof AssertionError` 於 runtime 為 true（vitest / cucumber-js
 * 之 test runner 將其辨識為 FAIL 而非 ERROR）。原型鏈：
 *
 *   SpecFormulaAssertionError.prototype
 *     → AssertionError.prototype       ← 插入此層（取代 SpecFormulaErrorBase）
 *     → Error.prototype
 *
 * `instanceof SpecFormulaError` / `isSpecFormulaError()` 之檢查由
 * SpecFormulaError[Symbol.hasInstance] 之 brand check 完成，不依賴單一原型鏈。
 */
Object.setPrototypeOf(SpecFormulaAssertionError.prototype, AssertionError.prototype);

/**
 * ADR-0026 §8 / §8.1 — feature 中的中立詞彙 → 各語言原生 class 對映。
 * TypeScript identity mapping：class 名稱即為全域術語。
 */
export const ERROR_CLASS_MAPPING = {
  SpecFormulaError,
  SpecFormulaArgumentError,
  SpecFormulaStateError,
  SpecFormulaLookupError,
  SpecFormulaAssertionError,
} as const;

export type SpecFormulaErrorClassName = keyof typeof ERROR_CLASS_MAPPING;

export function isSpecFormulaError(value: unknown): value is SpecFormulaError {
  return value instanceof SpecFormulaError;
}
