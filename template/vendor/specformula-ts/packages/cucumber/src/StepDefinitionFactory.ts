// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/StepDefinitionFactory.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/StepDefinitionFactory.ts
import { Given, When, Then } from '@cucumber/cucumber';
import type {
  IsaInstruction,
  ApiSpec,
  DatabaseSchema,
  ColumnDefinition,
} from '@specformula/core';
import {
  entityTableMappingAsMap,
  DefaultPluginContext,
  DefaultSpecRegistry,
  InstructionRegistry,
} from '@specformula/core';
import type {
  Instruction,
  InstructionDescriptor,
  IsaStepExecutor,
  PluginContext,
} from '@specformula/plugin-api';
import { SpecFormulaBridge } from '@specformula/node';
import { builtinInstructionsPlugin, rawDispatchOf } from './BuiltinInstructionsPlugin.js';
import { CucumberStepInvocation } from './CucumberStepInvocation.js';

interface DataTableLike {
  raw(): string[][];
  hashes?(): Array<Record<string, string>>;
}

function isDataTable(x: unknown): x is DataTableLike {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as { raw?: unknown }).raw === 'function'
  );
}

function lastDataTable(args: unknown[]): DataTableLike | null {
  const last = args[args.length - 1];
  return isDataTable(last) ? last : null;
}

function stringArg(args: unknown[], idx: number): string {
  const v = args[idx];
  return typeof v === 'string' ? v : '';
}

/** StepDefinitionFactory.register() 之選項（ADR-0027 plugin dispatch wiring）。 */
export interface StepRegistrationOptions {
  /**
   * 經 plugins.config disabled.instructions 停用之 instruction_type 集合
   * （來自 PluginLoader.getDisabledInstructionTypes()）。命中時註冊 loud-fail step，
   * 錯誤訊息指明「被 plugins.config 停用」而非「未知」。
   */
  readonly disabledInstructionTypes?: ReadonlySet<string>;

  /**
   * 傳給第三方 Instruction.create() 之 PluginContext。未提供時建立最小
   * DefaultPluginContext（空 SpecRegistry + bridge-backed variable resolver）。
   */
  readonly pluginContext?: PluginContext;
}

const KEYWORD_FNS = { Given, When, Then } as const;

/**
 * Reads IsaInstruction[] and dynamically registers Cucumber step definitions.
 * Uses instruction.format as a regex pattern (converted from Python named-group syntax).
 *
 * Dispatch 依 InstructionRegistry（ADR-0027）查找 contribution：
 *   - 內建六指令（帶 RAW_DISPATCH marker）→ 沿用既有 dispatcher，行為不變
 *   - 第三方 contribution → 以 CucumberStepInvocation 適配 IsaStepExecutor
 *   - registry 查無 → 註冊 loud-fail step（disabled 與 unknown 訊息區分）
 *
 * 未傳 registry 時（legacy caller / 單元測試）以內建 plugin contributions
 * 同步建立 builtin-only registry，行為與改版前一致。
 */
export class StepDefinitionFactory {
  static register(
    instructions: IsaInstruction[],
    registry?: InstructionRegistry,
    opts: StepRegistrationOptions = {},
  ): void {
    const reg = registry ?? builtinOnlyRegistry();
    const disabled = opts.disabledInstructionTypes ?? new Set<string>();
    // PluginContext lazy 單例：只有第三方 contribution 真的要 create() 時才建立。
    let pluginContext: PluginContext | undefined = opts.pluginContext;
    const contextOf = (): PluginContext => {
      pluginContext ??= new DefaultPluginContext(
        new DefaultSpecRegistry(),
        {},
        bridgeVariableResolver,
      );
      return pluginContext;
    };

    for (const instruction of instructions) {
      if (!instruction.format) continue;
      const pattern = toJsRegex(instruction.format);
      const type = instruction.instruction_type;
      const captureArity = countCaptureGroups(pattern);
      // cucumber-js 12 嚴格檢查 fn.length；對 with-DataTable / DocString step
      // 還會多吃一個尾參數，於是預留兩種 arity，由實際 step 文字決定 cucumber 走哪條。
      const arity = captureArity + 1;

      const contribution = reg.find(type);
      const raw = contribution ? rawDispatchOf(contribution) : undefined;

      if (raw) {
        // 內建指令：RAW_DISPATCH 直通既有 dispatcher（Given/When/Then + arity 與改版前相同）。
        const keywordFn = KEYWORD_FNS[raw.keyword];
        keywordFn(pattern, makeWrapper(raw.useCaptureArityOnly ? captureArity : arity, raw.handler));
      } else if (contribution) {
        // 第三方 plugin contribution：executor 適配層。
        Given(
          pattern,
          makeWrapper(arity, makeExecutorHandler(contribution, instruction, captureArity, contextOf)),
        );
      } else if (disabled.has(type)) {
        // 對齊 Java SpecFormulaBackend 之 disabled 訊息語意；保留 loud-fail step 形狀。
        Given(pattern, makeWrapper(captureArity, () =>
          Promise.reject(
            new Error(
              `StepDefinitionFactory: isa.yml instruction '${instruction.name}' references ` +
                `instruction_type '${type}' that was disabled via plugins.config.disabled.instructions.`,
            ),
          ),
        ));
      } else {
        const available = [...reg.instructionTypes()].sort().join(', ');
        Given(pattern, makeWrapper(captureArity, () =>
          Promise.reject(
            new Error(
              `StepDefinitionFactory: unknown instruction_type '${type}' — no Instruction ` +
                `contribution found in InstructionRegistry (available: [${available}]).`,
            ),
          ),
        ));
      }
    }
  }
}

/** Legacy caller（未傳 registry）：以內建 plugin contributions 同步建 registry。 */
function builtinOnlyRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  for (const contribution of builtinInstructionsPlugin.instructions?.() ?? []) {
    registry.register(contribution, true, false);
  }
  return registry;
}

/**
 * 第三方 contribution 之 step handler：lazy create + cache executor
 * （每個 isa.yml instruction 一個 instance；延後到首次執行，讓 create() 能取用
 * BeforeAll 才就緒之資源），把 cucumber args 包成 CucumberStepInvocation。
 */
function makeExecutorHandler(
  contribution: Instruction,
  instruction: IsaInstruction,
  captureCount: number,
  contextOf: () => PluginContext,
): (args: unknown[]) => Promise<void> {
  const descriptor = toDescriptor(instruction);
  let executor: IsaStepExecutor | null = null;
  return async (args: unknown[]): Promise<void> => {
    const ctx = contextOf();
    executor ??= contribution.create(descriptor, ctx);
    const invocation = new CucumberStepInvocation(
      descriptor,
      args,
      captureCount,
      ctx.variableResolver(),
    );
    await executor.execute(invocation);
  };
}

/** IsaInstruction（core model）→ plugin-api InstructionDescriptor。 */
function toDescriptor(instruction: IsaInstruction): InstructionDescriptor {
  return {
    name: instruction.name,
    format: instruction.format,
    instructionType: instruction.instruction_type,
    dataFormatRaw: instruction.data_format ?? null,
  };
}

/**
 * Bridge-backed variable resolver：把 `{{varName}}` / `$varName` / `varName`
 * 正規化後查 SpecFormulaBridge 當前 ScenarioContext（與 isa.yml 變數語意一致）。
 * 只在 step 執行期被呼叫（此時 scenario 必定 active）。
 */
export function bridgeVariableResolver(reference: string): unknown {
  let name = reference.trim();
  const braced = /^\{\{(.*)\}\}$/.exec(name);
  if (braced) name = braced[1].trim();
  if (name.startsWith('$')) name = name.slice(1);
  return SpecFormulaBridge.getInstance().getCurrentContext().get(name);
}

/**
 * 動態建立一個 function with 指定 formal-parameter arity，內部統一 forward 給 handler。
 * 用於符合 cucumber-js 12 的 fn.length 嚴格檢查。
 */
function makeWrapper(
  arity: number,
  handler: (args: unknown[]) => Promise<void>,
): (...rest: unknown[]) => Promise<void> {
  const wrapper = function (...args: unknown[]): Promise<void> {
    // cucumber-js 有時會在 promise-returning step 仍附帶 callback 為最後一個 arg；
    // 為了讓 lastDataTable() 仍能定位到真正的 DataTable / DocString，剝除尾部的 function。
    while (args.length > 0 && typeof args[args.length - 1] === 'function') {
      args.pop();
    }
    return handler(args);
  };
  // cucumber-js 12 用 fn.length 推斷期望參數數量；對動態 step def 必須手動設定。
  Object.defineProperty(wrapper, 'length', { value: arity, configurable: true });
  return wrapper;
}

function countCaptureGroups(regex: RegExp): number {
  // 計算 regex 內的 capture group 數量（不含 non-capturing (?:...)）
  const source = regex.source;
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (ch === '(') {
      const next = source[i + 1];
      if (next === '?') {
        // (?:...), (?=...), (?!...), (?<...>) 等
        const next2 = source[i + 2];
        if (next === '?' && next2 === '<' && source[i + 3] !== '=' && source[i + 3] !== '!') {
          count++; // named capture
        }
        continue;
      }
      count++;
    }
  }
  return count;
}

// ─── Dispatchers ──────────────────────────────────────────────────────────────

export function dispatchTimeControl(args: unknown[]): Promise<void> {
  try {
    const tc = SpecFormulaBridge.getInstance().getTimeControl();
    const timeExpr = stringArg(args, 0);
    tc.setNow(timeExpr);
    return Promise.resolve();
  } catch (e: unknown) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function dispatchApiCall(args: unknown[]): Promise<void> {
  const bridge = SpecFormulaBridge.getInstance();
  const apiCall = bridge.getApiCall();
  const config = requireConfig(bridge, 'api_call');

  // ISA api_call patterns:
  //   (No Actor|UID="$var") <summary>, call table:  ← DataTable variant
  //   (No Actor|UID="$var") <summary>, call JSON:   ← DocString variant
  // args 結構：[userIdExpr, summary, dataTable | docString]
  const userIdExpr = stringArg(args, 0);
  const summary = stringArg(args, 1);
  const last = args[args.length - 1];

  const token = await resolveActorToken(bridge, userIdExpr);

  if (isDataTable(last)) {
    const raw = last.raw();
    const headers = (raw[0] ?? []) as Array<string | null>;
    const rows = raw.slice(1) as Array<Array<string | null>>;
    await apiCall.executeFromDataTable(config.apiSpec, summary, headers, rows, token);
    return;
  }
  if (typeof last === 'string') {
    await apiCall.executeFromJson(config.apiSpec, summary, last, token);
    return;
  }
  throw new Error(
    'api_call: last step argument must be a DataTable (`, call table:`) or a JSON DocString (`, call JSON:`).',
  );
}

export function dispatchResponseValidate(args: unknown[]): Promise<void> {
  try {
    const bridge = SpecFormulaBridge.getInstance();
    const rv = bridge.getResponseValidate();
    const config = requireConfig(bridge, 'response_validate');
    const ctx = bridge.getCurrentContext();
    const lastResponse = ctx.getLastResponse();
    if (!lastResponse) {
      throw new Error('response_validate: no lastResponse in scenario context.');
    }
    const summary = stringArg(args, 0);
    const expectedStatus = Number(args[1] ?? 0);
    const last = args[args.length - 1];

    let result;
    if (isDataTable(last)) {
      const raw = last.raw();
      const headers = (raw[0] ?? []) as Array<string | null>;
      const rows = raw.slice(1) as Array<Array<string | null>>;
      result = rv.validateFromDataTable(
        config.apiSpec,
        summary,
        expectedStatus,
        headers,
        rows,
        lastResponse,
      );
    } else if (typeof last === 'string') {
      result = rv.validateFromJson(
        config.apiSpec,
        summary,
        expectedStatus,
        last,
        lastResponse,
      );
    } else {
      throw new Error(
        'response_validate: last step argument must be a DataTable (`, with table:`) or a JSON DocString (`, with JSON:`).',
      );
    }

    if (!result.passed) {
      throw new Error(result.error ?? 'response_validate: validation failed.');
    }
    return Promise.resolve();
  } catch (e: unknown) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Resolve the `UID="$Var"` expression in an api_call step into a bearer token.
 *
 * 流程：
 *   1. 從 ISA capture 拿到的 `$Actor.id` 取得 var name，從 ScenarioContext 撈出實際值
 *      （通常是 entity_setup 寫入 ScenarioContext 的 actor id）。
 *   2. 若 bridge 已註冊 Authenticator 且 Authenticator 實作了 `getToken(actorId)`，
 *      呼叫 it 換成 bearer token（對齊 Java 端 Authenticator.getToken）。
 *   3. 否則 fallback：若 context 值本身已是 string，視為「使用者直接把 token
 *      存進 context」舊行為，原樣回傳；其他型別則回傳 null（無 token）。
 */
async function resolveActorToken(
  bridge: SpecFormulaBridge,
  userIdExpr: string,
): Promise<string | null> {
  if (!userIdExpr) return null;
  const varName = userIdExpr.startsWith('$') ? userIdExpr.slice(1) : userIdExpr;
  const val: unknown = bridge.getCurrentContext().get(varName);
  if (val == null) return null;

  // 1) Prefer Authenticator.getToken(actorId) — matches Java's contract.
  let authenticator;
  try {
    authenticator = bridge.getAuthenticator();
  } catch {
    authenticator = undefined;
  }
  if (authenticator && typeof authenticator.getToken === 'function') {
    const tokenResult = await authenticator.getToken(val);
    if (tokenResult != null) return tokenResult;
  }

  // 2) Backward-compat fallback：getToken 不存在或回傳 null 時，
  // 保留收斂前的型別 coercion，避免 buildAuthHeaders-only 的舊 caller
  // 在 ScenarioContext 內放 numeric / boolean / bigint actor id 時
  // silently 失去 token。
  return coerceContextValueToToken(val);
}

function coerceContextValueToToken(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return String(val);
  }
  if (typeof val === 'object' || typeof val === 'function') {
    try {
      return JSON.stringify(val) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function dispatchEntitySetup(args: unknown[]): Promise<void> {
  const bridge = SpecFormulaBridge.getInstance();
  const setup = bridge.getEntitySetup();
  const entity = stringArg(args, 0);
  const mapped = findEntityMapping(bridge, entity);
  const conn = bridge.getConnection(mapped.dataSourceName);

  // entity_setup accepts either a DataTable (`, with table:`) or a JSON
  // DocString (`, with JSON:`) — mirror api_call / response_validate dispatch.
  const dt = lastDataTable(args);
  if (dt) {
    const raw = dt.raw();
    const headers = raw[0] ?? [];
    const rows = raw.slice(1);
    await setup.insertRows(conn, mapped.tableName, mapped.columns, headers, rows);
    return;
  }
  const last = args[args.length - 1];
  if (typeof last === 'string') {
    await setup.insertRowsFromJson(conn, mapped.tableName, mapped.columns, last);
    return;
  }
  throw new Error(
    'entity_setup: last step argument must be a DataTable (`, with table:`) or a JSON DocString (`, with JSON:`).',
  );
}

export async function dispatchEntityValidate(args: unknown[]): Promise<void> {
  const bridge = SpecFormulaBridge.getInstance();
  const validator = bridge.getEntityValidate();
  const entity = stringArg(args, 0);
  const mapped = findEntityMapping(bridge, entity);
  const conn = bridge.getConnection(mapped.dataSourceName);

  // entity_validate accepts either a DataTable (`, with table:`) or a JSON
  // DocString (`, with JSON:`).
  const dt = lastDataTable(args);
  if (dt) {
    const raw = dt.raw();
    const headers = raw[0] ?? [];
    const rows = raw.slice(1);
    await validator.validate(conn, mapped.tableName, mapped.columns, headers, rows);
    return;
  }
  const last = args[args.length - 1];
  if (typeof last === 'string') {
    await validator.validateFromJson(conn, mapped.tableName, mapped.columns, last);
    return;
  }
  throw new Error(
    'entity_validate: last step argument must be a DataTable (`, with table:`) or a JSON DocString (`, with JSON:`).',
  );
}

export async function dispatchEntityNonExistenceValidate(args: unknown[]): Promise<void> {
  const bridge = SpecFormulaBridge.getInstance();
  const validator = bridge.getEntityNonExistenceValidate();
  const dt = lastDataTable(args);
  if (!dt) {
    throw new Error('entity_non_existence_validate: requires a DataTable as the last step argument.');
  }
  const entity = stringArg(args, 0);
  const mapped = findEntityMapping(bridge, entity);
  const raw = dt.raw();
  const headers = raw[0] ?? [];
  const rows = raw.slice(1);
  await validator.validate(
    bridge.getConnection(mapped.dataSourceName),
    mapped.tableName,
    headers,
    rows,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface EntityMapping {
  readonly dataSourceName: string;
  readonly tableName: string;
  readonly columns: Array<{
    column: string;
    type: string;
    pk: string;
    notnull: string;
    default: string;
    auto: string;
    fk: string;
  }>;
}

function requireConfig(
  bridge: SpecFormulaBridge,
  type: string,
): { readonly apiSpec: ApiSpec } {
  const config = bridge.getConfig();
  if (!config) {
    throw new Error(`${type}: SpecFormulaBridge not initialized — call initialize() first.`);
  }
  return config;
}

function findEntityMapping(bridge: SpecFormulaBridge, entity: string): EntityMapping {
  const config = bridge.getConfig();
  if (!config) {
    throw new Error(`entity dispatch: SpecFormulaBridge not initialized — call initialize() first.`);
  }
  const matches: EntityMapping[] = [];
  for (const [dataSourceName, schema] of config.schemaMap) {
    const tableName = lookupTableName(schema, entity);
    if (!tableName) continue;
    const table = schema.tables.find((t) => t.tableName === tableName);
    if (!table) continue;
    matches.push({ dataSourceName, tableName, columns: columnsToDdlColumnSpec(table.columns) });
  }
  if (matches.length === 0) {
    throw new Error(
      `entity '${entity}' not found in schemaMap — no entity-to-table mapping registered for this entity.`,
    );
  }
  if (matches.length > 1) {
    const sources = matches.map((m) => m.dataSourceName).join(', ');
    throw new Error(
      `entity '${entity}' is ambiguous — found in multiple data sources: [${sources}]. Use a source-qualified entity name.`,
    );
  }
  return matches[0];
}

function lookupTableName(schema: DatabaseSchema, entity: string): string | null {
  const map = entityTableMappingAsMap(schema.entityTableMapping);
  return map.get(entity) ?? null;
}

function columnsToDdlColumnSpec(columns: readonly ColumnDefinition[]): EntityMapping['columns'] {
  return columns.map((c) => ({
    column: c.name,
    type: c.type,
    pk: c.primaryKey ? 'Y' : '',
    notnull: c.notNull ? 'Y' : '',
    default: c.defaultValue ?? '',
    auto: c.autoIncrement ? 'Y' : '',
    fk: c.foreignKey ?? '',
  }));
}

/**
 * Convert Python-style named capture groups (?P<name>...) to JS named groups (?<name>...).
 */
function toJsRegex(format: string): RegExp {
  const js = format.replace(/\(\?P</g, '(?<');
  return new RegExp(js);
}
