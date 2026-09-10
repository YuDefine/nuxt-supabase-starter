// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/SpecReaderRegistry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/SpecReaderRegistry.ts
import type { SpecReader } from '@specformula/plugin-api';

/**
 * SpecReaderRegistry — specKind → SpecReader contribution。
 *
 * ADR-0027 §五：SpecKind 衝突直接拋錯，**不支援 override**（共享狀態語意混亂）。
 */
export class SpecReaderRegistry {
  private readonly readers = new Map<string, SpecReader<unknown>>();

  register(reader: SpecReader<unknown>): void {
    const kind = reader.specKind;
    if (!kind || kind.trim() === '') {
      throw new Error(`SpecReader has blank specKind`);
    }
    if (this.readers.has(kind)) {
      throw new Error(`Duplicate specKind '${kind}'`);
    }
    this.readers.set(kind, reader);
  }

  find(specKind: string): SpecReader<unknown> | undefined {
    return this.readers.get(specKind);
  }

  specKinds(): ReadonlySet<string> {
    return new Set(this.readers.keys());
  }

  size(): number {
    return this.readers.size;
  }

  all(): ReadonlyMap<string, SpecReader<unknown>> {
    return new Map(this.readers);
  }
}
