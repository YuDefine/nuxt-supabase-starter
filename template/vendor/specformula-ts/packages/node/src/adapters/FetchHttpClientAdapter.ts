// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/node/src/adapters/FetchHttpClientAdapter.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/node/src/adapters/FetchHttpClientAdapter.ts
import type { HttpClientAdapter, TestRequest, TestResponse } from '@specformula/core';

/**
 * HttpClientAdapter implementation using the global fetch() API.
 * Used for testing against a real running server.
 */
export class FetchHttpClientAdapter implements HttpClientAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async execute(request: TestRequest): Promise<TestResponse> {
    const url = buildUrl(this.baseUrl, request.url, request.queryParams);

    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
    };

    if (
      request.body != null &&
      request.method !== 'GET' &&
      request.method !== 'HEAD'
    ) {
      init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      if (!(init.headers as Record<string, string>)['Content-Type']) {
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, init);
    const rawBody = await response.text();

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      headers,
      body,
      rawBody,
    };
  }
}

function buildUrl(
  base: string,
  path: string,
  queryParams: Readonly<Record<string, string>>,
): string {
  const fullPath = base ? `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}` : path;
  const params = new URLSearchParams(queryParams);
  const qs = params.toString();
  return qs ? `${fullPath}?${qs}` : fullPath;
}
