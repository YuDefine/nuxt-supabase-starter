#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_ROOT = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(TEMPLATE_ROOT, '..')
const CREATE_PACKAGE_DIR = join(TEMPLATE_ROOT, 'packages', 'create-nuxt-starter')
const FIXTURE_ROOT = join(TEMPLATE_ROOT, 'temp', 'validate-starter')

const VENDORED_AUDIT_SCRIPT = join(REPO_ROOT, 'scripts', 'vendor', 'evlog-adoption-audit.mjs')
const CLADE_AUDIT_SCRIPT = process.env.CLADE_HOME
  ? join(process.env.CLADE_HOME, 'scripts', 'evlog-adoption-audit.mjs')
  : null

export const AUDIT_SCRIPT =
  CLADE_AUDIT_SCRIPT && existsSync(CLADE_AUDIT_SCRIPT) ? CLADE_AUDIT_SCRIPT : VENDORED_AUDIT_SCRIPT

let scaffolderModules

const COMMON_BLOCKED_SIGNAL_CHECKS = [
  signalCheck('drain.rawSentry', 0),
  signalCheck('sampling.errorSampled', 0),
  signalCheck('redaction.missingCore', 0),
  signalCheck('consola.inServerApi', 0),
]

export const VALIDATION_CASES = [
  {
    preset: 'baseline',
    projectName: 'validate-baseline',
    evlogPreset: 'baseline',
    checks: [
      blockedCheck(0),
      ...COMMON_BLOCKED_SIGNAL_CHECKS,
      signalCheck('nuxthub.moduleInstalled', 0),
      signalAtLeastCheck('drain.pipelineWraps', 1),
      signalCheck('enrichers.installed', 5),
      fileExistsCheck('server/db', true),
      packageScriptCheck('db:drizzle:pull', true),
      packageDependencyCheck('@nuxtjs/supabase', true),
    ],
  },
  {
    preset: 'd-pattern-audit',
    projectName: 'validate-d-pattern-audit',
    evlogPreset: 'd-pattern-audit',
    checks: [
      blockedCheck(0),
      ...COMMON_BLOCKED_SIGNAL_CHECKS,
      signalCheck('nuxthub.moduleInstalled', 0),
      signalAtLeastCheck('drain.pipelineWraps', 1),
      signalCheck('enrichers.installed', 5),
      signalCheck('audit.forceKeepWired', 1),
      fileExistsCheck('server/db', true),
      packageScriptCheck('db:drizzle:pull', true),
      packageDependencyCheck('@nuxtjs/supabase', true),
    ],
  },
  {
    preset: 'nuxthub-ai',
    projectName: 'validate-nuxthub-ai',
    evlogPreset: 'nuxthub-ai',
    checks: [
      blockedCheck(0),
      ...COMMON_BLOCKED_SIGNAL_CHECKS,
      signalCheck('nuxthub.moduleInstalled', 1),
      signalCheck('drain.pipelineWraps', 1),
      signalCheck('enrichers.installed', 5),
      fileExistsCheck('server/db', false),
      packageScriptCheck('db:drizzle:pull', false),
      packageDependencyCheck('@nuxtjs/supabase', false),
      packageDependencyCheck('@nuxthub/core', true),
    ],
  },
  {
    preset: 'none',
    projectName: 'validate-none',
    evlogPreset: 'none',
    checks: [
      blockedCheck(0),
      ...COMMON_BLOCKED_SIGNAL_CHECKS,
      signalCheck('drain.pipelineWraps', 0),
      signalCheck('nuxthub.moduleInstalled', 0),
      signalCheck('enrichers.installed', 0),
      fileExistsCheck('server/db', true),
      packageScriptCheck('db:drizzle:pull', true),
      packageDependencyCheck('@nuxtjs/supabase', true),
    ],
  },
]

function blockedCheck(expected) {
  return {
    name: 'blocked',
    expected,
    actual: ({ audit }) => audit.blocked,
  }
}

function signalCheck(name, expected) {
  return {
    name,
    expected,
    actual: ({ audit }) => audit.signals[name] ?? 0,
  }
}

function signalAtLeastCheck(name, expected) {
  return {
    name,
    expected: `>=${expected}`,
    actual: ({ audit }) => audit.signals[name] ?? 0,
    matches: (actual) => typeof actual === 'number' && actual >= expected,
  }
}

function fileExistsCheck(path, expected) {
  return {
    name: `file:${path}:exists`,
    expected,
    actual: ({ targetDir }) => existsSync(join(targetDir, path)),
  }
}

function packageScriptCheck(name, expected) {
  return {
    name: `package.scripts.${name}`,
    expected,
    actual: ({ packageJson }) => Boolean(packageJson.scripts?.[name]),
  }
}

function packageDependencyCheck(name, expected) {
  return {
    name: `package.dependencies.${name}`,
    expected,
    actual: ({ packageJson }) =>
      Boolean(packageJson.dependencies?.[name] || packageJson.devDependencies?.[name]),
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function runCommand(file, args, options) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    })
  } catch (error) {
    const stdout = error.stdout ? `\nstdout:\n${error.stdout}` : ''
    const stderr = error.stderr ? `\nstderr:\n${error.stderr}` : ''
    throw new Error(
      `${file} ${args.join(' ')} failed with status ${error.status}${stdout}${stderr}`,
      { cause: error }
    )
  }
}

export function ensureAuditScriptAvailable() {
  if (!existsSync(AUDIT_SCRIPT)) {
    throw new Error(`audit script unavailable: ${AUDIT_SCRIPT}`)
  }
}

export function auditProject(targetDir) {
  ensureAuditScriptAvailable()
  const stdout = runCommand('node', [AUDIT_SCRIPT, '--repo', targetDir, '--json'])
  const result = JSON.parse(stdout)
  const target = result.targets?.[0]

  if (!target || typeof result.blocked !== 'number' || !target.signals) {
    const detail = target?.error ? ` — audit error: ${target.error}` : ''
    throw new Error(`audit output shape mismatch for ${targetDir}${detail}`)
  }

  return {
    blocked: result.blocked,
    signals: target.signals,
  }
}

export function evaluateCase(validationCase, targetDir, audit) {
  const packageJson = readJson(join(targetDir, 'package.json'))
  const context = {
    audit,
    packageJson,
    targetDir,
  }

  return validationCase.checks.map((check) => {
    const actual = check.actual(context)
    const ok = check.matches ? check.matches(actual) : Object.is(actual, check.expected)

    return {
      preset: validationCase.preset,
      path: targetDir,
      signal: check.name,
      expected: check.expected,
      actual,
      ok,
    }
  })
}

export function formatReportRow(row) {
  const status = row.ok ? 'ok' : 'FAIL'
  return `[${status}] preset=${row.preset} path=${row.path} signal=${row.signal} expected=${String(
    row.expected
  )} actual=${String(row.actual)}`
}

async function loadScaffolderModules() {
  if (scaffolderModules) return scaffolderModules

  runCommand(
    'pnpm',
    [
      '--dir',
      CREATE_PACKAGE_DIR,
      'exec',
      'tsdown',
      'src/cli.ts',
      'src/assemble.ts',
      '--format',
      'esm',
      '--out-dir',
      'dist',
    ],
    {
      cwd: TEMPLATE_ROOT,
    }
  )

  const assemble = await import(pathToFileURL(join(CREATE_PACKAGE_DIR, 'dist', 'assemble.js')).href)
  const cli = await import(pathToFileURL(join(CREATE_PACKAGE_DIR, 'dist', 'cli.js')).href)
  scaffolderModules = {
    assembleProject: assemble.assembleProject,
    buildSelectionsFromArgs: cli.buildSelectionsFromArgs,
  }

  return scaffolderModules
}

function generateFixture(validationCase, modules) {
  const targetDir = join(FIXTURE_ROOT, validationCase.projectName)
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(dirname(targetDir), { recursive: true })

  const { assembleProject, buildSelectionsFromArgs } = modules
  const projectName = basename(targetDir)
  const selections = buildSelectionsFromArgs({
    projectName,
    evlogPreset: validationCase.evlogPreset,
  })
  assembleProject(
    targetDir,
    selections.features,
    projectName,
    selections.agentTargets,
    selections.evlogPreset,
    selections.dbStack
  )

  return targetDir
}

async function main() {
  const rows = []

  try {
    ensureAuditScriptAvailable()
    rmSync(FIXTURE_ROOT, { recursive: true, force: true })
    mkdirSync(FIXTURE_ROOT, { recursive: true })

    const modules = await loadScaffolderModules()
    for (const validationCase of VALIDATION_CASES) {
      const targetDir = generateFixture(validationCase, modules)
      const audit = auditProject(targetDir)
      rows.push(...evaluateCase(validationCase, targetDir, audit))
    }
  } catch (error) {
    console.error(`[validate-starter] ${error.message}`)
    process.exitCode = 1
    return
  }

  for (const row of rows) {
    console.log(formatReportRow(row))
  }

  const failures = rows.filter((row) => !row.ok)
  if (failures.length > 0) {
    console.error('')
    console.error(`[validate-starter] ${failures.length} regression(s) failed`)
    for (const row of failures) {
      console.error(formatReportRow(row))
    }
    process.exitCode = 1
    return
  }

  console.log('')
  console.log(`[validate-starter] ${VALIDATION_CASES.length} fresh scaffold path(s) passed`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
