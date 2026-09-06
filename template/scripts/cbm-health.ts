#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/cbm-health.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/cbm-health.ts
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runEvidence } from './run-evidence.ts'

const scripts = dirname(fileURLToPath(import.meta.url))
function git(repo: string, args: string[]) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}
function snapshot(repo: string) {
  const status = git(repo, ['status', '--porcelain'])
  return {
    head: git(repo, ['rev-parse', 'HEAD']),
    dirty: status === null ? null : status.length > 0,
  }
}
function identity(repo: string) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      'source "$1/cbm-project.sh"; cbm_resolve_project "$2" || exit 1; cbm_is_temporary && exit 3; printf "%s\\0" "$CBM_REPO" "$CBM_PROJECT" "$CBM_CACHE" "$CBM_DB" "$CBM_NODES"',
      'cbm',
      scripts,
      repo,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) return null
  const [root, project, cache, db, nodes] = result.stdout.split('\0')
  return { repo: root, project, cache, db, nodes: Number(nodes) }
}
function atomic(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(data) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}
function read(path: string) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
function resultState(output: string, code: number | null) {
  if (code !== 0) return 'failure'
  const value = (() => {
    try {
      return JSON.parse(output)
    } catch {
      return null
    }
  })()
  if (!value) return 'unknown'
  const values = [
    value,
    ...(Array.isArray(value.content) ? value.content : [])
      .filter((v: any) => v.type === 'text')
      .map((v: any) => {
        try {
          return JSON.parse(v.text)
        } catch {
          return {}
        }
      }),
  ]
  if (
    values.some(
      (v) =>
        v && (v.isError || v.error || v.success === false || /error|fail/i.test(v.status || '')),
    )
  )
    return 'failure'
  if (values.some((v) => v && /progress|indexing|queued|running/i.test(v.status || '')))
    return 'in-progress'
  if (
    values.some(
      (v) =>
        v &&
        (v.success === true || /^(ready|complete|completed|success|indexed)$/.test(v.status || '')),
    )
  )
    return 'success'
  return 'unknown'
}
let [action, requested = process.cwd(), mode = ''] = process.argv.slice(2)
if (action === '--hook') {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const payload = input.trim() ? JSON.parse(input) : {}
  const event = payload.hook_event_name || payload.hookEventName || requested
  requested =
    payload.cwd ||
    payload.working_directory ||
    process.env.CURSOR_PROJECT_DIR ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  mode = /sessionstart/i.test(event) ? 'SessionStart' : 'PostToolUse'
  process.env.CLADE_CBM_SESSION_KEY = payload.session_id || payload.conversation_id || ''
  action = '--refresh'
  if (!git(requested, ['rev-parse', '--show-toplevel'])) process.exit(0)
}
const id = identity(requested)
if (id) {
  const receiptPath = join(id.cache, 'provenance', `${id.project}.json`)
  if (action === '--index') {
    const before = snapshot(id.repo)
    const prior = read(receiptPath)
    const base = {
      version: 1,
      repo: id.repo,
      project: id.project,
      before,
      startedAt: new Date().toISOString(),
      lastFailure: prior?.lastFailure || null,
    }
    atomic(receiptPath, { ...base, result: 'in-progress', pid: process.pid })
    const resolved = spawnSync(
      'bash',
      [
        '-c',
        'command -v codebase-memory-mcp || printf "%s" "$HOME/.local/bin/codebase-memory-mcp"',
      ],
      { encoding: 'utf8' },
    ).stdout.trim()
    const payload = JSON.stringify({
      repo_path: id.repo,
      name: id.project,
      ...(mode ? { mode } : {}),
    })
    const args = ['cli', 'index_repository', payload]
    const systemd = spawnSync('systemctl', ['--user', 'is-system-running'], { encoding: 'utf8' })
    const guarded = /^(running|degraded)\s*$/.test(systemd.stdout || '')
    const command = guarded ? 'systemd-run' : resolved
    const commandArgs = guarded
      ? [
          '--user',
          '--scope',
          '-q',
          '-p',
          `MemoryMax=${process.env.CBM_INDEX_MEM_MAX || '6G'}`,
          '-p',
          'MemorySwapMax=0',
          '-p',
          `CPUQuota=${process.env.CBM_INDEX_CPU_QUOTA || '200%'}`,
          resolved,
          ...args,
        ]
      : args
    const evidence = await runEvidence([command, ...commandArgs], {
      directory: join(id.cache, 'provenance'),
      display: true,
    })
    const stdout = readFileSync(evidence.stdout.path, 'utf8')
    const stderr = readFileSync(evidence.stderr.path, 'utf8') || evidence.spawnError || ''
    const { code, signal } = evidence
    const result = resultState(stdout, code)
    const finished = {
      ...base,
      after: snapshot(id.repo),
      result,
      exitCode: code,
      signal,
      evidence: evidence.receiptPath,
      finishedAt: new Date().toISOString(),
    }
    const failure =
      result === 'failure'
        ? {
            at: finished.finishedAt,
            head: before.head,
            exitCode: code,
            message: (stderr || stdout).slice(-2000),
            evidence: evidence.receiptPath,
          }
        : base.lastFailure
    atomic(receiptPath, { ...finished, lastFailure: failure })
    process.exitCode = evidence.spawnError ? 127 : code || (signal || result === 'failure' ? 1 : 0)
  } else {
    const receipt = read(receiptPath)
    const current = snapshot(id.repo)
    const session = process.env.CLADE_CBM_SESSION_KEY
    // Cursor may emit session-start context without delivering it to the model.
    // Give the post-tool channel its own notice while deduplicating each channel.
    const noticeScope = process.env.CLADE_RUNTIME === 'cursor' ? `\0${mode}` : ''
    const noticePath = session
      ? join(
          id.cache,
          'provenance',
          `notice-${createHash('sha256').update(`${id.repo}\0${process.env.CLADE_RUNTIME}\0${session}${noticeScope}`).digest('hex')}.json`,
        )
      : null
    const same = receipt?.repo === id.repo && receipt?.project === id.project
    const healthy =
      same &&
      id.nodes > 0 &&
      receipt.result === 'success' &&
      current.head &&
      receipt.before?.head === current.head &&
      receipt.after?.head === current.head &&
      receipt.before?.dirty === false &&
      receipt.after?.dirty === false &&
      current.dirty === false
    if (healthy && noticePath) rmSync(noticePath, { force: true })
    if (!healthy) {
      let reason = !id.nodes
        ? 'index missing, empty, or unreadable; empty graph results do not establish absent code'
        : !same
          ? 'provenance unknown'
          : receipt.result === 'failure'
            ? `last index failed: ${receipt.lastFailure?.message || receipt.exitCode}; evidence=${receipt.lastFailure?.evidence || receipt.evidence || receiptPath}`
            : current.dirty
              ? 'working tree has uncommitted changes; freshness unverified'
              : receipt.result !== 'success'
                ? `index result=${receipt.result}; freshness unverified`
                : 'HEAD differs from index provenance; stale'
      const text = `codebase-memory: project=${id.project} ${reason}. Check index_status and check_index_coverage for the queried scope.`
      const changed = !noticePath || read(noticePath)?.text !== text
      if (changed && (mode === 'SessionStart' || mode === 'PostToolUse')) {
        console.log(
          JSON.stringify(
            process.env.CLADE_RUNTIME === 'cursor'
              ? { additional_context: text }
              : { hookSpecificOutput: { hookEventName: mode, additionalContext: text } },
          ),
        )
      } else if (changed) console.log(text)
      if (changed && noticePath) atomic(noticePath, { text })
      // Retry on a changed HEAD, not repeatedly on the same failed/unknown source state.
      const needsRefresh =
        !same ||
        receipt.after?.head !== current.head ||
        (receipt.result === 'success' &&
          current.dirty === false &&
          (receipt.before?.dirty !== false || receipt.after?.dirty !== false))
      if (
        action === '--refresh' &&
        id.nodes > 0 &&
        current.head &&
        current.dirty === false &&
        needsRefresh &&
        receipt?.result !== 'in-progress'
      ) {
        const child = spawn('bash', [join(scripts, 'cbm-index.sh'), id.repo], {
          detached: true,
          stdio: 'ignore',
        })
        child.on('error', () => {})
        child.unref()
      }
    }
  }
}
