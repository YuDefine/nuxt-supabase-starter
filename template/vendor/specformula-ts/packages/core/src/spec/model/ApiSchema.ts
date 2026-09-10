// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/ApiSchema.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/ApiSchema.ts
export interface ApiSchema {
  type: string | null;
  nullable?: boolean;
  format: string | null;
  description: string | null;
  required: string[] | null;
  properties: Record<string, ApiSchema> | null;
  items: ApiSchema | null;
  enumValues: string[] | null;
  example: string | null;
}
