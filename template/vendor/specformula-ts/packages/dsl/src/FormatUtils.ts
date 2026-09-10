// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/FormatUtils.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/FormatUtils.ts
/**
 * FormatUtils（ADR-0032）— `format` 之 `{name}` 簡寫偵測與正規化。
 *
 * `format` 兩種形態：
 *   - 既有 regex（向後相容）：`^...$` anchored、具名捕獲寫 (?<name>...) 或 (?P<name>...)。
 *   - `{name}` 簡寫（ADR-0032）：固定字串 + `{識別字}` 佔位（識別字非純數字，
 *     以與 regex 量詞 `{2,3}` 區別）。簡寫於「編譯比對 pattern 時」正規化為
 *     anchored 具名捕獲 regex；`解析結果`（DslStepDef.format）保留原始字面。
 */

// 識別字：以非數字開頭，後接識別字字元（含非 ASCII，如中文）。
// 排除純數字 / 量詞（{2,3} / {3}）以與 regex 量詞區別。
const NAME_PLACEHOLDER_RE = /\{([^\d{}][^{}]*)\}/gu;

// 既有 regex 具名捕獲（JS `(?<name>...)` 或 Python `(?P<name>...)`）。
const NAMED_CAPTURE_GROUP_RE = /\(\?P?<[^>]+>/u;

/**
 * 偵測 format 是否為 `{name}` 簡寫：含至少一個 `{識別字}`（識別字非純數字）。
 */
export function isNamePlaceholderFormat(format: string): boolean {
  NAME_PLACEHOLDER_RE.lastIndex = 0;
  return NAME_PLACEHOLDER_RE.test(format);
}

/**
 * 偵測 format 是否為簡寫形態（ADR-0032，含 issue #358 之 0-capture 純文字）：
 * 非 anchored（未同時以 `^` 起、`$` 末）且不含既有 regex 具名捕獲 `(?<name>)` / `(?P<name>)`。
 *
 * 涵蓋兩種簡寫：
 *   - `{name}` 簡寫：固定字串 + `{識別字}` 佔位；
 *   - 0-capture 純文字 literal：無佔位、無具名捕獲（degenerate case，僅 escape + auto-anchor）。
 *
 * 既有 regex 形態（含具名捕獲且未 anchor）不在此列，須自行 anchor（否則 DSL_FORMAT_ANCHOR_MISSING）。
 */
export function isShorthandFormat(format: string): boolean {
  const anchored = format.startsWith('^') && format.endsWith('$');
  if (anchored) return false;
  return !NAMED_CAPTURE_GROUP_RE.test(format);
}

/**
 * 擷取 `{name}` 簡寫中所有佔位名稱（依出現順序，去重）。
 */
export function extractPlaceholderNames(format: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  NAME_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME_PLACEHOLDER_RE.exec(format)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** 將 literal 文字逐字 regex-escape。 */
function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 將 `{name}` 簡寫展開為 anchored 具名捕獲 regex 字面：
 *   - literal 文字逐字 escape；
 *   - 每個 `{name}` 依引號上下文（ADR-0033）決定捕獲樣式：
 *     - 緊鄰被引號包住（`"{name}"`：`{` 前一字元為 `"` 且 `}` 後一字元為 `"`）
 *       → `(?<name>[^"]+)`（捕獲引號內容，向後相容 ADR-0032）；
 *     - 否則（未被引號包住）→ `(?<name>.+?)`（non-greedy，捕獲整個 token，含引號）。
 *   - 整體補 `^...$`（若尚未 anchored）。
 *
 * 例：`系統中已存在玩家 "{玩家Id}"，暱稱為 "{暱稱}"`
 *   → `^系統中已存在玩家 "(?<玩家Id>[^"]+)"，暱稱為 "(?<暱稱>[^"]+)"$`
 * 例：`{name}是一個使用者`
 *   → `^(?<name>.+?)是一個使用者$`
 */
export function expandNamePlaceholderFormat(format: string): string {
  let result = '';
  let lastIndex = 0;
  NAME_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME_PLACEHOLDER_RE.exec(format)) !== null) {
    result += escapeRegexLiteral(format.slice(lastIndex, m.index));
    const before = m.index > 0 ? format[m.index - 1] : '';
    const afterIndex = m.index + m[0].length;
    const after = afterIndex < format.length ? format[afterIndex] : '';
    const quoted = before === '"' && after === '"';
    const body = quoted ? '[^"]+' : '.+?';
    result += `(?<${m[1]}>${body})`;
    lastIndex = afterIndex;
  }
  result += escapeRegexLiteral(format.slice(lastIndex));
  if (!result.startsWith('^')) result = '^' + result;
  if (!result.endsWith('$')) result = result + '$';
  return result;
}
