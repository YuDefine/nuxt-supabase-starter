// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/DatabaseSchema.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/DatabaseSchema.ts
import type { TableDefinition } from './TableDefinition.js';
import type { EntityTableMapping } from './EntityTableMapping.js';

export interface DatabaseSchema {
  tables: TableDefinition[];
  entityTableMapping: EntityTableMapping;
  dataSourceName: string;
  dbType: string;
}
