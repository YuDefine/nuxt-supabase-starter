// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/DslStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/DslStepDefs.ts
/**
 * ADR-0024 / ADR-0035 DSL Preprocessor BDD step definitions。
 *
 * 對應 specs/features/dsl/{dsl-yml-reader,dsl-validation-errors,dsl-folder-scope,
 * dsl-isa-folder-scope}.feature：
 *   Given dsl 存在一個 dsl.yml 檔: ...
 *   Given dsl 存在一個 isa.yml 檔: ...
 *   Given dsl 存在一個 "<rel>/dsl.yml" 檔: ...
 *   Given dsl 存在一個 DSL feature 檔: ...
 *   Given dsl 存在一個 "<rel>" DSL feature 檔: ...
 *   When  dsl 讀取 dsl.yml
 *   When  dsl 執行預處理
 *   Then  dsl 解析結果為: <json>
 *   Then  dsl 輸出 ISA feature 為: <gherkin>
 *   Then  dsl 輸出 "<path>" 的 ISA feature 為: <gherkin>
 *
 * ADR-0035 folder-scope：每個 feature 以自身所在資料夾為 anchor，獨立解析
 * effective DslSpec / ISA catalog（ancestor chain root → … → anchor）。
 * 錯誤碼斷言由共用 ErrorAssertionStepDefs 走 lastError slot。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  readDslYml,
  preprocessDsl,
  normalizeGherkinOutput,
  type DslWorld,
} from './dslOperations.js';

function world(this_: unknown): DslWorld {
  return this_ as DslWorld;
}

function reset(w: DslWorld): void {
  w._dslSpec = undefined;
  w._dslIsaOutputs = undefined;
  w.lastError = undefined;
}

Given('dsl 存在一個 dsl.yml 檔:', function (content: string) {
  const w = world(this);
  w._dslFiles = [{ path: 'dsl.yml', content }];
  w._dslFeature = undefined;
  reset(w);
});

Given('dsl 存在一個 isa.yml 檔:', function (content: string) {
  const w = world(this);
  w._dslIsaYml = content;
  reset(w);
});

Given(/^dsl 存在一個 "([^"]+)" 檔:$/, function (relPath: string, content: string) {
  const w = world(this);
  if (!w._dslFiles) w._dslFiles = [];
  // 同檔重複給定時覆寫；不同檔累積
  const existing = w._dslFiles.findIndex((f) => f.path === relPath);
  if (existing >= 0) w._dslFiles[existing] = { path: relPath, content };
  else w._dslFiles.push({ path: relPath, content });
  reset(w);
});

Given('dsl 存在一個 DSL feature 檔:', function (content: string) {
  const w = world(this);
  w._dslFeature = content;
  reset(w);
});

Given(/^dsl 存在一個 "([^"]+)" DSL feature 檔:$/, function (relPath: string, content: string) {
  const w = world(this);
  if (!w._dslFeatureFiles) w._dslFeatureFiles = {};
  w._dslFeatureFiles[relPath] = content;
  reset(w);
});

When('dsl 讀取 dsl.yml', function () {
  const w = world(this);
  try {
    w._dslSpec = readDslYml(w);
    w.lastError = undefined;
  } catch (e) {
    w.lastError = e instanceof Error ? e : new Error(String(e));
    w._dslSpec = undefined;
  }
});

When('dsl 執行預處理', function () {
  const w = world(this);
  try {
    w._dslIsaOutputs = preprocessDsl(w);
    w.lastError = undefined;
  } catch (e) {
    w.lastError = e instanceof Error ? e : new Error(String(e));
    w._dslIsaOutputs = undefined;
  }
});

Then('dsl 解析結果為:', function (docString: string) {
  const w = world(this);
  assert.ok(w._dslSpec, `Expected DslSpec but got error: ${w.lastError?.message}`);
  const expected = JSON.parse(docString.trim());
  const actual = JSON.parse(JSON.stringify(w._dslSpec));
  assert.deepStrictEqual(actual, expected);
});

Then('dsl 輸出 ISA feature 為:', function (docString: string) {
  const w = world(this);
  assert.ok(
    w._dslIsaOutputs !== undefined,
    `Expected ISA feature but got error: ${w.lastError?.message}`,
  );
  const outputs = w._dslIsaOutputs ?? {};
  const keys = Object.keys(outputs);
  assert.strictEqual(
    keys.length,
    1,
    `singular Then-step expects exactly 1 output, got ${keys.length}: ${keys.join(', ')}`,
  );
  const expected = normalizeGherkinOutput(docString);
  const actual = normalizeGherkinOutput(outputs[keys[0]] ?? '');
  assert.strictEqual(actual, expected);
});

Then(/^dsl 輸出 "([^"]+)" 的 ISA feature 為:$/, function (sourcePath: string, docString: string) {
  const w = world(this);
  assert.ok(
    w._dslIsaOutputs !== undefined,
    `Expected ISA feature but got error: ${w.lastError?.message}`,
  );
  const outputs = w._dslIsaOutputs ?? {};
  const outKey = sourcePath.replace('.dsl.feature', '.isa.feature');
  assert.ok(
    outKey in outputs,
    `no ISA output for source ${JSON.stringify(sourcePath)} (looked up ${JSON.stringify(outKey)}); available: ${Object.keys(outputs).join(', ')}`,
  );
  const expected = normalizeGherkinOutput(docString);
  const actual = normalizeGherkinOutput(outputs[outKey] ?? '');
  assert.strictEqual(actual, expected);
});
