// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/ApiParameter.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/ApiParameter.ts
import type { ApiSchema } from './ApiSchema.js';

export interface ApiParameter {
  name: string | null;
  in: string | null;
  required: boolean;
  schema: ApiSchema | null;
  description: string | null;
}
