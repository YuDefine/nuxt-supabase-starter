// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/LifecycleHook.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/LifecycleHook.ts
import type { PluginContext } from './PluginContext.js';
import type { ScenarioContext } from './ScenarioContext.js';

/**
 * Lifecycle hook contribution。對應 suite / scenario 兩個層級之開始與結束時機，
 * cleanup（資源清理）為其中一個常見使用情境。
 *
 * 四個 moment 皆 optional，hook 可只實作其中需要之子集（透過 undefined property）。
 * 原本「scope = SCENARIO / SUITE」之二分藉由「實作哪些 moment」自然表達。
 *
 * 同一 moment 內，多個 hook 以 order 升冪執行；同 order 依 name 字典序。
 * afterSuite 採反向順序執行（資源 acquire / release LIFO 一致）。
 */
export interface LifecycleHook {
  /** 全域唯一字串，例：rdb-cleanup、redis-cleanup、s3-cleanup。 */
  readonly name: string;

  /**
   * 整數順序；於每個 moment 內各自排序。
   * 由小到大執行；同 order 依 name 字典序。
   */
  readonly order: number;

  /** Suite 啟動時呼叫一次，可在此建立連線池、快取 schema 等。 */
  beforeSuite?(ctx: PluginContext): void | Promise<void>;

  /** 每個 scenario 開始時呼叫，可在此重設 mock state、開新 transaction 等。 */
  beforeScenario?(ctx: ScenarioContext): void | Promise<void>;

  /**
   * 每個 scenario 結束時呼叫；cleanup（資源清理）為此 moment 之主要使用情境，
   * ScenarioContext.tracker() 在此可用。
   */
  afterScenario?(ctx: ScenarioContext): void | Promise<void>;

  /** Suite 結束時呼叫一次；釋放連線 / 關閉快取等。反向順序執行。 */
  afterSuite?(ctx: PluginContext): void | Promise<void>;
}
