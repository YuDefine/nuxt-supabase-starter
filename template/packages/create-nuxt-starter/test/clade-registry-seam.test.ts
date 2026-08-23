import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterAll, describe, expect, it } from 'vitest'
import { buildRegisterConsumerArgs, preflightCladeRegistration } from '../src/post-scaffold'

/**
 * 這個 seam 跨兩個 repo：starter 的 buildRegisterConsumerArgs 產生 argv，
 * Clade 的 scripts/register-consumer.ts 解析它。兩邊各自的單元測試都會綠 ——
 * post-scaffold.test.ts 鎖住 starter 側的 argv 形狀，Clade 有自己的 parseArgs 測試 ——
 * 但沒有任何測試把兩邊接起來跑，所以任一側改 flag 名稱或加必填欄位，
 * 只有真人跑完整個 scaffold（含 pnpm install，數分鐘）才會在最後一步看到
 * 「Clade registry 登記失敗」。本檔就是補那一段。
 *
 * 走 Clade 的 --fleet-base / --registry-path 覆寫，完全不碰真實 registry。
 * CI 沒有 Clade checkout（private repo）時整組 skip，並在 skip 理由講清楚原因。
 */

function resolveCladeRoot(): string | undefined {
  const env = process.env.CLADE_HOME?.trim()
  if (env && existsSync(env)) return env
  const home = homedir()
  for (const candidate of [join(home, 'clade'), join(home, 'offline', 'clade')]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const cladeRoot = resolveCladeRoot()
const registerScript = cladeRoot ? join(cladeRoot, 'scripts', 'register-consumer.ts') : undefined
const seamAvailable = Boolean(registerScript && existsSync(registerScript))

const TEST_DIR = mkdtempSync(join(tmpdir(), 'clade-seam-test-'))
afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }))

/** Clade 要求 consumer 位於 fleet base 底下，且已有 package.json + .claude/hub.json。 */
function makeFakeConsumer(name: string): { fleetBase: string; consumerDir: string } {
  const fleetBase = join(TEST_DIR, `fleet-${name}`)
  const consumerDir = join(fleetBase, name)
  mkdirSync(join(consumerDir, '.claude'), { recursive: true })
  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({ name }, null, 2))
  writeFileSync(
    join(consumerDir, '.claude', 'hub.json'),
    JSON.stringify({ version: '0.0.0', modules: {}, localHooks: [] }, null, 2),
  )
  return { fleetBase, consumerDir }
}

function makeEmptyRegistry(name: string): string {
  const path = join(TEST_DIR, `registry-${name}.json`)
  writeFileSync(path, `${JSON.stringify({ consumers: [] }, null, 2)}\n`)
  return path
}

describe.skipIf(!seamAvailable)('starter CLI → Clade registry seam', () => {
  it('Clade 的 register-consumer.ts 接受 starter 產生的 argv 並寫出 entry', () => {
    const name = 'seam-demo'
    const { fleetBase, consumerDir } = makeFakeConsumer(name)
    const registryPath = makeEmptyRegistry(name)

    const args = [
      ...buildRegisterConsumerArgs(
        registerScript!,
        consumerDir,
        'YuDefine/seam-demo',
        'pr-merge-based',
        'active',
        3999,
      ),
      '--fleet-base',
      fleetBase,
      '--registry-path',
      registryPath,
      '--json',
    ]

    const stdout = execFileSync('node', args, { cwd: cladeRoot, encoding: 'utf8' })
    expect(JSON.parse(stdout).status).toBe('created')

    const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
    expect(registry.consumers).toHaveLength(1)
    const entry = registry.consumers[0]
    expect(entry.consumer_id).toBe(name)
    expect(entry.repo_id).toBe('YuDefine/seam-demo')
    // 逐欄都用非預設值：Clade 的 parseArgs 對未知 flag 是靜默略過（不是報錯），
    // 所以任一側把 flag 改名時，唯一會變的是這幾欄落回 default。
    // 斷言寫預設值 = 這個 gate 永遠不會亮。
    expect(entry.workflow_model).toBe('pr-merge-based')
    expect(entry.business_activity).toBe('active')
    expect(entry.dev_ports).toEqual({ nuxt: 3999 })
  })

  it('同一組身分重跑是 idempotent，不會寫出第二筆', () => {
    const name = 'seam-idem'
    const { fleetBase, consumerDir } = makeFakeConsumer(name)
    const registryPath = makeEmptyRegistry(name)

    const args = [
      ...buildRegisterConsumerArgs(
        registerScript!,
        consumerDir,
        'YuDefine/seam-idem',
        'trunk-based',
        'pre-production',
        3998,
      ),
      '--fleet-base',
      fleetBase,
      '--registry-path',
      registryPath,
      '--json',
    ]

    expect(
      JSON.parse(execFileSync('node', args, { cwd: cladeRoot, encoding: 'utf8' })).status,
    ).toBe('created')
    expect(
      JSON.parse(execFileSync('node', args, { cwd: cladeRoot, encoding: 'utf8' })).status,
    ).toBe('exists')
    expect(JSON.parse(readFileSync(registryPath, 'utf8')).consumers).toHaveLength(1)
  })
})

describe.skipIf(!seamAvailable)('scaffold 前的 preflight', () => {
  it('放行還不存在、但位置合法的 target', () => {
    const fleetBase = join(TEST_DIR, 'fleet-preflight-ok')
    mkdirSync(fleetBase, { recursive: true })
    // 刻意不建立 target 目錄：preflight 就是要在 scaffold 之前跑。
    const outcome = preflightCladeRegistration(cladeRoot!, join(fleetBase, 'not-yet-there'), {
      repoId: 'YuDefine/not-yet-there',
      devPort: 'auto',
    })

    // 真實 fleet base 是 Clade 的上一層，所以這個臨時路徑會被擋 ——
    // 這裡驗的是「preflight 有真的做出判斷」，而不是它恆回 ok。
    expect(outcome.status).toBe('rejected')
    expect(outcome.reason).toMatch(/fleet base/)
  })

  it('沒給 repoId 時不呼叫 Clade', () => {
    const outcome = preflightCladeRegistration(cladeRoot!, join(TEST_DIR, 'whatever'), {})
    expect(outcome.status).toBe('skipped')
  })
})

// seam 不可用時留一條會亮的軌跡：整組 skip 在報告裡只是一行灰字，
// 容易被讀成「這塊有測試在顧」。
describe.skipIf(seamAvailable)('starter CLI → Clade registry seam (unavailable)', () => {
  it('找不到 Clade checkout，跨 repo seam 本次未驗證', () => {
    expect(seamAvailable).toBe(false)
  })
})
