// coordinator 顯示與 merge gate ledger 共用的狀態判定；不把內文提到 resolved 當成已解決。
// never-declared 是既有 capability 分類名稱（#575），其他 never 否定仍照計。
const UNRESOLVED_WORDING =
  /\b(?:not|still|partially|mostly|unresolved|remains?)\b|\bnever\b(?!-declared\b)|\bun[\s-]*resolved\b|\b(?:regress\w*|broken|reopen\w*)\b|n['’]t\b|仍|未/i
const TRAILING_RESOLVED =
  /(?:[.;!?]\s+|[。；！？…]\s*)(?:已解決[：:]\s*)?resolved\.?(?:\s*[（(]已解決[）)])?\s*$|(?:[—–]|\s-)\s*已解決[。.]?\s*$/i

export function hasUnresolvedWording(line: string): boolean {
  return UNRESOLVED_WORDING.test(line.replace(/`[^`]*`/g, ' '))
}

/** 只在已知 round ≥ 2 排除獨立的行尾狀態；任一未修字樣保留計數。 */
export function trailingResolvedStatus(line: string, round = 1): boolean {
  const plain = line.replace(/`[^`]*`/g, ' ')
  return round >= 2 && !hasUnresolvedWording(plain) && TRAILING_RESOLVED.test(plain)
}
