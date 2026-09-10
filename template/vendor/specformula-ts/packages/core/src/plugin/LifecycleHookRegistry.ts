// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/LifecycleHookRegistry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/LifecycleHookRegistry.ts
import type {
  LifecycleHook,
  PluginContext,
  ScenarioContext,
} from '@specformula/plugin-api';

/**
 * 註冊與執行 LifecycleHook 之 registry。
 *
 * 每個 moment（beforeSuite / beforeScenario / afterScenario / afterSuite）內部以
 * order 升冪、同 order 依 name 字典序排序。afterSuite 採反向順序執行。
 *
 * - beforeSuite / beforeScenario：失敗即拋（中斷 suite / scenario）。
 * - afterScenario / afterSuite：失敗以 console.warn 記錄但不中斷（資源清理 best-effort）。
 */
export class LifecycleHookRegistry {
  private readonly hooks: LifecycleHook[] = [];
  private readonly names = new Set<string>();

  register(hook: LifecycleHook): void {
    const name = hook.name;
    if (!name || name.trim() === '') {
      throw new Error(`LifecycleHook has blank name`);
    }
    if (this.names.has(name)) {
      throw new Error(`Duplicate LifecycleHook name: ${name}`);
    }
    this.names.add(name);
    this.hooks.push(hook);
  }

  ordered(): readonly LifecycleHook[] {
    return [...this.hooks].sort((a, b) => {
      const orderDiff = a.order - b.order;
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
  }

  orderedReversed(): readonly LifecycleHook[] {
    return [...this.ordered()].reverse();
  }

  async executeBeforeSuite(ctx: PluginContext): Promise<void> {
    for (const h of this.ordered()) {
      if (!h.beforeSuite) continue;
      try {
        await h.beforeSuite(ctx);
      } catch (err) {
        throw new Error(
          `LifecycleHook '${h.name}' beforeSuite failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err instanceof Error ? err : undefined },
        );
      }
    }
  }

  async executeBeforeScenario(
    ctxFactory: (hook: LifecycleHook) => ScenarioContext,
  ): Promise<void> {
    for (const h of this.ordered()) {
      if (!h.beforeScenario) continue;
      try {
        await h.beforeScenario(ctxFactory(h));
      } catch (err) {
        throw new Error(
          `LifecycleHook '${h.name}' beforeScenario failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err instanceof Error ? err : undefined },
        );
      }
    }
  }

  async executeAfterScenario(
    ctxFactory: (hook: LifecycleHook) => ScenarioContext,
  ): Promise<void> {
    for (const h of this.ordered()) {
      if (!h.afterScenario) continue;
      try {
        await h.afterScenario(ctxFactory(h));
      } catch (err) {
        // afterScenario 失敗以 warn 記錄，不中斷後續 hooks
        console.warn(
          `LifecycleHook '${h.name}' afterScenario failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async executeAfterSuite(ctx: PluginContext): Promise<void> {
    for (const h of this.orderedReversed()) {
      if (!h.afterSuite) continue;
      try {
        await h.afterSuite(ctx);
      } catch (err) {
        console.warn(
          `LifecycleHook '${h.name}' afterSuite failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  size(): number {
    return this.hooks.length;
  }
}
