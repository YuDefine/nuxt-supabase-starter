// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/SpecReader.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/SpecReader.ts
import type { PluginContext } from './PluginContext.js';
import type { SpecSource } from './SpecSource.js';

/**
 * Spec reader contribution。對應一個 specKind（例：isa、api、data、dsl、第三方 events）。
 *
 * 由 SpecFormulaPlugin.specReaders() 提供。解析結果集中存於 SpecRegistry，
 * 供其他 contribution 透過 PluginContext.specs() 取用。
 *
 * TS 之 type erasure：`modelTypeName` 為 runtime 識別字串（替代 Java `Class<T>`），
 * 供 SpecRegistry 與 buildErrorFromRegistry 之類做 type-safe 取用提示；
 * runtime 不做嚴格 instanceof 檢查，採 structural typing。
 */
export interface SpecReader<T> {
  /** Spec kind，全域唯一。 */
  readonly specKind: string;

  /** Model 型別之識別字串（替代 Java `Class<T>`），供 logging / debug。 */
  readonly modelTypeName: string;

  /** 從 source 解析 model；async 為 default。 */
  read(source: SpecSource, ctx: PluginContext): Promise<T>;

  /** 對 model 做後置 validation；回傳錯誤訊息清單（空 list = OK）。 */
  validate?(spec: T): readonly string[];
}
