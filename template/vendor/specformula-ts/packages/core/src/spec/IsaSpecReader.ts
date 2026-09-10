// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/IsaSpecReader.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/IsaSpecReader.ts
import * as fs from 'node:fs';
import yaml from 'js-yaml';
import type {
  IsaSpec,
  IsaConfig,
  IsaApiConfig,
  IsaDataConfig,
  IsaDataSourceConfig,
  IsaInstruction,
} from './model/IsaSpec.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaLookupError,
} from '../error/SpecFormulaError.js';
import { isRecord } from '../helper/JsonBoundary.js';

const VALID_TIME_FORMATS = new Set(['iso', 'timestamp', 'epoch', 'date_only', 'time_only']);
// ADR-0028: db_type 'h2' → 'embedded'（語言中立化）；順序與 ADR §三字典序對齊
// （embedded < mssql < mysql < postgresql）— 此順序被驗證錯誤訊息之 `allowed` 字串
// 與全域 feature 期望值（isa-spec-reader-invalid-config.feature）共同消費。
const VALID_DB_TYPES = new Set(['embedded', 'mssql', 'mysql', 'postgresql']);
const VALID_PERMISSIONS = new Set(['isolated', 'shared']);
const VALID_INSTRUCTION_TYPES = new Set([
  'time_control', 'entity_setup', 'api_call', 'response_validate',
  'entity_validate', 'entity_non_existence_validate', 'custom',
]);
// ADR-0027 plugin dispatch wiring（#346）：plugin 貢獻之 instruction_type 於
// bootstrap 階段（loadSpecFormulaPlugins → InstructionRegistry.instructionTypes()）
// 註冊進此集合；validate() 以「內建 + plugin 註冊」之合併集合守門。
// 對齊 Java reader 之 lazy extensible knownInstructionTypes() 語意。
const PLUGIN_INSTRUCTION_TYPES = new Set<string>();
const ENTITY_INSTRUCTION_TYPES = new Set([
  'entity_setup', 'entity_validate', 'entity_non_existence_validate',
]);
const API_INSTRUCTION_TYPES = new Set(['api_call', 'response_validate']);
const VALID_DATA_FORMATS = new Set(['data_table', 'json']);

export class IsaSpecReader {
  private readonly resourcePath: string;

  constructor(resourcePath: string = 'isa.yml') {
    this.resourcePath = resourcePath;
  }

  /**
   * 註冊 plugin 貢獻之 instruction_type（須在 read() 之前呼叫，否則 isa.yml
   * 驗證會以 SPEC_ISA_INSTRUCTION_TYPE_UNKNOWN 拒絕 plugin 指令）。
   */
  static registerPluginInstructionTypes(types: Iterable<string>): void {
    for (const type of types) {
      PLUGIN_INSTRUCTION_TYPES.add(type);
    }
  }

  /** 清空 plugin 註冊之 instruction_type（測試隔離用）。 */
  static resetPluginInstructionTypes(): void {
    PLUGIN_INSTRUCTION_TYPES.clear();
  }

  read(): IsaSpec {
    if (!fs.existsSync(this.resourcePath)) {
      throw new SpecFormulaLookupError({
        code: 'SPEC_ISA_FILE_NOT_FOUND',
        details: { path: this.resourcePath },
      });
    }

    let raw: unknown;
    try {
      const content = fs.readFileSync(this.resourcePath, 'utf-8');
      raw = yaml.load(content);
    } catch {
      throw new SpecFormulaLookupError({
        code: 'SPEC_ISA_FILE_NOT_FOUND',
        details: { path: this.resourcePath },
      });
    }

    const spec = this.parseSpec(raw);
    this.validate(spec);
    return spec;
  }

  private parseSpec(raw: unknown): IsaSpec {
    if (!isRecord(raw)) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section: 'config' },
      });
    }
    return {
      config: this.parseConfig(raw['config']),
      instructions: this.parseInstructions(raw['instructions']),
    };
  }

  private parseConfig(raw: unknown): IsaConfig {
    if (!isRecord(raw)) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section: 'config' },
      });
    }
    return {
      api: this.parseApiConfig(raw['api']),
      data: this.parseDataConfig(raw['data']),
    };
  }

  private parseApiConfig(raw: unknown): IsaApiConfig {
    if (!isRecord(raw)) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section: 'config.api' },
      });
    }
    return {
      resource_path: typeof raw['resource_path'] === 'string' ? raw['resource_path'] : '',
      project_path: typeof raw['project_path'] === 'string' ? raw['project_path'] : '',
      time_format: this.optionalString(raw['time_format'], 'config.api.time_format', 'iso'),
    };
  }

  private parseDataConfig(raw: unknown): IsaDataConfig {
    if (!isRecord(raw)) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section: 'config.data' },
      });
    }
    const sourceRaw = raw['source'];
    if (!Array.isArray(sourceRaw)) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section: 'config.data.source' },
      });
    }
    return {
      permission: this.optionalString(raw['permission'], 'config.data.permission', 'isolated'),
      reuse: this.optionalBoolean(raw['reuse'], 'config.data.reuse', false),
      source: sourceRaw.map((item, idx) => this.parseDataSource(item, idx)),
    };
  }

  private parseDataSource(raw: unknown, idx: number): IsaDataSourceConfig {
    if (!isRecord(raw)) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section: `config.data.source[${idx}]` },
      });
    }
    const schema = raw['schema'];
    if (schema !== undefined && schema !== null && typeof schema !== 'string') {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_VALUE_INVALID',
        details: {
          path: `config.data.source[${idx}].schema`,
          value: String(schema),
          allowed: 'non-blank string',
        },
      });
    }
    return {
      name: typeof raw['name'] === 'string' ? raw['name'] : '',
      resource_path: typeof raw['resource_path'] === 'string' ? raw['resource_path'] : '',
      project_path: typeof raw['project_path'] === 'string' ? raw['project_path'] : '',
      db_type: this.optionalString(raw['db_type'], `config.data.source[${idx}].db_type`, 'embedded'),
      schema: schema === undefined ? null : schema,
    };
  }

  private optionalString(value: unknown, path: string, fallback: string): string {
    if (value == null) return fallback;
    if (typeof value !== 'string') {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_VALUE_INVALID',
        details: { path, value: String(value), allowed: 'string or omitted' },
      });
    }
    return value;
  }

  private optionalBoolean(value: unknown, path: string, fallback: boolean): boolean {
    if (value == null) return fallback;
    if (typeof value !== 'boolean') {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_VALUE_INVALID',
        details: { path, value: String(value), allowed: 'boolean or omitted' },
      });
    }
    return value;
  }

  private parseInstructions(raw: unknown): IsaInstruction[] | null {
    if (raw == null) return null;
    if (!Array.isArray(raw)) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section: 'instructions' },
      });
    }
    return raw.map((item, idx) => {
      if (!isRecord(item)) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
          details: { section: `instructions[${idx}]` },
        });
      }
      const dataFormat = item['data_format'];
      return {
        name: typeof item['name'] === 'string' ? item['name'] : '',
        format: typeof item['format'] === 'string' ? item['format'] : '',
        instruction_type: typeof item['instruction_type'] === 'string' ? item['instruction_type'] : '',
        data_format: typeof dataFormat === 'string' ? dataFormat : null,
      };
    });
  }

  private validate(spec: IsaSpec): void {
    const sectionMissing = (section: string): SpecFormulaArgumentError =>
      new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_SECTION_MISSING',
        details: { section },
      });
    const fieldRequired = (path: string): SpecFormulaArgumentError =>
      new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_FIELD_REQUIRED',
        details: { path },
      });
    const valueInvalid = (
      path: string,
      value: string,
      allowed: string,
    ): SpecFormulaArgumentError =>
      new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_VALUE_INVALID',
        details: { path, value, allowed },
      });

    const config = spec.config;
    if (!config) throw sectionMissing('config');
    const api = config.api;
    if (!api) throw sectionMissing('config.api');
    if (isBlank(api.resource_path)) throw fieldRequired('config.api.resource_path');
    if (isBlank(api.project_path)) throw fieldRequired('config.api.project_path');
    if (!VALID_TIME_FORMATS.has(api.time_format)) {
      throw valueInvalid(
        'config.api.time_format',
        api.time_format,
        [...VALID_TIME_FORMATS].join(', '),
      );
    }

    const data = config.data;
    if (!data) throw sectionMissing('config.data');
    if (!VALID_PERMISSIONS.has(data.permission)) {
      throw valueInvalid(
        'config.data.permission',
        data.permission,
        [...VALID_PERMISSIONS].join(', '),
      );
    }
    if (!data.source || data.source.length === 0) {
      throw new SpecFormulaArgumentError({
        code: 'SPEC_ISA_CONFIG_DATASOURCE_EMPTY',
        details: {},
      });
    }

    const seenNames = new Set<string>();
    for (let idx = 0; idx < data.source.length; idx++) {
      const src = data.source[idx];
      if (isBlank(src.name)) {
        throw fieldRequired(`config.data.source[${idx}].name`);
      }
      if (seenNames.has(src.name)) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ISA_CONFIG_DATASOURCE_DUPLICATE',
          details: { name: src.name },
        });
      }
      seenNames.add(src.name);
      if (isBlank(src.resource_path)) {
        throw fieldRequired(`config.data.source[${idx}].resource_path`);
      }
      if (isBlank(src.project_path)) {
        throw fieldRequired(`config.data.source[${idx}].project_path`);
      }
      if (!VALID_DB_TYPES.has(src.db_type)) {
        throw valueInvalid(
          `config.data.source[${idx}].db_type`,
          src.db_type,
          [...VALID_DB_TYPES].join(', '),
        );
      }
      // ADR-0020: schema 欄位若存在（非 null）必須為非空白 string。
      if (src.schema != null && (typeof src.schema !== 'string' || isBlank(src.schema))) {
        throw valueInvalid(
          `config.data.source[${idx}].schema`,
          String(src.schema),
          'non-blank string',
        );
      }
    }

    const instructions = spec.instructions;
    if (!instructions) return;

    for (const instr of instructions) {
      const type = instr.instruction_type;
      if (!type || !(VALID_INSTRUCTION_TYPES.has(type) || PLUGIN_INSTRUCTION_TYPES.has(type))) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ISA_INSTRUCTION_TYPE_UNKNOWN',
          details: { name: instr.name ?? '', type: type ?? '' },
        });
      }
      if (
        ENTITY_INSTRUCTION_TYPES.has(type) &&
        (!instr.format || !instr.format.includes('(?P<entity>'))
      ) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ISA_INSTRUCTION_CAPTURE_MISSING',
          details: { type, capture: 'entity', name: instr.name ?? '' },
        });
      }
      if (
        API_INSTRUCTION_TYPES.has(type) &&
        (!instr.format || !instr.format.includes('(?P<summary>'))
      ) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_ISA_INSTRUCTION_CAPTURE_MISSING',
          details: { type, capture: 'summary', name: instr.name ?? '' },
        });
      }
      if (type === 'response_validate') {
        if (instr.format && !instr.format.includes('(?P<status_code>')) {
          throw new SpecFormulaArgumentError({
            code: 'SPEC_ISA_INSTRUCTION_CAPTURE_MISSING',
            details: { type, capture: 'status_code', name: instr.name ?? '' },
          });
        }
        const df = instr.data_format ?? null;
        if (df == null) {
          throw new SpecFormulaArgumentError({
            code: 'SPEC_ISA_INSTRUCTION_DATA_FORMAT_MISSING',
            details: { name: instr.name ?? '' },
          });
        }
        if (!VALID_DATA_FORMATS.has(df)) {
          throw new SpecFormulaArgumentError({
            code: 'SPEC_ISA_INSTRUCTION_DATA_FORMAT_INVALID',
            details: { name: instr.name ?? '', format: df },
          });
        }
      }
      if (type === 'custom') {
        const df = instr.data_format ?? null;
        if (df != null && !VALID_DATA_FORMATS.has(df)) {
          throw new SpecFormulaArgumentError({
            code: 'SPEC_ISA_INSTRUCTION_DATA_FORMAT_INVALID',
            details: { name: instr.name ?? '', format: df },
          });
        }
      }
    }
  }
}

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim() === '';
}
