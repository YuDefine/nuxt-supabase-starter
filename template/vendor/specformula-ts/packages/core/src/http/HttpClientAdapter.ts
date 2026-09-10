// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/http/HttpClientAdapter.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/http/HttpClientAdapter.ts
/**
 * Framework-agnostic HTTP request representation.
 * Mirrors Java's TestRequest.
 */
export interface TestRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly queryParams: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/**
 * Framework-agnostic HTTP response representation.
 * Mirrors Java's TestResponse.
 */
export interface TestResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly rawBody: string;
}

/**
 * Abstraction over HTTP clients.
 * Implementations: SupertestHttpClientAdapter (in-process), FetchHttpClientAdapter (real server).
 */
export interface HttpClientAdapter {
  execute(request: TestRequest): Promise<TestResponse>;
}
