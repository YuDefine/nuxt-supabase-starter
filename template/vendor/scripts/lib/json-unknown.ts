// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/json-unknown.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/json-unknown.ts
/**
 * JSON.parse 的邊界：先拿到 unknown，再以 runtime 檢查收成 object。
 * 給具體 domain type 貼型別必須走 type guard，禁止 `JSON.parse(text) as Foo`。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJson(text: string): unknown {
  const raw: unknown = JSON.parse(text)
  return raw
}

export function parseJsonRecord(
  text: string,
  message = 'expected JSON object',
): Record<string, unknown> {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw)) throw new Error(message)
  return raw
}

export function parseJsonWith<T>(
  text: string,
  guard: (value: unknown) => value is T,
  message = 'invalid JSON shape',
): T {
  const raw: unknown = JSON.parse(text)
  if (!guard(raw)) throw new Error(message)
  return raw
}
