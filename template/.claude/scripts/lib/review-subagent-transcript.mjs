#!/usr/bin/env node
// review-subagent-transcript.mjs — commit 0-A subagent carrier 的身分與完整性核對。
//
// claude-review-safe.sh finalize 呼叫本檔。subagent carrier 沒有 dispatch record，
// 身分證據只有一份：Claude Code 寫在 <config>/projects/*/<parent-session>/subagents/
// 的 agent-<id>.jsonl 與 agent-<id>.meta.json。本檔從那裡回答 Herdr carrier 的
// completion record 回答的同一組問題，而且多答一題：
//
//   1. 這次 review 是哪一個 subagent 跑的——第一則 user message 含 prepare 鑄的 nonce，
//      恰好一份。0 份＝沒跑（exit 3）；>1 份＝nonce 被重用，歸屬不成立（exit 3）。
//      找到之後那則訊息還要**逐字等於** prepare 寫的 prompt：只比 nonce 的話，主線可以在
//      nonce 旁邊夾帶「X 不在範圍內」「回 No findings」，reviewer 審的就不是 prepare 凍結的
//      那份 review（exit 6，2026-09-24 0-A Major）。第一則之後的 user 訊息只准是 tool_result：
//      主線用 SendMessage 續派同一個 reviewer 再補一句，同樣是夾帶，而最終回覆正好取自那次
//      續派（exit 6）。兩處都 NEVER 剝 `<system-reminder>`：標籤誰都寫得出來，剝掉等於給夾帶
//      開一條包進標籤就過的路；248 份真實 reviewer transcript 裡 harness 從未在這兩處放
//      reminder（2026-09-25 實測），日後 harness 真的放了，這裡 fail closed 成 exit 6
//   2. 它是不是唯讀 reviewer——meta.json 的 agentType 必須是 commit-0a-reviewer
//      （該 agent 定義只給 Read／Grep／Glob），transcript 裡也不得出現其他工具
//   3. 實際跑的 model 與 effort——每一則 assistant message 都必須符合 requested；
//      缺值＝unverified，任何一則不同＝mismatch（兩者都 exit 8，`failed_check` 指出是哪一關）。
//      model 在 entry.message.model，effort 在 **entry 頂層** 的 `effort`（與 perTurnEffort 並列）：
//      harness 不把 effort 寫進 message，讀 message.effort 會讓每一次真實 finalize 都 exit 8
//      （2026-09-25 PR #343 0-A r1 Critical）。NEVER 退回讀 message.effort：真實 transcript 沒有
//      那個形狀，接受它只會讓合成／改寫過的 transcript 多一條過關的路；harness 日後搬位置時
//      這裡 fail closed 成 exit 8，由人更新讀取位置
//   4. 它有沒有讀完 brief——從成功的 Read 結果還原實際回傳的行號，必須涵蓋 1..N。
//      Herdr pointer 交付只能「要求」child 讀完，這裡是實際核對（缺行 exit 3）
//   5. verdict——最後一則 assistant 文字就是 verdict，必須含 `## Review Verdict`
//   6. 壓縮——reviewer 自己 auto-compact（transcript 出現 compact_boundary／isCompactSummary）＝
//      這一批太大、前文被摘要取代，之後的 verdict 看過的不是完整 brief（exit 7）。
//      compact summary 是 harness 寫進 transcript 的 user 訊息，不是主線續派：它 NEVER 計入
//      「續派」（把它判成 exit 6 會讓主持者讀成「有人夾帶」而不是「批太大」）；
//      但也 NEVER 因為「不算續派」就放行——壓縮過的 review 同樣不是 prepare 凍結的那份完整 review
//
// verdict 取自 transcript 本身，NEVER 由主線轉交：主線是受審改動的 producer，
// 讓它經手 verdict 文字就等於讓 maker 替 reviewer 交卷。
//
// 用法：node review-subagent-transcript.mjs --subagents-dir <dir> --nonce <n>
//         --prompt <prepare 寫的 prompt 檔> --brief <path> --model <requested> --effort xhigh --agent-type <type> --verdict-out <path>
// stdout 印一份 JSON 結論；exit 0 verified／3 沒跑成或不完整／6 prompt 被改或用了寫入型工具／
// 7 reviewer 自身壓縮（本批太大，切小重跑）／8 身分不成立／2 用法錯誤。

import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect, parseArgs } from 'node:util'

const READONLY_TOOLS = new Set(['Read', 'Grep', 'Glob'])

/**
 * Code Mode（Claude Code 實驗功能；HQ research/2026-11-14-Code-Mode.md § W2 S7、S12）下 reviewer 子代理
 * 跟著主 session 跑 REPL：頂層工具只剩 `REPL`（送 JS）與 `Poll`（取結果），真正的 Read／Grep／Glob 是 code 裡的
 * `tools.X(...)`。子代理沒辦法自己關 Code Mode（env 跟主 session），所以這裡改成認得它：
 *   - 主防線：每個內部呼叫都由 harness 各自落成一則 assistant tool_use（id `repl_*`、model `<synthetic>`），
 *     工具名照樣進 `tools`、照樣過唯讀集合——REPL／Poll 只是外殼，NEVER 因為看到 REPL 就整包放行；
 *   - 補一道靜態掃 REPL 的 `input.code`，方向是白名單 fail closed（NEVER 用「去字串去註解＋黑名單」）：
 *     先用嚴格 tokenizer 切 token，只認 ASCII 識別字、不含 HTML-like 註解、\r／U+2028／2029、反斜線識別字 escape，
 *     且 regex／除號、括號配對都能確定；任何一項對不上就整份當非唯讀（`REPL(code 超出可核對的唯讀文法)`）。
 *     通過文法後再擋：唯讀集合以外的 `tools.<Name>`、`tools[...]`、`tools` 整體轉手、global 入口（`globalThis`／`this`／`Function`／`eval`…）、
 *     原型鏈與反射入口（`constructor`／`prototype`／`__proto__`／`getOwnPropertyDescriptor`…）、非單一數字的下標、computed／非 tool 參數名的字串屬性鍵。
 *     `[` 只在 token 能證明是陣列字面值時放行，其餘當下標（`let[` 一律當下標，解構請用 `const`）。這不是完整的 JS 分析：內部呼叫有沒有被記下仍以第一道為準；
 *   - brief 讀完核對（`briefLinesRead`）：內部 Read 的結果只到 vm，模型看到的是 `Poll`／poll_events 的回傳；
 *     所以內部 Read 回的行，要在模型看得到的文字裡也出現才算讀到（code 只回行數或摘要就不算）。
 *     內部 Read 的 tool_result.content 為空字串時（2026-11-18 真實 transcript），內容在同一 user entry 的
 *     toolUseResult.file.content（原文、無行號前綴，起始行 startLine）：改從那裡取行，每一行照樣過同一道可見性核對。
 * REPL 是封閉 vm（W2 S11：沒有 require／process／fetch／eval），不經 tool 碰不到檔案系統。
 */
const CODE_MODE_CARRIER_TOOLS = new Set(['REPL', 'Poll'])

/** REPL code 裡唯讀集合以外的工具引用（含 `tools[...]` 動態取名，記成 `tools[…]`）；讀不懂的寫法記成 UNPARSEABLE。 */
export function replCodeNonReadonlyTools(code) {
  if (typeof code !== 'string') return ['REPL(input.code 缺席)']
  const toks = tokenizeStrict(code)
  if (!toks) return [UNPARSEABLE]
  const match = matchBrackets(toks)
  if (!match) return [UNPARSEABLE]
  const bad = new Set()
  const prevOf = (k) => toks[k - 1]
  const isDot = (t) => t?.t === 'p' && (t.v === '.' || t.v === '?.')
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]
    if (t.t === 'id') {
      if (FORBIDDEN_GLOBALS.has(t.v)) bad.add('動態取 global')
      else if (FORBIDDEN_REFLECTION.has(t.v)) bad.add('原型鏈')
      else if (BARE_GLOBAL_DENY.has(t.v) && !isDot(prevOf(k))) bad.add(t.v)
      if (t.v === 'tools') checkToolsRef(toks, k, match, bad)
    } else if (t.t === 'str') {
      // 字串＋`:` 是物件鍵／解構鍵：名字用 \u 或串接就看不穿，只放行已知的 tool 參數名
      // 鍵位置＝前面是 `{`／`,`（三元式 `c ? 'x' : 'y'` 的前面是 `?`，不是鍵）
      const before = prevOf(k)
      const keyPos = before?.t === 'p' && (before.v === '{' || before.v === ',')
      if (keyPos && toks[k + 1]?.t === 'p' && toks[k + 1].v === ':' && !SAFE_STRING_KEY.test(t.v))
        bad.add('原型鏈')
    } else if (t.t === 'p' && t.v === '[') {
      if (!isSafeBracket(toks, k, match[k])) bad.add('原型鏈')
    }
  }
  return [...bad]
}

/** 讀不懂（超出白名單文法）的 code：fail closed，一律當成非唯讀。 */
const UNPARSEABLE = 'REPL(code 超出可核對的唯讀文法)'

/**
 * 判定方向是白名單，不是黑名單：先用嚴格 tokenizer 把 code 切成 token，任何不在下列文法內的字元或寫法
 * （非 ASCII 識別字、反斜線識別字 escape、HTML-like 註解、無法確定是 regex 還是除號的 `/`、
 * \r／U+2028／U+2029 等 JS 認作換行而本檔不認的字元、括號不成對）整份判為讀不懂。NEVER 在這裡退回
 * 「去字串去註解後掃黑名單」：手寫 lexer 必然和 JS 詞法有縫。
 */
const FORBIDDEN_GLOBALS = new Set([
  'globalThis',
  'global',
  'self',
  'window',
  'this',
  'Function',
  'eval',
  'import',
  'require',
  'process',
])

/** 取原型／做動態屬性名查找的反射入口；任何位置出現一律擋（名字查找可用串接藏住，擋入口不擋名字）。 */
const FORBIDDEN_REFLECTION = new Set([
  'constructor',
  'prototype',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'getPrototypeOf',
  'setPrototypeOf',
  'Reflect',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getOwnPropertyNames',
  'getOwnPropertySymbols',
  'defineProperty',
  'defineProperties',
])

/** REPL vm 的裸全域（工具、shell、寫檔）：第一道防線是內部呼叫的落記錄，這裡補一道名字掃描。 */
const BARE_GLOBAL_DENY = new Set([
  '$',
  'edit',
  'write',
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'Agent',
  'Workflow',
  'Skill',
  'WebFetch',
  'WebSearch',
  'SendMessage',
  'AskUserQuestion',
])

/** Read／Grep／Glob 的參數名：寫成字串鍵（`{ "pattern": ... }`、`{ '-n': true }`）也是日常寫法，放行；其餘字串鍵 fail closed。 */
const SAFE_STRING_KEY =
  /^(?:-[A-Za-z]|pattern|path|file_path|glob|output_mode|type|offset|limit|head_limit|multiline|context)$/

/** 後面接 `/` 時一定是 regex literal 的保留字（一定不是識別字）。 */
const REGEX_AFTER_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
])
/** 後面接 `[` 時一定是陣列字面值的保留字（與上同；NEVER 放 of／yield／await／let：非 strict 位置它們是合法識別字）。 */
const ARRAY_AFTER_KEYWORD = new Set([...REGEX_AFTER_KEYWORD, 'const', 'var'])
/** 其餘保留字／上下文關鍵字：後面接 `/` 無法確定是除號還是 regex，讀不懂。 */
const AMBIGUOUS_WORDS = new Set([
  'await',
  'yield',
  'of',
  'let',
  'static',
  'async',
  'get',
  'set',
  'from',
  'as',
  'break',
  'catch',
  'class',
  'continue',
  'debugger',
  'default',
  'enum',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'switch',
  'try',
  'while',
  'with',
])

const PUNCTUATORS = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '**',
  ...'{}()[];,<>+-*/%&|^!~?:=.',
]
/** 這些 token 之後的 `/` 是 regex literal 的開頭（運算子或開括號之後必是運算元位置）。 */
const REGEX_AFTER_PUNCT = new Set(
  PUNCTUATORS.filter(
    (p) => !['(', ')', '[', ']', '}', '++', '--', '.', '?.', '/', '/='].includes(p),
  ).concat('(', '['),
)
/** 這些 token 之後的 `[` 是陣列字面值：排除 `) ] }`、後綴 `++`／`--`、`.`／`?.`（那些是下標）。 */
const ARRAY_AFTER_PUNCT = new Set(
  PUNCTUATORS.filter((p) => !['(', ')', '[', ']', '}', '++', '--', '.', '?.'].includes(p)).concat(
    '(',
    '[',
  ),
)

/** 任何一個 JS 認作換行或有別義、本檔不逐一處理的控制字元：整份讀不懂（含 \r、\v、\f、U+2028／2029）。 */
const hasForbiddenControl = (s) => {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f || c === 0x2028 || c === 0x2029)
      return true
  }
  return false
}

/**
 * 嚴格 tokenizer。回傳 token 陣列 { t: 'id'|'num'|'str'|'tpl'|'regex'|'p', v }，或 null（讀不懂）。
 * 識別字只收 ASCII；字串、註解、regex、模板的內容視為不透明（只有字串後接 `:` 時看內容）。
 */
function tokenizeStrict(src) {
  if (hasForbiddenControl(src)) return null
  const toks = []
  const braces = [] // 每個進行中的 `${` 一格：該層內未配對的 `{` 數
  const n = src.length
  let i = 0
  const scanTemplate = (from) => {
    for (let j = from; j < n;) {
      const ch = src[j]
      if (ch === '\\') j += 2
      else if (ch === '`') return { end: j + 1, open: false }
      else if (ch === '$' && src[j + 1] === '{') return { end: j + 2, open: true }
      else j += 1
    }
    return null
  }
  const pushTemplate = (from) => {
    const r = scanTemplate(from)
    if (!r) return false
    toks.push({ t: 'tpl', v: '', open: r.open })
    if (r.open) braces.push(0)
    i = r.end
    return true
  }
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') {
      i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i)
      i = end < 0 ? n : end
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) return null
      i = end + 2
      continue
    }
    // Annex B 的 HTML-like 註解：Script goal 把 `<!--` 與行首 `-->` 當單行註解，本 tokenizer 不認 → 讀不懂
    if (src.startsWith('<!--', i) || src.startsWith('-->', i)) return null
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && src[j] !== c) {
        if (src[j] === '\n') return null
        j += src[j] === '\\' ? 2 : 1
      }
      if (j >= n) return null
      const raw = src.slice(i + 1, j)
      // `\` 後接換行（LineContinuation）：字串邊界與逐字元掃描對不上
      if (/\\\n/.test(raw)) return null
      toks.push({ t: 'str', v: raw })
      i = j + 1
      continue
    }
    if (c === '`') {
      if (!pushTemplate(i + 1)) return null
      continue
    }
    if (c === '}' && braces.length > 0) {
      if (braces.at(-1) === 0) {
        braces.pop()
        if (!pushTemplate(i + 1)) return null
        continue
      }
      braces[braces.length - 1] -= 1
    } else if (c === '{' && braces.length > 0) {
      braces[braces.length - 1] += 1
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i, i + 256))
    if (word) {
      if (word[0].length >= 256) return null
      toks.push({ t: 'id', v: word[0] })
      i += word[0].length
      continue
    }
    const num = /^(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9]+)?n?/.exec(
      src.slice(i, i + 256),
    )
    if (num) {
      toks.push({ t: 'num', v: num[0] })
      i += num[0].length
      continue
    }
    if (c === '/') {
      const kind = slashKind(toks)
      if (kind === 'regex') {
        let j = i + 1
        let inClass = false
        for (;;) {
          const ch = src[j]
          if (ch === undefined || ch === '\n') return null
          if (ch === '\\') {
            if (src[j + 1] === undefined || src[j + 1] === '\n') return null
            j += 2
            continue
          }
          if (ch === '[') inClass = true
          else if (ch === ']') inClass = false
          else if (ch === '/' && !inClass) break
          j += 1
        }
        j += 1
        while (/[A-Za-z]/.test(src[j] ?? '')) j += 1
        toks.push({ t: 'regex', v: '' })
        i = j
        continue
      }
      if (kind !== 'div') return null
    }
    let punct = PUNCTUATORS.find((p) => src.startsWith(p, i))
    // `a?.5:1` 的 `?.` 不是可選鏈
    if (punct === '?.' && /[0-9]/.test(src[i + 2] ?? '')) punct = '?'
    if (!punct) return null
    toks.push({ t: 'p', v: punct })
    i += punct.length
  }
  return braces.length === 0 ? toks : null
}

/** 目前位置的 `/` 是 regex 開頭（'regex'）、除號（'div'），或無法確定（null＝讀不懂）。 */
function slashKind(toks) {
  const prev = toks.at(-1)
  if (!prev || (prev.t === 'tpl' && prev.open)) return 'regex'
  if (prev.t === 'p') {
    if (REGEX_AFTER_PUNCT.has(prev.v)) return 'regex'
    return prev.v === ']' ? 'div' : null
  }
  if (prev.t === 'id') {
    // 屬性名（`o.in / 2`）不是關鍵字
    const before = toks.at(-2)
    if (before?.t === 'p' && (before.v === '.' || before.v === '?.')) return 'div'
    if (REGEX_AFTER_KEYWORD.has(prev.v)) return 'regex'
    return AMBIGUOUS_WORDS.has(prev.v) ? null : 'div'
  }
  return 'div'
}

/** 括號必須成對且同型；回傳每個 `[` 對應的 `]` token 索引。不成對（含 regex 字元類誤判的殘局）＝讀不懂。 */
function matchBrackets(toks) {
  const pairs = { ')': '(', ']': '[', '}': '{' }
  const stack = []
  const match = {}
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]
    if (t.t !== 'p') continue
    if (t.v === '(' || t.v === '[' || t.v === '{') stack.push(k)
    else if (pairs[t.v]) {
      const open = stack.pop()
      if (open === undefined || toks[open].v !== pairs[t.v]) return null
      match[open] = k
    }
  }
  return stack.length === 0 ? match : null
}

/** `[` 在 toks[k]：陣列字面值／陣列解構放行；下標只放行單一純數字；computed 屬性鍵一律擋。 */
function isSafeBracket(toks, k, close) {
  const inner = toks.slice(k + 1, close)
  const onlyNumber = inner.length === 1 && inner[0].t === 'num' && /^[0-9]+$/.test(inner[0].v)
  const prev = toks[k - 1]
  if (!isArrayLiteralPosition(toks, k)) return onlyNumber
  // `{ [k]: v }`／`, [k]: v` 是 computed 屬性鍵（後面緊接 `:`）
  const after = toks[close + 1]
  if (prev?.t === 'p' && (prev.v === '{' || prev.v === ',') && after?.t === 'p' && after.v === ':')
    return onlyNumber
  return true
}

/** `[` 前面的 token 能不能證明它是陣列字面值（白名單）：開頭、運算子／開括號之後、保留字之後、for-of 的 `of` 之後。 */
function isArrayLiteralPosition(toks, k) {
  const prev = toks[k - 1]
  if (!prev || (prev.t === 'tpl' && prev.open)) return true
  if (prev.t === 'p') return ARRAY_AFTER_PUNCT.has(prev.v)
  if (prev.t !== 'id') return false
  const before = toks[k - 2]
  // `o.in[k]`／`o?.return[k]`：屬性名不是關鍵字
  if (before?.t === 'p' && (before.v === '.' || before.v === '?.')) return false
  if (ARRAY_AFTER_KEYWORD.has(prev.v)) return true
  if (prev.v === 'of') return isForOfHead(toks, k - 1)
  // `let` 後的 `[` 一律當下標：for 標頭條件式／更新式的 `let` 是普通識別字（sloppy 模式），無法在 token 層和宣告區分；
  // 要解構就改用 `const`。
  return false
}

/** `for ( [await] (const|let|var) <binding> of` 的 `of`（索引 k）；binding 是單一識別字或一組括號。 */
function isForOfHead(toks, k) {
  let j = k - 1
  const last = toks[j]
  if (last?.t === 'id') j -= 1
  else if (last?.t === 'p' && (last.v === '}' || last.v === ']')) {
    const open = last.v === '}' ? '{' : '['
    let depth = 0
    for (; j >= 0; j -= 1) {
      const t = toks[j]
      if (t.t !== 'p') continue
      if (t.v === last.v) depth += 1
      else if (t.v === open && (depth -= 1) === 0) break
    }
    if (j < 0) return false
    j -= 1
  } else return false
  if (!['const', 'let', 'var'].includes(toks[j]?.v)) return false
  j -= 1
  if (toks[j]?.v === 'await') j -= 1
  return toks[j]?.v === '(' && toks[j - 1]?.v === 'for'
}

/** `tools` 的每個出現：只放行 `tools.Read|Grep|Glob`（含 `?.`）與解構唯讀名。 */
function checkToolsRef(toks, k, match, bad) {
  const next = toks[k + 1]
  if (next?.t === 'p' && (next.v === '.' || next.v === '?.')) {
    const name = toks[k + 2]
    if (name?.t === 'id') {
      if (!READONLY_TOOLS.has(name.v)) bad.add(name.v)
    } else bad.add('tools[…]')
    return
  }
  if (next?.t === 'p' && next.v === '[') {
    bad.add('tools[…]')
    return
  }
  const prev = toks[k - 1]
  const close = toks[k - 2]
  if (prev?.t === 'p' && prev.v === '=' && close?.t === 'p' && close.v === '}') {
    let open = k - 2
    while (open >= 0 && !(toks[open].t === 'p' && toks[open].v === '{' && match[open] === k - 2))
      open -= 1
    const names = destructuredNames(toks.slice(open + 1, k - 2))
    if (names) {
      for (const name of names) if (!READONLY_TOOLS.has(name)) bad.add(name)
      return
    }
  }
  bad.add('tools(整體引用)')
}

/** `{ Read, Grep: g }` 內層的鍵名；有展開、巢狀、字串鍵或預設值以外的寫法就回 null（整體引用）。 */
function destructuredNames(inner) {
  const names = []
  let part = []
  const flush = () => {
    if (part.length === 0) return true
    if (part[0].t !== 'id') return false
    if (part.length > 1 && !(part[1].t === 'p' && (part[1].v === ':' || part[1].v === '=')))
      return false
    names.push(part[0].v)
    part = []
    return true
  }
  for (const t of inner) {
    if (t.t === 'p' && t.v === ',') {
      if (!flush()) return null
    } else part.push(t)
  }
  return flush() ? names : null
}

/** requested 是完整 model id（claude-opus-5-5）或 family alias（opus）；alias 比前綴。 */
export function modelMatches(requested, observed) {
  if (observed === requested) return true
  return !requested.includes('-') && observed.startsWith(`claude-${requested}-`)
}

function contentBlocks(message) {
  if (!message) return []
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }]
  return Array.isArray(message.content) ? message.content : []
}

function firstUserText(entries) {
  const first = entries.find((e) => e.type === 'user' && e.message)
  if (!first) return ''
  return contentBlocks(first.message)
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

/** compact summary 是 harness 在 reviewer 自己 auto-compact 時寫的 user 訊息（isCompactSummary: true），不是主線送的。 */
const isCompactSummary = (e) => e.type === 'user' && e.isCompactSummary === true

/**
 * reviewer 的 transcript 有沒有自己壓縮過。兩個訊號任一個都算：
 * `{type:'system', subtype:'compact_boundary', compactMetadata:{trigger, preTokens}}` 與
 * `{type:'user', isCompactSummary:true}`（#4478／#4494／#4130 的 reviewer transcript，
 * preTokens 267,941–278,656）。只認 boundary 的話，harness 日後只寫 summary 就漏；反之亦然。
 */
export function compactionEvidence(entries) {
  const boundaries = entries.filter((e) => e.type === 'system' && e.subtype === 'compact_boundary')
  const summaries = entries.filter(isCompactSummary)
  const preTokens = boundaries
    .map((e) => e.compactMetadata?.preTokens)
    .filter((n) => Number.isFinite(n))
  return {
    compacted: boundaries.length + summaries.length > 0,
    count: Math.max(boundaries.length, summaries.length),
    triggers: boundaries.map((e) => e.compactMetadata?.trigger).filter(Boolean),
    preTokens,
  }
}

/**
 * harness 在 reviewer Read 圖片（PNG 等）後自動插入的 user 條目：`isMeta: true`，內容只有圖片尺寸註記
 * `[Image: original 2880x1800, displayed at 2420x1512. Multiply coordinates by 1.19 to map to original image.]`
 * （或只含 image 區塊）。不是主線訊息，不可能夾帶指示（2026-11-16 presales#18 批 2 連 3 次誤判 exit 6）。
 *
 * 判準刻意嚴：必須同時 ① `isMeta === true`（harness 專屬旗標，SendMessage 續派寫不出來）、
 * ② 每個內容區塊要嘛是 image 區塊、要嘛整段文字**逐字完整符合**上面的註記格式（錨定頭尾，
 * 不用子字串）。多一個字、多一個區塊、少了 isMeta，都照舊算主線續派 fail closed。
 */
const IMAGE_META_NOTE =
  /^\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by \d+(?:\.\d+)? to map to original image\.\]$/

export function isHarnessImageMeta(e) {
  if (e.type !== 'user' || e.isMeta !== true) return false
  const blocks = contentBlocks(e.message)
  if (blocks.length === 0) return false
  return blocks.every(
    (c) => c.type === 'image' || (c.type === 'text' && IMAGE_META_NOTE.test(String(c.text).trim())),
  )
}

/** 第一則之後的非空 user 文字＝主線續派時補進去的指示（含包進 system-reminder 標籤的）；harness 自己寫的 compact summary 與 image 註記不算。 */
export function laterUserTexts(entries) {
  return entries
    .filter((e) => e.type === 'user' && e.message && !isCompactSummary(e))
    .slice(1)
    .filter((e) => !isHarnessImageMeta(e))
    .flatMap((e) => contentBlocks(e.message))
    .filter((c) => c.type === 'text')
    .map((c) => c.text.trim())
    .filter(Boolean)
}

export function readTranscript(path) {
  const entries = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // 寫到一半的尾行：subagent 還沒結束時才會出現，下面的 verdict 檢查會把它判成沒跑完。
    }
  }
  return entries
}

/** 找出第一則 user message 含 nonce 的 transcript。 */
export function findTranscripts(subagentsDir, nonce) {
  if (!existsSync(subagentsDir)) return []
  return readdirSync(subagentsDir)
    .filter((name) => /^agent-[A-Za-z0-9-]+\.jsonl$/.test(name))
    .map((name) => join(subagentsDir, name))
    .filter((path) => firstUserText(readTranscript(path)).includes(nonce))
}

/** 成功的 Read(brief) 實際回傳了哪些行：結果是 `<行號>\t<內容>`，從 offset 起逐行連號。 */
export function briefLinesRead(entries, briefPath) {
  const reads = new Map()
  const synthetic = new Set()
  for (const e of entries) {
    if (e.type !== 'assistant') continue
    for (const c of contentBlocks(e.message))
      if (c.type === 'tool_use' && c.name === 'Read' && c.input?.file_path === briefPath) {
        reads.set(c.id, c.input)
        if (e.message?.model === '<synthetic>' || String(c.id).startsWith('repl_'))
          synthetic.add(c.id)
      }
  }
  const visible = synthetic.size > 0 ? modelVisibleText(entries, syntheticToolUseIds(entries)) : ''
  const seen = new Set()
  for (const e of entries) {
    if (e.type !== 'user') continue
    for (const c of contentBlocks(e.message)) {
      if (c.type !== 'tool_result' || c.is_error || !reads.has(c.tool_use_id)) continue
      const text =
        typeof c.content === 'string'
          ? c.content
          : (c.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('')
      let expected = Number(reads.get(c.tool_use_id).offset ?? 1) || 1
      // Code Mode 內部 Read 的真實形狀（2026-11-18 #5481 的真實 transcript）：tool_result.content 是空字串，
      // 內容在同一 user entry 的 toolUseResult.file（{filePath, content, startLine, numLines, totalLines}），
      // content 是原文、沒有「行號\t」前綴。只對 synthetic 的 Read 開這條回退；每一行仍照樣過 visibleContains。
      const fallback =
        synthetic.has(c.tool_use_id) && text === '' ? toolUseResultFile(e, briefPath) : null
      if (fallback) {
        expected = fallback.startLine ?? expected
        for (const line of fallback.content.split('\n')) {
          // 內容要出現在模型看得到的回傳裡才算讀到（code 只回行數／摘要不算）
          if (!visibleContains(visible, line)) break
          seen.add(expected)
          expected += 1
        }
        continue
      }
      for (const line of text.split('\n')) {
        const m = /^\s*(\d+)\t/.exec(line)
        if (!m) continue
        // 只收從 offset 起連號的行：內容裡碰巧長得像「數字＋tab」的行不會被誤算成已讀。
        if (Number(m[1]) !== expected) continue
        // Code Mode 的內部 Read：那一行的內容也要出現在模型看得到的回傳裡（code 只回行數／摘要不算讀到）
        if (synthetic.has(c.tool_use_id) && !visibleContains(visible, line.slice(m[0].length)))
          break
        seen.add(expected)
        expected += 1
      }
    }
  }
  return seen
}

/** user entry 的 toolUseResult.file（對得上 brief 路徑、content 為字串才收）；沒有就 null。 */
function toolUseResultFile(entry, briefPath) {
  const file = entry.toolUseResult?.file
  if (!file || typeof file.content !== 'string' || file.filePath !== briefPath) return null
  const startLine = Number(file.startLine)
  return {
    content: file.content,
    startLine: Number.isInteger(startLine) && startLine >= 1 ? startLine : null,
  }
}

/** 模型實際看得到的 Code Mode 回傳：非內部呼叫的 tool_result（`Poll`、REPL 的 dispatched）與 poll_events 附件。 */
function syntheticToolUseIds(entries) {
  const ids = new Set()
  for (const e of entries) {
    if (e.type !== 'assistant') continue
    const internal = e.message?.model === '<synthetic>'
    for (const c of contentBlocks(e.message))
      if (c.type === 'tool_use' && (internal || String(c.id).startsWith('repl_'))) ids.add(c.id)
  }
  return ids
}

function modelVisibleText(entries, internalIds) {
  const parts = []
  for (const e of entries) {
    if (e.type === 'attachment' && e.attachment?.type === 'poll_events')
      parts.push(...(e.attachment.envelopes ?? []).filter((x) => typeof x === 'string'))
    if (e.type !== 'user') continue
    for (const c of contentBlocks(e.message)) {
      if (
        c.type !== 'tool_result' ||
        internalIds.has(c.tool_use_id) ||
        String(c.tool_use_id).startsWith('repl_')
      )
        continue
      parts.push(
        typeof c.content === 'string'
          ? c.content
          : (c.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join(''),
      )
    }
  }
  return parts.join('\n')
}

/**
 * 行內容在回傳裡出現：原樣、JSON 跳脫，或 util.inspect 的字串形式（依該行自選引號、跳脫 `\\` 與控制字元；
 * 不跳脫沒選上的引號）。另試「只多跳脫單引號」的舊式。空行一律算。
 */
export function visibleContains(visible, text) {
  if (!text.trim()) return true
  const forms = [
    text,
    JSON.stringify(text).slice(1, -1),
    inspect(text).slice(1, -1),
    inspect(text)
      .slice(1, -1)
      .replace(/(?<!\\)'/g, "\\'"),
    text.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  ]
  return forms.some((form) => visible.includes(form))
}

export function missingRanges(seen, total) {
  const ranges = []
  let start = null
  for (let n = 1; n <= total + 1; n += 1) {
    const missing = n <= total && !seen.has(n)
    if (missing && start === null) start = n
    if (!missing && start !== null) {
      ranges.push(start === n - 1 ? `${start}` : `${start}-${n - 1}`)
      start = null
    }
  }
  return ranges
}

/** 最後一次工具結果之後的 assistant 文字＝subagent 的最終回覆。 */
export function finalReply(entries) {
  let lastToolResult = -1
  entries.forEach((e, i) => {
    if (e.type === 'user' && contentBlocks(e.message).some((c) => c.type === 'tool_result'))
      lastToolResult = i
  })
  return entries
    .slice(lastToolResult + 1)
    .filter((e) => e.type === 'assistant')
    .flatMap((e) => contentBlocks(e.message))
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim()
}

export function verifySubagentReview({
  subagentsDir,
  nonce,
  prompt,
  brief,
  model,
  effort,
  agentType,
}) {
  const result = {
    model_verification: 'unverified',
    effort_verification: 'unverified',
    requested_model: model,
    requested_effort: effort,
  }
  const found = findTranscripts(subagentsDir, nonce)
  result.found = found.length
  if (found.length === 0)
    return {
      ...result,
      exit: 3,
      reason: `${subagentsDir} 沒有任何 subagent transcript 的第一則訊息含 nonce ${nonce}——reviewer subagent 沒跑（或不是在本 session 派的）`,
    }
  if (found.length > 1)
    return {
      ...result,
      exit: 3,
      reason: `${found.length} 份 transcript 都含 nonce ${nonce}（${found.join(', ')}）——同一份 brief 被派了不只一次，歸屬不成立；重跑 prepare 拿新 nonce`,
    }
  const transcript = found[0]
  const agentId = /agent-([A-Za-z0-9-]+)\.jsonl$/.exec(transcript)[1]
  Object.assign(result, { transcript, agent_id: agentId })

  const sent = firstUserText(readTranscript(transcript)).trim()
  if (sent !== readFileSync(prompt, 'utf8').trim())
    return {
      ...result,
      exit: 6,
      reason: `派給 reviewer 的 prompt 與 prepare 寫的 ${prompt} 不一致——AGENT_CALL 的 prompt MUST 逐字照抄，多一句指示就不是凍結的那份 review`,
    }
  const followUps = laterUserTexts(readTranscript(transcript))
  if (followUps.length > 0)
    return {
      ...result,
      exit: 6,
      reason: `reviewer 派出後又收到 ${followUps.length} 則主線訊息（續派）——review 只能是 prepare 凍結的那一份 prompt，續派補的指示同樣是夾帶；重跑 prepare 拿新 nonce`,
    }

  const metaPath = transcript.replace(/\.jsonl$/, '.meta.json')
  let meta = {}
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  } catch {
    // meta 缺席＝判不出 agent type，下面照 mismatch 處理，NEVER 當作符合。
  }
  result.agent_type = meta.agentType
  // agentType 可以是 prepare 寫進 state 的固定兩個名字（裸名與 hub-core 命名空間名）：逐字
  // 比對集合成員，NEVER 改成前綴／字尾比對——那會讓其他 plugin 的同名 agent 混進來。
  const allowedTypes = [agentType].flat()
  if (!allowedTypes.includes(meta.agentType))
    return {
      ...result,
      exit: 8,
      failed_check: 'agent_type',
      reason: `subagent_type 是 ${meta.agentType ?? '（meta.json 缺席）'}，不是 ${allowedTypes.join(' 或 ')}——只有 commit-0a-reviewer 的工具面是唯讀，其他 type 的輸出不是 0-A reviewer 的輸出`,
    }

  const entries = readTranscript(transcript)
  const observed = new Set()
  const observedEfforts = new Set()
  let missingEffort = false
  const tools = new Set()
  for (const e of entries) {
    if (e.type !== 'assistant' || !e.message) continue
    if (e.message.model && e.message.model !== '<synthetic>') observed.add(e.message.model)
    if (e.message.model && e.message.model !== '<synthetic>') {
      if (typeof e.effort === 'string' && e.effort.length > 0) observedEfforts.add(e.effort)
      else missingEffort = true
    }
    for (const c of contentBlocks(e.message)) {
      if (c.type !== 'tool_use') continue
      tools.add(c.name)
      if (c.name === 'REPL') for (const t of replCodeNonReadonlyTools(c.input?.code)) tools.add(t)
    }
  }
  result.observed_models = [...observed]
  result.observed_model = observed.size === 1 ? [...observed][0] : undefined
  if (observed.size === 0)
    return {
      ...result,
      exit: 8,
      failed_check: 'model',
      reason: 'transcript 沒有任何帶 model 的 assistant message，身分無法核實',
    }
  const wrong = [...observed].filter((m) => !modelMatches(model, m))
  if (wrong.length > 0)
    return {
      ...result,
      exit: 8,
      failed_check: 'model',
      model_verification: 'mismatch',
      reason: `requested ${model}，observed ${[...observed].join(', ')}`,
    }
  result.model_verification = 'verified'
  result.observed_efforts = [...observedEfforts]
  result.observed_effort = observedEfforts.size === 1 ? [...observedEfforts][0] : undefined
  if (missingEffort || observedEfforts.size === 0)
    return {
      ...result,
      exit: 8,
      failed_check: 'effort',
      reason: 'transcript 有 assistant entry 頂層沒有 effort，實際推理檔位無法核實',
    }
  if ([...observedEfforts].some((value) => value !== effort))
    return {
      ...result,
      exit: 8,
      failed_check: 'effort',
      effort_verification: 'mismatch',
      reason: `requested effort ${effort}，observed ${[...observedEfforts].join(', ')}`,
    }
  result.effort_verification = 'verified'

  const writeTools = [...tools].filter(
    (t) => !READONLY_TOOLS.has(t) && !CODE_MODE_CARRIER_TOOLS.has(t),
  )
  result.tools_used = [...tools]
  if (writeTools.length > 0)
    return {
      ...result,
      exit: 6,
      reason: `reviewer 用了唯讀集合以外的工具：${writeTools.join(', ')}——verdict 扣住`,
    }

  // 順序：續派（exit 6）→ 身分／effort／工具面（exit 8／6）→ 壓縮（exit 7）→ 讀完 brief。
  // 壓縮只說「這批太大、切小重跑」；seat 或 agent type 不對、用了寫入工具是更要緊的結論，
  // 不能被「切小重跑」蓋掉（也要留下身分稽核的 receipt）。壓縮過的 transcript 讀取範圍必然不完整，
  // 所以壓縮判定在 brief 覆蓋核對之前。
  const compaction = compactionEvidence(entries)
  if (compaction.compacted) {
    const peak = compaction.preTokens.length > 0 ? Math.max(...compaction.preTokens) : undefined
    return {
      ...result,
      exit: 7,
      failed_check: 'reviewer_compacted',
      compaction_count: compaction.count,
      compaction_pre_tokens: compaction.preTokens,
      reason: `reviewer 自己 auto-compact 了 ${compaction.count} 次${peak ? `（preTokens ${peak}）` : ''}——這批 brief 太大，前文被摘要取代，後面的 verdict 沒看完整個 changeset；不是主線續派、也不是通過。切小重跑：oa-batches.ts clean <pr> 後重跑 prepare（單批上限固定為 REVIEWER_BATCH_MAX_BYTES，--max-bytes 只能往下調）；commit skill 路徑則拆 commit，NEVER 沿用這份 verdict`,
    }
  }

  const total = readFileSync(brief, 'utf8').replace(/\n$/, '').split('\n').length
  const missing = missingRanges(briefLinesRead(entries, brief), total)
  result.brief_lines = total
  result.brief_coverage = missing.length === 0 ? 'full' : 'partial'
  if (missing.length > 0)
    return {
      ...result,
      exit: 3,
      reason: `reviewer 沒讀完 brief（${total} 行，未讀：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}）——看過部分內容的 verdict 與完整 review 同形，NEVER 放行`,
    }

  const verdict = finalReply(entries)
  if (!/^## Review Verdict/m.test(verdict))
    return {
      ...result,
      exit: 3,
      reason: 'subagent 的最終回覆沒有 `## Review Verdict` 區段（沒跑完，或輸出不合契約）',
    }
  return { ...result, exit: 0, verdict }
}

function main() {
  const { values } = parseArgs({
    options: {
      'subagents-dir': { type: 'string' },
      nonce: { type: 'string' },
      prompt: { type: 'string' },
      brief: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      'agent-type': { type: 'string', multiple: true },
      'verdict-out': { type: 'string' },
    },
  })
  const missing = [
    'subagents-dir',
    'nonce',
    'prompt',
    'brief',
    'model',
    'effort',
    'agent-type',
    'verdict-out',
  ].filter((k) => !values[k])
  if (missing.length > 0) {
    process.stdout.write(
      `${JSON.stringify({ exit: 2, reason: `缺參數：${missing.join(', ')}` })}\n`,
    )
    process.exit(2)
  }
  if (values.effort !== 'xhigh') {
    process.stdout.write(
      `${JSON.stringify({ exit: 2, reason: 'commit 0-A 只接受 xhigh effort' })}\n`,
    )
    process.exit(2)
  }
  const result = verifySubagentReview({
    subagentsDir: values['subagents-dir'],
    nonce: values.nonce,
    prompt: values.prompt,
    brief: values.brief,
    model: values.model,
    effort: values.effort,
    agentType: values['agent-type'],
  })
  if (result.exit === 0) writeFileSync(values['verdict-out'], `${result.verdict}\n`)
  const { verdict: _verdict, ...summary } = result
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  process.exit(result.exit)
}

// CLI 入口判斷 NEVER 用 `import.meta.url === \`file://${argv[1]}\``：import.meta.url 是 realpath
// 且 percent-encode（空白、非 ASCII），argv[1] 是呼叫端給的原字串（可能經 symlink）。兩邊不等時
// main() 不跑、node 以 exit 0 靜默結束，finalize 會把它當成核對通過（2026-09-26 consumer 0-A Major）。
function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  const self = fileURLToPath(import.meta.url)
  try {
    return realpathSync(entry) === realpathSync(self)
  } catch {
    return entry === self
  }
}

if (invokedAsCli()) main()
