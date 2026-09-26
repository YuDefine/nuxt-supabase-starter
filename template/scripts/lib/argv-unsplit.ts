// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/argv-unsplit.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/argv-unsplit.ts
/** Repair a zsh scalar that carried several CLI flags as one argv element. */
export type FlagOptions = Record<
  string,
  { type: 'string' | 'boolean'; optionalValue?: boolean; freeText?: boolean }
>

const ZSH_HINT = '疑似 zsh 未切割，請改用陣列 `A=(...); cmd $A`'

export class UnsplitArgvError extends Error {
  constructor(problem: string) {
    super(`${problem}；${ZSH_HINT}`)
  }
}

function shellWords(input: string): string[] | null {
  const words: string[] = []
  let word = ''
  let quote: 'single' | 'double' | null = null
  let started = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      started = true
    } else if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      started = true
    } else if (char === '\\' && quote !== 'single') {
      const next = input[++index]
      if (next === undefined) return null
      word += next
      started = true
    } else if (/\s/u.test(char) && quote === null) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote !== null) return null
  if (started) words.push(word)
  return words
}

function containsMultipleKnownFlags(words: string[], options: FlagOptions): boolean {
  let flags = 0
  for (let at = 0; at < words.length; at += 1) {
    const match = /^--([^=\s]+)(?:=(.*))?$/su.exec(words[at])
    if (!match || !Object.hasOwn(options, match[1])) return false
    const option = options[match[1]]
    if (match[2] !== undefined) {
      if (option.type === 'boolean') return false
    } else if (option.type === 'string') {
      const value = words[at + 1]
      if (value === undefined || value.startsWith('--')) {
        if (!option.optionalValue) return false
      } else {
        at += 1
      }
    }
    flags += 1
  }
  return flags > 1
}

/**
 * Only a whole element beginning with `--flag` can be repaired. A value element, even one
 * containing flags as prose, and `--flag=value with space` keep their original bytes. Equals
 * forms are refused only when the whole element parses as multiple known flags and the first
 * flag does not carry free text.
 * Requiring an exact flag/value grammar prevents an unquoted multi-word value becoming positionals.
 */
export function normalizeUnsplitArgv(
  argv: string[],
  options: FlagOptions,
  note: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): string[] {
  const result: string[] = []
  let expectingValue = false
  for (const [index, arg] of argv.entries()) {
    if (expectingValue) {
      result.push(arg)
      expectingValue = false
      continue
    }
    const equalsForm = /^--([^=\s]+)=(.*)$/su.exec(arg)
    if (
      equalsForm &&
      !options[equalsForm[1]]?.freeText &&
      containsMultipleKnownFlags(shellWords(arg) ?? [], options)
    )
      throw new UnsplitArgvError(`argv[${index}] 含多個已知旗標，無法安全判定旗標邊界`)
    if (!/^--[^\s=]+\s/u.test(arg)) {
      result.push(arg)
      const match = /^--([^=\s]+)$/u.exec(arg)
      if (match && Object.hasOwn(options, match[1])) {
        const option = options[match[1]]
        expectingValue = option.type === 'string' && !option.optionalValue
      }
      continue
    }
    const words = shellWords(arg)
    if (!words) throw new UnsplitArgvError(`argv[${index}] 的引號或跳脫不完整`)
    for (let at = 0; at < words.length; at += 1) {
      const token = words[at]
      const match = /^--([^=\s]+)(?:=(.*))?$/su.exec(token)
      if (!match)
        throw new UnsplitArgvError(`argv[${index}] 含無法辨識的片段 ${JSON.stringify(token)}`)
      if (!Object.hasOwn(options, match[1]))
        throw new UnsplitArgvError(`Unknown option '--${match[1]}' in argv[${index}]`)
      const option = options[match[1]]
      if (match[2] !== undefined) {
        if (option.type === 'boolean')
          throw new UnsplitArgvError(`argv[${index}] 的 ${token} 不接受值`)
      } else if (option.type === 'string') {
        const value = words[at + 1]
        if (value === undefined || value.startsWith('--')) {
          if (!option.optionalValue) throw new UnsplitArgvError(`argv[${index}] 的 ${token} 缺少值`)
        } else {
          at += 1
        }
      }
    }
    note(
      `note: argv[${index}] 含未切割的旗標串（zsh 不做字詞切割），已切開：${words.map((word) => JSON.stringify(word)).join(' ')}`,
    )
    result.push(...words)
  }
  return result
}
