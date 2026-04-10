/**
 * Exhaustiveness helper for discriminated unions and enum-like types.
 *
 * Usage:
 *   switch (cardType) {
 *     case 'tray': return 'i-lucide-monitor'
 *     case 'staff': return 'i-lucide-user'
 *     default: return assertNever(cardType, 'getBindingIcon')
 *   }
 *
 * When a new enum value is added, TypeScript will report the `default`
 * branch receiving a non-`never` type, forcing every consumer to be
 * updated before the code compiles.
 *
 * See `.claude/rules/ux-completeness.md` for the Exhaustiveness Rule.
 */
export function assertNever(value: never, context?: string): never {
  const detail = context ? ` in ${context}` : ''
  throw new Error(`Unexpected value ${JSON.stringify(value)}${detail} — an enum branch is missing`)
}
