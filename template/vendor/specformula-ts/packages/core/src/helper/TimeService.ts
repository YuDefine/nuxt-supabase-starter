// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/TimeService.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/TimeService.ts
import { DateTime, Duration } from 'luxon';
import type { ScenarioContext } from '../context/ScenarioContext.js';
import { SpecFormulaArgumentError } from '../error/SpecFormulaError.js';

/**
 * DateTimeTZ — luxon DateTime with timezone (from @time()).
 * DateOnly — luxon DateTime representing a date-only value (from @date()).
 * TimeOnly — luxon DateTime representing a time-only value (from @localtime()).
 *
 * We use branded wrappers so step definitions can do instanceof checks.
 */
export class DateTimeTZ {
  constructor(public readonly dt: DateTime) {}
  get year(): number { return this.dt.year; }
  get month(): number { return this.dt.month; }
  get day(): number { return this.dt.day; }
  get hour(): number { return this.dt.hour; }
  get minute(): number { return this.dt.minute; }
  get second(): number { return this.dt.second; }
  get zoneName(): string | null { return this.dt.zoneName; }
  get offset(): number { return this.dt.offset; }
  /** Returns timezone offset string like "+08:00" or "Z" */
  get offsetStr(): string {
    if (this.dt.offset === 0) return 'Z';
    const h = Math.floor(Math.abs(this.dt.offset) / 60);
    const m = Math.abs(this.dt.offset) % 60;
    const sign = this.dt.offset >= 0 ? '+' : '-';
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  toMillis(): number { return this.dt.toMillis(); }
  toString(): string { return this.dt.toISO({ suppressMilliseconds: true }) ?? this.dt.toString(); }
}

export class DateOnly {
  constructor(public readonly dt: DateTime) {}
  get year(): number { return this.dt.year; }
  get month(): number { return this.dt.month; }
  get day(): number { return this.dt.day; }
  toString(): string { return this.dt.toISODate() ?? this.dt.toString(); }
}

export class TimeOnly {
  constructor(public readonly dt: DateTime) {}
  get hour(): number { return this.dt.hour; }
  get minute(): number { return this.dt.minute; }
  get second(): number { return this.dt.second; }
  toString(): string {
    const hh = String(this.dt.hour).padStart(2, '0');
    const mm = String(this.dt.minute).padStart(2, '0');
    const ss = String(this.dt.second).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}

/** Units supported by relative time expressions */
type RelativeUnit = 's' | 'm' | 'h' | 'd' | 'M';

const RELATIVE_STEP_RE = /([+-])(\d+)([smhdM])/g;

/**
 * TimeService — parses @time(), @date(), @localtime() expressions.
 * Uses luxon 3.x internally. Honors setNow/getNow (ADR-0006).
 */
export class TimeService {
  private static readonly TIME_RE = /^@time\("?([^"]*)"?\)$/;
  private static readonly DATE_RE = /^@date\("?([^"]*)"?\)$/;
  private static readonly LOCALTIME_RE = /^@localtime\("?([^"]*)"?\)$/;

  /**
   * Resolve @time(), @date(), @localtime() expressions.
   * Delegates $now handling to SymbolResolver — this service only does conversion.
   */
  static resolveTimeExpression(
    expression: string,
    context?: ScenarioContext,
  ): DateTimeTZ | DateOnly | TimeOnly {
    const timeMatch = TimeService.TIME_RE.exec(expression);
    if (timeMatch) {
      return new DateTimeTZ(TimeService.parseDateTime(timeMatch[1], context));
    }

    const dateMatch = TimeService.DATE_RE.exec(expression);
    if (dateMatch) {
      return new DateOnly(TimeService.parseDateOnly(dateMatch[1], context));
    }

    const localtimeMatch = TimeService.LOCALTIME_RE.exec(expression);
    if (localtimeMatch) {
      return new TimeOnly(TimeService.parseTimeOnly(localtimeMatch[1], context));
    }

    throw new SpecFormulaArgumentError({
      code: 'SYMBOL_TIME_EXPR_UNSUPPORTED',
      details: { expression },
    });
  }

  /**
   * setNow — store a mocked "now" in the ScenarioContext (ADR-0006).
   * Parses the ISO string and stores a DateTimeTZ under key "now".
   */
  static setNow(isoString: string, context: ScenarioContext): void {
    const dt = TimeService.parseIsoOrDate(isoString);
    if (!dt.isValid) {
      throw new SpecFormulaArgumentError({
        code: 'SYMBOL_TIME_EXPR_UNSUPPORTED',
        details: { expression: isoString },
      });
    }
    context.set('now', new DateTimeTZ(dt));
  }

  /**
   * getNow — return the current "now" (mocked or real).
   * If ScenarioContext has a "now" DateTimeTZ, return that.
   * Otherwise return system time as DateTimeTZ.
   */
  static getNow(context?: ScenarioContext): DateTimeTZ {
    if (context) {
      const stored = context.get('now');
      if (stored instanceof DateTimeTZ) {
        return stored;
      }
    }
    return new DateTimeTZ(DateTime.now());
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private static parseDateTime(expr: string, context?: ScenarioContext): DateTime {
    if (expr === 'now') {
      return TimeService.getNow(context).dt;
    }

    if (expr.startsWith('now')) {
      return TimeService.applyRelative(TimeService.getNow(context).dt, expr.slice(3));
    }

    const dt = TimeService.parseIsoOrDate(expr);
    if (!dt.isValid) {
      throw new SpecFormulaArgumentError({
        code: 'SYMBOL_TIME_EXPR_UNSUPPORTED',
        details: { expression: expr },
      });
    }
    return dt;
  }

  private static parseDateOnly(expr: string, context?: ScenarioContext): DateTime {
    if (expr === 'now') {
      return TimeService.getNow(context).dt.startOf('day');
    }

    // Try slash format: 2025/12/16
    const slashMatch = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(expr);
    if (slashMatch) {
      const dt = DateTime.fromObject({
        year: parseInt(slashMatch[1], 10),
        month: parseInt(slashMatch[2], 10),
        day: parseInt(slashMatch[3], 10),
      });
      if (!dt.isValid)
        throw new SpecFormulaArgumentError({
          code: 'SYMBOL_TIME_DATE_PARSE_FAILED',
          details: { value: expr },
        });
      return dt;
    }

    // ISO date: 2025-12-16
    const dt = DateTime.fromISO(expr);
    if (!dt.isValid) {
      throw new SpecFormulaArgumentError({
        code: 'SYMBOL_TIME_DATE_PARSE_FAILED',
        details: { value: expr },
      });
    }
    return dt;
  }

  private static parseTimeOnly(expr: string, context?: ScenarioContext): DateTime {
    if (expr === 'now') {
      const now = TimeService.getNow(context).dt;
      return now;
    }

    // HH:mm or HH:mm:ss
    const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(expr);
    if (timeMatch) {
      const dt = DateTime.fromObject({
        hour: parseInt(timeMatch[1], 10),
        minute: parseInt(timeMatch[2], 10),
        second: timeMatch[3] ? parseInt(timeMatch[3], 10) : 0,
      });
      if (!dt.isValid)
        throw new SpecFormulaArgumentError({
          code: 'SYMBOL_TIME_CLOCK_PARSE_FAILED',
          details: { value: expr },
        });
      return dt;
    }

    throw new SpecFormulaArgumentError({
      code: 'SYMBOL_TIME_CLOCK_PARSE_FAILED',
      details: { value: expr },
    });
  }

  /**
   * Parse ISO 8601 string — handles with/without timezone, date-only, etc.
   */
  private static parseIsoOrDate(expr: string): DateTime {
    // Date-only: 2025-11-04
    if (/^\d{4}-\d{2}-\d{2}$/.test(expr)) {
      return DateTime.fromISO(expr + 'T00:00:00');
    }
    // Full ISO with or without timezone
    return DateTime.fromISO(expr, { setZone: true });
  }

  /**
   * Apply relative adjustments like "-1d+2h-30m" to a base DateTime.
   */
  private static applyRelative(base: DateTime, adjustments: string): DateTime {
    if (!adjustments) return base;

    RELATIVE_STEP_RE.lastIndex = 0;
    let result = base;
    let match: RegExpExecArray | null;
    let matched = false;

    while ((match = RELATIVE_STEP_RE.exec(adjustments)) !== null) {
      matched = true;
      const sign = match[1] === '+' ? 1 : -1;
      const amount = parseInt(match[2], 10) * sign;
      const unit = match[3] as RelativeUnit;

      switch (unit) {
        case 's': result = result.plus(Duration.fromObject({ seconds: amount })); break;
        case 'm': result = result.plus(Duration.fromObject({ minutes: amount })); break;
        case 'h': result = result.plus(Duration.fromObject({ hours: amount })); break;
        case 'd': result = result.plus(Duration.fromObject({ days: amount })); break;
        case 'M': result = result.plus(Duration.fromObject({ months: amount })); break;
      }
    }

    if (!matched && adjustments.length > 0) {
      throw new SpecFormulaArgumentError({
        code: 'SYMBOL_TIME_EXPR_UNSUPPORTED',
        details: { expression: `now${adjustments}` },
      });
    }

    return result;
  }
}
