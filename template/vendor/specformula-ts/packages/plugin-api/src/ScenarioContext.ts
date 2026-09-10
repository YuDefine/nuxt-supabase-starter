// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/ScenarioContext.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/ScenarioContext.ts
import type { PluginContext } from './PluginContext.js';
import type { DirtyTracker } from './DirtyTracker.js';

/**
 * Scenario 級 lifecycle hook 收到的 context。
 *
 * 在 PluginContext 基礎上額外提供 DirtyTracker — 此 scenario 內髒資源追蹤介面。
 * 鍵的語意由 hook 自定（RDB = table name、Redis = key prefix、S3 = bucket+prefix）。
 *
 * 在 LifecycleHook.beforeScenario / afterScenario 中可用。
 */
export interface ScenarioContext extends PluginContext {
  /**
   * 此 scenario 之 dirty tracker。
   * 回傳 null 表示此環境不支援 tracking；hook 應依文件規範 fallback。
   */
  tracker(): DirtyTracker | null;
}
