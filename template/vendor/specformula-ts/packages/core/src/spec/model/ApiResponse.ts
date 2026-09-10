// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/ApiResponse.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/ApiResponse.ts
import type { ApiSchema } from './ApiSchema.js';

export interface ApiResponse {
  statusCode: string;
  description: string | null;
  schema: ApiSchema | null;
  contentType: string | null;
  plainText: boolean;
}
