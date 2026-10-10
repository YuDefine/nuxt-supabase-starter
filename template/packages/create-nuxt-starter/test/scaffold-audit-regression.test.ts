// clade-legacy-test: frozen=2026-09-28 — 舊測試：沒有對應 truth，不是 BDD 的慣例來源；工作碰到就吸收（clade-spec-workflow/rules/legacy-tests.md）
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { assembleProject } from '../src/assemble'
import { buildSelectionsFromArgs } from '../src/cli'
import {
  AUDIT_SCRIPT,
  VALIDATION_CASES,
  auditProject,
  evaluateCase,
  formatReportRow,
} from '../../../../scripts/validate-starter-scaffold.mjs'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'scaffold-audit-regression-'))

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function scaffold(projectName: string, evlogPreset: string) {
  const selections = buildSelectionsFromArgs({
    projectName,
    evlogPreset,
  })
  const targetDir = join(TEST_DIR, projectName)

  assembleProject(
    targetDir,
    selections.features,
    projectName,
    selections.agentTargets,
    selections.evlogPreset,
    selections.dbStack,
  )

  return targetDir
}

function expectValidationRowsPass(rows: ReturnType<typeof evaluateCase>) {
  const failures = rows.filter((row) => !row.ok)
  if (failures.length > 0) {
    throw new Error(failures.map(formatReportRow).join('\n'))
  }
  expect(rows.map((row) => row.signal)).not.toHaveLength(0)
}

beforeEach(cleanTestDir)
afterEach(cleanTestDir)

describe('fresh scaffold evlog audit regression', () => {
  it('fails closed when the evlog audit script is unavailable', () => {
    expect(existsSync(AUDIT_SCRIPT), AUDIT_SCRIPT).toBe(true)
  })

  for (const validationCase of VALIDATION_CASES) {
    it(`keeps ${validationCase.preset} scaffold aligned with validate-starter expectations`, () => {
      const targetDir = scaffold(`audit-${validationCase.preset}`, validationCase.evlogPreset)
      const audit = auditProject(targetDir)
      const rows = evaluateCase(validationCase, targetDir, audit)

      expectValidationRowsPass(rows)
    })
  }
})
