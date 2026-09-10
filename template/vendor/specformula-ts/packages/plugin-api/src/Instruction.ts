// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/Instruction.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/Instruction.ts
import type { DataFormat } from './DataFormat.js';
import type { InstructionDescriptor } from './InstructionDescriptor.js';
import type { IsaStepExecutor } from './IsaStepExecutor.js';
import type { PluginContext } from './PluginContext.js';

/**
 * 指令 contribution。對應 isa.yml `instructions[].instruction_type` 之擴充點。
 *
 * 由 SpecFormulaPlugin.instructions() 提供；一個 Instruction 對應一個 instructionType
 * （全域唯一）。Runtime 依 instruction 之 type 從 InstructionRegistry 找到對應
 * contribution，呼叫 create() 產生 executor。
 */
export interface Instruction {
  /**
   * 對應 isa.yml `instruction_type` 欄位；全域唯一。
   *
   * Plugin 不可註冊 `instructionType === 'custom'`（ADR-0027 §3.1 / §五）：
   * `custom` 為保留字，專屬 ADR-0013 之 project-side BDD seam。
   */
  readonly instructionType: string;

  /**
   * 此指令支援之 payload format 集合。**必須至少包含一個值**；
   * 本 ADR 不支援 wildcard / 空集合語意。
   */
  readonly supportedDataFormats: ReadonlySet<DataFormat>;

  /**
   * 給定 isa.yml 中一個 instruction descriptor，回傳對應之 executor。
   * Executor 可為無狀態 closure，亦可為每個 instruction 建立獨立 state。
   */
  create(instruction: InstructionDescriptor, ctx: PluginContext): IsaStepExecutor;
}
