import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleProject, generatePackageJson } from '../src/assemble'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scaffold(features: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'quality-readiness-'))
  roots.push(root)
  assembleProject(root, features, 'example-project', [], 'none')
  return root
}

function readPackage(root: string) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

function executable(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  chmodSync(path, 0o755)
}

function expectCommand(
  root: string,
  script: string,
  label: string,
  command: string[],
  gate: boolean,
) {
  const bin = join(root, 'probe-bin')
  const output = join(root, 'argv.json')
  const gateOutput = join(root, 'gate.json')
  executable(
    join(bin, command[0]),
    `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'; writeFileSync(process.env.PROBE_OUTPUT, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.PROBE_EXIT));\n`,
  )
  if (gate) {
    executable(
      join(root, '.clade/bin/clade-gate'),
      `#!/usr/bin/env node\nimport fs from 'node:fs'; import cp from 'node:child_process'; const args=process.argv.slice(2); fs.writeFileSync(process.env.GATE_OUTPUT, JSON.stringify(args.slice(0,3))); const r=cp.spawnSync(args[3],args.slice(4),{stdio:'inherit'}); process.exit(r.status ?? 1);\n`,
    )
  }
  executable(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node\nimport fs from 'node:fs'; import cp from 'node:child_process'; const [name,...args]=process.argv.slice(2); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const r=cp.spawnSync('sh',['-c',pkg.scripts[name]+' "$@"','--',...args],{stdio:'inherit'}); process.exit(r.status ?? 1);\n`,
  )
  if (command[0] === 'vp') {
    executable(
      join(bin, 'nuxt'),
      `#!/usr/bin/env node\nimport fs from 'node:fs'; fs.writeFileSync(process.env.PROBE_OUTPUT+'.nuxt',JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.PROBE_EXIT));\n`,
    )
  }
  const args = ['--example', 'two words', '', 'quote\'"', '$(literal);*']
  for (const status of [0, 23]) {
    const result = spawnSync('sh', ['-c', `${script} "$@"`, '--', ...args], {
      cwd: root,
      env: {
        ...process.env,
        CI: 'true',
        PATH: `${bin}:${process.env.PATH}`,
        PROBE_OUTPUT: output,
        GATE_OUTPUT: gateOutput,
        PROBE_EXIT: String(status),
      },
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(status)
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([...command.slice(1), ...args])
    if (gate) expect(JSON.parse(readFileSync(gateOutput, 'utf8'))).toEqual(['run', label, '--'])
    if (script.includes('pnpm check:tools') && status === 0) {
      expect(JSON.parse(readFileSync(output + '.nuxt', 'utf8'))).toEqual(['typecheck', ...args])
    }
  }
}

describe('generated quality readiness', () => {
  for (const features of [
    [],
    ['quality'],
    ['quality', 'testing-vitest'],
    ['quality', 'testing-full'],
  ]) {
    for (const gate of [false, true]) {
      it(`${features.join('+') || 'base'} preserves heavy labels, argv and exit (helper=${gate})`, () => {
        const root = scaffold(features)
        const pkg = readPackage(root)
        expect(pkg.scripts.doctor).toBe('vite-doctor . --max-warnings 0')
        expect(pkg.devDependencies['vite-doctor']).toBe('0.0.10')
        expect(pkg.devDependencies['vite-plus']).toBeDefined()
        expect(pkg.scripts['audit:ux-drift']).toBe('node scripts/audit-ux-drift.ts')
        expectCommand(root, pkg.scripts.build, 'build', ['nuxt', 'build'], gate)
        expectCommand(root, pkg.scripts.typecheck, 'typecheck', ['nuxt', 'typecheck'], gate)
        if (features.includes('quality')) {
          expectCommand(root, pkg.scripts.check, 'typecheck', ['vp', 'check'], gate)
        }
        if (features.some((id) => id.startsWith('testing-'))) {
          expectCommand(root, pkg.scripts.test, 'test', ['vp', 'test', '--coverage'], gate)
          expect(pkg.devDependencies['vite-plus']).toBeDefined()
          expect(pkg.devDependencies['@vitest/coverage-v8']).toBeDefined()
        } else {
          expect(pkg.scripts.test).toBeUndefined()
        }
      })
    }
  }

  it('uses test-mutation admission when an input defines mutation tests', () => {
    const root = scaffold([])
    const pkg = readPackage(root)
    // generatePackageJson receives the base template, not an already generated manifest.
    pkg.scripts = { build: 'nuxt build', 'test:mutation': 'stryker run' }
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    generatePackageJson(root, [], 'example-project', [])
    expectCommand(
      root,
      readPackage(root).scripts['test:mutation'],
      'test-mutation',
      ['stryker', 'run'],
      true,
    )
  })

  it('keeps generated coverage and browser test results out of Git', () => {
    const root = scaffold(['quality', 'testing-full'])
    expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0)
    for (const path of [
      'coverage/coverage-final.json',
      'playwright-report/index.html',
      'test-results/result.json',
    ]) {
      expect(spawnSync('git', ['check-ignore', path], { cwd: root }).status).toBe(0)
    }
    expect(readFileSync(join(root, '.oxfmtignore'), 'utf8')).toContain('.clade/**')
  })

  it('keeps quality checks read-only and format explicitly writable', () => {
    const pkg = readPackage(scaffold(['quality', 'testing-vitest', 'git-hooks']))
    expect(pkg.scripts['check:tools']).toContain('run typecheck -- vp check')
    expect(pkg.scripts.check).toContain('pnpm typecheck')
    expect(pkg.scripts.check).not.toContain('pnpm test')
    expect(pkg.scripts.format).toBe('vp fmt --write --ignore-path .oxfmtignore')
    expect(pkg['lint-staged']['*.{js,ts,vue}']).toEqual(['vp lint --fix', 'vp fmt --write'])
  })
})
