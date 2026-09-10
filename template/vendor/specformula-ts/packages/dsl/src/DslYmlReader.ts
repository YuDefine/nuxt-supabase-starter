// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/DslYmlReader.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/DslYmlReader.ts
/**
 * DslYmlReader（ADR-0024 / ADR-0035）
 *
 * 讀取 dsl.yml 檔，產出合併之 DslSpec。
 *
 * - `read(files)`：內容導向合併 primitive（供 plugin / registry 單一來源讀取）。
 * - `readEffectiveSpec(baseDir, anchor)`：ADR-0035 per-anchor 祖先鏈合併（取代
 *   舊全域遞迴 readFromDir / read_all —— 不再掃 build 目錄，見 issue #388）。
 *
 * 全部 13 個 ADR-0026 DSL_* 錯誤碼之檢核點：
 *   - DSL_SPEC_FILE_PARSE_ERROR：YAML 解析失敗
 *   - DSL_FORMAT_ANCHOR_MISSING：format 缺 ^ / $ anchor
 *   - DSL_FORMAT_GROUP_NAME_COLLISION：format 之 named group 移除底線後撞名
 *   - DSL_FORMAT_PARAM_COLLIDE_CAPTURE：format named group 與 params key 同名
 *   - DSL_DEFINITION_DUPLICATE_NAME：同名 DslDefinition（跨檔亦不允許）
 *   - DSL_ISA_STEPS_EMPTY：isa_steps 為空
 *   - DSL_TEMPLATE_REF_DANGLING：isa_steps 之 {{ref}} 找不到對應 capture / param
 *   - DSL_PARAMS_DEFAULT_REF_DANGLING：params 之 default value 內 {{ref}} 找不到對應 capture
 *
 *（其他錯誤碼 DSL_EXPAND_PARAM_MISSING / UNKNOWN / STEP_AMBIGUOUS_MATCH /
 *  DATATABLE_MULTIPLE_ROWS / JSON_INPUT_NOT_OBJECT 由 DslExpander / DslPreprocessor 負責，
 *  非 read-time 檢核。）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { SpecFormulaArgumentError, SpecFormulaErrorCode } from '@specformula/core';
import type { DslDefinition, DslSpec, DslSubStep } from './DslModels.js';
import { isShorthandFormat, extractPlaceholderNames } from './FormatUtils.js';
import { ancestorChain, findDslSpecsInDir } from './discovery.js';

const NAMED_CAPTURE_RE = /\(\?P?<([^>]+)>/g;
const TEMPLATE_REF_RE = /\{\{([^}]+)\}\}/g;

export class DslYmlReader {
  /**
   * 從多個檔案合併載入；檔案順序由 caller 控制（通常為 sorted glob）。
   * 跨檔案 name 重複亦拋 DSL_DEFINITION_DUPLICATE_NAME。
   *
   * @param files 每個檔案需提供 path 與 content；path 用於錯誤訊息 details.path。
   */
  read(files: ReadonlyArray<{ path: string; content: string }>): DslSpec {
    const defs: DslDefinition[] = [];
    for (const file of files) {
      const parsed = this.parseSingleFile(file.path, file.content);
      defs.push(...parsed.dsl_steps);
    }
    this.validateAggregate(defs);
    return { dsl_steps: defs };
  }

  /**
   * Merge the ADR-0035 effective `DslSpec` for an `anchor` folder (issue #427).
   *
   * Walks the ancestor chain root → … → anchor (see `ancestorChain`); each
   * layer contributes only its own `dsl.yml` / `<domain>.dsl.yml`
   * (non-recursive, filename-sorted), merged root-first. Sibling and
   * descendant folders are invisible. Mirrors Python `read_effective_spec` /
   * Java `DslSpecReader.readEffectiveSpec`.
   *
   * @param baseDir DSL resource root the anchor is relative to.
   * @param anchor  Root-relative folder path (`/` separators); `""` means the
   *                root itself.
   * @returns The merged spec, or `null` when no DSL definition exists anywhere
   *          in the chain.
   * @throws `DSL_DEFINITION_DUPLICATE_NAME` when a definition `name` repeats
   *         anywhere in the effective scope (same layer or across layers —
   *         ADR-0035 §4 forbids shadowing), or any single-file validation error.
   */
  readEffectiveSpec(baseDir: string, anchor: string): DslSpec | null {
    const defs: DslDefinition[] = [];
    for (const folder of ancestorChain(baseDir, anchor)) {
      for (const filePath of findDslSpecsInDir(folder)) {
        const rel = path.relative(baseDir, filePath).split(path.sep).join('/');
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = this.parseSingleFile(rel, content);
        defs.push(...parsed.dsl_steps);
      }
    }
    if (defs.length === 0) return null;
    this.validateAggregate(defs);
    return { dsl_steps: defs };
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private parseSingleFile(filePath: string, content: string): DslSpec {
    let raw: unknown;
    try {
      raw = yaml.load(content);
    } catch (err) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_SPEC_FILE_PARSE_ERROR,
        details: { path: filePath },
        cause: err instanceof Error ? err : undefined,
      });
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_SPEC_FILE_PARSE_ERROR,
        details: { path: filePath },
      });
    }
    const top = raw as Record<string, unknown>;
    const dslStepsRaw = top['dsl_steps'];
    if (dslStepsRaw == null) {
      return { dsl_steps: [] };
    }
    if (!Array.isArray(dslStepsRaw)) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_SPEC_FILE_PARSE_ERROR,
        details: { path: filePath },
      });
    }

    const defs: DslDefinition[] = [];
    for (const itemRaw of dslStepsRaw) {
      const def = this.coerceDefinition(itemRaw);
      this.validateDefinition(def, filePath);
      defs.push(def);
    }
    return { dsl_steps: defs };
  }

  private coerceDefinition(itemRaw: unknown): DslDefinition {
    if (itemRaw == null || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_SPEC_FILE_PARSE_ERROR,
        details: { path: '(inline)' },
      });
    }
    const item = itemRaw as Record<string, unknown>;
    const name = toScalarString(item['name']);
    const format = toScalarString(item['format']);
    const params = this.coerceParams(item['params']);
    const isaStepsRaw = item['isa_steps'];
    const isaSteps: DslSubStep[] = Array.isArray(isaStepsRaw)
      ? isaStepsRaw.map((s) => this.coerceSubStep(s))
      : [];
    return { name, format, params, isa_steps: isaSteps };
  }

  /**
   * Coerce params：
   *  - Array：[a, b] → { a: null, b: null }（全 required）
   *  - Object：{ key: default | null }（null = required；非 null 值 string-coerce）
   *  - null / undefined → null
   */
  private coerceParams(raw: unknown): Record<string, string | null> | null {
    if (raw == null) return null;
    if (Array.isArray(raw)) {
      const out: Record<string, string | null> = {};
      for (const elem of raw) {
        out[String(elem)] = null;
      }
      return out;
    }
    if (typeof raw === 'object') {
      const out: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        out[k] = v == null ? null : toScalarString(v);
      }
      return out;
    }
    return null;
  }

  private coerceSubStep(raw: unknown): DslSubStep {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_SPEC_FILE_PARSE_ERROR,
        details: { path: '(inline)' },
      });
    }
    const r = raw as Record<string, unknown>;
    const instruction = toScalarString(r['instruction']);
    const table = this.coerceTable(r['table']);
    const text = r['text'] == null ? undefined : toScalarString(r['text']);
    return text === undefined
      ? { instruction, table }
      : { instruction, table, text };
  }

  private coerceTable(raw: unknown): Record<string, string> | null {
    if (raw == null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = v == null ? '' : toScalarString(v);
    }
    return out;
  }

  /** Per-definition 結構檢核（不跨檔）。 */
  private validateDefinition(def: DslDefinition, specPath: string): void {
    const { name, format, params, isa_steps } = def;

    // ADR-0032：format 為簡寫形態（非 anchored 且無既有 regex 具名捕獲）時，視為簡寫模式。
    // 涵蓋 `{name}` 簡寫與 0-capture 純文字 literal（issue #358）。
    // 簡寫於比對時自動 anchor，不適用 DSL_FORMAT_ANCHOR_MISSING；
    // 其捕獲名取自佔位名（純文字 literal 無佔位，捕獲名為空）。
    const isShorthand = isShorthandFormat(format);

    // DSL_FORMAT_ANCHOR_MISSING — 既有 regex（含具名捕獲）必有 ^ 起 與 $ 末；簡寫不適用。
    if (!isShorthand && (!format.startsWith('^') || !format.endsWith('$'))) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_FORMAT_ANCHOR_MISSING,
        details: { name, spec_path: specPath },
      });
    }

    // named capture 名稱清單（簡寫取自 `{name}` 佔位，regex 取自具名捕獲）
    const captureNames = isShorthand ? extractPlaceholderNames(format) : extractCaptureNames(format);

    // DSL_FORMAT_GROUP_NAME_COLLISION — 去底線後撞名
    {
      const seenStripped = new Map<string, string>();
      const conflicts: string[] = [];
      for (const cn of captureNames) {
        const stripped = cn.replaceAll('_', '');
        if (seenStripped.has(stripped) && seenStripped.get(stripped) !== cn) {
          conflicts.push(seenStripped.get(stripped)!);
          conflicts.push(cn);
        } else {
          seenStripped.set(stripped, cn);
        }
      }
      if (conflicts.length > 0) {
        const uniq = Array.from(new Set(conflicts));
        throw new SpecFormulaArgumentError({
          code: SpecFormulaErrorCode.DSL_FORMAT_GROUP_NAME_COLLISION,
          details: { name, group_names: uniq.join(', ') },
        });
      }
    }

    // DSL_FORMAT_PARAM_COLLIDE_CAPTURE — format named group 與 params key 同名
    if (params) {
      for (const cn of captureNames) {
        if (Object.prototype.hasOwnProperty.call(params, cn)) {
          throw new SpecFormulaArgumentError({
            code: SpecFormulaErrorCode.DSL_FORMAT_PARAM_COLLIDE_CAPTURE,
            details: { name, group_name: cn },
          });
        }
      }
    }

    // DSL_ISA_STEPS_EMPTY
    if (!isa_steps || isa_steps.length === 0) {
      throw new SpecFormulaArgumentError({
        code: SpecFormulaErrorCode.DSL_ISA_STEPS_EMPTY,
        details: { name },
      });
    }

    // 合法 reference name 集 = capture names ∪ params keys
    const validRefs = new Set<string>(captureNames);
    if (params) {
      for (const p of Object.keys(params)) validRefs.add(p);
    }

    // DSL_PARAMS_DEFAULT_REF_DANGLING — params default 內之 {{ref}} 只能引用 capture
    if (params) {
      for (const [paramName, defaultValue] of Object.entries(params)) {
        if (defaultValue == null) continue;
        const refs = extractTemplateRefs(defaultValue);
        for (const ref of refs) {
          if (!captureNames.includes(ref)) {
            throw new SpecFormulaArgumentError({
              code: SpecFormulaErrorCode.DSL_PARAMS_DEFAULT_REF_DANGLING,
              details: { name, param_name: paramName, var_name: ref },
            });
          }
        }
      }
    }

    // DSL_TEMPLATE_REF_DANGLING — isa_steps 之 {{ref}} 必須在 validRefs
    for (let stepIndex = 0; stepIndex < isa_steps.length; stepIndex++) {
      const step = isa_steps[stepIndex];
      const candidates: string[] = [];
      candidates.push(step.instruction);
      if (step.table) {
        for (const [k, v] of Object.entries(step.table)) {
          candidates.push(k);
          candidates.push(v);
        }
      }
      if (step.text != null) candidates.push(step.text);
      for (const candidate of candidates) {
        const refs = extractTemplateRefs(candidate);
        for (const ref of refs) {
          if (!validRefs.has(ref)) {
            throw new SpecFormulaArgumentError({
              code: SpecFormulaErrorCode.DSL_TEMPLATE_REF_DANGLING,
              details: { name, step_index: stepIndex, var_name: ref },
            });
          }
        }
      }
    }
  }

  /** 跨檔案結構檢核：DSL_DEFINITION_DUPLICATE_NAME。 */
  private validateAggregate(defs: readonly DslDefinition[]): void {
    const seen = new Set<string>();
    for (const def of defs) {
      if (seen.has(def.name)) {
        throw new SpecFormulaArgumentError({
          code: SpecFormulaErrorCode.DSL_DEFINITION_DUPLICATE_NAME,
          details: { name: def.name },
        });
      }
      seen.add(def.name);
    }
  }
}

// ─── module-private helpers ─────────────────────────────────────────────────

/**
 * 將 YAML 解析後之 unknown scalar 安全轉字串：null/undefined → ''；
 * 物件/陣列 → JSON.stringify（避免 [object Object] 的不可逆 toString）；
 * primitive → String()。
 */
function toScalarString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

/** 擷取 format 中所有 named capture 名稱（支援 (?<name>...) 與 (?P<name>...)）。 */
export function extractCaptureNames(format: string): string[] {
  const out: string[] = [];
  NAMED_CAPTURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAMED_CAPTURE_RE.exec(format)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** 擷取字串中所有 {{var}} 之變數名。 */
export function extractTemplateRefs(text: string): string[] {
  const out: string[] = [];
  TEMPLATE_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEMPLATE_REF_RE.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}
