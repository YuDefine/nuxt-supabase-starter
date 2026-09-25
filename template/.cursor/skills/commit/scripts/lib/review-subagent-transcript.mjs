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
//
// verdict 取自 transcript 本身，NEVER 由主線轉交：主線是受審改動的 producer，
// 讓它經手 verdict 文字就等於讓 maker 替 reviewer 交卷。
//
// 用法：node review-subagent-transcript.mjs --subagents-dir <dir> --nonce <n>
//         --prompt <prepare 寫的 prompt 檔> --brief <path> --model <requested> --effort medium --agent-type <type> --verdict-out <path>
// stdout 印一份 JSON 結論；exit 0 verified／3 沒跑成或不完整／6 prompt 被改或用了寫入型工具／
// 8 身分不成立／2 用法錯誤。

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const READONLY_TOOLS = new Set(['Read', 'Grep', 'Glob'])

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

/** 第一則之後的非空 user 文字＝主線續派時補進去的指示（含包進 system-reminder 標籤的）。 */
export function laterUserTexts(entries) {
  return entries
    .filter((e) => e.type === 'user' && e.message)
    .slice(1)
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
  for (const e of entries) {
    if (e.type !== 'assistant') continue
    for (const c of contentBlocks(e.message))
      if (c.type === 'tool_use' && c.name === 'Read' && c.input?.file_path === briefPath)
        reads.set(c.id, c.input)
  }
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
      for (const line of text.split('\n')) {
        const m = /^\s*(\d+)\t/.exec(line)
        if (!m) continue
        // 只收從 offset 起連號的行：內容裡碰巧長得像「數字＋tab」的行不會被誤算成已讀。
        if (Number(m[1]) !== expected) continue
        seen.add(expected)
        expected += 1
      }
    }
  }
  return seen
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
  if (meta.agentType !== agentType)
    return {
      ...result,
      exit: 8,
      failed_check: 'agent_type',
      reason: `subagent_type 是 ${meta.agentType ?? '（meta.json 缺席）'}，不是 ${agentType}——只有 ${agentType} 的工具面是唯讀，其他 type 的輸出不是 0-A reviewer 的輸出`,
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
    for (const c of contentBlocks(e.message)) if (c.type === 'tool_use') tools.add(c.name)
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

  const writeTools = [...tools].filter((t) => !READONLY_TOOLS.has(t))
  result.tools_used = [...tools]
  if (writeTools.length > 0)
    return {
      ...result,
      exit: 6,
      reason: `reviewer 用了唯讀集合以外的工具：${writeTools.join(', ')}——verdict 扣住`,
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
      'agent-type': { type: 'string' },
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
  if (values.effort !== 'medium') {
    process.stdout.write(
      `${JSON.stringify({ exit: 2, reason: 'commit 0-A 只接受 medium effort' })}\n`,
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

if (import.meta.url === `file://${process.argv[1]}`) main()
