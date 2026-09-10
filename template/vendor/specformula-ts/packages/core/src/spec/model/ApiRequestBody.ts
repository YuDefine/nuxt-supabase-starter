// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/ApiRequestBody.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/ApiRequestBody.ts
import type { ApiSchema } from './ApiSchema.js';

export interface ApiRequestBody {
  required: boolean;
  schema: ApiSchema | null;
  contentType: string | null;
}
