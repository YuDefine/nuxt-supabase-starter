import { existsSync, readFileSync } from 'node:fs'
import { QUESTION_CATALOG, questionById } from './question-catalog'

/**
 * intake 階段的具名診斷錯誤。`code` 會進 --json report 的 diagnostics，
 * 讓機器呼叫端（AI intake）可以穩定分類，不靠訊息文字猜。
 */
export class IntakeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'IntakeError'
  }
}

/** 攤平後的 catalog 題值：旗標與 answers-file 走同一個 normalizer，所以共用同一份形狀。 */
export interface CatalogArgValues {
  dbHost?: string
  /** register-fleet 解析結果；false = scaffold-only，true = managed 流程 */
  register?: boolean
  repoId?: string
  workflowModel?: string
  businessActivity?: string
  /** 'auto' 或 1024-65535 的 port 字串（custom 只存在互動流程，機讀答案不接受） */
  devPort?: string
  deployTrack?: string
  updatePolicy?: string
}

/**
 * 載入 `--answers-file`：AI intake 的機讀答案檔。
 * 契約：`{ schemaVersion: 1, answers: { <catalog-id>: <value> } }`。
 * 只放 catalog 題的答案；preset／目標路徑／release-store／registry 等執行控制仍走 flags。
 * 未知 id、壞 JSON、不支援的 schemaVersion、非純量值都在這裡拒絕——寫第一個檔之前。
 */
export function loadAnswersFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    throw new IntakeError('INTAKE_INVALID', `--answers-file 找不到檔案：${path}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new IntakeError(
      'INTAKE_INVALID',
      `--answers-file 不是合法 JSON：${path}（${(error as Error).message}）`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new IntakeError(
      'INTAKE_INVALID',
      '--answers-file 頂層必須是 JSON object：{ schemaVersion: 1, answers: { <catalog-id>: <value> } }',
    )
  }
  const { schemaVersion, answers } = parsed as { schemaVersion?: unknown; answers?: unknown }
  if (schemaVersion !== 1) {
    throw new IntakeError(
      'INTAKE_INVALID',
      `--answers-file schemaVersion 必須是 1（收到 ${JSON.stringify(schemaVersion)}）`,
    )
  }
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    throw new IntakeError('INTAKE_INVALID', '--answers-file 缺 answers object')
  }
  const known = new Set(QUESTION_CATALOG.map((q) => q.id))
  const result: Record<string, string> = {}
  for (const [id, raw] of Object.entries(answers)) {
    if (!known.has(id)) {
      throw new IntakeError(
        'INTAKE_INVALID',
        `--answers-file 含未知 question id「${id}」（可用 id：${QUESTION_CATALOG.map((q) => q.id).join(' | ')}）`,
      )
    }
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
      throw new IntakeError(
        'INTAKE_INVALID',
        `--answers-file「${id}」的值必須是字串／數字／布林（catalog 題值只接受純量）`,
      )
    }
    result[id] = String(raw)
  }
  return result
}

/**
 * 把 answers-file 的題值與顯式旗標併成一份 normalizer 輸入。
 * 同題同值 → 相容；同題不同值 → INTAKE_CONFLICT，在寫任何檔之前拒絕。
 * answers 只填旗標沒答到的題；旗標沒給也沒答的題留給 catalog default／missing check。
 */
export function mergeAnswersIntoFlags(
  answers: Record<string, string> | undefined,
  flags: {
    dbHost?: string
    /** `args['register-consumer']` 的解析值（default true） */
    registerConsumer: boolean
    repoId?: string
    workflowModel?: string
    businessActivity?: string
    devPort?: string
    deployTrack?: string
    updatePolicy?: string
  },
  present: ReadonlySet<string>,
): CatalogArgValues {
  // register-fleet 的旗標是 boolean 對偶：`--register-consumer` 明說 yes、`--no-register-consumer` 明說 no。
  const explicitRegister = present.has('--no-register-consumer')
    ? 'no'
    : present.has('--register-consumer')
      ? 'yes'
      : undefined
  const flagValues: Record<string, string | undefined> = {
    'db-host': flags.dbHost,
    'register-fleet': explicitRegister,
    'repo-id': flags.repoId,
    'workflow-model': flags.workflowModel,
    'business-activity': flags.businessActivity,
    'dev-port': flags.devPort,
    'deploy-track': flags.deployTrack,
    'update-policy': flags.updatePolicy,
  }
  const flagPresent: Record<string, boolean> = {
    'db-host': present.has('--db-host'),
    'register-fleet': explicitRegister !== undefined,
    'repo-id': present.has('--repo-id'),
    'workflow-model': present.has('--workflow-model'),
    'business-activity': present.has('--business-activity'),
    'dev-port': present.has('--dev-port'),
    'deploy-track': present.has('--deploy-track'),
    'update-policy': present.has('--update-policy'),
  }
  // register-fleet 的合法值域是 yes|no；其他 register 題的值域在
  // applyCatalogFlags（同一 normalizer）驗。這裡先擋「連布林語意都不合法」，
  // 避免 'maybe' 這種值被靜默當成 no。
  const registerAnswer = answers?.['register-fleet']
  if (registerAnswer !== undefined && registerAnswer !== 'yes' && registerAnswer !== 'no') {
    throw new IntakeError(
      'INTAKE_INVALID',
      `--answers-file「register-fleet」只接受 yes | no（收到 ${JSON.stringify(registerAnswer)}）`,
    )
  }
  if (answers) {
    for (const [id, answerValue] of Object.entries(answers)) {
      if (!flagPresent[id]) continue
      const flagValue = flagValues[id]
      if (flagValue !== answerValue) {
        throw new IntakeError(
          'INTAKE_CONFLICT',
          `--answers-file 的「${id}」=${JSON.stringify(answerValue)} 與顯式旗標 ${questionById(id).flag}=${JSON.stringify(flagValue)} 衝突；同題答案只能給一次`,
        )
      }
    }
  }
  const pick = (id: string, flagValue: string | undefined): string | undefined =>
    answers?.[id] ?? flagValue
  return {
    dbHost: pick('db-host', flags.dbHost),
    register: answers?.['register-fleet']
      ? answers['register-fleet'] === 'yes'
      : flags.registerConsumer !== false,
    repoId: pick('repo-id', flags.repoId),
    workflowModel: pick('workflow-model', flags.workflowModel),
    businessActivity: pick('business-activity', flags.businessActivity),
    devPort: pick('dev-port', flags.devPort),
    deployTrack: pick('deploy-track', flags.deployTrack),
    updatePolicy: pick('update-policy', flags.updatePolicy),
  }
}
