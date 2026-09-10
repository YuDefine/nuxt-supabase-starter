// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/adapters/SupertestHttpClientAdapter.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/adapters/SupertestHttpClientAdapter.ts
import type { HttpClientAdapter, TestRequest, TestResponse } from '@specformula/core';

/**
 * HttpClientAdapter implementation using supertest for in-process HTTP testing.
 * Placeholder — requires a reference to the app/server under test.
 * Full implementation will be wired in Phase 8.
 */
export class SupertestHttpClientAdapter implements HttpClientAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly app: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(app: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.app = app;
  }

  execute(_request: TestRequest): Promise<TestResponse> {
    return Promise.reject(new Error(
      'SupertestHttpClientAdapter is not yet implemented. Use FetchHttpClientAdapter for external servers.',
    ));
  }
}
