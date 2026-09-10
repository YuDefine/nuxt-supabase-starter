// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/TableDefinition.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/TableDefinition.ts
import type { ColumnDefinition } from './ColumnDefinition.js';

export interface TableDefinitionData {
  tableName: string;
  schemaName?: string | undefined;
  comment: string | null;
  columns: ColumnDefinition[];
  pkColumns: string[];
  queryColumns: string[];
  dbType?: string | undefined;
}

/**
 * Mutable TableDefinition class with lazy-computed SQL properties.
 * Mirrors the Java TableDefinition.
 */
export class TableDefinition implements TableDefinitionData {
  tableName: string;
  schemaName: string | undefined;
  comment: string | null;
  columns: ColumnDefinition[];
  pkColumns: string[];
  queryColumns: string[];
  dbType: string | undefined;

  private _selectSql: string | null = null;
  private _selectWhereColumnIndex: Map<string, number> | null = null;
  private _selectByValuesSql: string | null = null;
  private _selectByValuesIndex: Map<string, number[]> | null = null;

  constructor(data: TableDefinitionData) {
    this.tableName = data.tableName;
    this.schemaName = data.schemaName;
    this.comment = data.comment;
    this.columns = data.columns;
    this.pkColumns = data.pkColumns;
    this.queryColumns = data.queryColumns;
    this.dbType = data.dbType;
  }

  get selectSql(): string {
    this.ensureSelectBuilt();
    return this._selectSql!;
  }

  get selectWhereColumnIndex(): Map<string, number> {
    this.ensureSelectBuilt();
    return this._selectWhereColumnIndex!;
  }

  get selectByValuesSql(): string {
    this.ensureSelectByValuesBuilt();
    return this._selectByValuesSql!;
  }

  get selectByValuesIndex(): Map<string, number[]> {
    this.ensureSelectByValuesBuilt();
    return this._selectByValuesIndex!;
  }

  toJSON(): object {
    return {
      tableName: this.tableName,
      schemaName: this.schemaName,
      comment: this.comment,
      columns: this.columns,
      pkColumns: this.pkColumns,
      queryColumns: this.queryColumns,
    };
  }

  addColumn(name: string, type: string): void {
    this.columns.push({
      name,
      type,
      notNull: false,
      primaryKey: false,
      autoIncrement: false,
      unique: false,
      defaultValue: null,
      foreignKey: null,
      checkConstraint: null,
      comment: null,
    });
    this.invalidateSqlCache();
  }

  setQueryColumns(cols: string[]): void {
    this.queryColumns = cols;
    this._selectByValuesSql = null;
    this._selectByValuesIndex = null;
  }

  private getQuotedQualifiedTableName(): string {
    // The tableName may already carry quotes (e.g. '"user"') — preserve as-is
    if (this.schemaName) {
      return `${this.schemaName}.${this.tableName}`;
    }
    return this.tableName;
  }

  private ensureSelectBuilt(): void {
    if (this._selectSql !== null) return;

    const colList = this.columns.map((c) => c.name).join(', ');
    const whereIndex = new Map<string, number>();

    let whereClause = '';
    if (this.pkColumns.length > 0) {
      let idx = 1;
      const parts = this.pkColumns.map((pk) => {
        whereIndex.set(pk, idx++);
        return `${pk}=?`;
      });
      whereClause = ` WHERE ${parts.join(' AND ')}`;
    }

    this._selectSql = `SELECT ${colList} FROM ${this.getQuotedQualifiedTableName()}${whereClause}`;
    this._selectWhereColumnIndex = whereIndex;
  }

  private ensureSelectByValuesBuilt(): void {
    if (this._selectByValuesSql !== null) return;

    const colList = this.columns.map((c) => c.name).join(', ');
    const valuesIndex = new Map<string, number[]>();

    let whereClause = '';
    if (this.queryColumns.length > 0) {
      let idx = 1;
      const parts = this.queryColumns.map((col) => {
        const i1 = idx++;
        const i2 = idx++;
        valuesIndex.set(col, [i1, i2]);
        return `(? IS NULL OR ${col}=?)`;
      });
      whereClause = ` WHERE ${parts.join(' AND ')}`;
    }

    this._selectByValuesSql = `SELECT ${colList} FROM ${this.getQuotedQualifiedTableName()}${whereClause}`;
    this._selectByValuesIndex = valuesIndex;
  }

  private invalidateSqlCache(): void {
    this._selectSql = null;
    this._selectWhereColumnIndex = null;
    this._selectByValuesSql = null;
    this._selectByValuesIndex = null;
  }
}
