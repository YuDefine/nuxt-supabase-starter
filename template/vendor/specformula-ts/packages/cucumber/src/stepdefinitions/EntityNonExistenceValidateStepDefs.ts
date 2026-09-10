// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntityNonExistenceValidateStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/EntityNonExistenceValidateStepDefs.ts
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';
import { SpecFormulaBridge } from '@specformula/node';
import { MapScenarioContext, TimeService } from '@specformula/core';
import type { ScenarioContext } from '@specformula/core';
import { EntitySetup } from '@specformula/core/instruction/EntitySetup';
import type { DdlColumnSpec } from '@specformula/core/instruction/EntitySetup';
import { EntityNonExistenceValidate } from '@specformula/core/instruction/EntityNonExistenceValidate';

// ─── World interface ──────────────────────────────────────────────────────────

interface EntityNonExistenceWorld {
  scenarioCtx?: ScenarioContext;
  _entityNonExistence?: EntityNonExistenceState;
}

interface EntityNonExistenceState {
  tables: Map<string, Map<string, DdlColumnSpec[]>>;
  entityMapping: Map<string, { datasource: string; tableName: string }>;
  lastError?: Error;
}

function getState(world: EntityNonExistenceWorld): EntityNonExistenceState {
  if (!world._entityNonExistence) {
    world._entityNonExistence = {
      tables: new Map(),
      entityMapping: new Map(),
    };
  }
  return world._entityNonExistence;
}

function getCtx(world: EntityNonExistenceWorld): ScenarioContext {
  if (!world.scenarioCtx) {
    world.scenarioCtx = new MapScenarioContext();
  }
  return world.scenarioCtx;
}

type DataTableHashes = Array<Record<string, string>>;

// ─── Given: create table ──────────────────────────────────────────────────────

Given(
  /^entity-non-existence-validate (\w+) 建立資料表 (\w+):$/,
  async function (datasource: string, tableName: string, dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntityNonExistenceWorld;
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
  /^entity-non-existence-validate (\w+) entity_to_table_mapping:$/,
  function (datasource: string, dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntityNonExistenceWorld;
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

// ─── Given: insert data ───────────────────────────────────────────────────────

Given(
  /^entity-non-existence-validate 準備一個 (.+):$/,
  async function (entityName: string, dataTable: { raw(): string[][] }) {
    const world = this as EntityNonExistenceWorld;
    const state = getState(world);

    const mapping = state.entityMapping.get(entityName.trim());
    if (!mapping) {
      throw new Error(`找不到 entity '${entityName}'`);
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

Given(
  /^entity-non-existence-validate 設定時間為 "([^"]+)"$/,
  function (isoDateTime: string) {
    const world = this as EntityNonExistenceWorld;
    const ctx = getCtx(world);
    TimeService.setNow(isoDateTime, ctx);
  },
);

// ─── Given: context variable ─────────────────────────────────────────────────

Given(
  /^entity-non-existence-validate context 變數 "([^"]+)" 為 (.+)$/,
  function (varName: string, value: string) {
    const world = this as EntityNonExistenceWorld;
    const ctx = getCtx(world);
    const trimmed = value.trim();
    const parsed = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
    ctx.set(varName, parsed);
  },
);

// ─── When: validate non-existence ─────────────────────────────────────────────

When(
  /^entity-non-existence-validate 驗證 (.+) 不存在:$/,
  async function (entityName: string, dataTable: { raw(): string[][] }) {
    const world = this as EntityNonExistenceWorld;
    const state = getState(world);
    world._entityNonExistence!.lastError = undefined;

    try {
      const mapping = state.entityMapping.get(entityName.trim());
      if (!mapping) {
        throw new Error(`找不到 entity '${entityName}'`);
      }

      const { datasource, tableName } = mapping;

      const raw = dataTable.raw();
      const headers = raw[0] ?? [];
      const rows = raw.slice(1);

      const ctx = getCtx(world);
      const validator = new EntityNonExistenceValidate(ctx);
      const conn = SpecFormulaBridge.getInstance().getConnection(datasource);

      await validator.validate(conn, tableName, headers, rows, entityName.trim());
    } catch (e: unknown) {
      world._entityNonExistence!.lastError = e instanceof Error ? e : new Error(String(e));
    }
  },
);

// ─── Then: pass ───────────────────────────────────────────────────────────────

Then(/^entity-non-existence-validate 通過$/, function () {
  const world = this as EntityNonExistenceWorld;
  const err = world._entityNonExistence?.lastError;
  if (err) throw err;
});

// ─── Then: should throw exception ─────────────────────────────────────────────

Then(
  /^entity-non-existence-validate 應拋出例外:$/,
  function (dataTable: { hashes(): DataTableHashes }) {
    const world = this as EntityNonExistenceWorld;
    const err = world._entityNonExistence?.lastError;
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
