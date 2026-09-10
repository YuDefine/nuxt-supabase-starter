// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/NamedCaptureParser.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/NamedCaptureParser.ts
/**
 * 解析 ISA format 字串中之 named capture group 名稱（`(?P<name>...)`），依出現順序回傳。
 * 用於 StepInvocation.namedGroups() 將 positional groups 對應到 ISA 慣例語意命名。
 */
const NAMED = /\(\?P<([A-Za-z_][A-Za-z0-9_]*)>/g;

export function namesIn(pattern: string | null | undefined): readonly string[] {
  if (!pattern) return [];
  const names: string[] = [];
  let m: RegExpExecArray | null;
  NAMED.lastIndex = 0;
  while ((m = NAMED.exec(pattern)) !== null) {
    names.push(m[1]);
  }
  return Object.freeze(names);
}
