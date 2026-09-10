// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/DslExpander.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/DslExpander.ts
/**
 * DslExpander（ADR-0024）— DSL step 之純文字展開引擎。
 *
 * 不依賴 ISA / BDD 框架元件，僅做：pattern matching、capture/param 綁定、
 * {{var}} 文字渲染與 Gherkin block 重輸出。Read-time 結構檢核由 DslYmlReader 完成；
 * runtime 動態檢核（ambiguous / param-unknown / param-missing）由此處負責。
 */
import { SpecFormulaArgumentError, SpecFormulaErrorCode } from '@specformula/core';
import type { DslDefinition, DslSpec } from './DslModels.js';
import type { IsaInstructionCatalog } from './IsaInstructionCatalog.js';
import {
  isShorthandFormat,
  extractPlaceholderNames,
  expandNamePlaceholderFormat,
} from './FormatUtils.js';

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g;
const PYTHON_NAMED_GROUP_RE = /\(\?P<([^>]+)>/g;

export interface ExpandedGherkinBlock {
  readonly stepText: string;
  /** null when no DataTable payload；空 map 視為無 payload。 */
  readonly table: ReadonlyMap<string, string> | null;
  readonly text: string | null;
  /** 'none' | 'data_table' | 'json' | 'text' — undefined 表 caller 不需此資訊。 */
  readonly dataFormat: string | null;
}

export interface ExpansionResult {
  readonly definitionName: string;
  readonly originalStepText: string;
  readonly blocks: ReadonlyArray<ExpandedGherkinBlock>;
}

interface CompiledDefinition {
  readonly definition: DslDefinition;
  readonly pattern: RegExp;
  readonly captureNames: ReadonlyArray<string>;
}

export class DslExpander {
  private readonly compiled: CompiledDefinition[];
  private readonly isaCatalog: IsaInstructionCatalog | null;

  constructor(spec: DslSpec | null | undefined, isaCatalog: IsaInstructionCatalog | null = null) {
    this.compiled = [];
    this.isaCatalog = isaCatalog;
    if (!spec || !spec.dsl_steps) return;
    for (const def of spec.dsl_steps) {
      this.compiled.push({
        definition: def,
        pattern: compileFormat(def.format),
        captureNames: extractCaptureNamesUnique(def.format),
      });
    }
  }

  isEmpty(): boolean {
    return this.compiled.length === 0;
  }

  /** 嘗試匹配。多匹配時拋 DSL_STEP_AMBIGUOUS_MATCH；無匹配時 false。 */
  matches(stepText: string): boolean {
    const found = this.findMatches(stepText);
    if (found.length === 0) return false;
    if (found.length > 1) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_STEP_AMBIGUOUS_MATCH,
        details: { step_text: stepText },
      });
    }
    return true;
  }

  /** 嘗試取得第一個匹配定義名稱（不處理 ambiguous）。 */
  findFirstMatchingDefinitionName(stepText: string): string | null {
    const found = this.findMatches(stepText);
    return found.length === 0 ? null : found[0].definition.name;
  }

  /**
   * 展開 step。無匹配時回傳 null。多匹配拋 DSL_STEP_AMBIGUOUS_MATCH。
   *
   * @param pmInput PM 從 DataTable/JSON 傳入之覆蓋值（null 表無）；
   *   - 鍵不在 def.params 內 → DSL_EXPAND_PARAM_UNKNOWN
   *   - def.params 中標記 required（default 為 null）且未提供 → DSL_EXPAND_PARAM_MISSING
   */
  tryExpand(stepText: string, pmInput: ReadonlyMap<string, string> | null = null): ExpansionResult | null {
    const found = this.findMatches(stepText);
    if (found.length === 0) return null;
    if (found.length > 1) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_STEP_AMBIGUOUS_MATCH,
        details: { step_text: stepText },
      });
    }

    const compiled = found[0];
    const match = compiled.pattern.exec(stepText);
    if (match === null) return null; // unreachable post-findMatches

    // 1. Regex captures
    const captures = new Map<string, string>();
    const groups = match.groups ?? {};
    for (const name of compiled.captureNames) {
      const val = groups[name];
      if (val !== undefined) captures.set(name, val);
    }

    // 2. Build variables = param defaults (template-resolved) overlaid by captures
    const variables = new Map<string, string>();
    const params = compiled.definition.params;
    if (params) {
      for (const [k, def] of Object.entries(params)) {
        if (def !== null) {
          variables.set(k, applyTemplates(def, captures));
        }
      }
    }
    for (const [k, v] of captures) variables.set(k, v);

    // 3. PM input override
    if (pmInput) {
      for (const [k, v] of pmInput) {
        if (!params || !Object.prototype.hasOwnProperty.call(params, k)) {
          throw new SpecFormulaArgumentError({
            code: SpecFormulaErrorCode.DSL_EXPAND_PARAM_UNKNOWN,
            details: { param_name: k },
          });
        }
        variables.set(k, v);
      }
    }

    // 4. Required param check
    if (params) {
      for (const [k, def] of Object.entries(params)) {
        if (def === null && !variables.has(k)) {
          throw new SpecFormulaArgumentError({
            code: SpecFormulaErrorCode.DSL_EXPAND_PARAM_MISSING,
            details: { param_name: k },
          });
        }
      }
    }

    const blocks = this.expand(compiled.definition, variables);
    return { definitionName: compiled.definition.name, originalStepText: stepText, blocks };
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private findMatches(stepText: string): CompiledDefinition[] {
    const out: CompiledDefinition[] = [];
    for (const c of this.compiled) {
      c.pattern.lastIndex = 0;
      const m = c.pattern.exec(stepText);
      if (m !== null && m[0] === stepText) {
        out.push(c);
      }
    }
    return out;
  }

  private expand(def: DslDefinition, variables: ReadonlyMap<string, string>): ExpandedGherkinBlock[] {
    const out: ExpandedGherkinBlock[] = [];
    for (const sub of def.isa_steps) {
      const stepText = applyTemplates(sub.instruction, variables);
      const table = resolveTable(sub.table, variables);
      const text = sub.text == null ? null : applyTemplates(sub.text, variables);

      const dataFormat = this.isaCatalog
        ? this.isaCatalog.resolveDataFormat(def.name, stepText)
        : inferDataFormatBySuffix(stepText);

      this.validateDataFormatPayload(def.name, stepText, dataFormat, table, text);
      if (this.isaCatalog && table != null && table.size > 0) {
        this.validateCaptureRestriction(def.name, stepText, table);
      }

      out.push({ stepText, table, text, dataFormat });
    }
    return out;
  }

  /** ADR-0025：data_format vs dsl.yml payload field 驗證。 */
  private validateDataFormatPayload(
    defName: string,
    stepText: string,
    dataFormat: string | null,
    table: ReadonlyMap<string, string> | null,
    text: string | null,
  ): void {
    const hasTable = table != null && table.size > 0;
    const hasText = text !== null;
    const instructionName = this.resolveInstructionDisplayName(stepText);

    if (dataFormat === 'none' && (hasTable || hasText)) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_DATA_FORMAT_PAYLOAD_FORBIDDEN,
        details: {
          name: defName,
          instruction_name: instructionName,
          payload_field: hasTable ? 'table' : 'text',
        },
      });
    }
    if (dataFormat === 'text' && hasTable) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_DATA_FORMAT_FIELD_MISMATCH,
        details: { name: defName, instruction_name: instructionName, expected: 'text', provided: 'table' },
      });
    }
    if ((dataFormat === 'data_table' || dataFormat === 'json') && hasText) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_DATA_FORMAT_FIELD_MISMATCH,
        details: { name: defName, instruction_name: instructionName, expected: dataFormat, provided: 'text' },
      });
    }
  }

  /** custom instruction 不允許 table 出現 < / > capture/export 標記。 */
  private validateCaptureRestriction(
    defName: string,
    stepText: string,
    table: ReadonlyMap<string, string>,
  ): void {
    if (!this.isaCatalog) return;
    const matched = this.isaCatalog.findInstruction(stepText);
    if (!matched || matched.instructionType !== 'custom') return;
    for (const [key, value] of table) {
      const isCapture =
        key.startsWith('>') || key.startsWith('<') || value.startsWith('>') || value.startsWith('<');
      if (isCapture) {
        throw new SpecFormulaArgumentError({
          code: SpecFormulaErrorCode.DSL_CUSTOM_CAPTURE_NOT_SUPPORTED,
          details: { name: defName, instruction_name: matched.name, capture_key: key },
        });
      }
    }
  }

  private resolveInstructionDisplayName(stepText: string): string {
    if (!this.isaCatalog) return stepText;
    const matched = this.isaCatalog.findInstruction(stepText);
    return matched ? matched.name : stepText;
  }
}

// ─── module-level helpers ────────────────────────────────────────────────────

function applyTemplates(text: string, variables: ReadonlyMap<string, string>): string {
  return text.replace(TEMPLATE_RE, (_match, key: string) => {
    return variables.has(key) ? variables.get(key)! : `{{${key}}}`;
  });
}

function resolveTable(
  table: Readonly<Record<string, string>> | null,
  variables: ReadonlyMap<string, string>,
): Map<string, string> | null {
  if (table == null) return null;
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(table)) {
    out.set(applyTemplates(k, variables), applyTemplates(v, variables));
  }
  return out;
}

/**
 * 預設 ISA 缺席時，由 step 後綴推斷 data_format（與 Java 端「heuristic mode」對齊，
 * 僅用於 BDD 單元測試與展開預覽）。整合 IsaInstructionCatalog 後此邏輯會被覆寫。
 */
function inferDataFormatBySuffix(stepText: string): string | null {
  if (stepText.endsWith('JSON:')) return 'json';
  if (stepText.endsWith(':')) return 'data_table';
  return null;
}

/**
 * 編譯 format 為 RegExp（u flag）。
 *  - 簡寫形態（ADR-0032，含 issue #358 之 0-capture 純文字）：正規化於此處——
 *    literal escape、每個 `{name}` → (?<name>[^"]+)、補 ^...$；純文字僅 escape + anchor（無捕獲）。
 *    解析結果（DslStepDef.format）仍保留原始字面（不動 def）。
 *  - 既有 regex：(?P<name>...) Python style 轉成 JS 標準 (?<name>...)。
 */
function compileFormat(format: string): RegExp {
  const source = isShorthandFormat(format)
    ? expandNamePlaceholderFormat(format)
    : format.replace(PYTHON_NAMED_GROUP_RE, '(?<$1>');
  return new RegExp(source, 'u');
}

function extractCaptureNamesUnique(format: string): string[] {
  if (isShorthandFormat(format)) {
    return extractPlaceholderNames(format);
  }
  const all = new Set<string>();
  const re = /\(\?P?<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(format)) !== null) {
    all.add(m[1]);
  }
  return Array.from(all);
}

// ─── ExpandedGherkinBlock → Gherkin lines ───────────────────────────────────

/**
 * 將 ExpandedGherkinBlock 渲染為 Gherkin lines（含 keyword + payload）。
 *
 * - data_table：以 column-aligned DataTable 渲染（CJK 字元寬度 = 2）。
 * - json：以 JSON.stringify pretty print 之 DocString 包裝。
 * - text：以單純 DocString 包裝（無 fence 標記）。
 * - 無 payload 但 dataFormat 要求 payload：補空 payload 占位。
 */
export function blockToGherkinLines(block: ExpandedGherkinBlock, keyword: string, indent: string): string[] {
  const lines: string[] = [];
  const hasTable = block.table != null && block.table.size > 0;
  const hasText = block.text !== null;

  if (!hasTable && !hasText) {
    lines.push(`${indent}${keyword} ${block.stepText}`);
    if (block.dataFormat === 'data_table') {
      lines.push(`${indent}  | |`);
      lines.push(`${indent}  | |`);
    } else if (block.dataFormat === 'json') {
      lines.push(`${indent}  """json`);
      lines.push(`${indent}  {}`);
      lines.push(`${indent}  """`);
    } else if (block.dataFormat === 'text') {
      lines.push(`${indent}  """`);
      lines.push(`${indent}  """`);
    }
    return lines;
  }

  if (block.text !== null) {
    const text = block.text;
    lines.push(`${indent}${keyword} ${block.stepText}`);
    lines.push(`${indent}  """`);
    const content = text.endsWith('\n') ? text.slice(0, -1) : text;
    for (const ln of content.split('\n')) lines.push(`${indent}  ${ln}`);
    lines.push(`${indent}  """`);
    return lines;
  }

  // hasTable, no text
  lines.push(`${indent}${keyword} ${block.stepText}`);
  if (block.dataFormat === 'json') {
    const obj: Record<string, string> = {};
    for (const [k, v] of block.table!) obj[k] = v;
    const json = JSON.stringify(obj, null, 2);
    lines.push(`${indent}  """json`);
    for (const ln of json.split('\n')) lines.push(`${indent}  ${ln}`);
    lines.push(`${indent}  """`);
    return lines;
  }

  const entries = Array.from(block.table!.entries());
  const widths = entries.map(([k, v]) => Math.max(displayWidth(k), displayWidth(v)));
  let header = `${indent}  |`;
  let row = `${indent}  |`;
  for (let i = 0; i < entries.length; i++) {
    header += ` ${padToDisplayWidth(entries[i][0], widths[i])} |`;
    row += ` ${padToDisplayWidth(entries[i][1], widths[i])} |`;
  }
  lines.push(header);
  lines.push(row);
  return lines;
}

function padToDisplayWidth(s: string, target: number): string {
  const cur = displayWidth(s);
  return cur >= target ? s : s + ' '.repeat(target - cur);
}

/** CJK / 全形 = 2，其他 = 1。 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isFullWidth(cp)) w += 2;
    else w += 1;
  }
  return w;
}

function isFullWidth(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  );
}
