// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/error/SpecFormulaErrorCategory.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/error/SpecFormulaErrorCategory.ts
/**
 * ADR-0026 §6.1 — 4 個 framework error category（與 5 個 *Error 中立詞彙對應）。
 * registry_key 用於 specs/errors/zh-TW/*.yml 內 entry 的 `category` 欄位匹配。
 */
export const SpecFormulaErrorCategory = {
  ARGUMENT: 'argument',
  STATE: 'state',
  LOOKUP: 'lookup',
  ASSERTION: 'assertion',
} as const;

export type SpecFormulaErrorCategory =
  (typeof SpecFormulaErrorCategory)[keyof typeof SpecFormulaErrorCategory];
