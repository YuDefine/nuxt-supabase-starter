// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/context/ScenarioContextImpl.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/context/ScenarioContextImpl.ts
import { AsyncLocalStorage } from 'async_hooks';
import type { ScenarioContext, LastResponseData } from './ScenarioContext.js';

/**
 * Per-scenario state store shape held inside AsyncLocalStorage.
 */
interface ContextStore {
  variables: Map<string, unknown>;
  lastResponse: LastResponseData | undefined;
}

/**
 * Module-level AsyncLocalStorage instance shared across all step definitions.
 * One store per scenario run — each `runInContext` call creates a fresh Map.
 */
const als = new AsyncLocalStorage<ContextStore>();

/**
 * ScenarioContext implementation backed by AsyncLocalStorage.
 * All reads/writes are scoped to the current async execution context (scenario).
 *
 * Usage:
 *   // In Cucumber Before hook:
 *   await ScenarioContextImpl.runInContext(async () => { ... all steps ... });
 *
 *   // In step definitions:
 *   const ctx = ScenarioContextImpl.current();
 */
export class ScenarioContextImpl implements ScenarioContext {
  /**
   * Run a callback inside a fresh scenario context.
   * All step definitions executing within the callback share the same store.
   */
  static async runInContext<T>(fn: () => Promise<T>): Promise<T> {
    const store: ContextStore = {
      variables: new Map(),
      lastResponse: undefined,
    };
    return als.run(store, fn);
  }

  /**
   * Get the ScenarioContext for the current async execution context.
   * Returns a new ScenarioContextImpl that delegates to the ALS store.
   * Throws if called outside a runInContext scope.
   */
  static current(): ScenarioContext {
    return new ScenarioContextImpl();
  }

  private getStore(): ContextStore {
    const store = als.getStore();
    if (!store) {
      throw new Error(
        'ScenarioContext accessed outside of a scenario execution context. ' +
          'Ensure ScenarioContextImpl.runInContext() wraps the scenario lifecycle.',
      );
    }
    return store;
  }

  set(key: string, value: unknown): void {
    this.getStore().variables.set(key, value);
  }

  get(key: string): unknown {
    return this.getStore().variables.get(key);
  }

  has(key: string): boolean {
    return this.getStore().variables.has(key);
  }

  clear(): void {
    const store = this.getStore();
    store.variables.clear();
    store.lastResponse = undefined;
  }

  setLastResponse(response: LastResponseData): void {
    this.getStore().lastResponse = response;
  }

  getLastResponse(): LastResponseData | undefined {
    return this.getStore().lastResponse;
  }
}
