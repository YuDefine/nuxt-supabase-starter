// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/tech-debt-status.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/tech-debt-status.ts
// clade improvement-loop: shared tech-debt `**Status**:` parsing.
//
// Single source of truth for "is this TD closed?" so the emission path
// (improvement-digest.ts detectFromTechDebt) and the closure path
// (closure-scanner.ts evaluateStatePredicate) cannot drift apart — they
// previously disagreed: emission skipped Status-closed TDs while the closure
// scanner only recognised a TD as closed when its entry was physically removed.

// Closed-class TD statuses: fix has landed or is intentionally not happening.
// Matched on the leading token so `-clade-scope` qualifiers count
// (`resolved-clade-scope`, `wontfix-clade-scope`); `pending` / `deferred` /
// `workaround` / `mitigated` stay open.
export const CLOSED_TD_STATUSES = new Set(['done', 'resolved', 'closed', 'wontfix', 'superseded'])

// 第三態：規約 / 工具已經落地（所以 entry 帶著 `### Resolution`），但**驗收未跑**，
// 所以 Status 不能是 done —— 改 done 就是過早宣告完成。
//
// 為什麼需要一個 canonical token 而不是寫成 `open — 已落地`：後綴是自由散文，audit
// 只能靠字串啟發式認它，而「已實作待驗」「已 ship 待 smoke」這類同義寫法會一路漏。
// token 走既有的 `-qualifier` grammar（同 `resolved-clade-scope`），`parseTechDebtStatus`
// 的 `[A-Za-z][\w-]*` 直接吃得下，`isClosedStatus` 取 `split('-')[0]` 自動判成非 closed。
//
// **這不是 closed class**：它仍要計 Invariant 4 的 60d SLA（驗收本身會拖，那正是需要
// SLA 的形狀），只是免除 Invariant 5 的「open 不該有 Resolution」與 Invariant 6 的
// done-hint 誤判。判準見 `.claude/rules/local/tech-debt-hygiene.md § Invariant 5`。
export const LANDED_PENDING_TD_STATUSES = new Set(['landed'])

// @deprecated (TD-490) — `blocked-attended-only` 作為 Status token 已停用。
// 出口可達性現在由 `**Blocker**:` 欄位的存在與否獨立承載，與 Status 正交。
// 任何 open/pending/landed entry 只要有 `**Blocker**:` 欄且指向已知 gate，
// 就不計入 actionableOpen。不再需要獨立的 status token。
//
// 保留常數與 isBlockedAttendedOnly() 供 handoff-scan.ts backward compat（TD-504
// scope 內會遷移到 blocker-field-based 判準）。遷移完成後可移除。
//
// 防濫用在 Invariant 12（`**Blocker**:` MUST 指得出擋在哪一行）：這一格是 actionableOpen
// 的單一攻擊面，加 N 條 `**Blocker**:` 就能讓停止條件假成立。**NEVER** 把「需要人判斷」
// 「風險高」「還沒空」當 blocker —— 那些是優先序，不是 gate。
export const BLOCKED_ATTENDED_ONLY_TD_STATUSES = new Set(['blocked'])

// TD metadata 欄位的共用行首前綴：部分 entry 把整個 metadata 區塊寫成 bullet list
// （`- **Status**: done`）。少了它，`^` 錨點只吃裸欄位行。
//
// 集中在這裡而不是各自寫一份：同型 bug 已發生四次（Status 2026-05、Class 與
// Discovered/Location 2026-08-02，值前面的粗體 2026-08-23）。前三次漏的是**欄位名
// 前面**的修飾，失敗形態是「一個欄位認得 bullet、另一個不認，同一條 TD 半邊解析
// 成功」；第四次（[[TD-597]]）漏的是**值前面**的修飾（`**Status**: **resolved**`），
// 失敗形態是整條 regex 不匹配 → 回 null → 已結案 TD 被三條鏈一致當成 open。
//
// **修飾可以出現在兩個位置，各自需要一個共用常數**：欄位名前面走 TD_FIELD_PREFIX，
// 值前面走 TD_VALUE_WRAPPER。**NEVER** 在個別 regex 內重寫任一段。
export const TD_FIELD_PREFIX = '(?:[-*+]\\s+)?'

// 值前面的 markdown 強調包裹（`**resolved**` / `` `resolved` `` / `~~resolved~~`）。
// 只剝開頭：收尾的包裹符號由 `[\\w-]*` 自己停住，因為 `*` / `` ` `` / `~` 都不是
// word char。
//
// **`_` 刻意不在集合裡**：它是 word char，剝掉開頭的 `_` 之後 `[\\w-]*` 會把收尾那個
// 一起吃進 token（`_resolved_` → `resolved_`），`isClosedStatus` 的 `split('-')[0]`
// 仍判不出 closed —— 等於換一個地方失敗。要支援 `_` 強調就得同時改捕獲字元集，
// 那是另一個決策，**NEVER** 只把 `_` 加進本常數。
export const TD_VALUE_WRAPPER = '(?:[*`~]+\\s*)?'

// Parse the `**Status**:` field value (first token) from a TD body. Returns
// lowercased status word (e.g. 'done', 'resolved', 'open', 'wontfix') or null.
// The `[\w-]*` capture stops at the trailing CJK parenthetical annotation
// (`done（2026-05-10）`) because `（` is non-word.
//
// The optional `[-*+]\s+` prefix accepts the bullet-list metadata style some
// TD entries use (`- **Status**: done`) — without it the `^` anchor only
// matched bare `**Status**:` lines, so bullet-style closed TDs parsed as null
// → treated as open → falsely re-emitted as digest candidates every run.
//
// `TD_VALUE_WRAPPER` strips markdown emphasis wrapping the **value**
// (`**Status**: **resolved**`): the token is taken from inside the wrapper, so
// `isClosedStatus`'s `split('-')[0]` still sees a bare `resolved`. **NEVER**
// widen the capture to `[^\s]+` instead — that swallows the asterisks into the
// token and moves the failure downstream rather than fixing it.
export function parseTechDebtStatus(body) {
  const m = body.match(
    new RegExp(
      `^${TD_FIELD_PREFIX}\\*\\*Status\\*\\*[:：]\\s*${TD_VALUE_WRAPPER}([A-Za-z][\\w-]*)`,
      'm',
    ),
  )
  return m ? m[1].toLowerCase() : null
}

// True when a status token (possibly with a `-qualifier`) is a closed-class
// status. Null-safe — a missing Status field is treated as open.
export function isClosedStatus(status) {
  if (status === null || status === undefined) return false
  return CLOSED_TD_STATUSES.has(status.split('-')[0])
}

// True when a status token is the「已落地、待驗收」third state
// (`landed-pending-verification`). Null-safe. Deliberately NOT part of
// isClosedStatus — landed entries stay in the open pool for SLA purposes.
export function isLandedPendingVerification(status) {
  if (status === null || status === undefined) return false
  return LANDED_PENDING_TD_STATUSES.has(status.split('-')[0])
}

// @deprecated (TD-490) — 出口可達性現在由 `**Blocker**:` 欄位獨立承載。
// 新 code path 用 `hasBlockerGate(entry.blocker)` 判斷是否被 gate 擋住，
// 不再依賴 status token。保留供 handoff-scan.ts backward compat。
export function isBlockedAttendedOnly(status) {
  if (status === null || status === undefined) return false
  return BLOCKED_ATTENDED_ONLY_TD_STATUSES.has(status.split('-')[0])
}

// (TD-490) 判斷 `**Blocker**:` 欄位是否指向已知 gate。
// 與 status token 正交——任何 open/pending/landed entry 只要 blocker 指向已知 gate，
// 就從 actionableOpen 扣除。gate 名冊與 audit-tech-debt-hygiene.ts 的 KNOWN_GATE_RE
// 同源；呼叫端傳入的 gateRe 應是那個 regex。
// 回 false 而非 throw：blocker 為 null 只代表該 entry 沒有 Blocker 欄位。
export function hasBlockerGate(blocker, gateRe) {
  if (!blocker) return false
  return gateRe.test(blocker)
}

// Extract the `**Status**:` of a single TD entry from a full tech-debt.md
// content string. Slices the block from the `## <tdId>` heading to the next
// `## ` heading (same splitting contract as improvement-digest.ts readTechDebt)
// so a sibling TD's Status line can't leak in. Returns the lowercased status
// token, or null when the entry is absent or has no Status field.
export function getTechDebtStatus(fileContent, tdId) {
  const lines = fileContent.split('\n')
  const headingRe = new RegExp(`^## ${tdId}\\s*[—-]\\s`)
  let inBlock = false
  const block = []
  for (const line of lines) {
    if (!inBlock) {
      if (headingRe.test(line)) inBlock = true
      continue
    }
    if (line.startsWith('## ')) break
    block.push(line)
  }
  if (!inBlock) return null
  return parseTechDebtStatus(block.join('\n'))
}

// Terminal tokens are explicit; unknown qualifiers retain the work for review.
//
// 與 `isClosedStatus` 的分歧是刻意的，NEVER 收斂成一個判定：
// `isClosedStatus` 只看 leading token，所以 `wontfix-until-signal` 為 true —— 它對 digest /
// SLA 而言確實已離開 open pool。`isTerminalStatus` 是 archive / rotate 的判準，對它為 false
// —— parked 的 entry 等訊號回來，搬進 archive 就是把還會動的工作關掉。2026-09-06 實測
// docs/tech-debt.md：292 筆裡 46 筆是這個 token，收斂成一個判定會一次搬走那 46 筆。
// 斷言在 test/rotate-closed-bloat.test.ts。
export function isTerminalStatus(status: string | null | undefined): boolean {
  return /^(?:(?:done|resolved|closed|wontfix|superseded)(?:-clade-scope)?|closed-(?:workaround|mitigated)|wontfix-(?:by-design|unrecoverable|as-specified))$/.test(
    status ?? '',
  )
}
