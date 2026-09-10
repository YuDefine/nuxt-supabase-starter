// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntitySetupStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntitySetupStepDefs.ts
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';
import { SpecFormulaBridge } from '@specformula/node';
import {
  MapScenarioContext,
  TimeService,
  SpecFormulaArgumentError,
  SpecFormulaLookupError,
} from '@specformula/core';
import type { ScenarioContext } from '@specformula/core';
import { EntitySetup } from '@specformula/core/instruction/EntitySetup';
import type { DdlColumnSpec } from '@specformula/core/instruction/EntitySetup';

// ─── World interface ──────────────────────────────────────────────────────────

interface EntitySetupWorld {
  scenarioCtx?: ScenarioContext;
  _entitySetup?: EntitySetupState;
}

interface EntitySetupState {
  // datasource name -> tableName -> columns
  tables: Map<string, Map<string, DdlColumnSpec[]>>;
  // entity name -> { datasource, tableName }
  entityMapping: Map<string, { datasource: string; tableName: string }>;
  // last error thrown by When step
  lastError?: Error;
}

function getState(world: EntitySetupWorld): EntitySetupState {
  if (!world._entitySetup) {
    world._entitySetup = {
      tables: new Map(),
      entityMapping: new Map(),
    };
  }
  return world._entitySetup;
}

function getCtx(world: EntitySetupWorld): ScenarioContext {
  if (!world.scenarioCtx) {
    world.scenarioCtx = new MapScenarioContext();
  }
  return world.scenarioCtx;
}

type DataTableHashes = Array<Record<string, string>>;

// ─── Given: create table ──────────────────────────────────────────────────────

Given(
  /^entity-setup (\w+) 建立資料表 (\w+):$/,
  async function (datasource: string, tableName: string, dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntitySetupWorld;
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

    // Store column specs for later INSERT type resolution
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
  /^entity-setup (\w+) entity_to_table_mapping:$/,
  function (datasource: string, dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntitySetupWorld;
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

// ─── Given: set time ─────────────────────────────────────────────────────────

Given(/^entity-setup 設定時間為 "([^"]+)"$/, function (isoDateTime: string) {
  const world = this as EntitySetupWorld;
  const ctx = getCtx(world);
  TimeService.setNow(isoDateTime, ctx);
});

// ─── Given: context variable ─────────────────────────────────────────────────

Given(
  /^entity-setup context 變數 "([^"]+)" 為 (.+)$/,
  function (varName: string, value: string) {
    const world = this as EntitySetupWorld;
    const ctx = getCtx(world);
    // Parse the value — number or string
    const trimmed = value.trim();
    const parsed = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
    ctx.set(varName, parsed);
  },
);

// ─── When: 準備一個 (data table) ───────────────────────────────────────────────

When(
  /^entity-setup 準備一個 (.+):$/,
  async function (entityName: string, dataTable: { raw(): string[][]; hashes(): DataTableHashes }) {
    const world = this as EntitySetupWorld;
    const state = getState(world);
    world._entitySetup!.lastError = undefined;

    try {
      const trimmedEntity = entityName.replace(/^"(.*)"$/, '$1').trim();

      if (!trimmedEntity) {
        throw new SpecFormulaArgumentError({
          code: 'EXEC_ENTITY_NAME_MISSING',
          details: {},
        });
      }

      const mapping = state.entityMapping.get(trimmedEntity);
      if (!mapping) {
        const available = [...state.entityMapping.keys()].join(', ');
        throw new SpecFormulaLookupError({
          code: 'EXEC_ENTITY_NOT_FOUND',
          details: { name: trimmedEntity, available },
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
    } catch (e: unknown) {
      world._entitySetup!.lastError = e instanceof Error ? e : new Error(String(e));
    }
  },
);

// ─── When: json-entity-setup ──────────────────────────────────────────────────

When(
  /^json-entity-setup 準備一個 (.+):$/,
  async function (entityName: string, docString: string) {
    const world = this as EntitySetupWorld;
    const state = getState(world);
    world._entitySetup!.lastError = undefined;

    try {
      const mapping = state.entityMapping.get(entityName.trim());
      if (!mapping) {
        const available = [...state.entityMapping.keys()].join(', ');
        throw new SpecFormulaLookupError({
          code: 'EXEC_ENTITY_NOT_FOUND',
          details: { name: entityName.trim(), available },
        });
      }

      const { datasource, tableName } = mapping;
      const tableColumns = state.tables.get(datasource)?.get(tableName) ?? [];

      const ctx = getCtx(world);
      const setup = new EntitySetup(ctx);
      const conn = SpecFormulaBridge.getInstance().getConnection(datasource);

      // Exercise the real core JSON-DocString path (camelCase→snake_case,
      // JSONB serialization, >/</$/@time symbol resolution).
      await setup.insertRowsFromJson(conn, tableName, tableColumns, docString.trim());
    } catch (e: unknown) {
      world._entitySetup!.lastError = e instanceof Error ? e : new Error(String(e));
    }
  },
);

// ─── Then: table should have data ─────────────────────────────────────────────

Then(
  /^entity-setup (\w+) 資料表應有資料:$/,
  async function (tableName: string, dataTable: { raw(): string[][] }) {
    const world = this as EntitySetupWorld;
    const state = getState(world);

    // Find datasource for this table
    const datasource = findDatasourceForTable(state, tableName);
    const conn = SpecFormulaBridge.getInstance().getConnection(datasource);
    const ctx = getCtx(world);
    const setup = new EntitySetup(ctx);

    const raw = dataTable.raw();
    const headers = raw[0] ?? [];
    const rows = raw.slice(1);

    await setup.assertTableHasData(conn, tableName, headers, rows);
  },
);

// ─── Then: context should have variables ──────────────────────────────────────

Then(
  /^entity-setup context 應有變數:$/,
  async function (dataTable: { raw(): string[][] }) {
    const world = this as EntitySetupWorld;
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

      if (expectedCell.startsWith('&')) {
        const { applyConstraints } = await import('@specformula/core');
        const normalizedActual = typeof actual === 'bigint' ? Number(actual) : actual;
        const numActual = typeof normalizedActual === 'string' ? Number(normalizedActual) || normalizedActual : normalizedActual;
        assert.ok(
          applyConstraints(numActual, expectedCell, ctx),
          `Context variable '${varName}' = ${JSON.stringify(actual)} does not satisfy ${expectedCell}`,
        );
      } else if (expectedCell !== '') {
        const actualStr = String(typeof actual === 'bigint' ? Number(actual) : actual);
        assert.strictEqual(actualStr, expectedCell, `Context variable '${varName}'`);
      }
    }
  },
);

// ─── Then: should throw exception ─────────────────────────────────────────────

Then(
  /^entity-setup 應拋出例外:$/,
  function (dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntitySetupWorld;
    const state = world._entitySetup;

    const err = state?.lastError;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findDatasourceForTable(state: EntitySetupState, tableName: string): string {
  for (const [ds, tableMap] of state.tables) {
    if (tableMap.has(tableName)) return ds;
  }
  // Also check entity mapping
  for (const [, { datasource, tableName: tn }] of state.entityMapping) {
    if (tn === tableName) return datasource;
  }
  return 'primary';
}

