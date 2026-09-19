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

export type VisiblePane = {
  pane_id: string
  tab_id: string
  workspace_id: string
  label: string
  cwd: string
  agent: string | null
}
export type VisibleTab = { tab_id: string; workspace_id: string; label: string; pane_count: number }
export type VisibleSnapshot = {
  panes: VisiblePane[]
  tabs: VisibleTab[]
  /** Top-left first; the fallback when a Tab label names no live pane. */
  paneOrder: Record<string, string[]>
}
/** What the reconciler last wrote, so a later difference says which side a person changed. */
export type VisibleState = {
  tabs: Record<string, { pane_id: string; tab_label: string; pane_label: string }>
}
export type VisibleChange = {
  kind: 'pane' | 'tab'
  id: string
  from: string
  to: string
  reason: string
}
export type VisibleFinding = {
  kind: 'pane' | 'tab'
  id: string
  tab_id: string
  label: string
  expected: string
  issue: 'misleading' | 'incomplete'
  detail: string
}

const ID_PREFIX = /^\[(w[\da-z-]+:p[\da-z-]+)\]\s*/iu

export function labelPaneId(label: string): string | undefined {
  return ID_PREFIX.exec(label.trim())?.[1]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function paneNumber(paneId: string): number {
  const suffix = paneId.split(':p')[1] ?? ''
  return suffix ? Number.parseInt(suffix, 36) : Number.POSITIVE_INFINITY
}

/** One `api snapshot` read: every pane, Tab and layout of the default session. */
export function readVisibleSnapshot(request: HerdrRequest): VisibleSnapshot {
  const response = request(['api', 'snapshot'])
  const snapshot =
    isRecord(response) && isRecord(response.result) && isRecord(response.result.snapshot)
      ? response.result.snapshot
      : undefined
  if (!snapshot || !Array.isArray(snapshot.panes) || !Array.isArray(snapshot.tabs))
    throw new Error('Herdr snapshot 無法回讀')
  const panes = snapshot.panes.filter(isRecord).map((pane) => ({
    pane_id: text(pane.pane_id),
    tab_id: text(pane.tab_id),
    workspace_id: text(pane.workspace_id),
    label: text(pane.label),
    cwd: text(pane.cwd),
    agent: typeof pane.agent === 'string' ? pane.agent : null,
  }))
  const tabs = snapshot.tabs.filter(isRecord).map((tab) => ({
    tab_id: text(tab.tab_id),
    workspace_id: text(tab.workspace_id),
    label: text(tab.label),
    pane_count: typeof tab.pane_count === 'number' ? tab.pane_count : 0,
  }))
  if (panes.some((pane) => !pane.pane_id || !pane.tab_id) || tabs.some((tab) => !tab.tab_id))
    throw new Error('Herdr snapshot 缺少 pane／Tab ID')
  const paneOrder: Record<string, string[]> = {}
  for (const layout of Array.isArray(snapshot.layouts) ? snapshot.layouts.filter(isRecord) : []) {
    const rects = (Array.isArray(layout.panes) ? layout.panes.filter(isRecord) : []).map((pane) => {
      const rect = isRecord(pane.rect) ? pane.rect : {}
      return {
        id: text(pane.pane_id),
        y: typeof rect.y === 'number' ? rect.y : 0,
        x: typeof rect.x === 'number' ? rect.x : 0,
      }
    })
    paneOrder[text(layout.tab_id)] = rects
      .toSorted((left, right) => left.y - right.y || left.x - right.x)
      .map((rect) => rect.id)
  }
  return { panes, tabs, paneOrder }
}

/**
 * The Tab's primary pane: the one its label already names while that pane still lives in the Tab
 * (sticky, so a split never steals the name), else the top-left pane, else the oldest ID.
 */
export function primaryPane(snapshot: VisibleSnapshot, tab: VisibleTab): VisiblePane | undefined {
  const members = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id)
  const named = labelPaneId(tab.label)
  const sticky = members.find((pane) => pane.pane_id === named)
  if (sticky) return sticky
  for (const id of snapshot.paneOrder[tab.tab_id] ?? []) {
    const pane = members.find((member) => member.pane_id === id)
    if (pane) return pane
  }
  return members.toSorted((left, right) => paneNumber(left.pane_id) - paneNumber(right.pane_id))[0]
}

function validTask(label: string, cwd: string): string | undefined {
  const task = taskName(label)
  return taskLabelProblem(task, cwd) ? undefined : task
}

/**
 * Misleading = the label states an ID or a task that Herdr contradicts. A missing prefix or a
 * missing name hides information but asserts nothing false, so it is only incomplete.
 */
function contradiction(label: string, expected: string, cwd: string): VisibleFinding['issue'] {
  const statedId = labelPaneId(label)
  if (statedId && statedId !== labelPaneId(expected)) return 'misleading'
  const statedTask = validTask(label, cwd)
  return statedTask && statedTask !== taskName(expected) ? 'misleading' : 'incomplete'
}

function unnamedLabel(pane: VisiblePane): string {
  return `[${pane.pane_id}] ${basename(pane.cwd) || 'shell'}`
}

/**
 * The single naming invariant:
 *   pane label = `[own pane id] task` (task = cwd basename while unnamed)
 *   Tab label  = its primary pane's label
 * A Tab label that names a pane no longer in the Tab describes closed work and is never carried
 * over. When Tab and primary pane disagree on a real task, the side that changed since the last
 * reconcile wins; with no record, the Tab wins because the Tab bar is what people rename.
 */
export function planVisibleIdentity(
  snapshot: VisibleSnapshot,
  state: VisibleState = { tabs: {} },
  scope: { workspaceIds?: string[] } = {},
): { changes: VisibleChange[]; findings: VisibleFinding[] } {
  const inScope = (workspaceId: string) =>
    !scope.workspaceIds || scope.workspaceIds.includes(workspaceId)
  const changes: VisibleChange[] = []
  const findings: VisibleFinding[] = []
  const desiredPane = new Map<string, { label: string; reason: string }>()

  for (const tab of snapshot.tabs) {
    if (!inScope(tab.workspace_id)) continue
    const primary = primaryPane(snapshot, tab)
    if (!primary) continue
    const tabPaneId = labelPaneId(tab.label)
    const tabIsStale = Boolean(tabPaneId && tabPaneId !== primary.pane_id)
    const tabTask = tabIsStale ? undefined : validTask(tab.label, primary.cwd)
    const paneTask = validTask(primary.label, primary.cwd)
    const last = state.tabs[tab.tab_id]
    let task: string | undefined
    let reason: string
    if (tabTask && paneTask && tabTask !== paneTask) {
      const paneChanged =
        last?.pane_id === primary.pane_id &&
        last.tab_label === tab.label &&
        last.pane_label !== primary.label
      task = paneChanged ? paneTask : tabTask
      reason = paneChanged ? 'pane 任務名稱較新，同步到 Tab' : 'Tab 任務名稱較新，同步到 pane'
    } else {
      task = paneTask ?? tabTask
      reason = tabIsStale
        ? `Tab 名稱指向已不在此 Tab 的 ${tabPaneId}`
        : paneTask
          ? 'Tab 名稱跟隨主 pane'
          : 'pane 名稱跟隨 Tab 任務'
    }
    const label = task ? `[${primary.pane_id}] ${task}` : unnamedLabel(primary)
    desiredPane.set(primary.pane_id, { label, reason })
    if (tab.label !== label) {
      changes.push({ kind: 'tab', id: tab.tab_id, from: tab.label, to: label, reason })
      findings.push({
        kind: 'tab',
        id: tab.tab_id,
        tab_id: tab.tab_id,
        label: tab.label,
        expected: label,
        issue: contradiction(tab.label, label, primary.cwd),
        detail: reason,
      })
    }
  }

  for (const pane of snapshot.panes) {
    if (!inScope(pane.workspace_id)) continue
    const task = validTask(pane.label, pane.cwd)
    const planned = desiredPane.get(pane.pane_id)
    const label = planned?.label ?? (task ? `[${pane.pane_id}] ${task}` : unnamedLabel(pane))
    const reason =
      planned?.reason ?? (task ? 'pane ID 前綴跟隨實際 pane ID' : 'pane 未具名，補上實際 pane ID')
    if (pane.label !== label) {
      changes.push({ kind: 'pane', id: pane.pane_id, from: pane.label, to: label, reason })
      findings.push({
        kind: 'pane',
        id: pane.pane_id,
        tab_id: pane.tab_id,
        label: pane.label,
        expected: label,
        issue: contradiction(pane.label, label, pane.cwd),
        detail: reason,
      })
    }
  }
  // Pane writes first: a Tab label must never name a pane label that does not exist yet.
  return {
    changes: changes.toSorted((left, right) =>
      left.kind === right.kind ? 0 : left.kind === 'pane' ? -1 : 1,
    ),
    findings,
  }
}

/** Record Tabs whose label already equals their primary pane; anything else stays as last seen. */
export function observedVisibleState(
  snapshot: VisibleSnapshot,
  previous: VisibleState,
): VisibleState {
  const tabs = { ...previous.tabs }
  const live = new Set(snapshot.tabs.map((tab) => tab.tab_id))
  for (const id of Object.keys(tabs)) if (!live.has(id)) delete tabs[id]
  for (const tab of snapshot.tabs) {
    const primary = primaryPane(snapshot, tab)
    if (primary && primary.label === tab.label)
      tabs[tab.tab_id] = {
        pane_id: primary.pane_id,
        tab_label: tab.label,
        pane_label: primary.label,
      }
  }
  return { tabs }
}

export function auditVisibleWork(request: HerdrRequest): VisibleFinding[] {
  return planVisibleIdentity(readVisibleSnapshot(request)).findings
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
    const findings = auditVisibleWork(requestDefaultHerdr)
    const misleading = findings.filter((finding) => finding.issue === 'misleading')
    const incomplete = findings.filter((finding) => finding.issue === 'incomplete')
    process.stdout.write(
      `${JSON.stringify({ session: 'default', misleading, incomplete }, null, 2)}\n`,
    )
    // Only a name that contradicts Herdr fails; a missing ID or name is listed, not failed.
    if (misleading.length) process.exitCode = 1
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
