// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/ConstraintEngine.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/ConstraintEngine.ts
import { DateTime } from 'luxon';
import type { ScenarioContext } from '../context/ScenarioContext.js';
import { DateTimeTZ, DateOnly, TimeOnly, TimeService } from './TimeService.js';
import { asString } from './utils/string-coerce.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaAssertionError,
  SpecFormulaLookupError,
} from '../error/SpecFormulaError.js';

/**
 * Parsed single constraint: name + raw args string.
 */
interface Constraint {
  name: string;
  args: string;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Find the matching closing parenthesis, respecting nested parens and quoted strings.
 */
function findMatchingCloseParen(str: string, startIndex: number): number {
  if (startIndex >= str.length || str[startIndex] !== '(') return -1;

  let depth = 0;
  let inString = false;
  let stringChar: string | null = null;

  for (let i = startIndex; i < str.length; i++) {
    const c = str[i];

    if ((c === '"' || c === "'") && (i === 0 || str[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = c;
      } else if (c === stringChar) {
        inString = false;
        stringChar = null;
      }
    }

    if (!inString) {
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }

  return -1;
}

/**
 * Parse a constraint expression string into individual Constraint objects.
 * Handles nested parentheses and quoted strings (e.g. "&sameTime(\"@time(\\\"now\\\")\")" ).
 */
export function parseConstraints(constraintStr: string): Constraint[] {
  const constraints: Constraint[] = [];
  let i = 0;

  while (i < constraintStr.length) {
    const ampIndex = constraintStr.indexOf('&', i);
    if (ampIndex === -1) break;

    let nameEnd = ampIndex + 1;
    while (nameEnd < constraintStr.length && /[a-zA-Z0-9_]/.test(constraintStr[nameEnd])) {
      nameEnd++;
    }

    const name = constraintStr.slice(ampIndex + 1, nameEnd);
    let args = '';

    if (nameEnd < constraintStr.length && constraintStr[nameEnd] === '(') {
      const closeParen = findMatchingCloseParen(constraintStr, nameEnd);
      if (closeParen !== -1) {
        args = constraintStr.slice(nameEnd + 1, closeParen);
        i = closeParen + 1;
      } else {
        i = nameEnd + 1;
      }
    } else {
      i = nameEnd;
    }

    constraints.push({ name, args });

    // Skip whitespace between constraints
    while (i < constraintStr.length && /\s/.test(constraintStr[i])) i++;
  }

  return constraints;
}

/**
 * Split args string by commas, respecting nested parentheses and quoted strings.
 */
function splitArgs(argsStr: string): string[] {
  if (!argsStr) return [];

  const result: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar: string | null = null;

  for (let i = 0; i < argsStr.length; i++) {
    const c = argsStr[i];

    if ((c === '"' || c === "'") && (i === 0 || argsStr[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = c;
      } else if (c === stringChar) {
        inString = false;
        stringChar = null;
      }
      current += c;
      continue;
    }

    if (!inString) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
    }

    current += c;
  }

  if (current.trim().length > 0) result.push(current.trim());
  return result;
}

/**
 * Strip surrounding quotes from a string argument.
 */
function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Resolve $varName references in args string using the ScenarioContext.
 */
function resolveArgs(args: string, context?: ScenarioContext): string {
  if (!context || !args) return args;

  let resolved = '';
  let inString = false;

  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if ((c === '"' || c === "'") && (i === 0 || args[i - 1] !== '\\')) {
      inString = !inString;
      resolved += c;
      continue;
    }

    if (!inString && c === '$' && args[i + 1] === '{') {
      const end = args.indexOf('}', i + 2);
      if (end !== -1) {
        const varName = args.slice(i + 2, end);
        resolved += context.has(varName) ? stringifyConstraintArg(context.get(varName)) : `\${${varName}}`;
        i = end;
        continue;
      }
    }

    if (!inString && c === '$') {
      // Allow dotted variable names (e.g. $ProductC.id) — context stores
      // VAR-captured keys like `ProductC.id` as flat keys, matching
      // SymbolResolver.resolveVariable's whole-name lookup.
      const match = /^([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/.exec(args.slice(i + 1));
      if (match) {
        resolved += stringifyConstraintArg(resolveConstraintVariable(match[1], context));
        i += match[1].length;
        continue;
      }
    }

    resolved += c;
  }

  return resolved;
}

function resolveConstraintVariable(varName: string, context: ScenarioContext): unknown {
  if (context.has(varName)) return context.get(varName);
  if (varName === 'now') return TimeService.getNow(context);
  throw new SpecFormulaLookupError({
    code: 'SYMBOL_VAR_KEY_NOT_FOUND',
    details: { key: varName },
  });
}

function stringifyConstraintArg(value: unknown): string {
  if (value instanceof DateTimeTZ || value instanceof DateOnly || value instanceof TimeOnly) {
    return value.toString();
  }
  return asString(value);
}

// ─── Type conversion (for constraint args) ────────────────────────────────────

/**
 * Auto-convert a string arg to its JS type (number, boolean, null, string).
 * DECIMAL stays as number via parseFloat — only used for comparisons.
 */
function convertArg(value: string): unknown {
  const v = value.trim();
  if (v === 'null' || v === '') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return v;
}

// ─── DateTime extraction ──────────────────────────────────────────────────────

/**
 * Extract a luxon DateTime from various actual value types.
 * Supports: DateTimeTZ, DateOnly, TimeOnly, Date, number (timestamp), string (ISO).
 */
function toDateTime(actual: unknown): DateTime | null {
  if (actual instanceof DateTimeTZ) return actual.dt;
  if (actual instanceof DateOnly) return actual.dt;
  if (actual instanceof TimeOnly) return actual.dt;
  // Duck-type check for DateTimeTZ/DateOnly/TimeOnly (handles cross-module instanceof issues)
  if (
    actual !== null &&
    typeof actual === 'object' &&
    'dt' in actual &&
    (actual).dt instanceof DateTime
  ) {
    return (actual as { dt: DateTime }).dt;
  }
  if (actual instanceof Date) return DateTime.fromJSDate(actual);
  if (typeof actual === 'number') return DateTime.fromMillis(actual);
  if (typeof actual === 'string') {
    const dt = DateTime.fromISO(actual, { setZone: true });
    if (dt.isValid) return dt;
    // Try date-only
    const d = DateTime.fromISO(actual);
    if (d.isValid) return d;
    return null;
  }
  return null;
}

/**
 * Parse a constraint arg string into a DateTime (for time comparisons).
 * Supports: ISO 8601 strings (with/without timezone, with/without time).
 * HH:mm or HH:mm:ss (time-only) uses today as base date.
 */
function argToDateTime(argStr: string): DateTime | null {
  const s = unquote(argStr).trim();

  // Time-only: HH:mm or HH:mm:ss
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (timeOnly) {
    return DateTime.fromObject({
      hour: parseInt(timeOnly[1], 10),
      minute: parseInt(timeOnly[2], 10),
      second: timeOnly[3] ? parseInt(timeOnly[3], 10) : 0,
    });
  }

  // Date-only: 2025-01-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return DateTime.fromISO(s);
  }

  // Full ISO (with or without timezone)
  const dt = DateTime.fromISO(s, { setZone: true });
  if (dt.isValid) return dt;

  return null;
}

// ─── Single constraint evaluator ──────────────────────────────────────────────

function evaluateSingle(
  actual: unknown,
  name: string,
  argsStr: string,
  context?: ScenarioContext,
): boolean {
  const args = splitArgs(argsStr);

  switch (name) {
    // ── Numeric comparisons ──────────────────────────────────────────────
    case 'eq': {
      if (args.length !== 1) return false;
      const expected = convertArg(unquote(args[0]));
      if (typeof actual === 'number' && typeof expected === 'number') {
        return actual === expected;
      }
      return actual === expected;
    }

    case 'ne': {
      if (args.length !== 1) return false;
      const expected = convertArg(unquote(args[0]));
      return actual !== expected;
    }

    case 'gt': {
      assertArgCount(name, args, 1);
      const threshold = convertArg(unquote(args[0]));
      assertNumeric(actual);
      assertNumeric(threshold, unquote(args[0]));
      return actual > threshold;
    }

    case 'lt': {
      assertArgCount(name, args, 1);
      const threshold = convertArg(unquote(args[0]));
      assertNumeric(actual);
      assertNumeric(threshold, unquote(args[0]));
      return actual < threshold;
    }

    case 'ge': {
      assertArgCount(name, args, 1);
      const threshold = convertArg(unquote(args[0]));
      assertNumeric(actual);
      assertNumeric(threshold, unquote(args[0]));
      return actual >= threshold;
    }

    case 'le': {
      assertArgCount(name, args, 1);
      const threshold = convertArg(unquote(args[0]));
      assertNumeric(actual);
      assertNumeric(threshold, unquote(args[0]));
      return actual <= threshold;
    }

    case 'between': {
      assertArgCount(name, args, 2);
      const min = convertArg(unquote(args[0]));
      const max = convertArg(unquote(args[1]));
      assertNumeric(actual);
      assertNumeric(min, unquote(args[0]));
      assertNumeric(max, unquote(args[1]));
      return actual >= min && actual <= max;
    }

    case 'notBetween': {
      assertArgCount(name, args, 2);
      const min = convertArg(unquote(args[0]));
      const max = convertArg(unquote(args[1]));
      assertNumeric(actual);
      assertNumeric(min, unquote(args[0]));
      assertNumeric(max, unquote(args[1]));
      return actual < min || actual > max;
    }

    // ── Type checks ──────────────────────────────────────────────────────
    case 'isNum': return typeof actual === 'number';
    case 'isStr': return typeof actual === 'string';
    case 'isBool': return typeof actual === 'boolean';
    case 'isNull': return actual === null;
    case 'isNotNull': return actual !== null && actual !== undefined;
    case 'isDef': return actual !== null && actual !== undefined;

    // ── String operations ────────────────────────────────────────────────
    case 'contains': {
      if (args.length !== 1) return false;
      if (typeof actual !== 'string') return false;
      return actual.includes(unquote(args[0]));
    }

    case 'startsWith': {
      if (args.length !== 1) return false;
      if (typeof actual !== 'string') return false;
      return actual.startsWith(unquote(args[0]));
    }

    case 'endsWith': {
      if (args.length !== 1) return false;
      if (typeof actual !== 'string') return false;
      return actual.endsWith(unquote(args[0]));
    }

    case 'matches': {
      if (args.length !== 1) return false;
      if (typeof actual !== 'string') return false;
      try {
        return new RegExp(unquote(args[0])).test(actual);
      } catch {
        return false;
      }
    }

    case 'length': {
      assertArgCount(name, args, 2);
      const min = convertArg(unquote(args[0]));
      const len = typeof actual === 'string' ? actual.length
        : Array.isArray(actual) ? actual.length
        : -1;
      if (len === -1) return false;
      const max = convertArg(unquote(args[1]));
      if (typeof min !== 'number' || typeof max !== 'number') return false;
      return len >= min && len <= max;
    }

    // ── Collection / array ───────────────────────────────────────────────
    case 'hasItem': {
      if (args.length !== 1) return false;
      if (!Array.isArray(actual)) return false;
      const searchVal = convertArg(unquote(args[0]));
      return actual.includes(searchVal);
    }

    case 'hasNoItem': {
      if (args.length !== 1) return false;
      if (!Array.isArray(actual)) return false;
      const searchVal = convertArg(unquote(args[0]));
      return !actual.includes(searchVal);
    }

    case 'size': {
      if (args.length !== 1) return false;
      const expectedSize = convertArg(unquote(args[0]));
      if (typeof expectedSize !== 'number') return false;
      if (Array.isArray(actual)) return actual.length === expectedSize;
      if (typeof actual === 'string') return actual.length === expectedSize;
      if (typeof actual === 'object' && actual !== null) return Object.keys(actual).length === expectedSize;
      return false;
    }

    case 'isEmpty': {
      if (Array.isArray(actual)) return actual.length === 0;
      if (typeof actual === 'string') return actual.length === 0;
      if (typeof actual === 'object' && actual !== null) return Object.keys(actual).length === 0;
      return false;
    }

    case 'isNotEmpty': {
      if (Array.isArray(actual)) return actual.length > 0;
      if (typeof actual === 'string') return actual.length > 0;
      if (typeof actual === 'object' && actual !== null) return Object.keys(actual).length > 0;
      return false;
    }

    // ── Existence ────────────────────────────────────────────────────────
    case 'exists': return actual !== null && actual !== undefined;
    case 'notExists': return actual === null || actual === undefined;

    // ── Map field checks ─────────────────────────────────────────────────
    case 'hasField': {
      if (args.length !== 1) return false;
      if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
      return unquote(args[0]) in (actual as Record<string, unknown>);
    }

    case 'noField': {
      if (args.length !== 1) return false;
      if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
      return !(unquote(args[0]) in (actual as Record<string, unknown>));
    }

    // ── Set membership ───────────────────────────────────────────────────
    case 'oneOf': {
      if (args.length === 0) return false;
      const allowed = args.map((a) => convertArg(unquote(a)));
      return allowed.includes(actual);
    }

    case 'noneOf': {
      if (args.length === 0) return false;
      const disallowed = args.map((a) => convertArg(unquote(a)));
      return !disallowed.includes(actual);
    }

    // ── Time comparisons ─────────────────────────────────────────────────
    case 'before': {
      if (args.length !== 1) return false;
      const actualDt = toDateTime(actual);
      // Special keyword "now" (ADR-0006 mocked contextual time)
      const beforeArgRaw = unquote(args[0]).trim();
      const compareDt = beforeArgRaw === 'now' ? TimeService.getNow(context).dt : argToDateTime(args[0]);
      if (!actualDt || !compareDt) return false;
      return actualDt.toMillis() < compareDt.toMillis();
    }

    case 'after': {
      if (args.length !== 1) return false;
      const actualDt = toDateTime(actual);
      // Special keyword "now" (ADR-0006 mocked contextual time)
      const afterArgRaw = unquote(args[0]).trim();
      const compareDt = afterArgRaw === 'now' ? TimeService.getNow(context).dt : argToDateTime(args[0]);
      if (!actualDt || !compareDt) return false;
      return actualDt.toMillis() > compareDt.toMillis();
    }

    case 'sameDay': {
      if (args.length !== 1) return false;
      const actualDt = toDateTime(actual);
      if (!actualDt) return false;
      // Special keyword "today"
      const argRaw = unquote(args[0]).trim();
      const compareDt = argRaw === 'today' ? TimeService.getNow(context).dt : argToDateTime(args[0]);
      if (!compareDt) return false;
      // Use local date for comparison
      const ad = actualDt.toLocal();
      const cd = compareDt.toLocal();
      return ad.year === cd.year && ad.month === cd.month && ad.day === cd.day;
    }

    case 'withinDays': {
      if (args.length !== 1) return false;
      const days = convertArg(unquote(args[0]));
      if (typeof days !== 'number') return false;
      const actualDt = toDateTime(actual);
      if (!actualDt) return false;
      const now = TimeService.getNow(context).dt;
      // Use floor of absolute diff in whole days to avoid floating-point sub-day fractions
      const diffDays = Math.floor(Math.abs(actualDt.diff(now, 'days').days));
      return diffDays <= days;
    }

    case 'sameTime': {
      if (args.length !== 1) return false;
      const actualDt = toDateTime(actual);
      // Special keyword "now" (ADR-0006 mocked contextual time)
      const argRaw = unquote(args[0]).trim();
      const compareDt = argRaw === 'now' ? TimeService.getNow(context).dt : argToDateTime(args[0]);
      if (!actualDt || !compareDt) return false;
      // Compare at millisecond level (truncate to seconds to ignore nanoseconds)
      const actualSec = Math.floor(actualDt.toMillis() / 1000);
      const compareSec = Math.floor(compareDt.toMillis() / 1000);
      return actualSec === compareSec;
    }

    case 'timeRange': {
      assertArgCount(name, args, 2);
      const actualDt = toDateTime(actual);
      const startDt = argToDateTime(args[0]);
      const endDt = argToDateTime(args[1]);
      if (!actualDt || !startDt || !endDt) return false;
      const actualMinutes = actualDt.hour * 60 + actualDt.minute;
      const startMinutes = startDt.hour * 60 + startDt.minute;
      const endMinutes = endDt.hour * 60 + endDt.minute;
      return actualMinutes >= startMinutes && actualMinutes <= endMinutes;
    }

    default:
      throw new SpecFormulaArgumentError({
        code: 'SYMBOL_CAS_CONSTRAINT_UNKNOWN',
        details: { name },
      });
  }
}

function assertArgCount(name: string, args: string[], expected: number): void {
  if (args.length === expected) return;
  throw new SpecFormulaArgumentError({
    code: 'SYMBOL_CAS_PARAMETER_INVALID',
    details: {
      name,
      error_message: expected === 2 ? '需要兩個參數' : `需要 ${expected} 個參數`,
    },
  });
}

function assertNumeric(value: unknown, rawValue?: string): asserts value is number {
  if (typeof value === 'number' && !Number.isNaN(value)) return;
  throw new SpecFormulaArgumentError({
    code: 'SYMBOL_CAS_VALUE_NOT_NUMERIC',
    details: { value: rawValue ?? asString(value) },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate all constraints in a constraint expression string against an actual value.
 * All constraints must pass (AND logic).
 * Returns true if all pass, false if any fail.
 */
export function applyConstraints(
  actual: unknown,
  constraintStr: string,
  context?: ScenarioContext,
): boolean {
  const constraints = parseConstraints(constraintStr);

  for (const { name, args } of constraints) {
    const resolvedArgs = resolveArgs(args, context);
    if (!evaluateSingle(actual, name, resolvedArgs, context)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluate constraints and throw on failure with a descriptive error message.
 */
export function evaluateConstraints(
  actual: unknown,
  constraintStr: string,
  context?: ScenarioContext,
  fieldName?: string,
  entityName?: string,
): void {
  if (!applyConstraints(actual, constraintStr, context)) {
    const location =
      entityName && fieldName
        ? `${entityName}.${fieldName}`
        : fieldName ?? 'field';
    throw new SpecFormulaAssertionError({
      code: 'ASSERT_CAS_CONSTRAINT_FAILED',
      details: {
        json_path: location,
        constraint: constraintStr,
        actual_value: JSON.stringify(actual),
      },
    });
  }
}

/**
 * ConstraintEngine — wraps the stateless functions with a ScenarioContext.
 */
export class ConstraintEngine {
  constructor(private readonly context: ScenarioContext) {}

  apply(actual: unknown, constraintStr: string): boolean {
    return applyConstraints(actual, constraintStr, this.context);
  }

  evaluate(
    actual: unknown,
    constraintStr: string,
    fieldName?: string,
    entityName?: string,
  ): void {
    evaluateConstraints(actual, constraintStr, this.context, fieldName, entityName);
  }

  parseConstraints(constraintStr: string): Array<{ name: string; args: string }> {
    return parseConstraints(constraintStr);
  }
}
