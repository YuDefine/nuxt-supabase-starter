// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/IsaInstructionCatalog.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/IsaInstructionCatalog.ts
/**
 * IsaInstructionCatalog（ADR-0025）— DSL preprocessor 之輕量 isa.yml 讀取器。
 *
 * 只擷取 instructions[].format / data_format / instruction_type 供 data_format 解析；
 * 完整 ISA spec 驗證留給 @specformula/core 之 IsaSpecReader。
 *
 * resolveDataFormat 依 ADR-0025 規則：
 *   1. instruction.data_format 顯式宣告 → 使用該值
 *   2. 缺失 + instruction_type=custom → 'none'
 *   3. 缺失 + built-in → suffix heuristic（JSON: → json / : → data_table / 否則 none）
 */
import * as fs from 'node:fs';
import { SpecFormulaArgumentError, SpecFormulaErrorCode } from '@specformula/core';
import yaml from 'js-yaml';
import { ancestorChain, findIsaSpecsInDir } from './discovery.js';

const VALID_DATA_FORMATS = new Set(['none', 'data_table', 'json', 'text']);
const PYTHON_NAMED_GROUP_RE = /\(\?P<([^>]+)>/g;
const PLACEHOLDER_DOLLAR_ANGLE_RE = /\$<([^>]+)>/g;

export interface IsaInstruction {
  readonly name: string;
  readonly format: string;
  readonly compiledPattern: RegExp;
  readonly dataFormat: string | null;
  readonly instructionType: string | null;
}

export class IsaInstructionCatalog {
  private readonly instructions: ReadonlyArray<IsaInstruction>;

  constructor(instructions: ReadonlyArray<IsaInstruction>) {
    this.instructions = instructions;
  }

  /** 由 yaml 內容解析建立。 */
  static parse(yamlContent: string): IsaInstructionCatalog {
    return new IsaInstructionCatalog(IsaInstructionCatalog.parseInstructionsFromYaml(yamlContent));
  }

  /**
   * Merge the ADR-0035 §7 effective ISA catalog for an `anchor` folder
   * (issue #427).
   *
   * Walks the ancestor chain root → … → anchor; each layer contributes only
   * its own `isa.yml` / `<domain>.isa.yml` (non-recursive, filename-sorted),
   * merged root-first. The `<domain>` prefix is file grouping only — it never
   * affects scope or instruction `name`. Mirrors Python `load_effective` /
   * Java `IsaInstructionCatalog.loadEffective`.
   *
   * Returns `null` only when **no** ISA file exists anywhere in the chain
   * (lenient mode — the expander then skips strict catalog matching). A chain
   * that yields at least one ISA file returns a catalog even when it parses to
   * zero instructions: found-but-empty is *strict*, so every in-scope DSL
   * expansion fails with `DSL_ISA_STEP_NO_MATCH` rather than passing through.
   *
   * @throws `DSL_DEFINITION_DUPLICATE_NAME` when an instruction `name`
   *         (non-empty) repeats anywhere in the effective scope — same layer or
   *         across layers (ADR-0035 §4, no shadowing).
   */
  static loadEffective(baseDir: string, anchor: string): IsaInstructionCatalog | null {
    const merged: IsaInstruction[] = [];
    const seenNames = new Set<string>();
    let found = false;
    for (const folder of ancestorChain(baseDir, anchor)) {
      for (const isaFile of findIsaSpecsInDir(folder)) {
        const content = fs.readFileSync(isaFile, 'utf-8');
        const instrs = IsaInstructionCatalog.parseInstructionsFromYaml(content);
        found = true;
        for (const instr of instrs) {
          if (instr.name) {
            if (seenNames.has(instr.name)) {
              throw new SpecFormulaArgumentError({
                code: SpecFormulaErrorCode.DSL_DEFINITION_DUPLICATE_NAME,
                details: { name: instr.name },
              });
            }
            seenNames.add(instr.name);
          }
          merged.push(instr);
        }
      }
    }
    if (!found) return null;
    return new IsaInstructionCatalog(merged);
  }

  /** 由 yaml 內容解析出 instructions 清單（含 data_format 檢核）。 */
  private static parseInstructionsFromYaml(yamlContent: string): IsaInstruction[] {
    const root = yaml.load(yamlContent) as Record<string, unknown> | null;
    if (!root || typeof root !== 'object') return [];
    const instructionsNode = root.instructions;
    if (!Array.isArray(instructionsNode)) return [];

    const out: IsaInstruction[] = [];
    for (const node of instructionsNode as Array<Record<string, unknown>>) {
      const name = toScalarString(node.name);
      const format = toScalarString(node.format);
      const dataFormat = node.data_format == null ? null : toScalarString(node.data_format);
      const instructionType = node.instruction_type == null ? null : toScalarString(node.instruction_type);

      if (dataFormat != null && !VALID_DATA_FORMATS.has(dataFormat)) {
        throw new SpecFormulaArgumentError({
          code: SpecFormulaErrorCode.SPEC_ISA_INSTRUCTION_DATA_FORMAT_INVALID,
          details: { name, format: dataFormat },
        });
      }

      try {
        const jsFormat = format.replace(PYTHON_NAMED_GROUP_RE, '(?<$1>');
        const pattern = new RegExp(jsFormat, 'u');
        out.push({ name, format, compiledPattern: pattern, dataFormat, instructionType });
      } catch {
        // skip invalid regex（與 Java 對齊）
      }
    }
    return out;
  }

  findInstruction(instructionText: string): IsaInstruction | null {
    for (const instr of this.instructions) {
      instr.compiledPattern.lastIndex = 0;
      const m = instr.compiledPattern.exec(instructionText);
      if (m !== null && m[0] === instructionText) return instr;
    }
    const placeholderText = toPlaceholderValidationText(instructionText);
    if (placeholderText !== instructionText) {
      for (const instr of this.instructions) {
        instr.compiledPattern.lastIndex = 0;
        const m = instr.compiledPattern.exec(placeholderText);
        if (m !== null && m[0] === placeholderText) return instr;
      }
    }
    return null;
  }

  /**
   * Returns data_format string；若 strict match 失敗則拋 DSL_ISA_STEP_NO_MATCH
   * 或 DSL_ISA_STEP_MULTIPLE_MATCH。dslName 用於 error details.name。
   */
  resolveDataFormat(dslName: string | null, instructionText: string): string {
    const matches = this.collectMatches(instructionText);
    if (matches.length === 0) {
      const placeholderText = toPlaceholderValidationText(instructionText);
      if (placeholderText !== instructionText) {
        matches.push(...this.collectMatches(placeholderText));
      }
    }
    if (matches.length === 0) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_ISA_STEP_NO_MATCH,
        details: { name: dslName ?? '(unknown)', instruction: instructionText },
      });
    }
    if (matches.length > 1) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_ISA_STEP_MULTIPLE_MATCH,
        details: {
          name: dslName ?? '(unknown)',
          instruction: instructionText,
          matched_names: matches.map((m) => m.name).join(', '),
        },
      });
    }
    const matched = matches[0];
    if (matched.dataFormat != null) return matched.dataFormat;
    if (matched.instructionType === 'custom') return 'none';
    if (instructionText.endsWith('JSON:')) return 'json';
    if (instructionText.endsWith(':')) return 'data_table';
    return 'none';
  }

  private collectMatches(text: string): IsaInstruction[] {
    const out: IsaInstruction[] = [];
    for (const instr of this.instructions) {
      instr.compiledPattern.lastIndex = 0;
      const m = instr.compiledPattern.exec(text);
      if (m !== null && m[0] === text) out.push(instr);
    }
    return out;
  }
}

function toPlaceholderValidationText(instructionText: string): string {
  return instructionText.replace(PLACEHOLDER_DOLLAR_ANGLE_RE, '$$$1');
}

function toScalarString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}
