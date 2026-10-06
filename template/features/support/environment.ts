// SpecFormula / aixbdd BDD bootstrap（TD-026 D5）
// 對應規約：rules/core/specformula.md § MUST 5、§ NEVER 2
//
// 這支是整套接線的唯一入口。cucumber.cjs 的 import 第一項就是它。
//
// ⚠️ 頂層那段（loadSpecFormulaPlugins → IsaSpecReader.read → StepDefinitionFactory.register）
//    MUST 留在 module load 階段，NEVER 搬進 BeforeAll —— cucumber 在載 feature 之前
//    就要看得到 step definition，搬進去的症狀是「所有 step 都 undefined」。
//    順序也 MUST 是先 plugin 後 read：plugin 貢獻的 instruction_type 要先註冊，
//    isa.yml 驗證才不會以 SPEC_ISA_INSTRUCTION_TYPE_UNKNOWN 拒絕它。

import { setTimeout as sleep } from 'node:timers/promises'

import { AfterAll, After, Before, BeforeAll } from '@cucumber/cucumber'
import {
  ApiSpecReader,
  EntityDdlReader,
  IsaSpecReader,
  type DatabaseSchema,
} from '@specformula/core'
import { StepDefinitionFactory, loadSpecFormulaPlugins } from '@specformula/cucumber'
import {
  FetchHttpClientAdapter,
  SpecFormulaBridge,
  createPostgresDataSource,
} from '@specformula/node'

// 已在跑的 nuxt dev server（dev-login 只在 import.meta.dev 下存在，MUST 是 dev）。
const BASE_URL = process.env.SPECFORMULA_BASE_URL ?? 'http://127.0.0.1:3020'

// 本機 `supabase start` 的 Postgres。NEVER 填 hosted *.supabase.co。
export const SPECFORMULA_DB = {
  host: process.env.SPECFORMULA_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SPECFORMULA_DB_PORT ?? 54322),
  database: process.env.SPECFORMULA_DB_NAME ?? 'postgres',
  username: process.env.SPECFORMULA_DB_USER ?? 'postgres',
  password: process.env.SPECFORMULA_DB_PASSWORD ?? 'postgres',
}

export const SPECFORMULA_BASE_URL = BASE_URL

// ── module load 階段 ────────────────────────────────────────────────────────
const pluginLoader = await loadSpecFormulaPlugins()
const isaSpecAtLoadTime = new IsaSpecReader().read()
StepDefinitionFactory.register(isaSpecAtLoadTime.instructions ?? [], pluginLoader.instructions, {
  disabledInstructionTypes: pluginLoader.getDisabledInstructionTypes(),
})

async function waitForHealth(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`${BASE_URL}/test/health`)
      if (response.ok) return
    } catch {
      // server 還沒起來
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${BASE_URL}/test/health 在 ${timeoutMs}ms 內沒有回 200。` +
          ' 先跑 SPECFORMULA_TEST=1 pnpm dev，再跑 pnpm test:bdd。',
      )
    }
    await sleep(500)
  }
}

BeforeAll({ timeout: 130_000 }, async () => {
  await waitForHealth()

  const bridge = SpecFormulaBridge.getInstance()
  const isaSpec = new IsaSpecReader().read()

  const schemaMap = new Map<string, DatabaseSchema>()
  for (const source of isaSpec.config.data.source ?? []) {
    schemaMap.set(source.name, new EntityDdlReader(source).read())
    bridge.setDataSource(
      source.name,
      await createPostgresDataSource(SPECFORMULA_DB, source.schema ?? 'public'),
    )
  }

  bridge.setHttpClient(new FetchHttpClientAdapter(BASE_URL))
  bridge.initialize({
    schemaMap,
    apiSpec: new ApiSpecReader(isaSpec.config.api.resource_path).read(),
    timeFormat: isaSpec.config.api.time_format,
  })
})

Before(function (this: Record<string, unknown>) {
  this['scenarioCtx'] = SpecFormulaBridge.getInstance().newScenario()
})

After(async () => {
  await SpecFormulaBridge.getInstance().endScenario()
})

AfterAll(async () => {
  await SpecFormulaBridge.getInstance().closeAllDataSources()
})
