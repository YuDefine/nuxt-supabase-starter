// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/BuiltinInstructionsPlugin.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/BuiltinInstructionsPlugin.ts
/**
 * BuiltinInstructionsPlugin — 內建六指令之 SpecFormulaPlugin（ADR-0027 / #346）。
 *
 * 把既有六個 cucumber dispatcher（entity_setup / entity_validate /
 * entity_non_existence_validate / api_call / response_validate / time_control）
 * 以 Instruction contribution 形式進入 InstructionRegistry，讓內建與第三方走同一條
 * dispatch 查找路徑（含 disabled / override_builtin 衝突規則）。
 *
 * 為了讓內建 runtime 行為與改版前 byte-identical，各 contribution 以 module 內部
 * RAW_DISPATCH symbol 附掛原始 dispatcher；StepDefinitionFactory 辨識到此 marker 時
 * 直接沿用既有 makeWrapper + Given/When/Then 註冊路徑，不經 IsaStepExecutor 適配層。
 */
import { BUILTIN_PLUGIN_TAG, DataFormat } from '@specformula/plugin-api';
import type {
  Instruction,
  InstructionDescriptor,
  IsaStepExecutor,
  PluginContext,
  SpecFormulaPlugin,
} from '@specformula/plugin-api';
import {
  dispatchApiCall,
  dispatchEntityNonExistenceValidate,
  dispatchEntitySetup,
  dispatchEntityValidate,
  dispatchResponseValidate,
  dispatchTimeControl,
} from './StepDefinitionFactory.js';

/**
 * Package 內部 marker：附掛在內建 contribution 上之原始 dispatcher。
 * 不從 package index re-export — 僅供 StepDefinitionFactory 辨識內建路徑。
 */
export const RAW_DISPATCH: unique symbol = Symbol('@specformula/cucumber:RAW_DISPATCH');

export interface RawDispatch {
  /** 對應改版前 hardcoded 之 Given / When / Then 註冊 keyword。 */
  readonly keyword: 'Given' | 'When' | 'Then';

  /** 原始 world-free dispatcher（吃 cucumber args、經 SpecFormulaBridge 執行）。 */
  readonly handler: (args: unknown[]) => Promise<void>;

  /**
   * true → makeWrapper 用 captureArity（改版前僅 time_control）；
   * false → captureArity + 1（其餘吃 DataTable / DocString 尾參數之指令）。
   */
  readonly useCaptureArityOnly: boolean;
}

/** 取 contribution 上之 RAW_DISPATCH marker；第三方 contribution → undefined。 */
export function rawDispatchOf(contribution: Instruction): RawDispatch | undefined {
  return (contribution as Partial<Record<typeof RAW_DISPATCH, RawDispatch>>)[RAW_DISPATCH];
}

class BuiltinInstructionContribution implements Instruction {
  readonly instructionType: string;
  readonly supportedDataFormats: ReadonlySet<DataFormat>;
  readonly [RAW_DISPATCH]: RawDispatch;

  constructor(
    instructionType: string,
    supportedDataFormats: ReadonlySet<DataFormat>,
    raw: RawDispatch,
  ) {
    this.instructionType = instructionType;
    this.supportedDataFormats = supportedDataFormats;
    this[RAW_DISPATCH] = raw;
  }

  create(_instruction: InstructionDescriptor, _ctx: PluginContext): IsaStepExecutor {
    // 內建指令不走 executor 適配層：StepDefinitionFactory 以 RAW_DISPATCH 直通
    // 既有 dispatcher（保持 byte-identical 行為）。此方法不應被呼叫。
    throw new Error(
      `Builtin instruction '${this.instructionType}' is dispatched via its raw cucumber ` +
        `dispatcher by StepDefinitionFactory; create() is not used for builtins.`,
    );
  }
}

// supportedDataFormats 依各 dispatcher 實際接受之 payload 推導：
//   entity_setup / entity_validate / api_call / response_validate — DataTable 或 JSON DocString
//   entity_non_existence_validate — 僅 DataTable（dispatcher 對非 DataTable 直接 throw）
//   time_control — 無 payload
const TABLE_OR_JSON: ReadonlySet<DataFormat> = new Set([DataFormat.DATA_TABLE, DataFormat.JSON]);
const TABLE_ONLY: ReadonlySet<DataFormat> = new Set([DataFormat.DATA_TABLE]);
const NO_PAYLOAD: ReadonlySet<DataFormat> = new Set([DataFormat.NONE]);

class BuiltinInstructionsPluginImpl implements SpecFormulaPlugin {
  readonly id = 'specformula.builtin.instructions';
  readonly version = '0.0.1';
  readonly [BUILTIN_PLUGIN_TAG] = true as const;

  instructions(): readonly Instruction[] {
    return [
      new BuiltinInstructionContribution('entity_setup', TABLE_OR_JSON, {
        keyword: 'Given',
        handler: dispatchEntitySetup,
        useCaptureArityOnly: false,
      }),
      new BuiltinInstructionContribution('entity_validate', TABLE_OR_JSON, {
        keyword: 'Then',
        handler: dispatchEntityValidate,
        useCaptureArityOnly: false,
      }),
      new BuiltinInstructionContribution('entity_non_existence_validate', TABLE_ONLY, {
        keyword: 'Then',
        handler: dispatchEntityNonExistenceValidate,
        useCaptureArityOnly: false,
      }),
      new BuiltinInstructionContribution('api_call', TABLE_OR_JSON, {
        keyword: 'When',
        handler: dispatchApiCall,
        useCaptureArityOnly: false,
      }),
      new BuiltinInstructionContribution('response_validate', TABLE_OR_JSON, {
        keyword: 'Then',
        handler: dispatchResponseValidate,
        useCaptureArityOnly: false,
      }),
      new BuiltinInstructionContribution('time_control', NO_PAYLOAD, {
        keyword: 'Given',
        handler: dispatchTimeControl,
        useCaptureArityOnly: true,
      }),
    ];
  }
}

export const builtinInstructionsPlugin: SpecFormulaPlugin = new BuiltinInstructionsPluginImpl();
export default builtinInstructionsPlugin;
