// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/PluginLoader.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/PluginLoader.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isBuiltinPlugin,
  type Instruction,
  type LifecycleHook,
  type SpecFormulaPlugin,
  type SpecReader,
} from '@specformula/plugin-api';

import type { DefaultPluginContext } from './DefaultPluginContext.js';
import { InstructionRegistry } from './InstructionRegistry.js';
import { LifecycleHookRegistry } from './LifecycleHookRegistry.js';
import { SpecReaderRegistry } from './SpecReaderRegistry.js';
import { isRecord } from '../helper/JsonBoundary.js';

/**
 * Plugin discovery + lifecycle orchestration（ADR-0027 / ts-0010 §三）。
 *
 * Discovery：以「使用 process.cwd() 之 package.json 為起點」，掃描其
 * dependencies / devDependencies 對應之 `node_modules/<pkg>/package.json`；
 * 若該 manifest 含 `specformula.plugin` 欄位（相對於 plugin 套件根之路徑），
 * 動態 import 該檔取得 default export 作為 SpecFormulaPlugin。
 *
 * Builtin plugin 不走 node_modules 掃描；由 @specformula/core 在建構 PluginLoader
 * 時透過 builtinPlugins 參數直接注入；兩者進入 registry 之衝突檢查路徑完全相同。
 *
 * 啟動五階段：
 *   1. Bootstrap read（caller 負責；本 loader 接受 plugins.config 結構）
 *   2. Discovery（builtin + node_modules）
 *   3. configure（每個 plugin 依 plugins.config.<id> 衍生 context）
 *   4. Registry build（套用 disabled 過濾）
 *   5. beforeSuite（由 caller 在 full spec read 完成後觸發）
 */

export interface PluginLoaderOptions {
  /** 內建 plugin 列表（@specformula/core 注入；不走 node_modules 掃描）。 */
  readonly builtinPlugins?: readonly SpecFormulaPlugin[];

  /** 從何處開始掃描 node_modules（預設 process.cwd()）。 */
  readonly projectRoot?: string;

  /** 已對 disabled 名稱呼叫的 logger（預設 console.info）。 */
  readonly log?: (message: string) => void;

  /** 是否關閉 node_modules 掃描（測試 / 純 builtin 場景用）。預設 false。 */
  readonly skipNodeModulesScan?: boolean;
}

interface DisabledContributions {
  readonly instructions: ReadonlySet<string>;
  readonly lifecycleHooks: ReadonlySet<string>;
  readonly specReaders: ReadonlySet<string>;
}

export class PluginLoader {
  readonly instructions = new InstructionRegistry();
  readonly lifecycleHooks = new LifecycleHookRegistry();
  readonly specReaders = new SpecReaderRegistry();

  private readonly plugins: SpecFormulaPlugin[] = [];
  private readonly disabledInstructionTypes = new Set<string>();
  private readonly disabledLifecycleHookNames = new Set<string>();
  private readonly disabledSpecKinds = new Set<string>();

  private readonly opts: Required<Pick<PluginLoaderOptions, 'projectRoot' | 'log' | 'skipNodeModulesScan'>>;
  private readonly builtinPlugins: readonly SpecFormulaPlugin[];

  constructor(opts: PluginLoaderOptions = {}) {
    this.builtinPlugins = opts.builtinPlugins ?? [];
    this.opts = {
      projectRoot: opts.projectRoot ?? process.cwd(),
      log: opts.log ?? ((m) => console.info(m)),
      skipNodeModulesScan: opts.skipNodeModulesScan ?? false,
    };
  }

  /**
   * 載入所有 plugin。順序：builtin 先，第三方後；同 id 衝突拋錯。
   */
  async load(
    baseContext: DefaultPluginContext,
    pluginsConfigYml: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
  ): Promise<void> {
    const byId = new Map<string, SpecFormulaPlugin>();

    // Step 2a — builtin plugins（注入式 discovery）
    for (const plugin of this.builtinPlugins) {
      this.registerDiscovered(plugin, byId);
    }

    // Step 2b — node_modules 掃描
    if (!this.opts.skipNodeModulesScan) {
      const discovered = await this.discoverFromNodeModules();
      for (const plugin of discovered) {
        this.registerDiscovered(plugin, byId);
      }
    }

    // 檢查 plugins.config 中的 id 是否都在 discovery 結果裡
    for (const cfgId of Object.keys(pluginsConfigYml)) {
      if (!byId.has(cfgId)) {
        throw new Error(
          `isa.yml plugins.config references plugin '${cfgId}' but it was not discovered ` +
            `(builtin or node_modules)`,
        );
      }
    }

    // Step 3 — configure
    for (const plugin of this.plugins) {
      const pluginConfig = pluginsConfigYml[plugin.id] ?? {};
      const ctx = baseContext.withPluginConfig(pluginConfig);
      if (plugin.configure) {
        try {
          await plugin.configure(ctx);
        } catch (err) {
          throw new Error(
            `Plugin '${plugin.id}' configure() failed: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err instanceof Error ? err : undefined },
          );
        }
      }
    }

    // Step 4 — registry build
    for (const plugin of this.plugins) {
      const pluginConfig = pluginsConfigYml[plugin.id] ?? {};
      const builtin = isBuiltinPlugin(plugin);
      const overrideBuiltin = pluginConfig['override_builtin'] === true;

      const disabled = this.parseDisabled(plugin, pluginConfig);
      for (const t of disabled.instructions) this.disabledInstructionTypes.add(t);
      for (const n of disabled.lifecycleHooks) this.disabledLifecycleHookNames.add(n);
      for (const k of disabled.specReaders) this.disabledSpecKinds.add(k);

      const instructions: readonly Instruction[] = plugin.instructions?.() ?? [];
      for (const ip of instructions) {
        if (disabled.instructions.has(ip.instructionType)) {
          this.opts.log(
            `Skipping disabled instruction '${ip.instructionType}' from plugin '${plugin.id}'`,
          );
          continue;
        }
        this.instructions.register(ip, builtin, overrideBuiltin);
      }

      const hooks: readonly LifecycleHook[] = plugin.lifecycleHooks?.() ?? [];
      for (const h of hooks) {
        if (disabled.lifecycleHooks.has(h.name)) {
          this.opts.log(`Skipping disabled lifecycle hook '${h.name}' from plugin '${plugin.id}'`);
          continue;
        }
        this.lifecycleHooks.register(h);
      }

      const readers: readonly SpecReader<unknown>[] = plugin.specReaders?.() ?? [];
      for (const sr of readers) {
        if (disabled.specReaders.has(sr.specKind)) {
          this.opts.log(`Skipping disabled spec reader '${sr.specKind}' from plugin '${plugin.id}'`);
          continue;
        }
        this.specReaders.register(sr);
      }
    }

    this.opts.log(
      `Plugin registration complete: ${this.instructions.size()} instruction types, ` +
        `${this.lifecycleHooks.size()} lifecycle hooks, ${this.specReaders.size()} spec readers ` +
        `(disabled: ${this.disabledInstructionTypes.size} instructions, ` +
        `${this.disabledLifecycleHookNames.size} hooks, ${this.disabledSpecKinds.size} readers)`,
    );
  }

  /** Step 5 — beforeSuite（caller 通常於 full spec read 完成後觸發）。 */
  async prepareAll(baseContext: DefaultPluginContext): Promise<void> {
    await this.lifecycleHooks.executeBeforeSuite(baseContext);
  }

  /** Suite 結束時呼叫；先反向跑所有 hook 之 afterSuite，再跑 plugin.shutdown()。 */
  async shutdownAll(baseContext: DefaultPluginContext): Promise<void> {
    await this.lifecycleHooks.executeAfterSuite(baseContext);
    const reversed = [...this.plugins].reverse();
    for (const plugin of reversed) {
      if (!plugin.shutdown) continue;
      try {
        await plugin.shutdown(baseContext);
      } catch (err) {
        console.warn(
          `Plugin '${plugin.id}' shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  getPlugins(): readonly SpecFormulaPlugin[] {
    return [...this.plugins];
  }

  getDisabledInstructionTypes(): ReadonlySet<string> {
    return new Set(this.disabledInstructionTypes);
  }

  getDisabledLifecycleHookNames(): ReadonlySet<string> {
    return new Set(this.disabledLifecycleHookNames);
  }

  getDisabledSpecKinds(): ReadonlySet<string> {
    return new Set(this.disabledSpecKinds);
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  private registerDiscovered(plugin: SpecFormulaPlugin, byId: Map<string, SpecFormulaPlugin>): void {
    const id = plugin.id;
    if (!id || id.trim() === '') {
      throw new Error(`SpecFormulaPlugin has blank id`);
    }
    if (byId.has(id)) {
      const existing = byId.get(id)!;
      throw new Error(
        `Duplicate plugin id '${id}': ${getCtorName(existing)} vs ${getCtorName(plugin)}`,
      );
    }
    byId.set(id, plugin);
    this.plugins.push(plugin);
    this.opts.log(`Discovered plugin: id=${id}, version=${plugin.version}`);
  }

  /**
   * 掃描 process.cwd() 之 package.json 之 dependencies / devDependencies，逐個讀
   * node_modules/<pkg>/package.json 之 specformula.plugin 欄位，動態 import 該檔。
   *
   * pnpm workspace 下，node_modules 為 symlink；fs.existsSync + import() 皆能透傳。
   */
  private async discoverFromNodeModules(): Promise<SpecFormulaPlugin[]> {
    const root = this.opts.projectRoot;
    const rootPkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(rootPkgPath)) return [];

    const rootPkg = readJson(rootPkgPath);
    const depNames = new Set<string>([
      ...Object.keys(rootPkg.dependencies ?? {}),
      ...Object.keys(rootPkg.devDependencies ?? {}),
    ]);

    const discovered: SpecFormulaPlugin[] = [];
    for (const name of depNames) {
      const pkgDir = path.join(root, 'node_modules', name);
      const pkgManifest = path.join(pkgDir, 'package.json');
      if (!fs.existsSync(pkgManifest)) continue;
      const manifest = readJson(pkgManifest);
      const pluginEntry = manifest.specformula?.plugin;
      if (typeof pluginEntry !== 'string') continue;
      const entryPath = path.join(pkgDir, pluginEntry);
      if (!fs.existsSync(entryPath)) {
        throw new Error(
          `Plugin '${name}' specformula.plugin entry not found: ${entryPath}`,
        );
      }
      const url = pathToFileURL(entryPath).href;
      const mod = (await import(url)) as { default?: SpecFormulaPlugin };
      const plugin = mod.default;
      if (!plugin || typeof plugin !== 'object' || typeof plugin.id !== 'string') {
        throw new Error(
          `Plugin '${name}' specformula.plugin entry ${entryPath} did not default-export SpecFormulaPlugin`,
        );
      }
      discovered.push(plugin);
    }
    return discovered;
  }

  /**
   * ADR-0027 §五 — disabled section 解析 + 錯字驗證（plugin 不提供該 contribution → 拋）。
   */
  private parseDisabled(
    plugin: SpecFormulaPlugin,
    pluginConfig: Readonly<Record<string, unknown>>,
  ): DisabledContributions {
    const raw = pluginConfig['disabled'];
    if (raw == null) {
      return {
        instructions: new Set(),
        lifecycleHooks: new Set(),
        specReaders: new Set(),
      };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(
        `Plugin '${plugin.id}' disabled section must be an object, got: ${typeof raw}`,
      );
    }
    const disabledMap = raw as Record<string, unknown>;
    const dInstr = parseStringList(disabledMap['instructions'], plugin.id, 'instructions');
    const dHooks = parseStringList(disabledMap['lifecycle_hooks'], plugin.id, 'lifecycle_hooks');
    const dReaders = parseStringList(disabledMap['spec_readers'], plugin.id, 'spec_readers');

    const pluginInstr = new Set((plugin.instructions?.() ?? []).map((i) => i.instructionType));
    const pluginHooks = new Set((plugin.lifecycleHooks?.() ?? []).map((h) => h.name));
    const pluginReaders = new Set((plugin.specReaders?.() ?? []).map((r) => r.specKind));

    assertSubset(dInstr, pluginInstr, plugin.id, 'instructions');
    assertSubset(dHooks, pluginHooks, plugin.id, 'lifecycle_hooks');
    assertSubset(dReaders, pluginReaders, plugin.id, 'spec_readers');

    return { instructions: dInstr, lifecycleHooks: dHooks, specReaders: dReaders };
  }
}

// ─── module-private helpers ─────────────────────────────────────────────────

interface PackageJsonLike {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly specformula?: {
    readonly plugin?: string;
  };
}

function readJson(filePath: string): PackageJsonLike {
  return parsePackageJson(fs.readFileSync(filePath, 'utf-8'));
}

function parseOptionalStringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error('invalid package.json');
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new Error('invalid package.json');
    }
    out[key] = entry;
  }
  return out;
}

export function parsePackageJson(source: string): PackageJsonLike {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('invalid package.json');
  }
  if (!isRecord(parsed)) {
    throw new Error('invalid package.json');
  }

  const dependencies = parseOptionalStringRecord(parsed['dependencies']);
  const devDependencies = parseOptionalStringRecord(parsed['devDependencies']);
  const specformulaRaw = parsed['specformula'];
  let specformula: { readonly plugin?: string } | undefined;
  if (specformulaRaw !== undefined) {
    if (!isRecord(specformulaRaw)) {
      throw new Error('invalid package.json');
    }
    const plugin = specformulaRaw['plugin'];
    if (plugin !== undefined && typeof plugin !== 'string') {
      throw new Error('invalid package.json');
    }
    specformula = plugin === undefined ? {} : { plugin };
  }

  return {
    ...(dependencies ? { dependencies } : {}),
    ...(devDependencies ? { devDependencies } : {}),
    ...(specformula ? { specformula } : {}),
  };
}

function parseStringList(raw: unknown, pluginId: string, field: string): Set<string> {
  if (raw == null) return new Set();
  if (!Array.isArray(raw)) {
    throw new Error(
      `Plugin '${pluginId}' disabled.${field} must be a list, got: ${typeof raw}`,
    );
  }
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new Error(
        `Plugin '${pluginId}' disabled.${field} contains non-string entry: ${String(item)}`,
      );
    }
    out.add(item);
  }
  return out;
}

function assertSubset(
  requested: ReadonlySet<string>,
  available: ReadonlySet<string>,
  pluginId: string,
  field: string,
): void {
  const unknown: string[] = [];
  for (const r of requested) {
    if (!available.has(r)) unknown.push(r);
  }
  if (unknown.length > 0) {
    throw new Error(
      `Plugin '${pluginId}' disabled.${field} references unknown contribution(s): ` +
        `[${unknown.join(', ')}] (available: [${[...available].join(', ')}])`,
    );
  }
}

function getCtorName(plugin: SpecFormulaPlugin): string {
  return (plugin as { constructor?: { name?: string } }).constructor?.name ?? 'SpecFormulaPlugin';
}
