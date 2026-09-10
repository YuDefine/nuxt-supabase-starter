// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/bootstrapPlugins.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/bootstrapPlugins.ts
/**
 * bootstrapPlugins — BDD bootstrap 之 plugin 載入 helper（ADR-0027 / #346）。
 *
 * 標準用法（benchmark environment.ts；順序重要 — plugin 先載，plugin 貢獻之
 * instruction_type 才能通過 IsaSpecReader 驗證）：
 *
 *   const loader = await loadSpecFormulaPlugins();
 *   const isaSpec = new IsaSpecReader().read();
 *   StepDefinitionFactory.register(isaSpec.instructions ?? [], loader.instructions, {
 *     disabledInstructionTypes: loader.getDisabledInstructionTypes(),
 *   });
 */
import {
  DefaultPluginContext,
  DefaultSpecRegistry,
  IsaSpecReader,
  PluginLoader,
} from '@specformula/core';

import { builtinInstructionsPlugin } from './BuiltinInstructionsPlugin.js';
import { bridgeVariableResolver } from './StepDefinitionFactory.js';

export interface LoadSpecFormulaPluginsOptions {
  /** node_modules 掃描起點（預設 process.cwd()）。 */
  readonly projectRoot?: string;

  /** 關閉 node_modules 掃描（測試 / 純 builtin 場景）。預設 false。 */
  readonly skipNodeModulesScan?: boolean;

  /**
   * plugins.config 內容（plugin id → config 物件）。
   * 注意：TS 之 IsaSpec model 目前只有 config / instructions 兩區塊
   * （core/src/spec/model/IsaSpec.ts），isa.yml 尚無 plugins section 可透傳，
   * 故由呼叫端以此 option 提供；未來 IsaSpec 支援 plugins 區塊後可直接餵入。
   */
  readonly pluginsConfig?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;

  /** Discovery / 註冊過程之 logger（預設 console.info）。 */
  readonly log?: (message: string) => void;
}

/**
 * 建構並載入 PluginLoader（builtin instructions plugin + node_modules 掃描），
 * 並把 registry 內全部 instruction_type 註冊給 IsaSpecReader，讓後續
 * IsaSpecReader.read() 接受 plugin 指令。
 */
export async function loadSpecFormulaPlugins(
  opts: LoadSpecFormulaPluginsOptions = {},
): Promise<PluginLoader> {
  const loader = new PluginLoader({
    builtinPlugins: [builtinInstructionsPlugin],
    projectRoot: opts.projectRoot,
    skipNodeModulesScan: opts.skipNodeModulesScan,
    log: opts.log,
  });
  const baseContext = new DefaultPluginContext(
    new DefaultSpecRegistry(),
    {},
    bridgeVariableResolver,
  );
  await loader.load(baseContext, opts.pluginsConfig ?? {});
  IsaSpecReader.registerPluginInstructionTypes(loader.instructions.instructionTypes());
  return loader;
}
