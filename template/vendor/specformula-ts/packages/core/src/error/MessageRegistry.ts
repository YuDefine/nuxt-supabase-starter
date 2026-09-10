// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/error/MessageRegistry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/error/MessageRegistry.ts
/**
 * ADR-0026 §7 — 訊息渲染 registry。
 *
 * 載入 `specs/errors/<locale>/*.yml`，每筆 entry 結構：
 *   <CODE>:
 *     category: argument | state | lookup | assertion
 *     template: "...{key1}...{key2}..."
 *     fixtures: [{ details: {...} }]
 *
 * Reviewer 報告 P0 #4 對應修正：
 *   - render(code, details) **fail-fast** on：
 *     * 未註冊 code → throw plain Error（不可循環構造 SpecFormula*Error，
 *       否則 boot 階段註冊器尚未載入會死鎖）
 *     * details key 與 template placeholder 不對等（多 / 少都拒）
 *     * details value 型別違反 §6.1 canonical（float / 集合 / 其他）
 *   - 移除原本「unknown details key silently ignored / missing placeholder
 *     leaves `{key}` literal」之 lenient 行為
 *
 * Bootstrap：MessageRegistry.get() 於 first call 自動走 cwd 向上找
 * specs/errors/zh-TW；後續 cache。SpecFormulaError constructor 依賴本 registry，
 * 因此 registry 自身之契約違反**不可拋 SpecFormula*Error**（會循環）；改拋
 * 一律為 plain Error，由 process boot / CI gate 攔下。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { SpecFormulaErrorCategory } from './SpecFormulaErrorCategory.js';
import { SpecFormulaErrorCode } from './SpecFormulaErrorCode.js';

export interface MessageRegistryEntry {
  readonly category: SpecFormulaErrorCategory;
  readonly template: string;
  readonly fixtures: ReadonlyArray<{ readonly details: Readonly<Record<string, unknown>> }>;
  readonly placeholders: ReadonlySet<string>;
}

const PLACEHOLDER_RE = /\{([a-z_][a-z0-9_]*)\}/g;

function extractPlaceholders(template: string): Set<string> {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(template)) !== null) {
    set.add(m[1]);
  }
  return set;
}

/**
 * ADR-0026 §6.1 canonical stringification — 限制 details value 型別。
 * 不支援者：拒絕並拋 Error（boot-time contract violation，不可循環構造 SpecFormula*Error）。
 */
function canonicalize(value: unknown, key: string, code: string): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(
        `MessageRegistry: code='${code}' details.${key}=${String(value)} 為 float，` +
          `ADR-0026 §6.1 canonical 不允許（限 string / int / bool / null）`,
      );
    }
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'string') return value;
  throw new Error(
    `MessageRegistry: code='${code}' details.${key} 型別 ${typeof value} 不在 ADR-0026 §6.1 ` +
      `canonical 允許範圍（限 string / int / bool / null）；實際值：${JSON.stringify(value)}`,
  );
}

/**
 * 從 cwd 往上找 specs/errors/zh-TW；BDD 由 specformula-ts/ 啟動，向上一層即為 repo root。
 */
function resolveDefaultRegistryDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'specs', 'errors', 'zh-TW');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), 'specs', 'errors', 'zh-TW');
}

export class MessageRegistry {
  private static instance: MessageRegistry | null = null;
  private entries: Map<string, MessageRegistryEntry> = new Map();

  /** 重置 singleton（測試用） */
  static reset(): void {
    MessageRegistry.instance = null;
  }

  /**
   * 載入並回傳 singleton；若已載入則直接回傳既有 instance。
   * 預設由 resolveDefaultRegistryDir() 自 cwd 往上找。
   */
  static get(dirPath?: string): MessageRegistry {
    if (MessageRegistry.instance) return MessageRegistry.instance;
    const reg = new MessageRegistry();
    reg.load(dirPath ?? resolveDefaultRegistryDir());
    MessageRegistry.instance = reg;
    return reg;
  }

  /**
   * 載入指定目錄下所有 .yml 並合併 entries；同名 code 重複載入拋例外（plain Error）。
   */
  load(dirPath: string): void {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      throw new Error(`MessageRegistry: 目錄不存在 — ${dirPath}`);
    }
    const files = fs
      .readdirSync(dirPath)
      .filter((f) => f.toLowerCase().endsWith('.yml'))
      .sort();
    for (const f of files) {
      const filePath = path.join(dirPath, f);
      const raw = yaml.load(fs.readFileSync(filePath, 'utf-8')) as Record<
        string,
        { category?: string; template?: string; fixtures?: Array<{ details?: Record<string, unknown> }> }
      >;
      if (!raw || typeof raw !== 'object') continue;
      for (const [code, entry] of Object.entries(raw)) {
        if (this.entries.has(code)) {
          throw new Error(
            `MessageRegistry: code '${code}' 重複定義（檔案：${filePath}）`,
          );
        }
        if (!entry?.category || !entry?.template) {
          throw new Error(
            `MessageRegistry: code '${code}' 缺少 category 或 template（檔案：${filePath}）`,
          );
        }
        const validCats: ReadonlyArray<SpecFormulaErrorCategory> = [
          SpecFormulaErrorCategory.ARGUMENT,
          SpecFormulaErrorCategory.STATE,
          SpecFormulaErrorCategory.LOOKUP,
          SpecFormulaErrorCategory.ASSERTION,
        ];
        if (!validCats.includes(entry.category as SpecFormulaErrorCategory)) {
          throw new Error(
            `MessageRegistry: code '${code}' category '${entry.category}' 不合法 ` +
              `（允許：${validCats.join(', ')}）`,
          );
        }
        const placeholders = extractPlaceholders(entry.template);
        const fixtures = (entry.fixtures ?? []).map((fx) => ({
          details: Object.freeze({ ...(fx.details ?? {}) }),
        }));
        this.entries.set(code, {
          category: entry.category as SpecFormulaErrorCategory,
          template: entry.template,
          fixtures: Object.freeze(fixtures),
          placeholders: Object.freeze(placeholders),
        });
      }
    }
    // 啟動期 cross-check：所有 generated SpecFormulaErrorCode 必須在 registry 中
    // （reviewer P0 #4 — code 不再可為 raw string；compile-time const literal 必有對應 entry）
    for (const code of Object.keys(SpecFormulaErrorCode)) {
      if (!this.entries.has(code)) {
        throw new Error(
          `MessageRegistry: SpecFormulaErrorCode.${code} 未於 registry 找到對應 entry；` +
            `請重跑 uv run scripts/generate-spec-formula-error-code-ts.py`,
        );
      }
    }
  }

  /**
   * ADR-0026 §G6 / §G7 / reviewer P0 #4 — fail-fast 渲染：
   *   - code 未註冊                          → throw Error
   *   - details keys ≠ template placeholders → throw Error（雙向相等）
   *   - details value 違反 §6.1 canonical    → throw Error（見 canonicalize）
   * 通過後返回 `[<code>] <rendered_template>`。
   */
  render(code: string, details: Readonly<Record<string, unknown>>): string {
    const entry = this.entries.get(code);
    if (!entry) {
      throw new Error(`MessageRegistry: 未註冊 code '${code}'`);
    }
    const detailKeys = new Set(Object.keys(details));
    const missing: string[] = [];
    for (const placeholder of entry.placeholders) {
      if (!detailKeys.has(placeholder)) missing.push(placeholder);
    }
    const extra: string[] = [];
    for (const key of detailKeys) {
      if (!entry.placeholders.has(key)) extra.push(key);
    }
    if (missing.length > 0 || extra.length > 0) {
      const lines = [`MessageRegistry: code='${code}' details schema 不對齊`];
      if (missing.length > 0) lines.push(`  缺少 placeholder: ${missing.join(', ')}`);
      if (extra.length > 0) lines.push(`  多餘 detail key: ${extra.join(', ')}`);
      lines.push(`  registry placeholders: ${[...entry.placeholders].join(', ')}`);
      throw new Error(lines.join('\n'));
    }
    PLACEHOLDER_RE.lastIndex = 0;
    const rendered = entry.template.replace(PLACEHOLDER_RE, (_full, key: string) =>
      canonicalize(details[key], key, code),
    );
    return `[${code}] ${rendered}`;
  }

  getCategory(code: string): SpecFormulaErrorCategory {
    const entry = this.entries.get(code);
    if (!entry) {
      throw new Error(`MessageRegistry: 未註冊 code '${code}'`);
    }
    return entry.category;
  }

  getEntry(code: string): MessageRegistryEntry | undefined {
    return this.entries.get(code);
  }

  hasCode(code: string): boolean {
    return this.entries.has(code);
  }

  allCodes(): string[] {
    return [...this.entries.keys()];
  }
}

// `buildErrorFromRegistry` 移至獨立檔 `./buildErrorFromRegistry.ts`
// 避免 MessageRegistry → SpecFormulaError → MessageRegistry 之 ES module
// circular dependency runtime initialization 失敗（ReferenceError: Cannot
// access 'SpecFormulaArgumentError' before initialization）。
