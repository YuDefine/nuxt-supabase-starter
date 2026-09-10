// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/ColumnDefinition.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/ColumnDefinition.ts
export interface ColumnDefinition {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  defaultValue: string | null;
  foreignKey: string | null; // format: table.column
  checkConstraint: string | null;
  comment: string | null;
}
