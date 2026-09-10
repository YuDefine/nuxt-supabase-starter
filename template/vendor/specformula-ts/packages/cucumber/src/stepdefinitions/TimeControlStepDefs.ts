// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TimeControlStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/TimeControlStepDefs.ts
/**
 * TimeControl step definitions.
 */
import { When, Then } from '@cucumber/cucumber';
import {
  MapScenarioContext,
  TimeControl,
  DateTimeTZ,
} from '@specformula/core';
import type { ScenarioContext } from '@specformula/core';
import assert from 'node:assert/strict';

// ─── World ────────────────────────────────────────────────────────────────────

interface TimeControlWorld {
  ctx: ScenarioContext;
  timeControl: TimeControl;
  lastError: unknown;
}

function ensureInit(world: TimeControlWorld): void {
  if (!world.ctx) {
    world.ctx = new MapScenarioContext();
    world.timeControl = new TimeControl(world.ctx);
  }
}

// ─── When — set now ───────────────────────────────────────────────────────────

When('time-control 設定時間為 {string}', function (this: TimeControlWorld, timeExpr: string) {
  ensureInit(this);
  this.lastError = undefined;
  try {
    this.timeControl.setNow(timeExpr);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── Then — assertions ────────────────────────────────────────────────────────

Then('time-control 現在時間的年月日為 {int}-{int}-{int}', function (this: TimeControlWorld, year: number, month: number, day: number) {
  const now = this.timeControl.getNow();
  assert.strictEqual(now.year, year, `Year: expected ${year}, got ${now.year}`);
  assert.strictEqual(now.month, month, `Month: expected ${month}, got ${now.month}`);
  assert.strictEqual(now.day, day, `Day: expected ${day}, got ${now.day}`);
});

Then('time-control 現在時間的時分秒為 {string}', function (this: TimeControlWorld, expectedTime: string) {
  const now = this.timeControl.getNow();
  const hh = String(now.hour).padStart(2, '0');
  const mm = String(now.minute).padStart(2, '0');
  const ss = String(now.second).padStart(2, '0');
  const actual = `${hh}:${mm}:${ss}`;
  assert.strictEqual(actual, expectedTime, `Time: expected ${expectedTime}, got ${actual}`);
});

Then('time-control 現在時間的時區偏移為 {string}', function (this: TimeControlWorld, expectedOffset: string) {
  const now = this.timeControl.getNow();
  assert.strictEqual(
    now.offsetStr,
    expectedOffset,
    `Timezone offset: expected "${expectedOffset}", got "${now.offsetStr}"`,
  );
});

Then('time-control 現在時間為 DateTimeTZ 類型', function (this: TimeControlWorld) {
  const now = this.timeControl.getNow();
  assert.ok(
    now instanceof DateTimeTZ,
    `Expected DateTimeTZ but got: ${typeof now}`,
  );
});

Then('time-control 設定時間應拋出例外訊息包含 {string}', function (this: TimeControlWorld, expectedMsg: string) {
  assert.ok(
    this.lastError instanceof Error,
    `Expected an error but got: ${String(this.lastError)}`,
  );
  assert.ok(
    (this.lastError).message.includes(expectedMsg),
    `Expected error message to contain "${expectedMsg}", got: "${(this.lastError).message}"`,
  );
});
