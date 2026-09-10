import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildInitConsumerArgs,
  buildRegisterConsumerArgs,
  findCladeRoot,
  preflightCladeRegistration,
  resolveCladeInitScript,
} from '../src/post-scaffold'

/**
 * 這個 seam 跨兩個 repo：starter 的 buildRegisterConsumerArgs 產生 argv，
 * Clade 的 scripts/register-consumer.ts 解析它。兩邊各自的單元測試都會綠 ——
 * post-scaffold.test.ts 鎖住 starter 側的 argv 形狀，Clade 有自己的 parseArgs 測試 ——
 * 但沒有任何測試把兩邊接起來跑，所以任一側改 flag 名稱或加必填欄位，
 * 只有真人跑完整個 scaffold（含 pnpm install，數分鐘）才會在最後一步看到
 * 「Clade registry 登記失敗」。本檔就是補那一段。
 *
 * 走 Clade 的 --fleet-base / --registry-path 覆寫，完全不碰真實 registry。
 * CI 沒有 Clade checkout（private repo）時整組 skip，理由由下方 `process.stdout.write`
 * 印出來 —— 預設 reporter 在非 TTY（CI 就是）只印總計那兩行，測試名根本不會出現。
 *
 * fixture 的 consumer manifest 也由 Clade 的 init-consumer.ts 產生，不寫死 —— 那是
 * scaffold 真實的前一步（post-scaffold 的 runInitConsumer），而且寫死的 manifest 會被
 * Clade 的 manifest.schema.json 收緊時打掉（TD-013：`$.modules: no anyOf schema branch
 * matched`）。跟著產生器走，schema 再收緊也不用改這支測試。
 */

// clade checkout 的位置用 scaffolder 自己的 findCladeRoot()，不在測試裡另抄一份 ——
// 抄一份的話，src 端加了新的 CLADE_HOME 慣例時這裡不會跟著改，seamAvailable 會照舊規則
// 判斷，於是這支 gate 可能靜默地一直 skip（或反過來在沒有 clade 的機器上跑）而沒人發現。
const cladeRoot = findCladeRoot()
const registerScript = cladeRoot ? join(cladeRoot, 'scripts', 'register-consumer.ts') : undefined
const initScript = cladeRoot ? resolveCladeInitScript(cladeRoot) : undefined

/**
 * 不可用的三個原因**分開講**。合成一個 boolean 之後，報告裡只會剩「找不到 Clade
 * checkout」一句話 —— 但 checkout 明明在、只是 Clade 那邊把 init-consumer 改名了，
 * 是比「沒 checkout」更值得知道的事，而它會被那句話蓋掉。skip 的整個價值就在理由。
 */
const unavailableReason = !cladeRoot
  ? '找不到 Clade checkout（CLADE_HOME / ~/clade / ~/offline/clade 都沒有）'
  : !existsSync(registerScript!)
    ? `Clade checkout 在，但缺 scripts/register-consumer.ts：${cladeRoot}`
    : !initScript
      ? `Clade checkout 在，但缺 scripts/init-consumer.{ts,mjs}：${cladeRoot}`
      : undefined
const seamAvailable = unavailableReason === undefined

// 這行用 `process.stdout.write` 而**不是** `console.warn`：vitest 會攔截 console，非 TTY 的
// 預設 reporter 不把它印出來（實測過），未攔截的 stdout 寫入則照印。CI 跑的正是預設 reporter
// （`vp test --coverage`，不帶 --reporter），所以這是「seam 沒跑」這件事唯一會出現在 CI log
// 裡的字。**NEVER** 改用 console.* 或只依賴測試名。
if (!seamAvailable) {
  process.stdout.write(`[clade-registry-seam] 跨 repo seam 本次未驗證：${unavailableReason}\n`)
}

const TEST_DIR = mkdtempSync(join(tmpdir(), 'clade-seam-test-'))
afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }))

/** Clade 要求 consumer 位於 fleet base 底下，且已有 package.json + consumer manifest。 */
function makeFakeConsumer(name: string): { fleetBase: string; consumerDir: string } {
  const fleetBase = join(TEST_DIR, `fleet-${name}`)
  const consumerDir = join(fleetBase, name)
  mkdirSync(consumerDir, { recursive: true })
  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({ name }, null, 2))
  execFileSync(
    'node',
    [
      ...buildInitConsumerArgs(initScript!, {
        auth: 'better-auth',
        dbSchema: 'supabase',
        dbRuntime: 'cf-workers',
        runtime: 'cf-workers',
        framework: 'nuxt',
        localHooks: [],
      }),
      // production argv 原樣在前（那正是本檔要釘的東西），只在後面追加一個 test-only 旗標：
      // init 收尾的 baseline 會再 spawn 8 支 audit，對一個空的 tmp fixture 每支都只會回
      // 「none」，卻佔掉這支測試約六成時間。它與 manifest 形狀無關，跳掉不減少任何覆蓋。
      '--skip-baseline',
    ],
    { cwd: consumerDir, stdio: 'pipe' },
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
// 容易被讀成「這塊有測試在顧」。真正會出現在 CI log 裡的是上面那行 stdout；
// 這個 describe 讓它在測試計數裡也佔一格。
describe.skipIf(seamAvailable)('starter CLI → Clade registry seam (unavailable)', () => {
  // 理由寫在**測試名**裡，不是寫在斷言的失敗訊息裡：這個 describe 只在 seam 不可用時執行，
  // 所以斷言必須是會過的那一邊（`toBeDefined`）—— 寫成 `toBeUndefined` 等於讓沒有 clade
  // checkout 的 CI 一律紅，而那不是缺陷，是本來就跑不了。名字才是報告裡看得到的載體。
  // 理由也掛在測試名上，給 `--reporter=verbose` 與 UI 用（`?? ` 那半是因為 `skipIf(true)`
  // 仍會執行 factory 收集子項，不給預設值時 seam 可用的那一輪會印出「…未驗證：undefined」）。
  //
  // **NEVER** 為了「讓它變大聲」把斷言改成會失敗的那一邊：沒有 clade checkout 是 CI 的正常
  // 狀態，不是缺陷，那樣做只會讓 Template CI 一直紅（這正是本檔踩過的一次 Major）。
  it(`跨 repo seam 本次未驗證：${unavailableReason ?? '(seam 可用，本區塊不適用)'}`, () => {
    expect(unavailableReason).toBeDefined()
  })
})
