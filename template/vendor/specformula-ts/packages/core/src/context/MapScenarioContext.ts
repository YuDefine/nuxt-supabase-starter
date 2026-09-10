// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/context/MapScenarioContext.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/context/MapScenarioContext.ts
import type { ScenarioContext, LastResponseData } from './ScenarioContext.js';

/**
 * Simple Map-backed ScenarioContext implementation.
 * Used in Cucumber step definitions where AsyncLocalStorage is not needed,
 * and as a fallback / test helper.
 */
export class MapScenarioContext implements ScenarioContext {
  private readonly variables = new Map<string, unknown>();
  private lastResponse: LastResponseData | undefined;

  set(key: string, value: unknown): void {
    this.variables.set(key, value);
  }

  get(key: string): unknown {
    return this.variables.get(key);
  }

  has(key: string): boolean {
    return this.variables.has(key);
  }

  clear(): void {
    this.variables.clear();
    this.lastResponse = undefined;
  }

  setLastResponse(response: LastResponseData): void {
    this.lastResponse = response;
  }

  getLastResponse(): LastResponseData | undefined {
    return this.lastResponse;
  }
}
