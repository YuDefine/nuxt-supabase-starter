// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/context/ScenarioContext.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/context/ScenarioContext.ts
/**
 * Per-scenario state container.
 * Primary: AsyncLocalStorage. Fallback: Cucumber World (explicit parameter).
 * Mirrors Java's ScenarioContext (ThreadLocal-based).
 */
export interface ScenarioContext {
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  has(key: string): boolean;
  clear(): void;

  setLastResponse(response: LastResponseData): void;
  getLastResponse(): LastResponseData | undefined;
}

export interface LastResponseData {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly rawBody: string;
}
