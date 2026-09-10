// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/SpecFormulaSupportCode.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/SpecFormulaSupportCode.ts
import { BeforeAll, Before, After } from '@cucumber/cucumber';
import {
  IsaSpecReader,
  EntityDdlReader,
  ApiSpecReader,
} from '@specformula/core';
import type { DatabaseSchema } from '@specformula/core';
import { SpecFormulaBridge } from '@specformula/node';

/**
 * Registers Cucumber lifecycle hooks that wire SpecFormulaBridge.
 *
 * Call this function once in your Cucumber support file to activate:
 *   import { registerSpecFormulaHooks } from '@specformula/cucumber';
 *   registerSpecFormulaHooks();
 *
 * BeforeAll: reads specs and initializes the bridge.
 * Before:    creates a new ScenarioContext per scenario.
 * After:     runs cleanup (endScenario) after each scenario.
 */
export function registerSpecFormulaHooks(): void {
  BeforeAll(function () {
    const bridge = SpecFormulaBridge.getInstance();

    // Read ISA spec
    const isaReader = new IsaSpecReader();
    const isaSpec = isaReader.read();

    // Build schemaMap from each data source config
    const schemaMap = new Map<string, DatabaseSchema>();
    const dataSources = isaSpec.config.data.source ?? [];

    for (const src of dataSources) {
      // Read DDL for this data source — EntityDdlReader accepts IsaDataSourceConfig directly
      const ddlReader = new EntityDdlReader(src);
      const schema = ddlReader.read();

      schemaMap.set(src.name, schema);

      // Auto-provision an in-memory SqliteDataSource only if the user hasn't
      // already registered one (e.g. a Postgres testcontainer DataSource).
      bridge.ensureDataSource(src.name);
    }

    // Read OpenAPI spec — ApiSpecReader.read() is synchronous
    const apiReader = new ApiSpecReader(isaSpec.config.api.resource_path);
    const apiSpec = apiReader.read();

    bridge.initialize({
      schemaMap,
      apiSpec,
      timeFormat: isaSpec.config.api.time_format,
    });
  });

  Before(function () {
    const bridge = SpecFormulaBridge.getInstance();
    const ctx = bridge.newScenario();
    // Attach context to Cucumber World for access in step definitions
    (this as Record<string, unknown>)['scenarioCtx'] = ctx;
  });

  After(async function () {
    const bridge = SpecFormulaBridge.getInstance();
    await bridge.endScenario();
  });
}
