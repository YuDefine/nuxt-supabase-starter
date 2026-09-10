// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/DefaultDirtyTracker.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/DefaultDirtyTracker.ts
import type { DirtyTracker } from '@specformula/plugin-api';

/**
 * 預設 DirtyTracker — 簡單 Set 包裝。
 * RdbCleanupHook 之類 cleanup plugin 透過 markDirty 標記、afterScenario 讀 dirty()。
 */
export class DefaultDirtyTracker implements DirtyTracker {
  private readonly keys = new Set<string>();

  dirty(): ReadonlySet<string> {
    return this.keys;
  }

  markDirty(key: string): void {
    this.keys.add(key);
  }

  clear(): void {
    this.keys.clear();
  }
}
