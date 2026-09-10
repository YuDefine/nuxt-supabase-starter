// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/PayloadView.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/PayloadView.ts
import { DataFormat } from './DataFormat.js';

/**
 * Step payload 的語言中立視角。包裝 DataTable / JSON DocString / Plain text DocString。
 *
 * Plugin author 透過此介面取用 payload，無需依賴 Cucumber.js 之 DataTable / DocString。
 * 具體適配層由 `@specformula/cucumber` 之 CucumberPayloadView 實作。
 */
export interface PayloadView {
  readonly format: DataFormat;
  isEmpty(): boolean;

  /**
   * 將 DataTable 表達為 list-of-lists（含 header row）。
   * 僅當 `format === DataFormat.DATA_TABLE` 時可用；其餘 → throw。
   */
  asRows(): ReadonlyArray<ReadonlyArray<string>>;

  /**
   * 將 DataTable 表達為 list-of-maps（以第一行為 header）。
   * 僅當 `format === DataFormat.DATA_TABLE` 時可用；其餘 → throw。
   */
  asMaps(): ReadonlyArray<Readonly<Record<string, string>>>;

  /**
   * 取得 DocString 原始字串內容（json 或 plain text）。
   * 僅當 `format === DataFormat.JSON` 或 `DataFormat.TEXT` 時可用；其餘 → throw。
   */
  asString(): string;

  /**
   * 取得底層原始物件（依 BDD backend 而定，例：Cucumber.js DataTable / docString）。
   * 內建 plugin 可透過此 backdoor 沿用既有 Cucumber API；
   * 第三方 plugin 應優先用 asRows / asMaps / asString。
   */
  raw(): unknown;
}

/**
 * 空 payload 的單例。對應 instruction.data_format = 'none'。
 */
export const NONE_PAYLOAD: PayloadView = Object.freeze({
  format: DataFormat.NONE,
  isEmpty(): boolean {
    return true;
  },
  asRows(): never {
    throw new Error('payload format is NONE, no rows');
  },
  asMaps(): never {
    throw new Error('payload format is NONE, no maps');
  },
  asString(): never {
    throw new Error('payload format is NONE, no string');
  },
  raw(): null {
    return null;
  },
});
