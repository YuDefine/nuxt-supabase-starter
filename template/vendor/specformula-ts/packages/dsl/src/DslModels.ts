// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/DslModels.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/DslModels.ts
/**
 * DSL spec models（ADR-0024 / ADR-0025）。
 *
 * `dsl.yml` 結構：
 *   ```yaml
 *   dsl_steps:
 *     - name: <DslDefinition.name>
 *       format: '^...$'
 *       params: [a, b] | { key: default | null }
 *       isa_steps:
 *         - instruction: '...'
 *           table: { col: '{{ref}}' }
 *           text: '...'      # 可選；ADR-0025 之 text DocString
 *   ```
 *
 * 為對齊 java 之 BDD 期望，params 之 value 若為 YAML number / boolean 一律
 * coerce 為 string（null 保留為 null，表示「required 但無 default」）。
 */

export interface DslSpec {
  readonly dsl_steps: ReadonlyArray<DslDefinition>;
}

export interface DslDefinition {
  readonly name: string;
  readonly format: string;
  /**
   * - undefined / null：無 params
   * - object：key → default value（null = required，string = optional with default）
   */
  readonly params: Readonly<Record<string, string | null>> | null;
  readonly isa_steps: ReadonlyArray<DslSubStep>;
}

export interface DslSubStep {
  readonly instruction: string;
  /** 與 ADR-0025 之 data_format = data_table 對應；無 table → null。 */
  readonly table: Readonly<Record<string, string>> | null;
  /** 與 ADR-0025 之 data_format = text 對應；無 text → undefined（序列化時不出現）。 */
  readonly text?: string;
}
