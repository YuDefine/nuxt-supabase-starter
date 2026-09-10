// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/JsonApiCallStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/JsonApiCallStepDefs.ts
/**
 * JsonApiCall step definitions — JSON DocString format.
 */
import { When } from '@cucumber/cucumber';
import {
  type ApiSpec,
  ApiCall,
} from '@specformula/core';
import type { HttpClientAdapter, TestRequest, TestResponse, ScenarioContext, TimeFormat } from '@specformula/core';

// Re-use the same world interface shape from ApiCallStepDefs
interface ApiCallWorld {
  ctx: ScenarioContext;
  apiSpec: ApiSpec;
  mockResponses: Map<string, { status: number; body: unknown; headers: Record<string, string> }>;
  lastRequest: TestRequest | null;
  lastResponse: TestResponse | null;
  lastError: unknown;
  timeFormat: string;
}

// ─── When — Execute JSON ──────────────────────────────────────────────────────

When('json-api-call {string} WithActor token {string}:', async function (this: ApiCallWorld, summary: string, token: string, docString: string) {
  this.lastError = undefined;
  try {
    const result = await executeJsonApiCall(this, summary, token, docString);
    this.lastResponse = result;
  } catch (err) {
    this.lastError = err;
  }
});

When('json-api-call {string} WithoutActor:', async function (this: ApiCallWorld, summary: string, docString: string) {
  this.lastError = undefined;
  try {
    const result = await executeJsonApiCall(this, summary, null, docString);
    this.lastResponse = result;
  } catch (err) {
    this.lastError = err;
  }
});

When('json-api-call {string} WithoutActor 應拋出錯誤:', async function (this: ApiCallWorld, summary: string, docString: string) {
  this.lastError = undefined;
  try {
    await executeJsonApiCall(this, summary, null, docString);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function executeJsonApiCall(
  world: ApiCallWorld,
  summary: string,
  token: string | null,
  docString: string,
): Promise<TestResponse> {
  let capturedRequest: TestRequest | null = null;
  const mockClient: HttpClientAdapter = {
    execute(req: TestRequest): Promise<TestResponse> {
      capturedRequest = req;
      const resp = world.mockResponses.get(summary);
      if (resp) {
        return Promise.resolve({
          status: resp.status,
          headers: resp.headers,
          body: resp.body,
          rawBody: JSON.stringify(resp.body),
        });
      }
      return Promise.resolve({ status: 200, headers: {}, body: null, rawBody: '' });
    },
  };

  const timeFormat = (world.timeFormat ?? 'ISO') as TimeFormat;
  const apiCall = new ApiCall(mockClient, world.ctx, timeFormat);

  const response = await apiCall.executeFromJson(
    world.apiSpec,
    summary,
    docString,
    token,
  );

  world.lastRequest = capturedRequest;
  return response;
}
