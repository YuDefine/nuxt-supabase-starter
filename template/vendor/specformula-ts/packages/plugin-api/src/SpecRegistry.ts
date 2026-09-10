// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/SpecRegistry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/SpecRegistry.ts
/**
 * 已載入之 spec 集中註冊表。所有 SpecReader 解析結果皆進此 registry，
 * 供其他 contribution（Instruction / LifecycleHook）透過 PluginContext.specs() 取用。
 */
export interface SpecRegistry {
  /** 取得指定 specKind 之 spec model；不存在 → undefined。 */
  get(specKind: string): unknown;

  /**
   * 取得指定 specKind 之 spec model（typed）；不存在 → undefined。
   * 型別檢核僅止於 TS compile-time（structural typing）；runtime 不做 instanceof 檢查。
   */
  getTyped<T>(specKind: string): T | undefined;

  /** 註冊一個 spec model。由 SpecReaderRegistry 在啟動時呼叫。 */
  put(specKind: string, spec: unknown): void;

  /** 已註冊之所有 spec kind。 */
  kinds(): ReadonlySet<string>;
}
