// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/DataFormat.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/DataFormat.ts
/**
 * ADR-0025 — ISA instruction payload format 四型別。
 *
 * - `none`       — 步驟無 payload
 * - `data_table` — payload 為 DataTable
 * - `json`       — payload 為 JSON DocString
 * - `text`       — payload 為 plain text DocString
 *
 * 對應 isa.yml `instructions[].data_format` 欄位字串。
 */
export const DataFormat = {
  NONE: 'none',
  DATA_TABLE: 'data_table',
  JSON: 'json',
  TEXT: 'text',
} as const;

export type DataFormat = (typeof DataFormat)[keyof typeof DataFormat];

/**
 * 從 isa.yml 字串值解析為 DataFormat；null / 空字串 / 未知 → undefined
 * （由呼叫端套用預設規則，例如 instruction 預設為 NONE）。
 */
export function dataFormatFromString(value: string | null | undefined): DataFormat | undefined {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'none':
      return DataFormat.NONE;
    case 'data_table':
      return DataFormat.DATA_TABLE;
    case 'json':
      return DataFormat.JSON;
    case 'text':
      return DataFormat.TEXT;
    default:
      return undefined;
  }
}
