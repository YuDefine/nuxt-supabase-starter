// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/CucumberStepInvocation.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/CucumberStepInvocation.ts
/**
 * CucumberStepInvocation — StepInvocation 之 Cucumber.js 具體實作
 * （plugin-api 約定：concrete impl 落在 @specformula/cucumber）。
 *
 * 把 cucumber step handler 收到的 args 切成：
 *   - groups()：前 captureCount 個 regex capture 字串（依出現順序，不含 payload）
 *   - payload()：尾端 DataTable / DocString（若有）之 PayloadView
 *
 * captureCount 由呼叫端（StepDefinitionFactory）以 instruction.format 之 capture
 * group 數量決定 — 尾端 JSON / text DocString 同為 string，無法只靠型別區分。
 */
import { buildNamedGroups, DataFormat, NONE_PAYLOAD, payloadFormatOf } from '@specformula/plugin-api';
import type { InstructionDescriptor, PayloadView, StepInvocation } from '@specformula/plugin-api';

interface DataTableLike {
  raw(): string[][];
  hashes?(): Array<Record<string, string>>;
}

function isDataTable(x: unknown): x is DataTableLike {
  return !!x && typeof x === 'object' && typeof (x as { raw?: unknown }).raw === 'function';
}

type VariableResolver = (reference: string) => unknown;

export class CucumberStepInvocation implements StepInvocation {
  readonly instruction: InstructionDescriptor;

  private readonly _groups: readonly string[];
  private readonly _payload: PayloadView;
  private readonly resolver: VariableResolver;
  private _namedGroups: Readonly<Record<string, string>> | null = null;

  /**
   * @param args cucumber step handler 收到的 args（尾端 callback 已被 makeWrapper 剝除）
   * @param captureCount instruction.format 之 capture group 數；args 前段為 groups，
   *        超出的第一個 arg 視為 payload（DataTable / DocString）
   * @param variableResolver `{{varName}}` 解析器；未提供時預設 identity
   *        （回傳 reference 原字串）— 正式 dispatch 路徑由 StepDefinitionFactory
   *        注入 PluginContext.variableResolver()。
   */
  constructor(
    instruction: InstructionDescriptor,
    args: readonly unknown[],
    captureCount: number,
    variableResolver?: VariableResolver,
  ) {
    this.instruction = instruction;
    this._groups = Object.freeze(
      args.slice(0, captureCount).map((v) => (typeof v === 'string' ? v : String(v))),
    );
    this._payload = buildPayloadView(instruction, args.length > captureCount ? args[captureCount] : undefined);
    this.resolver = variableResolver ?? ((reference) => reference);
  }

  groups(): readonly string[] {
    return this._groups;
  }

  namedGroups(): Readonly<Record<string, string>> {
    this._namedGroups ??= buildNamedGroups(this.instruction, this._groups);
    return this._namedGroups;
  }

  group(name: string): string | undefined {
    return this.namedGroups()[name];
  }

  payload(): PayloadView {
    return this._payload;
  }

  resolveVariable(reference: string): unknown {
    return this.resolver(reference);
  }
}

// ─── PayloadView 實作 ─────────────────────────────────────────────────────────

function buildPayloadView(
  instruction: InstructionDescriptor,
  payloadArg: unknown,
): PayloadView {
  if (payloadArg == null) return NONE_PAYLOAD;
  if (isDataTable(payloadArg)) return new DataTablePayloadView(payloadArg);
  if (typeof payloadArg === 'string') {
    // DocString：依 instruction 宣告之 data_format 區分 JSON / text；
    // 未宣告（或宣告與實際不符）時保守視為 plain text。
    const declared = payloadFormatOf(instruction);
    const format = declared === DataFormat.JSON ? DataFormat.JSON : DataFormat.TEXT;
    return new DocStringPayloadView(payloadArg, format);
  }
  throw new Error(
    `CucumberStepInvocation: unsupported payload argument for instruction ` +
      `'${instruction.name}' — expected DataTable, DocString or none, got: ${typeof payloadArg}.`,
  );
}

class DataTablePayloadView implements PayloadView {
  readonly format = DataFormat.DATA_TABLE;

  constructor(private readonly table: DataTableLike) {}

  isEmpty(): boolean {
    return this.table.raw().length === 0;
  }

  asRows(): ReadonlyArray<ReadonlyArray<string>> {
    return this.table.raw();
  }

  asMaps(): ReadonlyArray<Readonly<Record<string, string>>> {
    if (typeof this.table.hashes === 'function') {
      return this.table.hashes();
    }
    const [header = [], ...rest] = this.table.raw();
    return rest.map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = row[i] ?? '';
      });
      return obj;
    });
  }

  asString(): never {
    throw new Error('payload format is DATA_TABLE, use asRows() / asMaps()');
  }

  raw(): unknown {
    return this.table;
  }
}

class DocStringPayloadView implements PayloadView {
  constructor(
    private readonly content: string,
    readonly format: DataFormat,
  ) {}

  isEmpty(): boolean {
    return this.content.trim() === '';
  }

  asRows(): never {
    throw new Error(`payload format is ${this.format}, no rows`);
  }

  asMaps(): never {
    throw new Error(`payload format is ${this.format}, no maps`);
  }

  asString(): string {
    return this.content;
  }

  raw(): unknown {
    return this.content;
  }
}
