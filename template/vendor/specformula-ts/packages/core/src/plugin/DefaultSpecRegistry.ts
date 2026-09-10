// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/DefaultSpecRegistry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/DefaultSpecRegistry.ts
import type { SpecRegistry } from '@specformula/plugin-api';

/**
 * 預設 SpecRegistry 實作。
 *
 * ADR-0027 §五：當 plugin.config.<id>.disabled.spec_readers 列出某個 specKind，
 * 該 kind 的 reader 不會註冊，但 consumer 仍可能透過 get() 詢問；此時拋錯
 * （runtime detection）而非 silent undefined。
 */
export class DefaultSpecRegistry implements SpecRegistry {
  private readonly specs = new Map<string, unknown>();
  private disabledSpecKinds: ReadonlySet<string> = new Set();

  /** PluginLoader 載入完成後注入 disabled 名單以啟用 runtime detection。 */
  setDisabledSpecKinds(disabled: ReadonlySet<string>): void {
    this.disabledSpecKinds = new Set(disabled);
  }

  get(specKind: string): unknown {
    if (this.disabledSpecKinds.has(specKind)) {
      throw new Error(
        `SpecKind '${specKind}' was disabled via plugins.config.disabled.spec_readers — ` +
          `consumer must not request a disabled spec (ADR-0027 §五)`,
      );
    }
    return this.specs.get(specKind);
  }

  getTyped<T>(specKind: string): T | undefined {
    const value = this.get(specKind);
    return value as T | undefined;
  }

  put(specKind: string, spec: unknown): void {
    this.specs.set(specKind, spec);
  }

  kinds(): ReadonlySet<string> {
    return new Set(this.specs.keys());
  }
}
