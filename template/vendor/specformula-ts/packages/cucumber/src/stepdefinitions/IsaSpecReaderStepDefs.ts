// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/IsaSpecReaderStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/IsaSpecReaderStepDefs.ts
import { Given, When, Then } from '@cucumber/cucumber';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert';
import { IsaSpecReader } from '@specformula/core';
import type { IsaSpec } from '@specformula/core';

interface IsaSpecWorld {
  _isaTmpFile?: string;
  _isaPath?: string;
  _isaSpec?: IsaSpec;
  _isaError?: Error;
}

function getWorld(this_: unknown): IsaSpecWorld {
  return this_ as IsaSpecWorld;
}

Given('spec.isa 存在一個 isa.yml 檔:', function (content: string) {
  const w = getWorld(this);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specformula-isa-'));
  const filePath = path.join(tmpDir, 'isa.yml');
  fs.writeFileSync(filePath, content, 'utf-8');
  w._isaTmpFile = filePath;
  w._isaPath = filePath;
  w._isaSpec = undefined;
  w._isaError = undefined;
});

Given('spec.isa 使用不存在的路徑 {string}', function (filePath: string) {
  const w = getWorld(this);
  w._isaPath = filePath;
  w._isaTmpFile = undefined;
  w._isaSpec = undefined;
  w._isaError = undefined;
});

When('spec.isa 讀取 isa.yml', function () {
  const w = getWorld(this);
  const reader = new IsaSpecReader(w._isaPath);
  try {
    w._isaSpec = reader.read();
    w._isaError = undefined;
  } catch (e: unknown) {
    w._isaError = e instanceof Error ? e : new Error(String(e));
    w._isaSpec = undefined;
  }
});

Then('spec.isa 解析結果為:', function (docString: string) {
  const w = getWorld(this);
  assert.ok(w._isaSpec, `Expected IsaSpec but got error: ${w._isaError?.message}`);
  const expected = JSON.parse(docString.trim());
  const actual = JSON.parse(JSON.stringify(w._isaSpec));
  assert.deepStrictEqual(actual, expected);
});

Then('spec.isa 解析應拋出例外訊息為 {string}', function (message: string) {
  const w = getWorld(this);
  assert.ok(
    w._isaError,
    `Expected an error with message "${message}" but no error was thrown`,
  );
  assert.strictEqual(
    w._isaError.message,
    message,
    `Expected error message to be "${message}" but got: "${w._isaError.message}"`,
  );
});
