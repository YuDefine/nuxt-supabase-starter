// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/ApiOperation.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/ApiOperation.ts
import type { ApiParameter } from './ApiParameter.js';
import type { ApiRequestBody } from './ApiRequestBody.js';
import type { ApiResponse } from './ApiResponse.js';

export interface ApiOperation {
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  operationId: string | null;
  tags: string[] | null;
  parameters: ApiParameter[] | null;
  requestBody: ApiRequestBody | null;
  responses: Record<string, ApiResponse> | null;
}
