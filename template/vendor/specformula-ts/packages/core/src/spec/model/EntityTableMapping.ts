// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/EntityTableMapping.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/EntityTableMapping.ts
export interface EntityTableMapping {
  entity_to_table_mapping: Array<Record<string, string>>;
}

export function entityTableMappingAsMap(
  mapping: EntityTableMapping,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of mapping.entity_to_table_mapping) {
    for (const [k, v] of Object.entries(entry)) {
      result.set(k, v);
    }
  }
  return result;
}
