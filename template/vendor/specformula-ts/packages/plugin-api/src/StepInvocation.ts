// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/StepInvocation.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/StepInvocation.ts
import type { InstructionDescriptor } from './InstructionDescriptor.js';
import type { PayloadView } from './PayloadView.js';
import { namesIn } from './NamedCaptureParser.js';

/**
 * 單次 step 執行的上下文。提供 regex 捕獲組與 payload，與 BDD backend 無關。
 *
 * 具體實作於 `@specformula/cucumber` 之 CucumberStepInvocation。
 */
export interface StepInvocation {
  /** 描述當前執行之 instruction（從 isa.yml）。 */
  readonly instruction: InstructionDescriptor;

  /**
   * format 中 capturing group 解析後之字串值，依出現順序。
   * 不含 payload。
   */
  groups(): readonly string[];

  /**
   * 依名稱取得 named capture group 之值，例如 ISA format
   * `(?P<entity>...)` / `(?P<summary>...)` / `(?P<status_code>...)`。
   * 預設依 instruction.format 解析 `(?P<name>...)` 出現順序對齊 groups()；
   * implementer 可 override 提供更快實作。
   */
  namedGroups(): Readonly<Record<string, string>>;

  /** Convenience：`namedGroups()[name]`。 */
  group(name: string): string | undefined;

  /** Step payload，依 instruction.data_format 決定型別。 */
  payload(): PayloadView;

  /**
   * 解析變數引用（`{{varName}}`）；具體解析器由 PluginContext 注入。
   * 第三方 plugin 透過此方法取得 scenario 上下文中的變數值。
   */
  resolveVariable(reference: string): unknown;
}

/**
 * Helper：建立預設 namedGroups 之 builder（從 format 解析 `(?P<name>...)`
 * 與 positional groups 對齊）；用於 implementer 之 base default。
 */
export function buildNamedGroups(
  desc: InstructionDescriptor,
  groups: readonly string[],
): Readonly<Record<string, string>> {
  const names = namesIn(desc.format);
  if (names.length === 0) return Object.freeze({});
  const out: Record<string, string> = {};
  for (let i = 0; i < names.length && i < groups.length; i++) {
    out[names[i]] = groups[i];
  }
  return Object.freeze(out);
}
