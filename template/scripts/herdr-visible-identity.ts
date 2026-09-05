#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/herdr-visible-identity.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/herdr-visible-identity.ts

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { isRecord } from './lib/json-unknown.ts'

/** Daily work uses one server. A caller's pane ID has meaning only on that server. */
export function defaultHerdrSocket(): string {
  return join(homedir(), '.config', 'herdr', 'herdr.sock')
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

export function assertDefaultHerdrCaller(env: NodeJS.ProcessEnv = process.env): void {
  if (env.HERDR_ENV !== '1') return
  if (
    !env.HERDR_SOCKET_PATH ||
    canonical(env.HERDR_SOCKET_PATH) !== canonical(defaultHerdrSocket())
  ) {
    throw new Error(
      'Herdr 工作入口要求 default session；目前 caller socket 不屬於 default，未使用其 pane ID。',
    )
  }
}

export function taskLabelProblem(raw: string | undefined, cwd = process.cwd()): string | null {
  const label = taskName(raw ?? '')
  if (!label) return '需要任務名稱，例如「修復登入失敗」'
  if (
    label.startsWith('-') ||
    [...label].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return '任務名稱含非法字元'
  if ([...label].length > 48) return '任務名稱最多 48 字'
  if (/^\[?w[\da-z]+(?::[pt][\da-z-]+)?\]?$/iu.test(label) || /^\d+$/u.test(label)) {
    return 'pane／Tab ID 不能當作任務名稱'
  }
  const task = label
  if (
    task.toLowerCase() === basename(resolve(cwd)).toLowerCase() ||
    /^(?:default|new[ -]?(?:tab|pane)|terminal|shell|zsh|bash|claude|codex|pi|gemini)$/iu.test(task)
  )
    return '需要描述工作內容，不能只用目錄名或工具名'
  return null
}

export function taskName(label: string): string {
  return label
    .trim()
    .replace(/^\[w[\da-z-]+:p[\da-z-]+\]\s*/iu, '')
    .trim()
}

/** Keep the exact pane ID visible beside the task, including when resuming a named pane. */
export function paneTaskLabel(paneId: string, label: string): string {
  return `[${paneId}] ${taskName(label)}`
}

export type HerdrRequest = (args: string[]) => unknown

function entity(response: unknown, kind: 'pane' | 'tab'): Record<string, unknown> {
  if (!isRecord(response) || !isRecord(response.result) || !isRecord(response.result[kind])) {
    throw new Error(`Herdr ${kind} 回讀缺少實體`)
  }
  return response.result[kind]
}

export function readPane(request: HerdrRequest, paneId: string): Record<string, unknown> {
  const pane = entity(request(['pane', 'get', paneId]), 'pane')
  if (pane.pane_id !== paneId || typeof pane.tab_id !== 'string') {
    throw new Error('Herdr pane 身分或所屬 Tab 回讀不符')
  }
  return pane
}

export type VisibleIdentity = {
  pane_id: string
  tab_id: string
  pane_label: string
  tab_label: string
  verified_at: string
  session: 'default'
}

/** Name only a newly owned Tab; an existing shared Tab keeps its verified main-task name. */
function* identitySteps(options: {
  paneId: string
  label: string
  cwd: string
  tabId?: string
  nameTab: boolean
}): Generator<string[], VisibleIdentity, unknown> {
  const problem = taskLabelProblem(options.label, options.cwd)
  if (problem) throw new Error(problem)
  const pane = entity(yield ['pane', 'get', options.paneId], 'pane')
  if (pane.pane_id !== options.paneId || typeof pane.tab_id !== 'string')
    throw new Error('Herdr pane 身分或所屬 Tab 回讀不符')
  const tabId = pane.tab_id
  if (options.tabId && options.tabId !== tabId)
    throw new Error('Herdr pane 已移至其他 Tab，停止啟動')
  const tab = entity(yield ['tab', 'get', tabId], 'tab')
  if (tab.tab_id !== tabId) throw new Error('Herdr Tab 身分回讀不符')
  const paneLabel = paneTaskLabel(options.paneId, options.label)
  const tabLabel = options.nameTab ? paneLabel : tab.label
  if (
    typeof tabLabel !== 'string' ||
    taskLabelProblem(tabLabel, options.cwd) ||
    !/^\[w[\da-z-]+:p[\da-z-]+\] /iu.test(tabLabel)
  ) {
    throw new Error('共用 Tab 缺少 ID 與任務名稱；先命名主工作 Tab，再啟動 child')
  }
  if (options.nameTab) yield ['tab', 'rename', tabId, tabLabel]
  yield ['pane', 'rename', options.paneId, paneLabel]
  const observedPane = entity(yield ['pane', 'get', options.paneId], 'pane')
  const observedTab = entity(yield ['tab', 'get', tabId], 'tab')
  if (
    observedPane.pane_id !== options.paneId ||
    observedPane.tab_id !== tabId ||
    observedPane.label !== paneLabel ||
    observedTab.tab_id !== tabId ||
    observedTab.label !== tabLabel
  )
    throw new Error('Herdr 任務名稱回讀不符；未啟動 agent')
  return {
    pane_id: options.paneId,
    tab_id: tabId,
    pane_label: paneLabel,
    tab_label: tabLabel,
    verified_at: new Date().toISOString(),
    session: 'default',
  }
}

export function verifyVisibleIdentity(
  request: HerdrRequest,
  options: Parameters<typeof identitySteps>[0],
): VisibleIdentity {
  const steps = identitySteps(options)
  let step = steps.next()
  while (step.done === false) step = steps.next(request(step.value))
  return step.value
}

export async function verifyVisibleIdentityAsync(
  request: (args: string[]) => Promise<unknown>,
  options: Parameters<typeof identitySteps>[0],
): Promise<VisibleIdentity> {
  const steps = identitySteps(options)
  let step = steps.next()
  while (step.done === false) step = steps.next(await request(step.value))
  return step.value
}

export function requestDefaultHerdr(args: string[]): unknown {
  const result = spawnSync('herdr', ['--session', 'default', ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Herdr 命令失敗')
  return JSON.parse(result.stdout)
}

export function auditVisibleWork(request: HerdrRequest): Record<string, unknown>[] {
  const response = request(['workspace', 'list'])
  if (
    !isRecord(response) ||
    !isRecord(response.result) ||
    !Array.isArray(response.result.workspaces)
  ) {
    throw new Error('Herdr workspace 清單無法回讀')
  }
  const rows: Record<string, unknown>[] = []
  for (const workspace of response.result.workspaces) {
    if (!isRecord(workspace) || typeof workspace.workspace_id !== 'string')
      throw new Error('Herdr workspace 缺少 ID')
    const listed = request(['pane', 'list', '--workspace', workspace.workspace_id])
    if (!isRecord(listed) || !isRecord(listed.result) || !Array.isArray(listed.result.panes))
      throw new Error('Herdr pane 清單無法回讀')
    for (const pane of listed.result.panes) {
      if (!isRecord(pane) || !pane.agent) continue
      if (typeof pane.pane_id !== 'string' || typeof pane.tab_id !== 'string')
        throw new Error('Herdr agent 缺少 pane／Tab ID')
      const tab = entity(request(['tab', 'get', pane.tab_id]), 'tab')
      const cwd = typeof pane.cwd === 'string' ? pane.cwd : ''
      const issues = [
        taskLabelProblem(typeof pane.label === 'string' ? pane.label : '', cwd)
          ? 'pane 未具名'
          : '',
        taskLabelProblem(typeof tab.label === 'string' ? tab.label : '', cwd) ? 'Tab 未具名' : '',
        typeof pane.label === 'string' && pane.label === paneTaskLabel(pane.pane_id, pane.label)
          ? ''
          : 'pane ID 前綴缺少或不符',
        typeof tab.label === 'string' && /^\[w[\da-z-]+:p[\da-z-]+\] /iu.test(tab.label)
          ? ''
          : 'Tab 缺少主工作 ID 前綴',
      ].filter(Boolean)
      rows.push({
        workspace: workspace.label,
        pane_id: pane.pane_id,
        tab_id: pane.tab_id,
        pane_label: pane.label,
        tab_label: tab.label,
        issues,
      })
    }
  }
  return rows
}

/** Synchronous launcher admission: argv is never inspected or rewritten (including resume). */
export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      label: { type: 'string' },
      pane: { type: 'string' },
      'new-tab': { type: 'boolean' },
      audit: { type: 'boolean' },
    },
    strict: true,
  })
  if (values.audit) {
    const rows = auditVisibleWork(requestDefaultHerdr)
    process.stdout.write(`${JSON.stringify({ session: 'default', rows }, null, 2)}\n`)
    if (rows.some((row) => Array.isArray(row.issues) && row.issues.length)) process.exitCode = 1
    return
  }
  if (process.env.HERDR_ENV !== '1' && !values.pane) return
  assertDefaultHerdrCaller()
  const paneId = values.pane ?? process.env.HERDR_PANE_ID
  if (!paneId) throw new Error('Herdr caller 缺少 pane ID，停止啟動')
  const pane = readPane(requestDefaultHerdr, paneId)
  let label =
    values.label ??
    process.env.HERDR_TASK_LABEL ??
    (typeof pane.label === 'string' ? pane.label : '')
  if (taskLabelProblem(label)) {
    if (!process.stdin.isTTY) throw new Error('未命名工作：啟動前設定 HERDR_TASK_LABEL 為任務名稱')
    const input = createInterface({ input: process.stdin, output: process.stderr })
    try {
      label = (await input.question('這個工作叫什麼？（例如：修復登入失敗） ')).trim()
    } finally {
      input.close()
    }
  }
  const tabId = pane.tab_id as string
  const tab = entity(requestDefaultHerdr(['tab', 'get', tabId]), 'tab')
  const singlePane = tab.pane_count === 1
  const evidence = verifyVisibleIdentity(requestDefaultHerdr, {
    paneId,
    tabId,
    label,
    cwd: process.cwd(),
    nameTab: values['new-tab'] || singlePane,
  })
  process.stderr.write(
    `Herdr default → ${evidence.tab_label}${evidence.tab_label === evidence.pane_label ? '' : ` → ${evidence.pane_label}`}\n`,
  )
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
