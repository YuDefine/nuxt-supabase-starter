// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/helper/utils/naming.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/helper/utils/naming.ts
/**
 * Naming convention utilities for converting between camelCase and snake_case.
 */

/**
 * Convert camelCase to snake_case.
 * @example "managerId" -> "manager_id"
 */
export function camelToSnake(str: string): string {
  if (!str) return str;
  return str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Convert snake_case to camelCase.
 * @example "manager_id" -> "managerId"
 */
export function snakeToCamel(str: string): string {
  if (!str) return str;

  const result: string[] = [];
  let nextUpper = false;

  for (const char of str) {
    if (char === '_') {
      nextUpper = true;
    } else {
      result.push(nextUpper ? char.toUpperCase() : char);
      nextUpper = false;
    }
  }

  return result.join('');
}
