#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/control-plane-projection-validate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/control-plane-projection-validate.ts

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const repoRoot = resolve(process.argv[2] ?? process.cwd())
const changesRoot = join(repoRoot, 'openspec', 'changes')
const controlPlaneRoot = join(repoRoot, '.clade', 'ai-control-plane')
const violations: Array<{ path: string; reason: string }> = []

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string | unknown): string {
  return `sha256:${createHash('sha256')
    .update(typeof value === 'string' ? value : canonical(value))
    .digest('hex')}`
}

function parseJsonRecord(raw: string): Record<string, any> {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected JSON object')
  }
  return value as Record<string, any>
}

function readJsonLines(path: string): Array<Record<string, any>> {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => parseJsonRecord(line))
}

function canonicalInputs(changeId: string): {
  digest: string
  intentRevision: number
  flowCount: number
  evidenceCount: number
  decisionCount: number
} {
  const source = parseJsonRecord(
    readFileSync(join(controlPlaneRoot, 'intent', `${changeId}.json`), 'utf8'),
  )
  const allEvents = readJsonLines(join(repoRoot, '.clade', 'flow', 'events.jsonl'))
  const workIds = new Set(
    allEvents
      .filter((event) => event.kind === 'work.open' && event.payload?.change_id === changeId)
      .map((event) => event.work_id),
  )
  const flowEvents = allEvents.filter((event) => event.work_id && workIds.has(event.work_id))
  const evidence = readJsonLines(join(controlPlaneRoot, 'evidence.jsonl')).filter(
    (row) => row.change_id === changeId,
  )
  const decisions = readJsonLines(join(controlPlaneRoot, 'human-decisions.jsonl')).filter(
    (row) => row.change_id === changeId,
  )
  const plan = source.native_artifacts?.find(
    (artifact: Record<string, any>) => artifact.artifact_type === 'intent.work_plan',
  )
  if (!plan) throw new Error('persisted intent is missing intent.work_plan')
  return {
    digest: sha256({
      source,
      flow_events: flowEvents,
      evidence,
      human_decisions: decisions,
    }),
    intentRevision: Number(plan.intent_revision),
    flowCount: flowEvents.length,
    evidenceCount: evidence.length,
    decisionCount: decisions.length,
  }
}

if (existsSync(changesRoot)) {
  for (const entry of readdirSync(changesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    const tasksPath = join(changesRoot, entry.name, 'tasks.md')
    if (!existsSync(tasksPath)) continue
    const content = readFileSync(tasksPath, 'utf8')
    const changeId = content.match(/^<!-- control-plane-change-id: (chg_[A-Za-z0-9]+) -->$/m)?.[1]
    if (!changeId) continue
    const relativeTasksPath = relative(repoRoot, tasksPath)
    const lockPath = join(controlPlaneRoot, 'locks', `${changeId}.lock`)
    if (existsSync(lockPath)) {
      violations.push({
        path: relativeTasksPath,
        reason: 'projection write is in progress or requires recovery',
      })
      continue
    }
    const sidecarPath = join(controlPlaneRoot, 'projections', `${changeId}.json`)
    if (!existsSync(sidecarPath)) {
      violations.push({ path: relativeTasksPath, reason: 'missing projection sidecar' })
      continue
    }
    try {
      const projection = parseJsonRecord(readFileSync(sidecarPath, 'utf8')) as {
        change_id?: string
        checkpoint?: Record<string, any>
      }
      const checkpoint = projection.checkpoint
      const inputs = canonicalInputs(changeId)
      const expectedCursor = `intent:${inputs.intentRevision};flow:${inputs.flowCount};evidence:${inputs.evidenceCount};decision:${inputs.decisionCount}`
      const latestCheckpoint = readJsonLines(
        join(controlPlaneRoot, 'projection-events.jsonl'),
      ).findLast((row) => row.change_id === changeId)
      if (
        projection.change_id !== changeId ||
        checkpoint?.change_id !== changeId ||
        checkpoint?.projector !== 'ai-control-plane/tasks-v1' ||
        checkpoint?.output_path !== relativeTasksPath ||
        checkpoint?.output_digest !== sha256(content) ||
        checkpoint?.input_digest !== inputs.digest ||
        checkpoint?.through_cursor !== expectedCursor ||
        !latestCheckpoint ||
        canonical(latestCheckpoint) !== canonical(checkpoint)
      ) {
        violations.push({
          path: relativeTasksPath,
          reason: 'generated projection differs from canonical facts; rebuild required',
        })
      }
    } catch {
      violations.push({
        path: relativeTasksPath,
        reason: 'projection inputs or sidecar are unreadable; rebuild required',
      })
    }
  }
}

if (violations.length === 0) {
  process.stdout.write('control-plane projections current\n')
  process.exit(0)
}

for (const violation of violations) {
  process.stderr.write(`${violation.path}: ${violation.reason}\n`)
}
process.exit(1)
