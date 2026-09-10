// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/InstructionDescriptor.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/InstructionDescriptor.ts
import { dataFormatFromString } from './DataFormat.js';
import type { DataFormat } from './DataFormat.js';

/**
 * 描述一個 isa.yml 之 instruction；plugin 看到的最小契約。
 *
 * 具體之 IsaInstruction model 由 `@specformula/core` 提供並 implement 此介面，
 * 避免 plugin-api 反向依賴 core。
 */
export interface InstructionDescriptor {
  readonly name: string;

  /** Regex pattern，含 `^...$` anchor。 */
  readonly format: string;

  /** 對應 isa.yml `instruction_type` 欄位。 */
  readonly instructionType: string;

  /**
   * 對應 isa.yml `data_format` 欄位字串值。
   * 可能為 null（未宣告）；解析後 enum 可透過 `payloadFormat()` 取得。
   */
  readonly dataFormatRaw: string | null;
}

/** 從 raw 字串解析 payload format；未宣告 → undefined（由呼叫端套用預設）。 */
export function payloadFormatOf(desc: InstructionDescriptor): DataFormat | undefined {
  return dataFormatFromString(desc.dataFormatRaw);
}
