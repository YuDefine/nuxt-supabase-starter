// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/BuiltinPlugin.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/BuiltinPlugin.ts
/**
 * 內建 plugin 之 brand：實作 SpecFormulaPlugin 時 implements 此 marker interface
 * （或 instance 上設 `[BUILTIN_PLUGIN_TAG]: true`），讓 PluginLoader 在衝突檢測時
 * 區分「內建 vs 第三方」（ADR-0027 §五：第三方覆蓋內建需 override_builtin: true）。
 *
 * 純 marker：無方法，僅作 typeof / brand check。
 */
export const BUILTIN_PLUGIN_TAG: unique symbol = Symbol.for(
  '@specformula/plugin-api:BuiltinPlugin',
);

export interface BuiltinPluginBrand {
  readonly [BUILTIN_PLUGIN_TAG]: true;
}

export function isBuiltinPlugin(plugin: unknown): boolean {
  return (
    plugin !== null &&
    typeof plugin === 'object' &&
    BUILTIN_PLUGIN_TAG in plugin &&
    (plugin as { [BUILTIN_PLUGIN_TAG]?: unknown })[BUILTIN_PLUGIN_TAG] === true
  );
}
