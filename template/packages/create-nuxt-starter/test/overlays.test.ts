import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyOverlay, validateOverlayCompatibility } from '../src/overlays'

const TEST_DIR = join(import.meta.dirname, '.tmp-overlays-test')

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

function makeOverlay(
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {}
) {
  const overlayDir = join(TEST_DIR, 'overlays', name)
  writeJson(join(overlayDir, 'manifest.json'), {
    name,
    add: [],
    remove: [],
    ...manifest,
  })

  for (const [path, content] of Object.entries(files)) {
    writeText(join(overlayDir, 'add', path), content)
  }

  return overlayDir
}

function makeProject() {
  const projectDir = join(TEST_DIR, 'project')
  writeJson(join(projectDir, 'package.json'), {
    name: 'test-project',
    scripts: {
      dev: 'nuxt dev',
      'db:drizzle:pull': 'drizzle-kit pull',
    },
    dependencies: {
      '@nuxtjs/supabase': '^2.0.4',
      '@supabase/supabase-js': '^2.99.1',
      nuxt: '^4.4.2',
      postgres: '^3.4.9',
    },
    devDependencies: {
      'drizzle-kit': '^0.31.10',
      typescript: '^5.9.3',
    },
  })
  writeText(join(projectDir, 'server/db/schema/index.ts'), 'export const supabaseSchema = {}\n')
  return projectDir
}

describe('overlay compatibility', () => {
  beforeEach(() => {
    cleanTestDir()
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(cleanTestDir)

  it('accepts selections that satisfy manifest requires', () => {
    const manifest = {
      name: 'db-nuxthub-d1',
      requires: {
        auth: ['better-auth', 'none'],
      },
    }

    expect(() =>
      validateOverlayCompatibility(manifest, { auth: 'better-auth', dbStack: 'nuxthub-d1' })
    ).not.toThrow()
  })

  it('fails before file operations when a requires constraint is unmet', () => {
    const manifest = {
      name: 'db-nuxthub-d1',
      requires: {
        auth: ['better-auth', 'none'],
      },
    }

    expect(() =>
      validateOverlayCompatibility(manifest, { auth: 'nuxt-auth-utils', dbStack: 'nuxthub-d1' })
    ).toThrow(/db-nuxthub-d1.*auth.*nuxt-auth-utils/)
  })

  it('fails before file operations when conflicts_with matches', () => {
    const manifest = {
      name: 'db-nuxthub-d1',
      conflicts_with: [{ key: 'dbStack', values: ['supabase'] }],
    }

    expect(() =>
      validateOverlayCompatibility(manifest, { auth: 'better-auth', dbStack: 'supabase' })
    ).toThrow(/db-nuxthub-d1.*dbStack.*supabase/)
  })
})

describe('applyOverlay', () => {
  beforeEach(() => {
    cleanTestDir()
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(cleanTestDir)

  it('throws for missing overlays', () => {
    const projectDir = makeProject()

    expect(() =>
      applyOverlay(
        projectDir,
        'missing-overlay',
        { auth: 'better-auth' },
        {
          overlaysDir: join(TEST_DIR, 'overlays'),
        }
      )
    ).toThrow(/missing-overlay.*not found/)
  })

  it('adds and removes files declared by the manifest', () => {
    const projectDir = makeProject()
    makeOverlay(
      'test-overlay',
      {
        requires: { auth: ['better-auth'] },
        add: ['server/database/schema/index.ts'],
        remove: ['server/db'],
      },
      {
        'server/database/schema/index.ts': 'export const d1Schema = {}\n',
      }
    )

    applyOverlay(
      projectDir,
      'test-overlay',
      { auth: 'better-auth' },
      {
        overlaysDir: join(TEST_DIR, 'overlays'),
      }
    )

    expect(existsSync(join(projectDir, 'server/db'))).toBe(false)
    expect(readFileSync(join(projectDir, 'server/database/schema/index.ts'), 'utf-8')).toContain(
      'd1Schema'
    )
  })

  it('skips conditional add files when their selection condition does not match', () => {
    const projectDir = makeProject()
    makeOverlay(
      'test-overlay',
      {
        add: [
          {
            path: 'server/database/migrations/0001_better_auth_d1.sql',
            when: { auth: ['better-auth'] },
          },
          'server/database/migrations/0002_evlog_events.sql',
        ],
      },
      {
        'server/database/migrations/0001_better_auth_d1.sql': 'create table user (id text);\n',
        'server/database/migrations/0002_evlog_events.sql':
          'create table evlog_events (id text);\n',
      }
    )

    applyOverlay(
      projectDir,
      'test-overlay',
      { auth: 'none' },
      {
        overlaysDir: join(TEST_DIR, 'overlays'),
      }
    )

    expect(existsSync(join(projectDir, 'server/database/migrations/0001_better_auth_d1.sql'))).toBe(
      false
    )
    expect(existsSync(join(projectDir, 'server/database/migrations/0002_evlog_events.sql'))).toBe(
      true
    )
  })

  it('applies structural package.json delta without string replacement', () => {
    const projectDir = makeProject()
    makeOverlay('test-overlay', {
      package_json: {
        remove_scripts: ['db:drizzle:pull'],
        add_scripts: {
          'hub:db:migrations:apply': 'nuxt db migrate',
          'hub:db:migrations:create': 'nuxt db generate',
        },
        remove_dependencies: ['@nuxtjs/supabase', '@supabase/supabase-js', 'postgres'],
        add_dependencies: {
          '@nuxthub/core': '^0.10.7',
          '@evlog/nuxthub': '^2.16.0',
        },
        remove_dev_dependencies: ['drizzle-kit'],
      },
    })

    applyOverlay(
      projectDir,
      'test-overlay',
      { auth: 'better-auth' },
      {
        overlaysDir: join(TEST_DIR, 'overlays'),
      }
    )

    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['db:drizzle:pull']).toBeUndefined()
    expect(pkg.scripts['hub:db:migrations:create']).toBe('nuxt db generate')
    expect(pkg.scripts['hub:db:migrations:apply']).toBe('nuxt db migrate')
    expect(pkg.dependencies['@nuxtjs/supabase']).toBeUndefined()
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined()
    expect(pkg.dependencies.postgres).toBeUndefined()
    expect(pkg.dependencies['@nuxthub/core']).toBe('^0.10.7')
    expect(pkg.dependencies['@evlog/nuxthub']).toBe('^2.16.0')
    expect(pkg.devDependencies['drizzle-kit']).toBeUndefined()

    const raw = readFileSync(join(projectDir, 'package.json'), 'utf-8')
    expect(raw).toMatch(/"dependencies": \{/)
    expect(raw).not.toContain('@supabase/supabase-js')
  })
})
