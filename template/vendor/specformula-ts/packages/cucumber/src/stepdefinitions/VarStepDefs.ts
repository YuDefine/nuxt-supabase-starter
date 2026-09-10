// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/VarStepDefs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/VarStepDefs.ts
/**
 * Symbol System step definitions — VAR, CAS, TIME combined.
 * All three feature files share the same World interface and background step.
 */
import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import {
  MapScenarioContext,
  SymbolResolver,
  DateTimeTZ,
  DateOnly,
  TimeOnly,
  TimeService,
  applyConstraints,
  parseConstraints,
  parseStringRecord,
} from '@specformula/core';
import assert from 'node:assert/strict';
import type { ScenarioContext } from '@specformula/core';

// ─── Cucumber World interface ─────────────────────────────────────────────────

interface SymbolWorld {
  ctx: ScenarioContext;
  resolver: SymbolResolver;
  contextKeyMap: Map<number, string>;
  lastResult: unknown;
  lastError: unknown;
  executionVariable: unknown;
  /** CAS: the actual value being tested */
  casActual: unknown;
}

// ─── Background ───────────────────────────────────────────────────────────────

Given('初始化 ScenarioContext 和 SymbolResolver', function (this: SymbolWorld) {
  this.ctx = new MapScenarioContext();
  this.resolver = new SymbolResolver(this.ctx);
  this.contextKeyMap = new Map();
  this.lastResult = undefined;
  this.lastError = undefined;
  this.executionVariable = undefined;
  this.casActual = undefined;
});

// ─── Given — VAR pre-conditions ──────────────────────────────────────────────

Given('設定變數 {string} 為整數 {int}', function (this: SymbolWorld, key: string, value: number) {
  this.ctx.set(key, value);
});

Given('設定變數 {string} 為字串 {string}', function (this: SymbolWorld, key: string, value: string) {
  this.ctx.set(key, value);
});

Given(
  '設定變數 {string} 為 DateTimeTZ {string}',
  function (this: SymbolWorld, key: string, value: string) {
    const tempCtx = new MapScenarioContext();
    TimeService.setNow(value, tempCtx);
    const dt = TimeService.getNow(tempCtx);
    this.ctx.set(key, dt);
  },
);

Given('var execution variable:', function (this: SymbolWorld, docString: string) {
  this.executionVariable = JSON.parse(docString);
});

Given('設定當前時間為 {string}', function (this: SymbolWorld, datetime: string) {
  this.lastError = undefined;
  try {
    TimeService.setNow(datetime, this.ctx);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── When — VAR context key parsing ──────────────────────────────────────────

When('var 解析 context keys:', function (this: SymbolWorld, dataTable: DataTable) {
  this.lastError = undefined;
  try {
    const headers = dataTable.raw()[0];
    this.contextKeyMap = this.resolver.parseContextKeys(headers);
  } catch (err) {
    this.lastError = err;
  }
});

When(
  'var 解析 context keys（含 null）:',
  function (this: SymbolWorld, dataTable: DataTable) {
    this.lastError = undefined;
    try {
      const headers = dataTable.raw()[0].map((h: string) => (h === 'null' ? null : h));
      this.contextKeyMap = this.resolver.parseContextKeys(headers);
    } catch (err) {
      this.lastError = err;
    }
  },
);

When('var 解析空 headers 的 context keys', function (this: SymbolWorld) {
  this.lastError = undefined;
  try {
    this.contextKeyMap = this.resolver.parseContextKeys([]);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── When — VAR extraction ────────────────────────────────────────────────────

When('var 提取並儲存變數:', function (this: SymbolWorld, dataTable: DataTable) {
  this.lastError = undefined;
  try {
    const rows = dataTable.raw();
    const headers: Array<string | null> = rows[0];
    const dataRow: Array<string | null> = rows[1] ?? [];
    const contextKeys = this.resolver.parseContextKeys(headers);
    this.resolver.extractAndStoreVariables(contextKeys, headers, dataRow, this.executionVariable);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── When — VAR variable resolution ──────────────────────────────────────────

When('解析變數引用 {string}', function (this: SymbolWorld, value: string) {
  this.lastError = undefined;
  try {
    this.lastResult = this.resolver.resolveValue(value);
  } catch (err) {
    this.lastError = err;
  }
});

When('解析變數引用 null', function (this: SymbolWorld) {
  this.lastError = undefined;
  try {
    this.lastResult = this.resolver.resolveValue(null);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── When — CAS actual value setters ─────────────────────────────────────────

When('實際值為整數 {int}', function (this: SymbolWorld, value: number) {
  this.casActual = value;
});

When('實際值為浮點數 {float}', function (this: SymbolWorld, value: number) {
  this.casActual = value;
});

When('實際值為字串 {string}', function (this: SymbolWorld, value: string) {
  this.casActual = value;
});

When('實際值為布林 {word}', function (this: SymbolWorld, value: string) {
  this.casActual = value === 'true';
});

When('實際值為 null', function (this: SymbolWorld) {
  this.casActual = null;
});

When('實際值為字串列表 {string}', function (this: SymbolWorld, csv: string) {
  this.casActual = csv.split(',').map((s) => s.trim());
});

When('實際值為整數列表 {string}', function (this: SymbolWorld, csv: string) {
  this.casActual = csv.split(',').map((s) => parseInt(s.trim(), 10));
});

When('實際值為浮點數列表 {string}', function (this: SymbolWorld, csv: string) {
  this.casActual = csv.split(',').map((s) => parseFloat(s.trim()));
});

When('實際值為布林列表 {string}', function (this: SymbolWorld, csv: string) {
  this.casActual = csv.split(',').map((s) => s.trim() === 'true');
});

When('實際值為空列表', function (this: SymbolWorld) {
  this.casActual = [];
});

When('實際值為:', function (this: SymbolWorld, dataTable: DataTable) {
  const row = dataTable.hashes()[0] as { actual_type?: string; actual_value?: string } | undefined;
  assert.ok(row, 'actual value table must contain one data row');
  this.casActual = parseCasActual(row.actual_type ?? '', row.actual_value ?? '', this.ctx);
});

When('實際值為 Map:', function (this: SymbolWorld, dataTable: DataTable) {
  const rows = dataTable.raw();
  const map: Record<string, string> = {};
  // Table has header "key | value", data rows follow
  for (let i = 1; i < rows.length; i++) {
    map[rows[i][0]] = rows[i][1];
  }
  this.casActual = map;
});

When('實際值為 Map 列表:', function (this: SymbolWorld, dataTable: DataTable) {
  this.casActual = dataTable.hashes();
});

When('實際值為 JSON 陣列字串 {string}', function (this: SymbolWorld, json: string) {
  try {
    this.casActual = JSON.parse(json);
  } catch {
    this.casActual = json;
  }
});

When('實際值為 DateOnly {string}', function (this: SymbolWorld, date: string) {
  const result = TimeService.resolveTimeExpression(`@date("${date}")`, this.ctx);
  this.casActual = result;
});

/**
 * ADR-0026 / CAS contract — SQL DATE carrier mapping。
 * 各語言實作將自身 DB DATE 表示映射為「日期語意、無時間、無時區」之中立 actual；
 * TypeScript 採 native Date（時間設為 00:00:00 local），與 ConstraintEngine 中
 * `actual instanceof Date → DateTime.fromJSDate(actual)` 之路徑對齊。
 */
When('實際值為 SQL DATE {string}', function (this: SymbolWorld, isoDate: string) {
  const [y, m, d] = isoDate.split('-').map((s) => parseInt(s, 10));
  this.casActual = new Date(y, m - 1, d, 0, 0, 0, 0);
});

When('實際值為今天的 SQL DATE', function (this: SymbolWorld) {
  const now = TimeService.getNow(this.ctx);
  this.casActual = new Date(now.year, now.month - 1, now.day, 0, 0, 0, 0);
});

When('實際值為 {int} 天前的 SQL DATE', function (this: SymbolWorld, daysAgo: number) {
  const now = TimeService.getNow(this.ctx);
  const base = new Date(now.year, now.month - 1, now.day, 0, 0, 0, 0);
  base.setDate(base.getDate() - daysAgo);
  this.casActual = base;
});

When('實際值為 DateOnlyTime {string}', function (this: SymbolWorld, datetime: string) {
  const result = TimeService.resolveTimeExpression(`@time("${datetime}")`, this.ctx);
  this.casActual = result;
});

When(
  '實際值為 DateOnlyTime {string} 的 timestamp',
  function (this: SymbolWorld, datetime: string) {
    const result = TimeService.resolveTimeExpression(`@time("${datetime}")`, this.ctx);
    this.casActual = (result as DateTimeTZ).toMillis();
  },
);

When(
  '實際值為 DateOnlyTime {string} 帶奈秒 {int}',
  function (this: SymbolWorld, datetime: string, _nanoseconds: number) {
    // 奈秒參數在 JS 端無法保留（Date / luxon DateTime 之最小單位皆為 ms），
    // capture 對齊用，行為等同 DateOnlyTime。
    const result = TimeService.resolveTimeExpression(`@time("${datetime}")`, this.ctx);
    this.casActual = result;
  },
);

When('實際值為 DateTimeTZ {string}', function (this: SymbolWorld, datetimetz: string) {
  const result = TimeService.resolveTimeExpression(`@time("${datetimetz}")`, this.ctx);
  this.casActual = result;
});

When(
  '實際值為 DateTimeTZ {string} 轉換為系統時區',
  function (this: SymbolWorld, datetimetz: string) {
    const result = TimeService.resolveTimeExpression(`@time("${datetimetz}")`, this.ctx);
    this.casActual = result;
  },
);

When(
  '實際值為 DateTimeTZ {string} 帶奈秒 {int}',
  function (this: SymbolWorld, datetimetz: string, _nanoseconds: number) {
    const result = TimeService.resolveTimeExpression(`@time("${datetimetz}")`, this.ctx);
    this.casActual = result;
  },
);

When('實際值為當前 DateTimeTZ', function (this: SymbolWorld) {
  const result = TimeService.resolveTimeExpression('@time("now")', this.ctx);
  this.casActual = result;
});

When('實際值為系統時區 {string} 的 DateTimeTZ', function (this: SymbolWorld, datetimetz: string) {
  const result = TimeService.resolveTimeExpression(`@time("${datetimetz}")`, this.ctx);
  this.casActual = result;
});

When('實際值為 Instant {string}', function (this: SymbolWorld, instant: string) {
  const result = TimeService.resolveTimeExpression(`@time("${instant}")`, this.ctx);
  this.casActual = result;
});

When(
  '實際值為 Instant {string} 轉換為系統時區',
  function (this: SymbolWorld, instant: string) {
    const result = TimeService.resolveTimeExpression(`@time("${instant}")`, this.ctx);
    this.casActual = result;
  },
);

When(
  '實際值為系統時區 {string} 的 Instant',
  function (this: SymbolWorld, datetime: string) {
    const result = TimeService.resolveTimeExpression(`@time("${datetime}")`, this.ctx);
    this.casActual = result;
  },
);

When('實際值為當前 DateOnlyTime', function (this: SymbolWorld) {
  const result = TimeService.resolveTimeExpression('@time("now")', this.ctx);
  this.casActual = result;
});

When('實際值為當前 DateOnlyTime 的 timestamp', function (this: SymbolWorld) {
  const result = TimeService.resolveTimeExpression('@time("now")', this.ctx);
  this.casActual = (result as DateTimeTZ).toMillis();
});

When('實際值為當前 DateOnlyTime 的字串', function (this: SymbolWorld) {
  const result = TimeService.resolveTimeExpression('@time("now")', this.ctx);
  this.casActual = (result as DateTimeTZ).toString();
});

When('實際值為當前 Instant', function (this: SymbolWorld) {
  const result = TimeService.resolveTimeExpression('@time("now")', this.ctx);
  this.casActual = result;
});

When('實際值為 {int} 天前的 DateOnlyTime', function (this: SymbolWorld, n: number) {
  const result = TimeService.resolveTimeExpression(`@time("now-${n}d")`, this.ctx);
  this.casActual = result;
});

When(/^實際值為今天 (.+) 的 timestamp$/, function (this: SymbolWorld, time: string) {
  const today = new Date().toISOString().slice(0, 10);
  const result = TimeService.resolveTimeExpression(`@time("${today}T${time}")`, this.ctx);
  this.casActual = (result as DateTimeTZ).toMillis();
});

When('實際值為今天的 java.sql.Date', function (this: SymbolWorld) {
  const result = TimeService.resolveTimeExpression('@time("now")', this.ctx);
  this.casActual = result;
});

When('實際值為 java.sql.Date {string}', function (this: SymbolWorld, date: string) {
  const result = TimeService.resolveTimeExpression(`@date("${date}")`, this.ctx);
  this.casActual = result;
});

When('實際值為 {int} 天前的 java.sql.Date', function (this: SymbolWorld, n: number) {
  const result = TimeService.resolveTimeExpression(`@time("now-${n}d")`, this.ctx);
  this.casActual = result;
});

// ─── When — parseConstraints direct call ─────────────────────────────────────

When('解析約束條件字串 {string}', function (this: SymbolWorld, constraintExpr: string) {
  this.lastError = undefined;
  try {
    this.lastResult = parseConstraints(constraintExpr);
  } catch (err) {
    this.lastError = err;
  }
});

When('約束 {string}', function (this: SymbolWorld, constraint: string) {
  this.lastError = undefined;
  try {
    this.lastResult = applyConstraints(this.casActual, constraint, this.ctx);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── When — TIME expression resolution ───────────────────────────────────────

When('解析時間表達式 {string}', function (this: SymbolWorld, expression: string) {
  this.lastError = undefined;
  try {
    this.lastResult = TimeService.resolveTimeExpression(expression, this.ctx);
  } catch (err) {
    this.lastError = err;
  }
});

// ─── Then — CAS constraint assertions ────────────────────────────────────────

Then('約束 {string} 驗證通過', function (this: SymbolWorld, constraint: string) {
  const result = applyConstraints(this.casActual, constraint, this.ctx);
  assert.ok(result, `Constraint "${constraint}" should pass for actual=${JSON.stringify(this.casActual)} but failed`);
});

Then('約束 {string} 驗證失敗', function (this: SymbolWorld, constraint: string) {
  const result = applyConstraints(this.casActual, constraint, this.ctx);
  assert.ok(!result, `Constraint "${constraint}" should fail for actual=${JSON.stringify(this.casActual)} but passed`);
});

Then('約束條件數量為 {int}', function (this: SymbolWorld, n: number) {
  assert.ok(Array.isArray(this.lastResult), 'lastResult is not an array of constraints');
  assert.strictEqual((this.lastResult as unknown[]).length, n);
});

Then('約束條件參數應該包含 {string}', function (this: SymbolWorld, value: string) {
  assert.ok(Array.isArray(this.lastResult), 'lastResult is not an array of constraints');
  const constraints = this.lastResult as Array<{ name: string; args: string }>;
  const found = constraints.some((c) => c.args.includes(value) || c.name.includes(value));
  assert.ok(found, `No constraint has args containing "${value}": ${JSON.stringify(constraints)}`);
});

Then(
  '約束應該驗證通過（與系統時區對應的 DateOnlyTime）',
  function (this: SymbolWorld) {
    // The actual is an Instant converted to system timezone — verify &sameTime passes
    const result = applyConstraints(
      this.casActual,
      `&sameTime("${(this.casActual as DateTimeTZ).toString()}")`,
      this.ctx,
    );
    assert.ok(result, 'sameTime constraint should pass');
  },
);

Then(
  '約束應該驗證通過（與系統時區對應的 DateTimeTZ）',
  function (this: SymbolWorld) {
    const result = applyConstraints(
      this.casActual,
      `&sameTime("${(this.casActual as DateTimeTZ).toString()}")`,
      this.ctx,
    );
    assert.ok(result, 'sameTime constraint should pass');
  },
);

Then(
  '約束應該通過 sameDay 驗證（與系統時區對應的日期）',
  function (this: SymbolWorld) {
    const result = applyConstraints(
      this.casActual,
      `&sameDay("${(this.casActual as DateTimeTZ).toString()}")`,
      this.ctx,
    );
    assert.ok(result, 'sameDay constraint should pass');
  },
);

// ─── Then — VAR context key map assertions ────────────────────────────────────

export function parseContextKeyMapJson(source: string): Record<string, string> {
  return parseStringRecord(source, 'context key map');
}

Then('var context key map 為:', function (this: SymbolWorld, docString: string) {
  const expected = parseContextKeyMapJson(docString);
  const actual: Record<string, string> = {};
  for (const [k, v] of this.contextKeyMap.entries()) {
    actual[String(k)] = v;
  }
  assert.deepStrictEqual(actual, expected);
});

// ─── Then — ScenarioContext assertions ────────────────────────────────────────

Then(
  'scenarioContext 的 {string} 應該等於整數 {int}',
  function (this: SymbolWorld, key: string, value: number) {
    assert.strictEqual(this.ctx.get(key), value);
  },
);

Then(
  'scenarioContext 的 {string} 應該等於 {string}',
  function (this: SymbolWorld, key: string, value: string) {
    assert.strictEqual(this.ctx.get(key), value);
  },
);

Then('scenarioContext 的 {string} 應該為 null', function (this: SymbolWorld, key: string) {
  assert.strictEqual(this.ctx.get(key), null);
});

Then(
  'scenarioContext 的 {string} 應該是 DateTimeTZ 類型',
  function (this: SymbolWorld, key: string) {
    const val = this.ctx.get(key);
    assert.ok(
      val instanceof DateTimeTZ,
      `Expected "${key}" to be DateTimeTZ but got: ${typeof val}: ${String(val)}`,
    );
    this.lastResult = val;
  },
);

// ─── Then — result value assertions ───────────────────────────────────────────

Then('結果應該等於整數 {int}', function (this: SymbolWorld, value: number) {
  assert.strictEqual(this.lastResult, value);
});

Then('結果應該等於字串 {string}', function (this: SymbolWorld, value: string) {
  assert.strictEqual(this.lastResult, value);
});

Then('結果應該為 null', function (this: SymbolWorld) {
  assert.strictEqual(this.lastResult, null);
});

Then('結果應該是 DateTimeTZ 類型', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof DateTimeTZ,
    `Expected DateTimeTZ but got ${typeof this.lastResult}: ${String(this.lastResult)}`,
  );
});

Then('結果應該是 DateOnly 類型', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof DateOnly,
    `Expected DateOnly but got ${typeof this.lastResult}: ${String(this.lastResult)}`,
  );
});

Then('結果應該是 TimeOnly 類型', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof TimeOnly,
    `Expected TimeOnly but got ${typeof this.lastResult}: ${String(this.lastResult)}`,
  );
});

Then(
  '年為 {int}，月為 {int}，日為 {int}',
  function (this: SymbolWorld, year: number, month: number, day: number) {
    const r = this.lastResult;
    if (r instanceof DateTimeTZ) {
      assert.strictEqual(r.year, year);
      assert.strictEqual(r.month, month);
      assert.strictEqual(r.day, day);
    } else if (r instanceof DateOnly) {
      assert.strictEqual(r.year, year);
      assert.strictEqual(r.month, month);
      assert.strictEqual(r.day, day);
    } else {
      assert.fail(`Result is not DateTimeTZ or DateOnly: ${String(r)}`);
    }
  },
);

Then(
  '時為 {int}，分為 {int}，秒為 {int}',
  function (this: SymbolWorld, hour: number, minute: number, second: number) {
    const r = this.lastResult;
    if (r instanceof DateTimeTZ) {
      assert.strictEqual(r.hour, hour);
      assert.strictEqual(r.minute, minute);
      assert.strictEqual(r.second, second);
    } else if (r instanceof TimeOnly) {
      assert.strictEqual(r.hour, hour);
      assert.strictEqual(r.minute, minute);
      assert.strictEqual(r.second, second);
    } else {
      assert.fail(`Result is not DateTimeTZ or TimeOnly: ${String(r)}`);
    }
  },
);

Then(
  '時為 {int}，分為 {int}',
  function (this: SymbolWorld, hour: number, minute: number) {
    const r = this.lastResult;
    if (r instanceof DateTimeTZ) {
      assert.strictEqual(r.hour, hour);
      assert.strictEqual(r.minute, minute);
    } else if (r instanceof TimeOnly) {
      assert.strictEqual(r.hour, hour);
      assert.strictEqual(r.minute, minute);
    } else {
      assert.fail(`Result is not DateTimeTZ or TimeOnly: ${String(r)}`);
    }
  },
);

Then('時為 {int}', function (this: SymbolWorld, hour: number) {
  const r = this.lastResult;
  if (r instanceof DateTimeTZ) {
    assert.strictEqual(r.hour, hour);
  } else if (r instanceof TimeOnly) {
    assert.strictEqual(r.hour, hour);
  } else {
    assert.fail(`Result is not DateTimeTZ or TimeOnly: ${String(r)}`);
  }
});

Then('時區為 {string}', function (this: SymbolWorld, tz: string) {
  assert.ok(
    this.lastResult instanceof DateTimeTZ,
    `Result is not DateTimeTZ: ${String(this.lastResult)}`,
  );
  const dt = this.lastResult;
  if (tz === 'Z') {
    assert.strictEqual(dt.offset, 0, `Expected UTC (offset 0) but got offset ${dt.offset}`);
  } else {
    assert.ok(
      dt.zoneName === tz || dt.offsetStr === tz,
      `Expected zone "${tz}" but got zone="${dt.zoneName}" offset="${dt.offsetStr}"`,
    );
  }
});

Then('時區偏移為 {string}', function (this: SymbolWorld, offset: string) {
  assert.ok(
    this.lastResult instanceof DateTimeTZ,
    `Result is not DateTimeTZ: ${String(this.lastResult)}`,
  );
  assert.strictEqual((this.lastResult).offsetStr, offset);
});

Then('結果應該接近系統當前時間', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof DateTimeTZ,
    `Result is not DateTimeTZ: ${String(this.lastResult)}`,
  );
  const diff = Math.abs((this.lastResult).toMillis() - Date.now());
  assert.ok(diff < 5000, `Result not close to current time (diff: ${diff}ms)`);
});

Then('結果應該接近系統當前 DateTimeTZ', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof DateTimeTZ,
    `Result is not DateTimeTZ: ${String(this.lastResult)}`,
  );
  const diff = Math.abs((this.lastResult).toMillis() - Date.now());
  assert.ok(diff < 5000, `Result not close to current DateTimeTZ (diff: ${diff}ms)`);
});

Then('結果應該接近系統當前 TimeOnly', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof TimeOnly,
    `Result is not TimeOnly: ${String(this.lastResult)}`,
  );
  const r = this.lastResult;
  assert.ok(r.hour >= 0 && r.hour <= 23);
});

Then('結果應該等於系統當前日期', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof DateOnly,
    `Result is not DateOnly: ${String(this.lastResult)}`,
  );
  const r = this.lastResult;
  const now = new Date();
  assert.strictEqual(r.year, now.getFullYear());
  assert.strictEqual(r.month, now.getMonth() + 1);
  assert.strictEqual(r.day, now.getDate());
});

Then(
  /^結果應該約為 (\d+) (?!個月 \d+ 天)(.+?)前（允許 (.+?)誤差）$/,
  function (this: SymbolWorld, nStr: string, unit: string, tolerance: string) {
    assert.ok(this.lastResult instanceof DateTimeTZ, `Result is not DateTimeTZ`);
    const n = parseInt(nStr, 10);
    let toleranceMs = parseTolerance(tolerance);
    // Months can vary by up to 2 days (28-31 day months)
    if (unit.includes('月') || unit.includes('個月')) toleranceMs += 2 * 24 * 3600 * 1000;
    const expectedMs = Date.now() - unitToMs(n, unit);
    const diff = Math.abs((this.lastResult).toMillis() - expectedMs);
    assert.ok(diff <= toleranceMs, `Result not ~${n} ${unit} ago (diff: ${diff}ms, tol: ${toleranceMs}ms)`);
  },
);

Then(
  /^結果應該約為 (\d+) (?!個月 \d+ 天)(.+?)後（允許 (.+?)誤差）$/,
  function (this: SymbolWorld, nStr: string, unit: string, tolerance: string) {
    assert.ok(this.lastResult instanceof DateTimeTZ, `Result is not DateTimeTZ`);
    const n = parseInt(nStr, 10);
    let toleranceMs = parseTolerance(tolerance);
    // Months can vary by up to 2 days (28-31 day months)
    if (unit.includes('月') || unit.includes('個月')) toleranceMs += 2 * 24 * 3600 * 1000;
    const expectedMs = Date.now() + unitToMs(n, unit);
    const diff = Math.abs((this.lastResult).toMillis() - expectedMs);
    assert.ok(diff <= toleranceMs, `Result not ~${n} ${unit} from now (diff: ${diff}ms, tol: ${toleranceMs}ms)`);
  },
);

Then(
  /^結果應該約為 (\d+) 個月 (\d+) 天 (\d+) 小時 (\d+) 分鐘 (\d+) 秒前（允許 (.+?)誤差）$/,
  function (
    this: SymbolWorld,
    monthsStr: string,
    daysStr: string,
    hoursStr: string,
    minutesStr: string,
    secondsStr: string,
    tolerance: string,
  ) {
    assert.ok(this.lastResult instanceof DateTimeTZ);
    const toleranceMs = parseTolerance(tolerance);
    const approxMs =
      parseInt(monthsStr, 10) * 30 * 24 * 60 * 60 * 1000 +
      parseInt(daysStr, 10) * 24 * 60 * 60 * 1000 +
      parseInt(hoursStr, 10) * 60 * 60 * 1000 +
      parseInt(minutesStr, 10) * 60 * 1000 +
      parseInt(secondsStr, 10) * 1000;
    const expectedMs = Date.now() - approxMs;
    const diff = Math.abs((this.lastResult).toMillis() - expectedMs);
    assert.ok(diff <= toleranceMs + 2 * 24 * 60 * 60 * 1000);
  },
);

Then('結果應該等於設定的 DateTimeTZ', function (this: SymbolWorld) {
  assert.ok(
    this.lastResult instanceof DateTimeTZ,
    `Expected DateTimeTZ but got: ${String(this.lastResult)}`,
  );
});

// ─── Then — getNow assertions ─────────────────────────────────────────────────

Then(/^getNow\(\) 應該返回 DateTimeTZ$/, function (this: SymbolWorld) {
  const result = TimeService.getNow(this.ctx);
  assert.ok(result instanceof DateTimeTZ);
  this.lastResult = result;
});

Then(/^getNow\(\) 應該返回系統當前時間$/, function (this: SymbolWorld) {
  const result = TimeService.getNow(this.ctx);
  assert.ok(result instanceof DateTimeTZ);
  const diff = Math.abs(result.toMillis() - Date.now());
  assert.ok(diff < 5000, `getNow() not close to current time (diff: ${diff}ms)`);
});

Then('TIME-System 只負責轉換，不會自動存入 context 變數', function (this: SymbolWorld) {
  // TIME-System is pure conversion — no side effects to verify
});

// ─── Then — legacy 通用錯誤訊息 step（typed-error 走 ErrorAssertionStepDefs） ─

Then(
  '錯誤訊息包含 {string} 和 {string}',
  function (this: SymbolWorld, kw1: string, kw2: string) {
    assert.ok(this.lastError instanceof Error, `Expected Error but got: ${String(this.lastError)}`);
    const msg = (this.lastError).message;
    assert.ok(msg.includes(kw1), `Error message "${msg}" does not contain "${kw1}"`);
    assert.ok(msg.includes(kw2), `Error message "${msg}" does not contain "${kw2}"`);
  },
);

Then('不應該拋出異常', function (this: SymbolWorld) {
  assert.strictEqual(this.lastError, undefined, `Expected no error but got: ${String(this.lastError)}`);
});

Then('應該拋出例外', function (this: SymbolWorld) {
  assert.ok(this.lastError instanceof Error, `Expected an exception but got: ${String(this.lastError)}`);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTolerance(tolerance: string): number {
  const match = /(\d+)\s*([秒分時天小]|second|minute|hour|day|s|m|h|d)/i.exec(tolerance);
  if (!match) return 5000;
  const n = parseInt(match[1], 10);
  const u = match[2].toLowerCase();
  if (u === '秒' || u === 's' || u.startsWith('second')) return n * 1000;
  if (u === '分' || u === 'm' || u.startsWith('minute')) return n * 60 * 1000;
  if (u === '時' || u === '小' || u === 'h' || u.startsWith('hour')) return n * 3600 * 1000;
  if (u === '天' || u === 'd' || u.startsWith('day')) return n * 24 * 3600 * 1000;
  return 5000;
}

function parseCasActual(actualType: string, actualValue: string, ctx: ScenarioContext): unknown {
  const type = actualType.trim();
  const value = actualValue.trim();

  if (type === '' && value === 'null') return null;
  if (type === '整數') return parseInt(value, 10);
  if (type === '浮點數') return parseFloat(value);
  if (type === '字串') return stripQuotes(value);
  if (type === '布林') return value === 'true';
  if (type === '空列表') return [];
  if (type === '字串列表') return splitCsv(value).map(stripQuotes);
  if (type === '整數列表') return splitCsv(value).map((s) => parseInt(s, 10));
  if (type === '浮點數列表') return splitCsv(value).map((s) => parseFloat(s));
  if (type === '布林列表') return splitCsv(value).map((s) => s === 'true');

  if (type === 'DateOnly') {
    return TimeService.resolveTimeExpression(`@date("${stripQuotes(value)}")`, ctx);
  }
  if (type === 'SQL DATE') {
    const [y, m, d] = stripQuotes(value).split('-').map((s) => parseInt(s, 10));
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  if (type === '今天的 SQL DATE') {
    const now = TimeService.getNow(ctx).dt;
    return new Date(now.year, now.month - 1, now.day, 0, 0, 0, 0);
  }
  const sqlDateDaysAgo = /^(\d+) 天前的 SQL DATE$/.exec(type);
  if (sqlDateDaysAgo) {
    const now = TimeService.getNow(ctx).dt;
    const date = new Date(now.year, now.month - 1, now.day, 0, 0, 0, 0);
    date.setDate(date.getDate() - parseInt(sqlDateDaysAgo[1], 10));
    return date;
  }

  if (type === 'DateTimeTZ') {
    const { iso, asTimestamp } = parseDateTimeValue(value);
    const result = TimeService.resolveTimeExpression(`@time("${iso}")`, ctx);
    return asTimestamp ? (result as DateTimeTZ).toMillis() : result;
  }
  if (type === '當前 DateTimeTZ') {
    return TimeService.resolveTimeExpression('@time("now")', ctx);
  }
  if (type === '當前 DateTimeTZ 的 timestamp') {
    return (TimeService.resolveTimeExpression('@time("now")', ctx) as DateTimeTZ).toMillis();
  }
  if (type === '當前 DateTimeTZ 的字串') {
    return (TimeService.resolveTimeExpression('@time("now")', ctx) as DateTimeTZ).toString();
  }
  const dateTimeDaysAgo = /^(\d+) 天前的 DateTimeTZ$/.exec(type);
  if (dateTimeDaysAgo) {
    return TimeService.resolveTimeExpression(`@time("now-${dateTimeDaysAgo[1]}d")`, ctx);
  }

  throw new Error(`Unsupported actual_type: ${actualType}`);
}

function parseDateTimeValue(value: string): { iso: string; asTimestamp: boolean } {
  const asTimestamp = value.includes('timestamp');
  const match = /"([^"]+)"/.exec(value);
  return { iso: match ? match[1] : stripQuotes(value), asTimestamp };
}

function splitCsv(value: string): string[] {
  const stripped = stripQuotes(value);
  if (stripped === '') return [];
  return stripped.split(',').map((s) => s.trim());
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function unitToMs(n: number, unit: string): number {
  if (unit.includes('秒')) return n * 1000;
  if (unit.includes('分')) return n * 60 * 1000;
  if (unit.includes('時') || unit.includes('小時')) return n * 3600 * 1000;
  if (unit.includes('天')) return n * 24 * 3600 * 1000;
  if (unit.includes('月') || unit.includes('個月')) return n * 30 * 24 * 3600 * 1000;
  return n * 1000;
}
