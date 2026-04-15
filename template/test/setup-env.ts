type ConsoleArgs = Parameters<typeof console.warn>

const originalConsoleWarn = console.warn.bind(console)
const originalConsoleError = console.error.bind(console)

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

console.warn = (...args: ConsoleArgs) => {
  throwOnVueUnresolvedComponent('warn', args)
  originalConsoleWarn(...args)
}

console.error = (...args: ConsoleArgs) => {
  throwOnVueUnresolvedComponent('error', args)
  originalConsoleError(...args)
}
