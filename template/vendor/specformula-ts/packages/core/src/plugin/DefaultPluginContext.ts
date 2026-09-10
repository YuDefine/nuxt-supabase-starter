// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/DefaultPluginContext.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/DefaultPluginContext.ts
import type { PluginContext, SpecRegistry } from '@specformula/plugin-api';

type VariableResolver = (reference: string) => unknown;

/**
 * 預設 PluginContext 實作。提供 SpecRegistry / pluginConfig / variableResolver
 * / resources（具名共享物件）；withPluginConfig() 用於 PluginLoader 在 configure
 * 階段為每個 plugin 衍生獨立 pluginConfig 之 context。
 */
export class DefaultPluginContext implements PluginContext {
  private readonly _specs: SpecRegistry;
  private readonly _pluginConfig: Readonly<Record<string, unknown>>;
  private readonly _variableResolver: VariableResolver;
  private readonly resources = new Map<string, unknown>();

  constructor(
    specs: SpecRegistry,
    pluginConfig: Readonly<Record<string, unknown>> = {},
    variableResolver: VariableResolver = () => undefined,
  ) {
    this._specs = specs;
    this._pluginConfig = pluginConfig;
    this._variableResolver = variableResolver;
  }

  specs(): SpecRegistry {
    return this._specs;
  }

  pluginConfig(): Readonly<Record<string, unknown>> {
    return this._pluginConfig;
  }

  variableResolver(): VariableResolver {
    return this._variableResolver;
  }

  resource(key: string): unknown {
    return this.resources.get(key);
  }

  putResource(key: string, value: unknown): void {
    this.resources.set(key, value);
  }

  /** 衍生新的 context 並覆寫 pluginConfig，其餘共用。 */
  withPluginConfig(config: Readonly<Record<string, unknown>>): DefaultPluginContext {
    const copy = new DefaultPluginContext(this._specs, config, this._variableResolver);
    for (const [k, v] of this.resources) copy.resources.set(k, v);
    return copy;
  }
}
