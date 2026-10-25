#!/usr/bin/env node
/**
 * notion-ticket-status-guard.ts — 擋自由形式的 Notion page PATCH 把票寫成客戶側狀態（done／archived）
 * （W-2026-10-13-notion-hook-ntn-api-notion-hub-charles-2026-10-1）。
 *
 * 為什麼存在：`MACHINE_TICKET_TRANSITIONS`（vendor/scripts/lib/notion-hub.ts）讓 `notion-sync.ts` 最遠只寫得到
 * acceptance，但 `ntn api -X PATCH /v1/pages/<id>` 沒有任何東西攔。2026-10-13 一個 consumer session 把
 * 「消化到規格書跟雛形後的單子就可以標記完成」當成當次授權，用 `ntn api` 把四張票直接設成完成，客戶沒驗收過。
 * 規約全文：`rules/core/notion-work-coupling.md` § 與「對外輸出需 user 授權」的關係。
 *
 * fleet 入口：`pre-bash-notion-ticket-status-gate.sh`（同目錄）以 stdin 餵 hook payload 執行本檔。
 *
 * threat model：防漂移，不防主動規避。絆索不是牆：只看 agent 的 Bash tool call 裡 `ntn api`／`curl` 對
 * `/v1/pages/<id>` 的寫入；Notion MCP、`node -e`／python／腳本檔裡的 HTTP 呼叫、Notion UI 都看不到。
 * 不承諾完整語意，只認常見入口。會攔到談論該指令的文字（`bash -c`／`eval`／`$( )` 內含完整範例時）；
 * 被誤擋時把內容改用 Write／Edit 落檔，或把 body 寫成字面 JSON／`-d @file` 讓判定讀得到實際值。
 * gate 型別：安全型（擋「未經客戶驗收就把票寫成完成／封存」這件不該發生的事）。
 *
 * 判定對象與方向（「輸入本身有歧義」的正常判定，不是故障）：
 *
 *   | body 的形狀 | 有 registry | 讀不到 registry |
 *   | --- | --- | --- |
 *   | 字面 JSON 或讀得到的 `-d @file`，沒設任何 status／select | 放行 | 放行 |
 *   | 同上，status／select 的 name 是任一 hub 的 done／archived 字 | 擋 | 擋（任何 status／select 寫入都擋） |
 *   | 同上，name 是其他字（驗收中、需使用者確認…） | 放行 | 擋 |
 *   | 同上，以 option id 指定（registry 沒有 id） | 放行＋additionalContext | 擋 |
 *   | 判不出：含 `$` 展開、`@-`／heredoc、檔讀不到、ntn inline 欄位、不是 JSON | 整條指令文字找 done／archived 字（獨立詞）或 `ticketStatus.done`／`["archived"]` 取值：命中擋，沒命中放行＋additionalContext | 擋 |
 *
 * 判不出又沒命中為什麼放行而不擋：cookbook 唯一核可的手動狀態寫入（問客戶 → needs-customer）就是
 * `"$K"`／`"$S"` 變數組的 body，倒向擋會擋掉具名例外；所以降到「只認指令文字裡看得到客戶側狀態字」這一層，
 * 並以 additionalContext 告知 agent 這次沒判出值。擋不到的形狀見下方「已知缺口」。
 *
 * registry 讀不到（`CLADE_HOME` 與 `~/offline/clade` 都沒有 `registry/notion-hubs.json`、不是 JSON、沒有任何
 * done／archived 字）→ fail-closed 到上表右欄。理由：狀態字的唯一來源就是 registry（notion-hub skill Rule 4），
 * 讀不到 registry 的機器本來就組不出合規的狀態寫入，擋下不損失任何正當工作；反過來放行則等於整道守門
 * 在「有 ntn 但沒有 clade checkout」的機器上不存在。
 *
 * 放行標記：指令文字裡出現 `CLADE_NOTION_CUSTOMER_TRANSITION_OK=<page-id>[,<page-id>…]`，且被改的 page id
 * （字面 32 碼，連字號可有可無）在清單內 → 放行，並以 additionalContext 留一行稽核痕跡。值不是 page id
 * （`1`、`all`、`*`）或沒列到這張 → 照擋；page id 是變數時無從比對 → 照擋。
 * 它是 agent 的逐張自我聲明，不是 permit：不綁 session、不由 gate 外部保管，agent 照抄格式就過
 * （hook-authoring「授權由受檢對象自證」那一格，本 gate 明文不承諾）。它機械上保證的只有一件事：
 * 泛稱授權寫不出標記，agent 必須逐張把 page id 打出來——授權本身仍由規約要求（Charles 當輪逐張點名）。
 *
 * 繞行場景表：
 *
 *   | 繞法 | 預期攔截點 |
 *   | --- | --- |
 *   | 改用 Notion MCP `notion-update-page`、python／node 直打 API | 不攔（防漂移；notion-hub Rule 2 另禁 MCP） |
 *   | 自己打放行標記卻沒有逐張授權 | 不攔（標記是自我聲明，見上）；標記與 page id 會留在 transcript 供事後稽核 |
 *   | 標記寫 `=1`／`=all`，或列別張票的 id | 擋：值必須含被改的那張 page id |
 *   | 狀態字藏進變數、檔案由同一條指令產生、base64 | 指令文字出現獨立的 done／archived 字或 `ticketStatus` 取值才擋；其餘不攔，見已知缺口 |
 *   | 以 status option id 寫入 | 有 registry 時不攔（放行＋告知），見已知缺口 |
 *   | 弄壞判定（刪 helper、空 PATH、非 JSON stdin） | 外殼 fail-closed：任何帶寫入跡象的 page 指令都擋（E1–E6） |
 *   | 讓 registry 讀不到（改 `CLADE_HOME`） | 只讀行程 env 不認指令前綴；讀不到時 fail-closed |
 *   | 變形 page 路徑：重複斜線、fragment、dot segment、%xx、host 大小寫／port／尾點、`/V1/Pages/` | 擋：路徑往寬處正規化後判（`pagesPathId`），外殼快篩也收提到 pages／%xx 的 ntn／curl 指令 |
 *   | 引號／反斜線拆開 pages（`pa''ges`、`pag\es`、`p"a"ges`），body 走 `-d @file` | 擋：`words()` 去引號後照常判；外殼快篩先去掉引號與反斜線再比工具名（`c''url`、`n\tn`）與 pages |
 *   | curl 合併短選項（`-sX PATCH`、`-sd '{…}'`）、`-T`／`--upload-file` 當 body | 擋：逐字元掃短選項群；上傳檔照 `-d @file` 判 |
 *   | curl URL globbing（`/v1/[p-p]ages/<id>`、`/v1/{pages}/<id>`、host 也可 glob） | 沒帶 `-g`／`--globoff` 時含 `[` `]` `{` `}` 的 URL 一律當讀不出 id 的 page 路徑（判 body，放行標記比不到 id 照擋）；帶 `-g` 時照字面解析（`/v1/pages/<id>#{x}`、`?a=[1]` 仍是 page）；外殼快篩也收含 `[`／`]`／指令內 `{`（含 `{\p}ages` 這類跳脫）的 curl 指令 |
 *   | curl PATCH 的 body 走 `-K` 設定檔、`--expand-data` 等判不出的入口 | 退回指令文字（無 registry 擋） |
 *
 * 已知缺口（NEVER 宣稱全擋）：
 *   - body 的狀態值來自變數／命令替換／stdin，且指令文字裡沒有獨立出現的 done／archived 字與 `ticketStatus` 取值
 *     （例：`S=$(cat /tmp/s.txt)`、上一個 tool call 寫好的 shell 腳本、`jq` 動態 key）。
 *   - 以 status／select 的 option id 而不是 name 寫入。
 *   - page 路徑由 `$'…'`、變數或命令替換拼出（`pa$'g'es`、`/v1/$P/<id>`）：判定認不出 page 路徑。
 *   - `ntn api`／`curl` 以外的寫入路徑（MCP、SDK、腳本檔）。
 *   - 把票移進垃圾桶（`archived`／`in_trash: true`）不是狀態欄轉移，不在本 gate。
 *   - 判定只看 property 值的形狀、不看欄位名與所屬資料庫：非 hub 票的 page 若把 status／select 設成同一個字
 *     （例如 交付項目 的「完成」、個人待辦）也會被擋；確認不是客戶票後用放行標記逐張列 id。
 *
 * 錯誤分支表（判定故障；出口都在外殼 `.sh`，外殼自己決定 exit code）：
 *
 *   | #  | 錯誤分支 | 位置 | 行為 |
 *   | -- | --- | --- | --- |
 *   | E1 | `node` 不在 PATH | `.sh` | 保守檢查：payload 帶寫入跡象（PATCH／-d／--data／--json）exit 2；否則 exit 0＋additionalContext |
 *   | E2 | 判定檔（本檔）不在 `.sh` 同目錄 | `.sh` | 同 E1 |
 *   | E3 | stdin 不是 JSON | `run()` 回 3 | 外殼收到 3 → 同 E1 |
 *   | E4 | JSON 但無 `tool_input.command` 字串 | `run()` 回 0 | 非受檢對象，放行 |
 *   | E5 | 判定丟例外 | `run()` 回 3 | 同 E3 |
 *   | E6 | 判定行程非 0／2／3 退出（helper import 失敗、node 不支援型別剝除、被 signal 終止） | `.sh` | 同 E1 |
 *   | E7 | registry 讀不到 | 本檔 | 不是故障出口：照上方判定表右欄 fail-closed |
 *
 * 已知限制：hooks.json 的逾時到期時 Claude Code 直接砍掉 hook（non-blocking），外殼收不到也無從出口。
 *
 * Locked 面與三條路徑：
 *
 *   | 面 | 類別 |
 *   | --- | --- |
 *   | 本檔、`pre-bash-notion-ticket-status-gate.sh`、`gh-pr-create-work.ts`（切段 helper）、`test/notion-ticket-status-guard.test.ts` | Locked |
 *   | `registry/notion-hubs.json`（狀態字來源）、`rules/core/notion-work-coupling.md` | Locked |
 *   | `CLADE_NOTION_GATE_DEGRADED_OK`（判定故障期放行）、客戶在 Notion UI 推票 | Human-controlled |
 *
 *   - bootstrap：源檔在 clade 改，經 PR＋publish 散播；consumer 第一次裝上走 propagate 的 commit。
 *   - update：本檔／外殼／測試／registry 都走 clade PR；本 gate 只看 Bash 的 Notion 寫入，不擋對自己的編輯。
 *   - recovery：誤擋 → 逐張列 id 的放行標記（additionalContext 留痕），或把 body 改成判得出的形狀；
 *     判定故障 → 行程 env `CLADE_NOTION_GATE_DEGRADED_OK=1`（只在 E1–E6 生效，放行時 stderr＋additionalContext 各一行）；
 *     完全繞開本系統的外部路徑：客戶／Charles 在 Notion UI 親手改狀態。
 *
 *   | REQUIRED 欄位 | 內容 |
 *   | --- | --- |
 *   | 觸發條件 | Bash 的 `ntn api`／`curl` page PATCH 把 status／select 設成任一 hub 的 done／archived 字、且沒有含該 page id 的放行標記 → exit 2 擋下該次 tool call |
 *   | 消費端 | 正要寫 Notion 的 agent（stderr 指出狀態只到驗收中、`notion-sync.ts` 正路、逐張授權與標記形狀） |
 *   | 觸發點 | 工具事件 hook：`pre-bash-notion-ticket-status-gate.sh`（fleet PreToolUse:Bash）在 page PATCH 那一刻判定；訊息由 test/notion-ticket-status-guard.test.ts 釘住 |
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { segments, words } from './gh-pr-create-work.ts'

export const MARKER = 'CLADE_NOTION_CUSTOMER_TRANSITION_OK'

const CUSTOMER_STAGES = ['done', 'archived'] as const
const DATA_FLAGS = new Set([
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--json',
])
const METHOD_FLAGS = new Set(['-X', '--method', '--request'])
/** curl 以檔案內容當 body 的旗標（值同 `-d @file`） */
const UPLOAD_FLAGS = new Set(['-T', '--upload-file'])
/** curl 值判不出的 body 旗標（變數展開、urlencode） */
const OPAQUE_DATA_FLAGS = new Set(['--expand-data', '--data-urlencode'])
/** curl 帶參數的短選項（合併短選項時其後字元都是它的值）；X／d／T 另外處理 */
const CURL_ARG_SHORT = new Set('AbcCDeEFHKmoPQrtuUwxyYz')
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'eval'])
const MAX_DEPTH = 3

type Word = { text: string; dynamic: boolean }
type ReadFile = (path: string) => string

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export interface StatusWords {
  /** 客戶側狀態字 → 它在哪些 hub 是哪個階段（`fc:done`） */
  blocked: Map<string, string[]>
  /** 各 hub 的 acceptance 字（訊息用） */
  acceptance: string[]
}

/** registry 的客戶側狀態字；讀不到、不是 JSON 或一個字都沒有 → null（E7，呼叫端 fail-closed）。 */
export function loadStatusWords(
  env: Record<string, string | undefined>,
  read: ReadFile = (p) => readFileSync(p, 'utf8'),
): StatusWords | null {
  const roots = [env.CLADE_HOME, join(env.HOME || homedir(), 'offline/clade')]
  for (const root of roots) {
    if (!root) continue
    const file = join(root, 'registry/notion-hubs.json')
    if (!existsSync(file)) continue
    try {
      const raw: unknown = JSON.parse(read(file))
      if (!isRecord(raw) || !isRecord(raw.hubs)) return null
      const blocked = new Map<string, string[]>()
      const acceptance = new Set<string>()
      for (const [key, hub] of Object.entries(raw.hubs)) {
        if (!isRecord(hub) || !isRecord(hub.ticketStatus)) continue
        for (const stage of CUSTOMER_STAGES) {
          const word = hub.ticketStatus[stage]
          if (typeof word !== 'string' || !word.trim()) continue
          blocked.set(word, [...(blocked.get(word) ?? []), `${key}:${stage}`])
        }
        const acc = hub.ticketStatus.acceptance
        if (typeof acc === 'string' && acc.trim()) acceptance.add(acc)
      }
      return blocked.size ? { blocked, acceptance: [...acceptance] } : null
    } catch {
      return null
    }
  }
  return null
}

export interface Candidate {
  /** 字面 page id（去連字號、小寫）；變數或 placeholder → null */
  pageId: string | null
  bodies: Word[]
  inline: boolean
  /** curl PATCH 沒有任何認得的 body 旗標（body 可能走 -K 設定檔等看不到的入口） */
  hidden?: boolean
}

function normalizeId(raw: string): string | null {
  const id = raw.replaceAll('-', '').toLowerCase()
  return /^[0-9a-f]{32}$/u.test(id) ? id : null
}

/**
 * 路徑正規化後是不是 `v1/pages/<id>`：是 → 字面 page id（判不出是 null）；不是 → undefined。
 * 往寬處正規化（fail-closed）：解 %xx、收合重複斜線、解 `.`／`..`、大小寫不敏感——ntn 實測會收合斜線、
 * 丟 fragment／query、容許尾端斜線（`ntn api <path> --spec`），curl 會解 dot segment，伺服器可能解 %xx。
 */
function pagesPathId(path: string): string | null | undefined {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {}
  const segs: string[] = []
  for (const seg of decoded.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') segs.pop()
    else segs.push(seg)
  }
  if (segs.length !== 3 || segs[0].toLowerCase() !== 'v1' || segs[1].toLowerCase() !== 'pages')
    return undefined
  return normalizeId(segs[2])
}

/** `ntn api` 的 PATH 引數 → page id（見 pagesPathId）；也收 `https://api.notion.com` 前綴的寫法。 */
function ntnPageId(text: string): string | null | undefined {
  let path = text.trim().replace(/[?#].*$/su, '')
  const origin = /^https?:\/\/[^/]*/iu.exec(path)
  if (origin) {
    if (notionHost(`${origin[0]}/`) !== true) return undefined
    path = path.slice(origin[0].length)
  }
  return pagesPathId(path)
}

/** URL 的 host 是不是 api.notion.com（大小寫、FQDN 尾點、port、userinfo 都不影響）；解析不了 → null。 */
function notionHost(url: string): boolean | null {
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(url) ? url : `https://${url}`)
    return u.hostname.toLowerCase().replace(/\.$/u, '') === 'api.notion.com'
  } catch {
    return null
  }
}

/** curl 的 URL 引數 → page id（WHATWG URL 解析：fragment 不送出、dot segment 由 curl 收合）。 */
function curlPageId(text: string): string | null | undefined {
  if (!/notion/iu.test(text) || notionHost(text) !== true) return undefined
  const t = text.trim()
  const u = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(t) ? t : `https://${t}`)
  return pagesPathId(u.pathname)
}

/**
 * curl URL globbing（沒帶 `-g`／`--globoff`）：`[a-z]`／`{a,b}` 由 curl 展開後才送出，
 * `[p-p]ages`、`{pages}`、`api.no{t}ion.com` 都會變成 page 路徑，展開前判不出 host 與 id → fail-closed。
 * 只認像 URL 的字（無空白、有 scheme 或 `/`），header 值等不算。
 */
function curlGlob(text: string): boolean {
  const t = text.trim()
  return /[[\]{}]/u.test(t) && !/\s/u.test(t) && /^[a-z][a-z\d+.-]*:\/\/|\//iu.test(t)
}

/** 這段文字可能含 page 路徑（遞迴進 `$( )`／`bash -c` 的條件；%xx 編碼一律算） */
function mentionsPages(text: string): boolean {
  return /pages|%/iu.test(text)
}

/** `$( … )` 的內文（括號配對） */
function substitutions(text: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const start = text.indexOf('$(', from)
    if (start === -1) return out
    let depth = 1
    let i = start + 2
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
    }
    out.push(text.slice(start + 2, depth === 0 ? i - 1 : i))
    from = i
  }
}

function head(text: string): string {
  const bare = text.replace(/^(?:[A-Za-z_]\w*=)?[$(`{!]*/u, '')
  return bare.slice(bare.lastIndexOf('/') + 1)
}

/** 指令裡對 `/v1/pages/<id>` 的寫入（ntn api：PATCH 或由 body 推斷；curl：PATCH）。沒帶 body 的是讀取，不列。 */
export function candidates(cmd: string, depth = 0): Candidate[] {
  const out: Candidate[] = []
  for (const seg of segments(cmd)) {
    const ws: Word[] = words(seg)
    let tool: 'ntn' | 'curl' | null = null
    let start = 0
    let shell = false
    for (let i = 0; i < ws.length; i++) {
      const h = head(ws[i].text)
      if (SHELLS.has(h)) shell = true
      if (h === 'ntn' && ws[i + 1]?.text === 'api') {
        tool = 'ntn'
        start = i + 2
        break
      }
      if (h === 'curl') {
        tool = 'curl'
        start = i + 1
        break
      }
    }
    if (depth < MAX_DEPTH) {
      for (const w of ws) {
        if (!mentionsPages(w.text)) continue
        const inner = substitutions(w.text)
        if (shell && /\s/u.test(w.text)) inner.push(w.text)
        for (const text of inner) out.push(...candidates(text, depth + 1))
      }
    }
    if (!tool) continue

    let method: string | undefined
    let pathId: string | null | undefined
    const bodies: Word[] = []
    let inline = false
    /** curl 帶 `-g`／`--globoff`：URL 的 `[]{}` 照字面送出，不 glob */
    let globoff = false
    /** curl 帶 glob 字元的 URL 字；`-g` 可能在 URL 之後，迴圈結束才定案（glob → id 判不出；-g → 照字面解析） */
    const globbed: string[] = []
    for (let j = start; j < ws.length; j++) {
      const w = ws[j]
      const t = w.text.replace(/[)`]+$/u, '')
      if (METHOD_FLAGS.has(t)) {
        method = ws[++j]?.text
        continue
      }
      const methodEq = /^(?:--method|--request)=(.+)$/u.exec(t)
      if (methodEq) {
        method = methodEq[1]
        continue
      }
      if (/^-X.+/u.test(t)) {
        method = t.slice(2)
        continue
      }
      if (DATA_FLAGS.has(t)) {
        bodies.push(ws[++j] ?? { text: '', dynamic: true })
        continue
      }
      if (tool === 'curl' && UPLOAD_FLAGS.has(t)) {
        const file = ws[++j]
        bodies.push(
          file ? { text: `@${file.text}`, dynamic: file.dynamic } : { text: '', dynamic: true },
        )
        continue
      }
      if (tool === 'curl' && OPAQUE_DATA_FLAGS.has(t)) {
        j++
        bodies.push({ text: '', dynamic: true })
        continue
      }
      if (tool === 'curl' && (t === '-g' || t === '--globoff')) {
        globoff = true
        continue
      }
      if (tool === 'curl' && /^-[^-]{2,}/su.test(w.text)) {
        // 合併短選項（-sX PATCH、-sSXPATCH、-sd '{…}'）：逐字元掃，遇到帶參數的選項，其後字元（或下一個字）就是它的值
        const text = w.text
        for (let k = 1; k < text.length; k++) {
          const c = text[k]
          const rest = text.slice(k + 1)
          if (c === 'g') globoff = true
          if (c === 'X') {
            method = rest || ws[++j]?.text
            break
          }
          if (c === 'd' || c === 'T') {
            const value = rest ? { text: rest, dynamic: w.dynamic } : ws[++j]
            const prefix = c === 'T' ? '@' : ''
            bodies.push(
              value
                ? { text: `${prefix}${value.text}`, dynamic: value.dynamic }
                : { text: '', dynamic: true },
            )
            break
          }
          if (CURL_ARG_SHORT.has(c)) break
        }
        continue
      }
      const dataEq = /^(?:--data(?:-raw|-binary|-ascii)?|--json)=(.*)$/su.exec(w.text)
      if (dataEq) {
        bodies.push({ text: dataEq[1], dynamic: w.dynamic })
        continue
      }
      if (/^-d.+/su.test(w.text) && !w.text.startsWith('--')) {
        bodies.push({ text: w.text.slice(2), dynamic: w.dynamic })
        continue
      }
      if (pathId === undefined) {
        if (tool === 'curl' && curlGlob(t)) {
          globbed.push(t)
          continue
        }
        const id = tool === 'ntn' ? ntnPageId(t) : curlPageId(t)
        if (id !== undefined) {
          pathId = id
          continue
        }
      }
      if (tool === 'ntn' && pathId !== undefined && !t.startsWith('-') && /^[^=\s<>]+=/u.test(t))
        inline = true
    }
    if (pathId === undefined && globbed.length) {
      if (!globoff) pathId = null
      else
        for (const t of globbed) {
          pathId = curlPageId(t)
          if (pathId !== undefined) break
        }
    }
    if (pathId === undefined) continue
    const m = method?.replace(/[)`'"]+$/u, '').toUpperCase()
    if (tool === 'curl' ? m !== 'PATCH' : m !== undefined && m !== 'PATCH') continue
    if (tool === 'curl' && !bodies.length) {
      out.push({ pageId: pathId, bodies, inline, hidden: true })
      continue
    }
    if (!bodies.length && !inline) continue
    out.push({ pageId: pathId, bodies, inline })
  }
  return out
}

function statusSets(body: unknown): { names: string[]; byId: boolean } | null {
  if (!isRecord(body)) return null
  if (body.properties === undefined) return { names: [], byId: false }
  if (!isRecord(body.properties)) return null
  const names: string[] = []
  let byId = false
  for (const value of Object.values(body.properties)) {
    if (!isRecord(value)) continue
    for (const key of ['status', 'select']) {
      const option = value[key]
      if (!isRecord(option)) continue
      if (typeof option.name === 'string') names.push(option.name)
      else if ('id' in option) byId = true
    }
  }
  return { names, byId }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return JSON.parse(text.replace(/[)`\s]+$/u, ''))
  }
}

/** 指令文字裡看得到的客戶側狀態字：獨立出現的 done／archived 字，或 `ticketStatus.done`／`["archived"]` 取值。 */
export function textHit(cmd: string, sw: StatusWords): string | null {
  for (const word of sw.blocked.keys()) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    if (new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').test(cmd)) return word
  }
  const lookup = /ticketStatus\s*(?:\.\s*|\[\s*\\?["']?)(done|archived)\b/u.exec(cmd)
  return lookup ? `ticketStatus.${lookup[1]}` : null
}

export type Verdict =
  | { kind: 'pass' }
  | { kind: 'hit'; word: string; via: 'body' | 'text' | 'no-registry' }
  | { kind: 'unknown'; why: string }

export function judgeCandidate(
  c: Candidate,
  cmd: string,
  sw: StatusWords | null,
  cwd: string,
  read: ReadFile,
): Verdict {
  let unknown: string | null = c.inline
    ? 'body 用 ntn inline 欄位組出'
    : c.hidden
      ? 'curl PATCH 沒有認得的 body 旗標（-K 設定檔等入口）'
      : null
  let byId = false
  for (const b of c.bodies) {
    let text: string
    if (b.text.startsWith('@')) {
      const name = b.text.slice(1)
      if (name === '-') {
        unknown = 'body 來自 stdin／heredoc'
        continue
      }
      if (b.dynamic) {
        unknown = 'body 檔名含變數'
        continue
      }
      try {
        text = read(isAbsolute(name) ? name : resolve(cwd, name))
      } catch {
        unknown = `body 檔 ${name} 讀不到`
        continue
      }
    } else if (b.dynamic) {
      unknown = 'body 含變數或命令替換'
      continue
    } else text = b.text
    let sets: ReturnType<typeof statusSets>
    try {
      sets = statusSets(parseJson(text))
    } catch {
      sets = null
    }
    if (!sets) {
      unknown = 'body 不是可解析的 JSON 物件'
      continue
    }
    if (!sw) {
      if (sets.names.length || sets.byId)
        return { kind: 'hit', word: sets.names[0] ?? '(option id)', via: 'no-registry' }
      continue
    }
    const word = sets.names.find((n) => sw.blocked.has(n))
    if (word) return { kind: 'hit', word, via: 'body' }
    if (sets.byId) byId = true
  }
  if (unknown) {
    if (!sw) return { kind: 'hit', word: '(判不出)', via: 'no-registry' }
    const word = textHit(cmd, sw)
    return word ? { kind: 'hit', word, via: 'text' } : { kind: 'unknown', why: unknown }
  }
  return byId ? { kind: 'unknown', why: '狀態以 option id 指定' } : { kind: 'pass' }
}

/** 放行標記列出的 page id（去連字號、小寫）；值不是 page id 的一律不算。 */
export function markerIds(cmd: string): Set<string> {
  const ids = new Set<string>()
  for (const m of cmd.matchAll(new RegExp(`${MARKER}=["']?([0-9A-Za-z,*-]+)`, 'gu')))
    for (const part of m[1].split(',')) {
      const id = normalizeId(part)
      if (id) ids.add(id)
    }
  return ids
}

export function denyMessage(
  c: Candidate,
  v: Extract<Verdict, { kind: 'hit' }>,
  sw: StatusWords | null,
): string {
  const page = c.pageId ?? '（page id 是變數，判不出是哪一張）'
  const lines: string[] = []
  if (v.via === 'no-registry') {
    lines.push(
      `⛔ Notion 票狀態守門：讀不到 registry/notion-hubs.json，無從分辨這次對 page ${page} 的狀態寫入（${v.word}）是不是客戶側狀態，一律擋下。`,
      '修法：在啟動 Claude Code 的環境把 CLADE_HOME 指到 clade checkout（或確認 ~/offline/clade 存在）；狀態字本來就只能從 registry 取。',
    )
  } else {
    const stages = sw?.blocked.get(v.word)?.join('、')
    lines.push(
      v.via === 'body'
        ? `⛔ Notion 票狀態守門：這次 PATCH 會把 page ${page} 的狀態設成「${v.word}」（客戶側狀態：${stages}）。`
        : `⛔ Notion 票狀態守門：這次對 page ${page} 的 PATCH 判不出 body 的狀態值，而指令文字裡出現客戶側狀態「${v.word}」。`,
    )
    if (v.via === 'text')
      lines.push(
        '不是要寫成那個狀態（只是文字裡提到）→ 把 body 寫成字面 JSON 或落檔後用 -d @<file>，判定就讀得到實際值。',
      )
  }
  const acc = sw?.acceptance.length ? `「${sw.acceptance.join('／')}」` : ' acceptance '
  lines.push(
    `機器最遠只能把票推到${acc}；acceptance → done、done → archived 是客戶側轉移。「內容已消化進規格書／雛形」對應的也是${acc}，不是完成。`,
    '正路：狀態轉移走 notion-sync.ts（release／follow／done，帶授權轉移表）；客戶驗收後跑 notion-sync.ts reconcile 對帳。',
    `確有 Charles 當輪逐張點名票號的授權時：在同一條指令加 ${MARKER}=<page-id>[,<page-id>…]，逐張列出被改的 page id（字面值）。`,
    '泛稱的「可以標完成」「處理完就結案」不算授權；標記值寫 1／all、或沒列到這張 page，照擋。',
    '判準全文：notion-work-coupling 規約 § 與「對外輸出需 user 授權」的關係。',
  )
  return lines.join('\n')
}

function context(text: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
  })
}

export interface Result {
  /** 0 放行、2 擋、3 判定讀不懂輸入或途中出錯（外殼走保守檢查） */
  code: 0 | 2 | 3
  /** code 2：deny 訊息（外殼轉 stderr）；code 0：additionalContext JSON 或空字串 */
  out: string
}

export function judge(
  cmd: string,
  cwd: string,
  env: Record<string, string | undefined>,
  read: ReadFile = (p) => readFileSync(p, 'utf8'),
): Result {
  const found = candidates(cmd)
  if (!found.length) return { code: 0, out: '' }
  const sw = loadStatusWords(env, read)
  const allowed = markerIds(cmd)
  const notes: string[] = []
  for (const c of found) {
    const v = judgeCandidate(c, cmd, sw, cwd, read)
    if (v.kind === 'pass') continue
    if (v.kind === 'unknown') {
      notes.push(
        `Notion 票狀態守門：這次 page PATCH 判不出狀態值（${v.why}），已放行。狀態最遠只能到 acceptance；done／archived 是客戶側轉移，需 Charles 當輪逐張點名票號。`,
      )
      continue
    }
    if (c.pageId && allowed.has(c.pageId)) {
      notes.push(
        `Notion 票狀態守門：以逐張放行標記放行 page ${c.pageId} → ${v.word}（${MARKER}；agent 聲明已有 Charles 當輪逐張授權）。`,
      )
      continue
    }
    return { code: 2, out: denyMessage(c, v, sw) }
  }
  return { code: 0, out: notes.length ? context([...new Set(notes)].join('\n')) : '' }
}

export function run(input: string, env: Record<string, string | undefined>): Result {
  let payload: unknown
  try {
    payload = JSON.parse(input)
  } catch {
    return { code: 3, out: '' }
  }
  const toolInput = isRecord(payload) ? payload.tool_input : undefined
  const cmd = isRecord(toolInput) ? toolInput.command : undefined
  if (typeof cmd !== 'string') return { code: 0, out: '' }
  const cwd = isRecord(payload) && typeof payload.cwd === 'string' ? payload.cwd : process.cwd()
  try {
    return judge(cmd, cwd, env)
  } catch {
    return { code: 3, out: '' }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = ''
  try {
    input = readFileSync(0, 'utf8')
  } catch {
    process.exit(3)
  }
  const result = run(input, process.env)
  if (result.out) process.stdout.write(`${result.out}\n`)
  process.exit(result.code)
}
