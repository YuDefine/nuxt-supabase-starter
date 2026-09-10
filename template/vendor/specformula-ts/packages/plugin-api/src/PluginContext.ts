// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/PluginContext.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/PluginContext.ts
import type { SpecRegistry } from './SpecRegistry.js';

/**
 * 跨 plugin 共用的上下文。在 plugin configure() / Instruction.create / LifecycleHook
 * 之 suite 級 hook 等所有 plugin 入口都會被傳入。
 *
 * Scenario 級 hook（beforeScenario / afterScenario）收到的是 ScenarioContext
 * （本介面之擴充，多了 tracker()）。
 */
export interface PluginContext {
  /** 已載入之 spec 集中註冊表。 */
  specs(): SpecRegistry;

  /**
   * 取得目前 plugin 的 config Map（來自 isa.yml `plugins.config.<id>`）。
   * 空物件表示沒有對應 config 區塊。
   */
  pluginConfig(): Readonly<Record<string, unknown>>;

  /**
   * 變數解析器。可用於 plugin 取得 scenario context 中之變數值
   * （與 isa.yml `{{varName}}` 引用相同語意）。
   */
  variableResolver(): (reference: string) => unknown;

  /**
   * 取得 plugin 共享資源（例：HTTP client、Authenticator）。
   * 鍵的語意由 BDD backend 與 builtin plugin 共同定義；第三方 plugin 一般不需使用。
   */
  resource(key: string): unknown;
}
