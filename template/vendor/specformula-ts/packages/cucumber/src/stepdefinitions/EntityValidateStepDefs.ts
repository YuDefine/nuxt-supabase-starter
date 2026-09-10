// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntityValidateStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntityValidateStepDefs.ts
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';
import { SpecFormulaBridge } from '@specformula/node';
import {
  MapScenarioContext,
  TimeService,
  applyConstraints,
  asString,
  SpecFormulaLookupError,
} from '@specformula/core';
import type { ScenarioContext } from '@specformula/core';
import { EntitySetup } from '@specformula/core/instruction/EntitySetup';
import type { DdlColumnSpec } from '@specformula/core/instruction/EntitySetup';
import { EntityValidate } from '@specformula/core/instruction/EntityValidate';

// ─── World interface ──────────────────────────────────────────────────────────

interface EntityValidateWorld {
  scenarioCtx?: ScenarioContext;
  _entityValidate?: EntityValidateState;
}

interface EntityValidateState {
  tables: Map<string, Map<string, DdlColumnSpec[]>>;
  entityMapping: Map<string, { datasource: string; tableName: string }>;
  lastError?: Error;
}

function getState(world: EntityValidateWorld): EntityValidateState {
  if (!world._entityValidate) {
    world._entityValidate = {
      tables: new Map(),
      entityMapping: new Map(),
    };
  }
  return world._entityValidate;
}

function getCtx(world: EntityValidateWorld): ScenarioContext {
  if (!world.scenarioCtx) {
    world.scenarioCtx = new MapScenarioContext();
  }
  return world.scenarioCtx;
}

type DataTableHashes = Array<Record<string, string>>;

// ─── Given: create table ──────────────────────────────────────────────────────

Given(
  /^entity-validate (\w+) 建立資料表 (\w+):$/,
  async function (datasource: string, tableName: string, dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntityValidateWorld;
    const state = getState(world);
    const rows = dataTable.hashes();

    const columns: DdlColumnSpec[] = rows.map((r) => ({
      column: r['column'] ?? '',
      type: r['type'] ?? 'VARCHAR',
      pk: r['pk'] ?? '',
      notnull: r['notnull'] ?? '',
      default: r['default'] ?? '',
      auto: r['auto'] ?? '',
      fk: r['fk'] ?? '',
    }));

    if (!state.tables.has(datasource)) {
      state.tables.set(datasource, new Map());
    }
    state.tables.get(datasource)!.set(tableName, columns);

    const ctx = getCtx(world);
    const setup = new EntitySetup(ctx);
    SpecFormulaBridge.getInstance().ensureDataSource(datasource);
    const conn = SpecFormulaBridge.getInstance().getConnection(datasource);
    await setup.createTable(conn, { tableName, columns });
  },
);

// ─── Given: entity_to_table_mapping ──────────────────────────────────────────

Given(
  /^entity-validate (\w+) entity_to_table_mapping:$/,
  function (datasource: string, dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntityValidateWorld;
    const state = getState(world);
    const rows = dataTable.hashes();

    for (const row of rows) {
      const entity = row['entity'] ?? '';
      const table = row['table'] ?? '';
      if (entity && table) {
        state.entityMapping.set(entity, { datasource, tableName: table });
      }
    }
  },
);

// ─── Given: insert data (entity-validate 準備一個) ────────────────────────────

Given(
  /^entity-validate 準備一個 (.+):$/,
  async function (entityName: string, dataTable: { raw(): string[][] }) {
    const world = this as EntityValidateWorld;
    const state = getState(world);

    const mapping = state.entityMapping.get(entityName.trim());
    if (!mapping) {
      throw new SpecFormulaLookupError({
        code: 'EXEC_ENTITY_DEFINITION_NOT_FOUND',
        details: { name: entityName },
      });
    }

    const { datasource, tableName } = mapping;
    const tableColumns = state.tables.get(datasource)?.get(tableName) ?? [];

    const raw = dataTable.raw();
    const headers = raw[0] ?? [];
    const rows = raw.slice(1);

    const ctx = getCtx(world);
    const setup = new EntitySetup(ctx);
    const conn = SpecFormulaBridge.getInstance().getConnection(datasource);
    await setup.insertRows(conn, tableName, tableColumns, headers, rows);
  },
);

// ─── Given: set time ─────────────────────────────────────────────────────────

Given(/^entity-validate 設定時間為 "([^"]+)"$/, function (isoDateTime: string) {
  const world = this as EntityValidateWorld;
  const ctx = getCtx(world);
  TimeService.setNow(isoDateTime, ctx);
});

// ─── Given: context variable ─────────────────────────────────────────────────

Given(
  /^entity-validate context 變數 "([^"]+)" 為 (.+)$/,
  function (varName: string, value: string) {
    const world = this as EntityValidateWorld;
    const ctx = getCtx(world);
    const trimmed = value.trim();
    const parsed = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
    ctx.set(varName, parsed);
  },
);

// ─── When: validate (data table) ─────────────────────────────────────────────

When(
  /^entity-validate 驗證 (.+) 資料:$/,
  async function (entityName: string, dataTable: { raw(): string[][] }) {
    const world = this as EntityValidateWorld;
    const state = getState(world);
    world._entityValidate!.lastError = undefined;

    try {
      const mapping = state.entityMapping.get(entityName.trim());
      if (!mapping) {
        throw new SpecFormulaLookupError({
        code: 'EXEC_ENTITY_DEFINITION_NOT_FOUND',
        details: { name: entityName },
      });
      }

      const { datasource, tableName } = mapping;
      const tableColumns = state.tables.get(datasource)?.get(tableName) ?? [];

      const raw = dataTable.raw();
      const headers = raw[0] ?? [];
      const rows = raw.slice(1);

      const ctx = getCtx(world);
      const validator = new EntityValidate(ctx);
      const conn = SpecFormulaBridge.getInstance().getConnection(datasource);

      await validator.validate(conn, tableName, tableColumns, headers, rows, entityName.trim());
    } catch (e: unknown) {
      world._entityValidate!.lastError = e instanceof Error ? e : new Error(String(e));
    }
  },
);

// ─── When: json-entity-validate ───────────────────────────────────────────────

When(
  /^json-entity-validate 驗證 (.+) 資料:$/,
  async function (entityName: string, docString: string) {
    const world = this as EntityValidateWorld;
    const state = getState(world);
    world._entityValidate!.lastError = undefined;

    try {
      const mapping = state.entityMapping.get(entityName.trim());
      if (!mapping) {
        throw new SpecFormulaLookupError({
          code: 'EXEC_ENTITY_DEFINITION_NOT_FOUND',
          details: { name: entityName },
        });
      }

      const { datasource, tableName } = mapping;
      const tableColumns = state.tables.get(datasource)?.get(tableName) ?? [];
      const ctx = getCtx(world);

      // Extract >contextKey: <executionKey pairs before JSON parsing
      const varPairs = extractJsonVarPairs(docString);

      // Pre-process: quote unquoted special values (&constraint, $var, @time(...)) before JSON parsing
      const jsonStr = quoteSpecialJsonValues(docString.trim());
      const parsed = JSON.parse(jsonStr);
      const expectedRecord: Record<string, unknown> = Array.isArray(parsed) ? parsed[0] : parsed;

      // Convert to header/row format, appending VAR pair columns
      const headers = Object.keys(expectedRecord).map((k) => k);
      const row = Object.values(expectedRecord).map((v) => (v === null ? '' : asString(v)));

      // Append >contextKey / <executionKey pairs as extra columns
      for (const { contextKey, executionKey } of varPairs) {
        headers.push(`>${contextKey}`);
        row.push(`<${executionKey}`);
      }

      const validator = new EntityValidate(ctx);
      const conn = SpecFormulaBridge.getInstance().getConnection(datasource);
      await validator.validate(conn, tableName, tableColumns, headers, [row]);
    } catch (e: unknown) {
      world._entityValidate!.lastError = e instanceof Error ? e : new Error(String(e));
    }
  },
);

// ─── Then: pass ───────────────────────────────────────────────────────────────

Then(/^entity-validate 通過$/, function () {
  const world = this as EntityValidateWorld;
  const err = world._entityValidate?.lastError;
  if (err) throw err;
});

// ─── Then: should throw exception ─────────────────────────────────────────────

Then(
  /^entity-validate 應拋出例外:$/,
  function (dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntityValidateWorld;
    const err = world._entityValidate?.lastError;
    assert.ok(err, 'Expected an exception to be thrown but none was');

    const rows = dataTable.hashes();
    for (const row of rows) {
      const keyword = row['message'] ?? '';
      if (keyword) {
        assert.ok(
          err.message.includes(keyword),
          `Expected error to contain '${keyword}' but got: '${err.message}'`,
        );
      }
    }
  },
);

// ─── Then: context should have variables ──────────────────────────────────────

Then(
  /^entity-validate context 應有變數:$/,
  function (dataTable: { raw(): string[][] }) {
    const world = this as EntityValidateWorld;
    const ctx = getCtx(world);

    const raw = dataTable.raw();
    const headers = raw[0] ?? [];
    const valueRow = raw[1] ?? [];

    for (let i = 0; i < headers.length; i++) {
      const varName = headers[i];
      const expectedCell = valueRow[i] ?? '';
      if (!varName) continue;

      assert.ok(ctx.has(varName), `Context variable '${varName}' not found`);
      const actual = ctx.get(varName);
      const normalizedActual = typeof actual === 'bigint' ? Number(actual) : actual;

      if (expectedCell.startsWith('&')) {
        const numVal =
          typeof normalizedActual === 'string'
            ? Number(normalizedActual) || normalizedActual
            : normalizedActual;
        assert.ok(
          applyConstraints(numVal, expectedCell, ctx),
          `Context variable '${varName}' = ${JSON.stringify(actual)} does not satisfy ${expectedCell}`,
        );
      } else if (expectedCell !== '') {
        const actualStr = String(normalizedActual);
        assert.strictEqual(actualStr, expectedCell, `Context variable '${varName}'`);
      }
    }
  },
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pre-process a JSON docstring to handle special non-JSON constructs:
 * 1. Lines with >contextKey: <executionKey (VAR system) - strip them from JSON, handle separately
 * 2. Quote unquoted special values (&constraint, $variable, @time(...))
 */
function quoteSpecialJsonValues(jsonStr: string): string {
  // Step 1: Remove >key: <value lines (VAR system pairs) that are not valid JSON keys
  // These look like: >categoryId: <id, (possibly with trailing comma)
  let result = jsonStr.replace(/^\s*>[^:]+:\s*<[^,}\]\n]+,?\s*$/gm, '');

  // Step 2: Quote unquoted special values after a colon
  // @time("...") — the argument may contain quoted strings with parens
  // &constraint, $variable
  result = result.replace(
    /:\s*(@(?:time|date|localtime)\((?:[^)"]*|"[^"]*")*\)|&[^\s,}\]]+|\$[a-zA-Z_][a-zA-Z0-9_.]*)/g,
    (_: string, val: string) => {
      // Escape any inner double-quotes before wrapping in quotes
      const escaped = val.replace(/"/g, '\\"');
      return `: "${escaped}"`;
    },
  );

  return result;
}

/**
 * Extract >contextKey: <executionKey pairs from a JSON docstring for VAR system handling.
 */
function extractJsonVarPairs(docStr: string): Array<{ contextKey: string; executionKey: string }> {
  const pairs: Array<{ contextKey: string; executionKey: string }> = [];
  const regex = />\s*([^:\s]+)\s*:\s*<([^,}\]\s\n]+)/g;
  let m;
  while ((m = regex.exec(docStr)) !== null) {
    pairs.push({ contextKey: m[1].trim(), executionKey: m[2].trim() });
  }
  return pairs;
}
