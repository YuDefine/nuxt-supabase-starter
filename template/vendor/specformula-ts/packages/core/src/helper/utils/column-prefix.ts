// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/utils/column-prefix.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/utils/column-prefix.ts
/**
 * Parse column header prefixes for API parameters.
 * Supports P: (path), Q: (query), H: (header), B: (bare body) prefixes.
 */

export interface ColumnPrefixInfo {
  /** 'P' | 'Q' | 'H' | 'B' | null */
  prefix: string | null;
  /** The name part after the colon (or the full header if no prefix) */
  name: string;
}

/**
 * Parse a DataTable column header to extract parameter prefix and name.
 *
 * Examples:
 *   "P:id"       -> { prefix: 'P', name: 'id' }
 *   "Q:limit"    -> { prefix: 'Q', name: 'limit' }
 *   "H:X-Trace"  -> { prefix: 'H', name: 'X-Trace' }
 *   "B:"         -> { prefix: 'B', name: '' }
 *   "name"       -> { prefix: null, name: 'name' }
 */
export function parseColumnPrefix(header: string): ColumnPrefixInfo {
  if (!header || header.length === 0) {
    return { prefix: null, name: '' };
  }

  const trimmed = header.trim();
  const colonIndex = trimmed.indexOf(':');

  if (colonIndex > 0) {
    const prefix = trimmed.substring(0, colonIndex).toUpperCase();
    if (prefix === 'P' || prefix === 'Q' || prefix === 'H' || prefix === 'B') {
      const name = trimmed.substring(colonIndex + 1);
      return { prefix, name };
    }
  }

  // B: with nothing after colon — entire string is "B:"
  if (trimmed === 'B:') {
    return { prefix: 'B', name: '' };
  }

  return { prefix: null, name: trimmed };
}
