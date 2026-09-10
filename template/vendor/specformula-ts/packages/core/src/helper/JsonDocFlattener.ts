// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/JsonDocFlattener.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/JsonDocFlattener.ts
/**
 * SpecFormula-flavored JSON DocString parser + flattener.
 *
 * Mirrors the Python reference (`specformula-core/.../instructions/json_doc.py`):
 * parses JSON that permits bare SpecFormula expressions (`$var`, `@time(...)`,
 * `&constraint(...)`, `<execKey`) and bare VAR-capture keys (`>contextKey`),
 * then flattens the tree into table-style `(headers, values)` so the existing
 * DataTable INSERT / assert pipeline can be reused unchanged.
 *
 * A root object flattens to one row; a root array flattens to N rows (one per
 * element). Nested objects/arrays produce dot/bracket JSON-path headers
 * (e.g. `orderItems[0].productId`), which `EntitySetup.insertRows` already maps
 * to a JSONB column with the nested structure serialized to a JSON string.
 */

type JsonDocNode =
  | { kind: 'object'; fields: Array<[string, JsonDocNode]> }
  | { kind: 'array'; elements: JsonDocNode[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; raw: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'bare'; expression: string };

class SpecFormulaJsonParser {
  private pos = 0;

  constructor(private readonly source: string) {}

  parse(): JsonDocNode {
    this.skipWhitespace();
    const result = this.parseValue();
    this.skipWhitespace();
    if (this.pos !== this.source.length) {
      throw this.error('JSON DocString 含有多餘內容');
    }
    return result;
  }

  private parseValue(): JsonDocNode {
    this.skipWhitespace();
    if (this.pos >= this.source.length) {
      throw this.error('未預期的結尾');
    }
    const current = this.source[this.pos];
    if (current === '{') return this.parseObject();
    if (current === '[') return this.parseArray();
    if (current === '"') return { kind: 'string', value: this.parseString() };
    if (current === '$' || current === '&' || current === '@' || current === '<') {
      return this.parseBareExpression();
    }
    if (current === '-' || (current >= '0' && current <= '9')) {
      return this.parseNumber();
    }
    if (this.source.startsWith('true', this.pos)) {
      this.pos += 4;
      return { kind: 'boolean', value: true };
    }
    if (this.source.startsWith('false', this.pos)) {
      this.pos += 5;
      return { kind: 'boolean', value: false };
    }
    if (this.source.startsWith('null', this.pos)) {
      this.pos += 4;
      return { kind: 'null' };
    }
    throw this.error(`未預期的字元: '${current}'`);
  }

  private parseObject(): JsonDocNode {
    this.expect('{');
    const fields: Array<[string, JsonDocNode]> = [];
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.pos += 1;
      return { kind: 'object', fields };
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.parseObjectKey();
      this.skipWhitespace();
      this.expect(':');
      this.skipWhitespace();
      fields.push([key, this.parseValue()]);
      this.skipWhitespace();
      if (this.peek() === '}') {
        this.pos += 1;
        break;
      }
      this.expect(',');
    }
    return { kind: 'object', fields };
  }

  private parseObjectKey(): string {
    if (this.peek() === '>') return this.parseBareKey();
    if (this.peek() === 'B' && this.source[this.pos + 1] === ':') {
      this.pos += 1;
      return 'B:';
    }
    if (this.pos + 1 < this.source.length) {
      const prefix = this.source[this.pos];
      if ((prefix === 'P' || prefix === 'Q' || prefix === 'H') && this.source[this.pos + 1] === '"') {
        this.pos += 1;
        return `${prefix}:${this.parseString()}`;
      }
    }
    return this.parseString();
  }

  private parseBareKey(): string {
    const start = this.pos;
    while (this.pos < this.source.length) {
      const current = this.source[this.pos];
      if (current === ':' || /\s/.test(current)) break;
      this.pos += 1;
    }
    if (this.pos === start) throw this.error('空的裸 key');
    return this.source.slice(start, this.pos);
  }

  private parseArray(): JsonDocNode {
    this.expect('[');
    const elements: JsonDocNode[] = [];
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.pos += 1;
      return { kind: 'array', elements };
    }
    for (;;) {
      elements.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek() === ']') {
        this.pos += 1;
        break;
      }
      this.expect(',');
      this.skipWhitespace();
    }
    return { kind: 'array', elements };
  }

  private parseString(): string {
    this.expect('"');
    const buffer: string[] = [];
    while (this.pos < this.source.length) {
      const current = this.source[this.pos];
      if (current === '\\') {
        this.pos += 1;
        if (this.pos >= this.source.length) throw this.error('未結束的跳脫序列');
        const escaped = this.source[this.pos];
        const replacements: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        if (escaped === 'u') {
          if (this.pos + 4 >= this.source.length) throw this.error('不完整的 unicode 跳脫');
          const hexText = this.source.slice(this.pos + 1, this.pos + 5);
          buffer.push(String.fromCharCode(parseInt(hexText, 16)));
          this.pos += 4;
        } else if (escaped in replacements) {
          buffer.push(replacements[escaped]);
        } else {
          throw this.error(`未知的跳脫字元: \\${escaped}`);
        }
      } else if (current === '"') {
        this.pos += 1;
        return buffer.join('');
      } else {
        buffer.push(current);
      }
      this.pos += 1;
    }
    throw this.error('未結束的字串');
  }

  private parseBareExpression(): JsonDocNode {
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.source.length) {
      const current = this.source[this.pos];
      if (depth === 0 && (current === ',' || current === '}' || current === ']')) break;
      if (current === '(' || current === '[') depth += 1;
      else if (current === ')' || current === ']') depth -= 1;
      this.pos += 1;
    }
    const expression = this.source.slice(start, this.pos).trim();
    if (!expression) throw this.error('空的 SpecFormula 表達式');
    return { kind: 'bare', expression };
  }

  private parseNumber(): JsonDocNode {
    const start = this.pos;
    if (this.peek() === '-') this.pos += 1;
    while (this.isDigit(this.peek())) this.pos += 1;
    if (this.peek() === '.') {
      this.pos += 1;
      while (this.isDigit(this.peek())) this.pos += 1;
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.pos += 1;
      if (this.peek() === '+' || this.peek() === '-') this.pos += 1;
      while (this.isDigit(this.peek())) this.pos += 1;
    }
    return { kind: 'number', raw: this.source.slice(start, this.pos) };
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos += 1;
    }
  }

  private expect(expected: string): void {
    if (this.peek() !== expected) {
      const actual = this.peek() || '\0';
      throw this.error(`預期 '${expected}' 但遇到 '${actual}'`);
    }
    this.pos += 1;
  }

  private peek(): string {
    return this.pos >= this.source.length ? '' : this.source[this.pos];
  }

  private error(message: string): Error {
    let line = 1;
    let column = 1;
    for (const ch of this.source.slice(0, this.pos)) {
      if (ch === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    return new Error(`[SpecFormulaJsonParser] ${message} (行 ${line}, 列 ${column})`);
  }
}

/** Escape dotted keys with bracket notation (mirror of Python `escape_key`). */
function escapeKey(key: string): string {
  if (key.includes('.') && !key.startsWith('["')) {
    return `["${key}"]`;
  }
  return key;
}

/**
 * Flatten a JSON DocString into `(headers, rows)`.
 *
 * A root object yields a single row; a root array yields one row per element.
 * Columns across array elements are unioned so every row aligns to the same
 * header list (missing cells become empty string → skipped at INSERT).
 */
export function flattenJsonDocument(document: string): { headers: string[]; rows: string[][] } {
  const root = new SpecFormulaJsonParser(document).parse();

  if (root.kind === 'array') {
    if (root.elements.length === 0) {
      return { headers: [], rows: [] };
    }
    const allHeaders: string[] = [];
    const perElement: Array<{ headers: string[]; values: string[] }> = [];
    for (const element of root.elements) {
      const headers: string[] = [];
      const values: string[] = [];
      flattenNode(element, '', headers, values);
      perElement.push({ headers, values });
      for (const h of headers) {
        if (!allHeaders.includes(h)) allHeaders.push(h);
      }
    }
    const rows: string[][] = perElement.map(({ headers, values }) => {
      const map = new Map<string, string>();
      headers.forEach((h, i) => map.set(h, values[i]));
      return allHeaders.map((h) => map.get(h) ?? '');
    });
    return { headers: allHeaders, rows };
  }

  const headers: string[] = [];
  const values: string[] = [];
  flattenNode(root, '', headers, values);
  return { headers, rows: [values] };
}

function flattenNode(node: JsonDocNode, prefix: string, headers: string[], values: string[]): void {
  if (node.kind === 'object') {
    for (const [key, child] of node.fields) {
      if (key === 'B:') {
        headers.push('B:');
        values.push(nodeToString(child, true));
        continue;
      }
      if (key.startsWith('>')) {
        headers.push(key);
        let childText = nodeToString(child, false);
        // Nested VAR-capture execution keys are prefixed with the JSON path so
        // `>k: <id` inside `orderItems[0]` resolves against the right column.
        if (childText.startsWith('<') && prefix) {
          childText = `<${prefix}.${childText.slice(1)}`;
        }
        values.push(childText);
        continue;
      }
      let path: string;
      if (key.startsWith('[')) {
        path = prefix ? `${prefix}${key}` : key;
      } else {
        const escaped = escapeKey(key);
        path = prefix ? `${prefix}.${escaped}` : escaped;
      }
      flattenNode(child, path, headers, values);
    }
    return;
  }

  if (node.kind === 'array') {
    node.elements.forEach((child, index) => {
      const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flattenNode(child, path, headers, values);
    });
    return;
  }

  headers.push(prefix);
  values.push(nodeToString(node, false));
}

function nodeToString(node: JsonDocNode, quoted: boolean): string {
  switch (node.kind) {
    case 'string':
      if (!quoted) {
        // Keep interpolation (${...}) inline; keep symbol-leading literals quoted
        // so downstream resolution treats them as literal values, not symbols.
        if (node.value.includes('${')) return node.value;
        if (node.value.startsWith('&') || node.value.startsWith('$')) {
          return `"${node.value}"`;
        }
        return node.value;
      }
      return `"${node.value}"`;
    case 'number':
      return node.raw;
    case 'boolean':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'bare':
      return node.expression;
    case 'object': {
      const fields = node.fields.map(
        ([key, value]) => `"${key}": ${nodeToString(value, true)}`,
      );
      return `{${fields.join(', ')}}`;
    }
    case 'array': {
      const elements = node.elements.map((element) => nodeToString(element, true));
      return `[${elements.join(', ')}]`;
    }
  }
}
