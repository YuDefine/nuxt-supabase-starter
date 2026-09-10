// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/SpecFormulaPlugin.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/SpecFormulaPlugin.ts
import type { Instruction } from './Instruction.js';
import type { LifecycleHook } from './LifecycleHook.js';
import type { SpecReader } from './SpecReader.js';
import type { PluginContext } from './PluginContext.js';

/**
 * SpecFormula plugin umbrella SPI（ADR-0027）。
 *
 * 透過各語言原生 discovery 機制載入：
 *   - Java：ServiceLoader + META-INF/services
 *   - C#：reflection + AppDomain assembly scanning
 *   - **TypeScript**：package.json 之 `specformula.plugin` 欄位 + 動態 `import()`
 *     掃描 node_modules（[ts-0010 §三]）
 *
 * 一個 plugin 可同時提供三類 contribution（Instruction / LifecycleHook / SpecReader），
 * 也可只提供其中一類。三類 contribution 不是獨立 plugin，而是 SpecFormulaPlugin 之
 * 擴充點 — 由 plugin 提供，不能脫離 plugin 單獨存在。
 *
 * 第三方 plugin 之套件 package.json 應宣告：
 *   ```json
 *   {
 *     "specformula": { "plugin": "./dist/plugin.js" },
 *     "peerDependencies": { "@specformula/plugin-api": "^0.1.0" }
 *   }
 *   ```
 * 該 entry 之 default export 為 SpecFormulaPlugin instance。
 */
export interface SpecFormulaPlugin {
  /** Plugin 識別字串。全域唯一；同 id 重複 → 啟動拋錯。 */
  readonly id: string;

  /** Plugin 版本。供 logging / debugging 用，不參與衝突邏輯。 */
  readonly version: string;

  /**
   * 啟動期一次性初始化。框架會於 instruction / lifecycle hook / spec reader
   * 註冊**之前**呼叫。透過 ctx.pluginConfig() 取得 isa.yml `plugins.config.<id>`。
   */
  configure?(ctx: PluginContext): void | Promise<void>;

  /** 此 plugin 提供之 Instruction contribution。 */
  instructions?(): readonly Instruction[];

  /** 此 plugin 提供之 LifecycleHook contribution。 */
  lifecycleHooks?(): readonly LifecycleHook[];

  /** 此 plugin 提供之 SpecReader contribution。 */
  specReaders?(): readonly SpecReader<unknown>[];

  /** Suite 結束時呼叫，反向順序執行。 */
  shutdown?(ctx: PluginContext): void | Promise<void>;
}
