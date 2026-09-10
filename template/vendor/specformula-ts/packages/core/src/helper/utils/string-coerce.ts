// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/utils/string-coerce.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/utils/string-coerce.ts
/**
 * Safely coerce an unknown value to a string for display/concatenation.
 * Objects are JSON-stringified to avoid '[object Object]'.
 */
export function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[Function]';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is narrowed to string|number|boolean|bigint after typeof guards above
  return String(value);
}
