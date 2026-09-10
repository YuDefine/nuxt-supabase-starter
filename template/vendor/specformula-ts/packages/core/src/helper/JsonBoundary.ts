// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/JsonBoundary.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/JsonBoundary.ts
/**
 * Runtime JSON boundaries: parse unknown input to a requested shape, or throw.
 * Doctor rule typescript/boundaries/no-unvalidated-deserialization.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function expectJsonObjectArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => expectJsonObject(item, `${label}[${index}]`));
}

function parseJsonValue(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid ${label}`);
  }
}

export function parseJsonObject(text: string, label: string): Record<string, unknown> {
  return expectJsonObject(parseJsonValue(text, label), label);
}

export function parseJsonString(text: string, label: string): string {
  const value = parseJsonValue(text, label);
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

export function parseStringRecord(text: string, label: string): Record<string, string> {
  const obj = parseJsonObject(text, label);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'string') {
      throw new Error(`${label}.${key} must be a string`);
    }
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      continue;
    }
    out[key] = value;
  }
  return out;
}
