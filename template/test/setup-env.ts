import { beforeEach } from 'vitest'

type ConsoleArgs = Parameters<typeof console.warn>

function formatConsoleArgs(args: ConsoleArgs): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg
      }

      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`
      }

      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function throwOnVueUnresolvedComponent(level: 'warn' | 'error', args: ConsoleArgs): void {
  const message = formatConsoleArgs(args)
  const isVueUnresolvedComponentWarn =
    message.includes('[Vue warn]') && message.includes('Failed to resolve component')

  if (isVueUnresolvedComponentWarn) {
    throw new Error(
      `[test-guard] Vue unresolved component detected via console.${level}: ${message}`
    )
  }
}

// Vitest 4 provides a different `console` object to test modules.
// We patch `globalThis.console` which is what Vue runtime actually uses.
beforeEach(() => {
  const gc = globalThis.console
  const originalWarn = gc.warn.bind(gc)
  const originalError = gc.error.bind(gc)

  gc.warn = (...args: ConsoleArgs) => {
    throwOnVueUnresolvedComponent('warn', args)
    originalWarn(...args)
  }

  gc.error = (...args: ConsoleArgs) => {
    throwOnVueUnresolvedComponent('error', args)
    originalError(...args)
  }
})
