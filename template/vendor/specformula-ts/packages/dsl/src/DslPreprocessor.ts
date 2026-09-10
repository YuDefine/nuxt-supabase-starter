// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/DslPreprocessor.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/DslPreprocessor.ts
/**
 * DslPreprocessor（ADR-0024）— .dsl.feature 文字預處理器。
 *
 * 將 Gherkin step lines（Given/When/Then/And/But/*）逐行掃描；若 step text 匹配
 * DslExpander 之某 DSL 定義，則收集後續 DataTable 或 JSON DocString 作為 pmInput，
 * 展開為 ISA step lines；否則原樣 pass-through。
 *
 * @dsl tag 在 Feature: 行前注入一次。
 */
import { SpecFormulaArgumentError, SpecFormulaErrorCode } from '@specformula/core';
import { blockToGherkinLines, type DslExpander, type ExpandedGherkinBlock } from './DslExpander.js';

const STEP_LINE_RE = /^(\s+)(Given|When|Then|And|But|\*)\s+(.+)$/;

export class DslPreprocessor {
  private readonly expander: DslExpander;

  constructor(expander: DslExpander) {
    this.expander = expander;
  }

  /** 對 .dsl.feature 內容字串做 in-memory 預處理，回傳 .isa.feature 字串。 */
  process(featureText: string): string {
    const inputLines = featureText.split('\n');
    const outputLines: string[] = [];
    let tagInjected = false;

    for (let i = 0; i < inputLines.length; i++) {
      const line = inputLines[i];

      if (!tagInjected && line.trimStart().startsWith('Feature:')) {
        outputLines.push('@dsl');
        tagInjected = true;
      }

      const m = STEP_LINE_RE.exec(line);
      if (!m) {
        outputLines.push(line);
        continue;
      }
      const [, indent, keyword, stepText] = m;

      if (!this.expander.matches(stepText)) {
        outputLines.push(line);
        continue;
      }

      // Determine PM input from following DataTable / DocString.
      // ADR-0030：DataTable 可有 1..N 列 → 逐列獨立展開（row-wise）；
      //           零列（無 table／只有 header）走 params default。
      //           JSON DocString 仍限單一 object。
      const defName = this.expander.findFirstMatchingDefinitionName(stepText) ?? stepText;
      // pmInputs：每筆代表一列輸入（null 代表零列，走 default）。
      let pmInputs: Array<Map<string, string> | null> = [null];
      let skipTo = i;

      const next = i + 1 < inputLines.length ? inputLines[i + 1].trimStart() : '';
      if (next.startsWith('|')) {
        const parsed = parseDataTable(inputLines, i + 1);
        pmInputs = parsed.rows.length > 0 ? parsed.rows : [null];
        skipTo = parsed.endIndex;
      } else if (next.startsWith('"""')) {
        const parsed = parseJsonDocString(inputLines, i + 1, defName, stepText);
        pmInputs = [parsed.values];
        skipTo = parsed.endIndex;
      }

      // 逐列展開；keyword 串接：整體第一個 ISA step 繼承原 keyword，其餘一律 And。
      const emittedLines: string[] = [];
      let emittedAny = false;
      let aborted = false;
      for (const pmInput of pmInputs) {
        const result = this.expander.tryExpand(stepText, pmInput);
        if (result === null) {
          aborted = true;
          break;
        }
        for (const block of result.blocks as ExpandedGherkinBlock[]) {
          const useKeyword = emittedAny ? 'And' : keyword;
          for (const gLine of blockToGherkinLines(block, useKeyword, indent)) {
            emittedLines.push(gLine);
          }
          emittedAny = true;
        }
      }
      if (aborted) {
        outputLines.push(line);
        continue;
      }
      i = skipTo;
      for (const gLine of emittedLines) outputLines.push(gLine);
    }

    return outputLines.join('\n');
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface ParsedInput {
  readonly values: Map<string, string> | null;
  readonly endIndex: number;
}

interface ParsedDataTable {
  /** 每列一個 header→value map；零列（只有 header）回傳空陣列。 */
  readonly rows: Array<Map<string, string>>;
  readonly endIndex: number;
}

/**
 * 解析 DataTable（ADR-0030）：header + 1..N 列 → 逐列 header→value map。
 * 多列不再拋 DSL_DATATABLE_MULTIPLE_ROWS（該錯誤對 DataTable 退役）。
 */
function parseDataTable(lines: ReadonlyArray<string>, startIndex: number): ParsedDataTable {
  const rawRows: string[][] = [];
  let i = startIndex;
  while (i < lines.length && lines[i].trimStart().startsWith('|')) {
    const line = lines[i].trim();
    const inner = line.slice(1, -1);
    const cells = inner.split('|').map((c) => c.trim());
    rawRows.push(cells);
    i++;
  }
  const endIndex = i - 1;
  if (rawRows.length < 2) return { rows: [], endIndex };
  const headers = rawRows[0];
  const rows: Array<Map<string, string>> = [];
  for (let r = 1; r < rawRows.length; r++) {
    const vals = rawRows[r];
    const map = new Map<string, string>();
    for (let j = 0; j < headers.length && j < vals.length; j++) {
      map.set(headers[j], vals[j]);
    }
    rows.push(map);
  }
  return { rows, endIndex };
}

function parseJsonDocString(
  lines: ReadonlyArray<string>,
  startIndex: number,
  defName: string,
  stepText: string,
): ParsedInput {
  // startIndex points to opening """ line
  let i = startIndex + 1;
  const buf: string[] = [];
  while (i < lines.length && !lines[i].trimStart().startsWith('"""')) {
    buf.push(lines[i].trim());
    i++;
  }
  const jsonStr = buf.join('').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new SpecFormulaArgumentError({
      code: SpecFormulaErrorCode.DSL_JSON_PARSE_ERROR,
      details: {
        step_text: stepText,
        parse_error: err instanceof Error ? err.message : String(err),
      },
      cause: err instanceof Error ? err : undefined,
    });
  }

  if (Array.isArray(parsed)) {
    throw new SpecFormulaArgumentError({
      code: SpecFormulaErrorCode.DSL_JSON_INPUT_NOT_OBJECT,
      details: { name: defName, actual_type: 'array' },
    });
  }
  if (parsed === null) {
    throw new SpecFormulaArgumentError({
      code: SpecFormulaErrorCode.DSL_JSON_INPUT_NOT_OBJECT,
      details: { name: defName, actual_type: 'null' },
    });
  }
  if (typeof parsed !== 'object') {
    throw new SpecFormulaArgumentError({
      code: SpecFormulaErrorCode.DSL_JSON_INPUT_NOT_OBJECT,
      details: { name: defName, actual_type: typeof parsed },
    });
  }

  const out = new Map<string, string>();
  flattenJsonPmValues(parsed, '', out);
  return { values: out, endIndex: i };
}

function flattenJsonPmValues(node: unknown, path: string, out: Map<string, string>): void {
  if (node === null || node === undefined) {
    if (path !== '') out.set(path, 'null');
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      flattenJsonPmValues(node[i], `${path}[${i}]`, out);
    }
    return;
  }
  if (typeof node === 'object') {
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path === '' ? (key.includes('.') ? `["${key}"]` : key) : `${path}.${key}`;
      flattenJsonPmValues(val, childPath, out);
    }
    return;
  }
  if (path === '') return;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    out.set(path, String(node));
  } else {
    out.set(path, JSON.stringify(node));
  }
}
