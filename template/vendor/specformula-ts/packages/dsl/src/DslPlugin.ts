// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/DslPlugin.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/DslPlugin.ts
/**
 * DslPlugin — DSL 模組之 SpecFormulaPlugin（ADR-0027 / ts-0010 §四）。
 *
 * 註冊一個 SpecReader<DslSpec>（specKind="dsl"）供 SpecRegistry 取用 dsl.yml 內容；
 * 真正之 .dsl.feature → .isa.feature 預處理由 DslPreprocessor 於 build / pretest 階段執行，
 * 不在 plugin lifecycle 內。
 *
 * runtime dsl.yml 為 optional：source 不存在或無 dsl_steps 時回傳 null，
 * SpecRegistry 跳過該 entry（與 Java 端對齊）。
 */
import { BUILTIN_PLUGIN_TAG } from '@specformula/plugin-api';
import type {
  PluginContext,
  SpecFormulaPlugin,
  SpecReader,
  SpecSource,
} from '@specformula/plugin-api';
import type { DslSpec } from './DslModels.js';
import { DslYmlReader } from './DslYmlReader.js';

class DslSpecReaderContribution implements SpecReader<DslSpec> {
  readonly specKind = 'dsl';
  readonly modelTypeName = 'DslSpec';

  async read(source: SpecSource, _ctx: PluginContext): Promise<DslSpec> {
    const content = await source.read();
    const reader = new DslYmlReader();
    return reader.read([{ path: source.identifier, content }]);
  }
}

class DslPluginImpl implements SpecFormulaPlugin {
  readonly id = 'specformula.builtin.dsl';
  readonly version = '0.0.1';
  readonly [BUILTIN_PLUGIN_TAG] = true as const;

  specReaders(): readonly SpecReader<unknown>[] {
    return [new DslSpecReaderContribution()];
  }
}

export const dslPlugin: SpecFormulaPlugin = new DslPluginImpl();
export default dslPlugin;
