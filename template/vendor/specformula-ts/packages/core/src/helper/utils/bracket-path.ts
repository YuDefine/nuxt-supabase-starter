// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/utils/bracket-path.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/utils/bracket-path.ts
/**
 * Bracket-notation aware path parser for API body construction and response validation.
 *
 * Supports:
 *   "user.name"                  -> normal dot-notation
 *   "a.b[0].c"                   -> array index
 *   "[\"app.version\"]"          -> bracket-escaped key with literal dot
 *   "data.[\"env.name\"]"        -> nested bracket-escaped key
 *   "[0].name"                   -> top-level array index
 */

export type PathSegment =
  | { type: 'key'; key: string }
  | { type: 'index'; index: number };

/**
 * Parse a path string into typed segments.
 * Handles:
 *  - dot notation: "a.b.c"
 *  - array indices: "a[0].b"
 *  - bracket notation (literal dot in key): ["key.with.dot"]
 *  - top-level array: "[0].field"
 */
export function parseBracketPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;

  while (i < path.length) {
    // Skip leading dot separators
    if (path[i] === '.') {
      i++;
      continue;
    }

    // Bracket notation: ["key"] — key may contain dots
    if (path[i] === '[' && i + 1 < path.length && (path[i + 1] === '"' || path[i + 1] === "'")) {
      const quoteChar = path[i + 1];
      const closeQuote = path.indexOf(quoteChar, i + 2);
      if (closeQuote !== -1 && path[closeQuote + 1] === ']') {
        const key = path.slice(i + 2, closeQuote);
        segments.push({ type: 'key', key });
        i = closeQuote + 2;
        continue;
      }
    }

    // Array index: [0]
    if (path[i] === '[') {
      const closeIdx = path.indexOf(']', i);
      if (closeIdx !== -1) {
        const idxStr = path.slice(i + 1, closeIdx);
        if (/^\d+$/.test(idxStr)) {
          segments.push({ type: 'index', index: parseInt(idxStr, 10) });
          i = closeIdx + 1;
          continue;
        }
      }
    }

    // Normal key: read until '.', '[', or end
    let end = i;
    while (end < path.length && path[end] !== '.' && path[end] !== '[') {
      end++;
    }

    if (end > i) {
      segments.push({ type: 'key', key: path.slice(i, end) });
      i = end;
    } else {
      // Unexpected character — skip it
      i++;
    }
  }

  return segments;
}

/**
 * Set a value in a nested object/array using bracket-aware path segments.
 * Creates intermediate objects/arrays as needed.
 */
export function setBracketValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = parseBracketPath(path);
  if (segments.length === 0) return;

  let current: unknown = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const nextSeg = segments[i + 1];
    const nextIsIndex = nextSeg.type === 'index';

    if (seg.type === 'key') {
      const rec = current as Record<string, unknown>;
      if (rec[seg.key] === undefined || rec[seg.key] === null) {
        rec[seg.key] = nextIsIndex ? [] : {};
      }
      current = rec[seg.key];
    } else {
      // index
      const arr = current as unknown[];
      while (arr.length <= seg.index) arr.push(null);
      if (arr[seg.index] === null || arr[seg.index] === undefined) {
        arr[seg.index] = nextIsIndex ? [] : {};
      }
      current = arr[seg.index];
    }
  }

  const last = segments[segments.length - 1];
  if (last.type === 'key') {
    (current as Record<string, unknown>)[last.key] = value;
  } else {
    const arr = current as unknown[];
    while (arr.length <= last.index) arr.push(null);
    arr[last.index] = value;
  }
}

/**
 * Get a value from a nested object/array using bracket-aware path segments.
 * Returns undefined if the path does not exist.
 */
export function getBracketValue(obj: unknown, path: string): unknown {
  const segments = parseBracketPath(path);
  let current: unknown = obj;

  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;

    if (seg.type === 'key') {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[seg.key];
    } else {
      if (!Array.isArray(current)) return undefined;
      current = (current as unknown[])[seg.index];
    }
  }

  return current;
}
