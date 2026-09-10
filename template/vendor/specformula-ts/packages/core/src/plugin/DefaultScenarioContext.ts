// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/DefaultScenarioContext.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/DefaultScenarioContext.ts
import type {
  DirtyTracker,
  PluginContext,
  ScenarioContext,
  SpecRegistry,
} from '@specformula/plugin-api';

/**
 * 預設 ScenarioContext 實作：包裝既有 PluginContext，加上 scenario 級的 DirtyTracker。
 */
export class DefaultScenarioContext implements ScenarioContext {
  constructor(
    private readonly delegate: PluginContext,
    private readonly _tracker: DirtyTracker | null,
  ) {}

  tracker(): DirtyTracker | null {
    return this._tracker;
  }

  specs(): SpecRegistry {
    return this.delegate.specs();
  }

  pluginConfig(): Readonly<Record<string, unknown>> {
    return this.delegate.pluginConfig();
  }

  variableResolver(): (reference: string) => unknown {
    return this.delegate.variableResolver();
  }

  resource(key: string): unknown {
    return this.delegate.resource(key);
  }
}
