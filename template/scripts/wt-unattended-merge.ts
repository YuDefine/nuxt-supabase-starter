// 🔒 LOCKED — managed by clade · Source: vendor/scripts/wt-unattended-merge.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/wt-unattended-merge.ts
/** Runtime parsers and fail-closed predicates for unattended coordinator merge. */
import { isRecord } from './lib/json-unknown.ts'

const objectIdPattern = /^[0-9a-f]{40}$/i
const leftoverKinds = new Set(['production-apply', 'safe-to-reset', 'line-uat', 'discord'])
const leftoverBlocks = new Set(['merge', 'release'])
const leftoverStatus = new Set(['pending', 'satisfied'])
const humanStatus = new Set(['passed', 'not-applicable', 'blocked-charles'])
const stagingPolicies = new Set(['serial-await-success', 'not-applicable'])

export type CharlesOnlyLeftover = {
  id: string
  workId: string
  carrier: string
  kind: 'production-apply' | 'safe-to-reset' | 'line-uat' | 'discord'
  blocks: 'merge' | 'release'
  status: 'pending' | 'satisfied'
  required_actor: 'Charles'
  evidence?: string
  hash?: string
}

export type UnattendedMergeAuthorization = {
  version: 1
  repository: string
  batchId: string
  workIds: string[]
  pr: number
  base: 'main'
  headBranch: string
  source_head: string
  reviewed_base: string
  candidate_tree: string
  seal_hash: string
  merge_method: 'squash'
  coordinator: { owner: string; runtime: string; session: string }
  authority: { evidence: string; hash: string }
  ci: {
    workflow_file: string
    ci_head_sha: string
    ci_run_id: number
    run_attempt: number
    required_jobs: string[]
  }[]
  human: {
    status: 'passed' | 'not-applicable' | 'blocked-charles'
    evidence: string
    hash: string
    leftovers: CharlesOnlyLeftover[]
  }
  staging_deploy_policy: 'serial-await-success' | 'not-applicable'
  deployment_evidence: { evidence: string; hash: string }
}

export type WorkflowJobSnapshot = {
  name: string
  status: string
  conclusion: string | null
}

export type WorkflowRunSnapshot = {
  workflowFile: string
  databaseId: number
  headSha: string
  event: string
  status: string
  conclusion: string | null
  runAttempt: number
  jobs: WorkflowJobSnapshot[]
}

export type UnattendedDeployAdmission = {
  allowMerge: boolean
  allowRelease: boolean
  reason: string
}

export type UnattendedWorld = {
  callerRole: 'coordinator' | 'worker'
  landingOwner: string
  remotePr: {
    state: 'OPEN' | 'CLOSED' | 'MERGED'
    mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
    base: string
    headSha: string
    headRef: string
    holds: string[]
  }
  remoteMainSha: string
  formalHead: string
  formalTree: string
  seal: { head?: string; tree: string; hash: string; phase: string }
  members: { workId: string; authorized: boolean; released: boolean }[]
  draftBindings: { workId: string; pr: number; headBranch: string }[]
  ciRuns: WorkflowRunSnapshot[]
  deploy: UnattendedDeployAdmission
  releaseWindow: { status: 'none' | 'active' | 'unknown' }
  pendingStaging: boolean
  doNotMerge: boolean
  alreadyMerged: boolean
  authorityRevoked: boolean
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${name}`)
  return value
}

function requireObjectId(value: unknown, name: string): string {
  const id = requireString(value, name).toLowerCase()
  if (!objectIdPattern.test(id)) throw new Error(`Invalid ${name}`)
  return id
}

function requirePositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid ${name}`)
  return value
}

export function parseCharlesOnlyLeftover(value: unknown): CharlesOnlyLeftover {
  if (!isRecord(value)) throw new Error('Invalid leftover record')
  const kind = requireString(value.kind, 'leftover.kind')
  const blocks = requireString(value.blocks, 'leftover.blocks')
  const status = requireString(value.status, 'leftover.status')
  if (!leftoverKinds.has(kind) || !leftoverBlocks.has(blocks) || !leftoverStatus.has(status))
    throw new Error('Invalid leftover kind, blocks or status')
  if (value.required_actor !== 'Charles') throw new Error('Leftover required_actor must be Charles')
  const leftover: CharlesOnlyLeftover = {
    id: requireString(value.id, 'leftover.id'),
    workId: requireString(value.workId, 'leftover.workId'),
    carrier: requireString(value.carrier, 'leftover.carrier'),
    kind: kind as CharlesOnlyLeftover['kind'],
    blocks: blocks as CharlesOnlyLeftover['blocks'],
    status: status as CharlesOnlyLeftover['status'],
    required_actor: 'Charles',
  }
  if (value.evidence !== undefined)
    leftover.evidence = requireString(value.evidence, 'leftover.evidence')
  if (value.hash !== undefined) leftover.hash = requireString(value.hash, 'leftover.hash')
  return leftover
}

export function parseUnattendedMergeAuthorization(value: unknown): UnattendedMergeAuthorization {
  if (!isRecord(value)) throw new Error('Invalid unattended merge authorization')
  if (value.version !== 1) throw new Error('Unattended authorization version must be 1')
  if (value.base !== 'main') throw new Error('Unattended merge base must be main')
  if (value.merge_method !== 'squash') throw new Error('Unattended merge_method must be squash')
  if (!isRecord(value.coordinator)) throw new Error('Invalid coordinator identity')
  if (!isRecord(value.authority)) throw new Error('Invalid authority evidence')
  if (!Array.isArray(value.ci) || value.ci.length === 0) throw new Error('CI bindings required')
  if (!isRecord(value.human)) throw new Error('Invalid human gate record')
  const status = requireString(value.human.status, 'human.status')
  if (!humanStatus.has(status)) throw new Error('Invalid human.status')
  if (!Array.isArray(value.human.leftovers)) throw new Error('human.leftovers required')
  if (!stagingPolicies.has(String(value.staging_deploy_policy)))
    throw new Error('Invalid staging_deploy_policy')
  if (!isRecord(value.deployment_evidence)) throw new Error('Invalid deployment_evidence')
  const workIds = value.workIds
  if (!Array.isArray(workIds) || workIds.some((id) => typeof id !== 'string' || !id.trim()))
    throw new Error('Invalid workIds')
  const ci = value.ci.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid ci[${index}]`)
    if (
      !Array.isArray(row.required_jobs) ||
      row.required_jobs.some((job) => typeof job !== 'string')
    )
      throw new Error(`Invalid ci[${index}].required_jobs`)
    return {
      workflow_file: requireString(row.workflow_file, `ci[${index}].workflow_file`),
      ci_head_sha: requireObjectId(row.ci_head_sha, `ci[${index}].ci_head_sha`),
      ci_run_id: requirePositiveInt(row.ci_run_id, `ci[${index}].ci_run_id`),
      run_attempt: requirePositiveInt(row.run_attempt, `ci[${index}].run_attempt`),
      required_jobs: row.required_jobs as string[],
    }
  })
  return {
    version: 1,
    repository: requireString(value.repository, 'repository'),
    batchId: requireString(value.batchId, 'batchId'),
    workIds: workIds as string[],
    pr: requirePositiveInt(value.pr, 'pr'),
    base: 'main',
    headBranch: requireString(value.headBranch, 'headBranch'),
    source_head: requireObjectId(value.source_head, 'source_head'),
    reviewed_base: requireObjectId(value.reviewed_base, 'reviewed_base'),
    candidate_tree: requireObjectId(value.candidate_tree, 'candidate_tree'),
    seal_hash: requireString(value.seal_hash, 'seal_hash'),
    merge_method: 'squash',
    coordinator: {
      owner: requireString(value.coordinator.owner, 'coordinator.owner'),
      runtime: requireString(value.coordinator.runtime, 'coordinator.runtime'),
      session: requireString(value.coordinator.session, 'coordinator.session'),
    },
    authority: {
      evidence: requireString(value.authority.evidence, 'authority.evidence'),
      hash: requireString(value.authority.hash, 'authority.hash'),
    },
    ci,
    human: {
      status: status as UnattendedMergeAuthorization['human']['status'],
      evidence: requireString(value.human.evidence, 'human.evidence'),
      hash: requireString(value.human.hash, 'human.hash'),
      leftovers: value.human.leftovers.map(parseCharlesOnlyLeftover),
    },
    staging_deploy_policy:
      value.staging_deploy_policy as UnattendedMergeAuthorization['staging_deploy_policy'],
    deployment_evidence: {
      evidence: requireString(value.deployment_evidence.evidence, 'deployment_evidence.evidence'),
      hash: requireString(value.deployment_evidence.hash, 'deployment_evidence.hash'),
    },
  }
}

export function assertCiAdmission(
  required: UnattendedMergeAuthorization['ci'],
  runs: WorkflowRunSnapshot[],
  formalHead: string,
): void {
  if (!runs) throw new Error('CI API unavailable')
  for (const binding of required) {
    if (binding.ci_head_sha !== formalHead)
      throw new Error(`CI binding SHA ${binding.ci_head_sha} is not formal HEAD ${formalHead}`)
    const matching = runs.filter(
      (run) => run.workflowFile === binding.workflow_file && run.headSha === formalHead,
    )
    if (matching.length === 0)
      throw new Error(`No CI run for ${binding.workflow_file} at ${formalHead}`)
    const named = matching.find((run) => run.databaseId === binding.ci_run_id)
    if (!named)
      throw new Error(
        `CI run ${binding.ci_run_id} is not the latest binding for ${binding.workflow_file}`,
      )
    const latest = matching.reduce((best, run) =>
      run.runAttempt > best.runAttempt ||
      (run.runAttempt === best.runAttempt && run.databaseId > best.databaseId)
        ? run
        : best,
    )
    if (latest.databaseId !== binding.ci_run_id || latest.runAttempt !== binding.run_attempt)
      throw new Error(
        `CI binding is stale: latest ${binding.workflow_file} is run ${latest.databaseId} attempt ${latest.runAttempt}`,
      )
    if (latest.status !== 'completed' || latest.conclusion !== 'success')
      throw new Error(`CI ${binding.workflow_file} is ${latest.status}/${latest.conclusion}`)
    for (const jobName of binding.required_jobs) {
      const job = latest.jobs.find((item) => item.name === jobName)
      if (!job) throw new Error(`Required CI job ${jobName} missing from ${binding.workflow_file}`)
      if (job.status !== 'completed' || job.conclusion !== 'success')
        throw new Error(`Required CI job ${jobName} is ${job.status}/${job.conclusion}`)
    }
  }
}

export function mergeBoundLeftovers(
  leftovers: CharlesOnlyLeftover[],
  workIds: string[],
): CharlesOnlyLeftover[] {
  return leftovers.filter(
    (item) => item.blocks === 'merge' && item.status === 'pending' && workIds.includes(item.workId),
  )
}

export function evaluateUnattendedAdmission(
  auth: UnattendedMergeAuthorization,
  world: UnattendedWorld,
): { action: 'merge' | 'confirm-only' | 'yield-blocked' } {
  if (world.callerRole !== 'coordinator')
    throw new Error('Unattended merge requires the named coordinator, not a slice worker')
  if (world.landingOwner !== auth.coordinator.owner)
    throw new Error('Caller does not hold unique landing ownership for this repository')
  if (world.authorityRevoked) throw new Error('Landing authority has been revoked')
  if (world.doNotMerge || world.remotePr.holds.includes('do-not-merge'))
    throw new Error('Explicit do-not-merge hold is still in force')
  if (world.seal.phase !== 'sealed') throw new Error('Batch is not sealed')
  if (auth.seal_hash !== world.seal.hash) throw new Error('Authorization seal hash does not match')
  if (
    auth.source_head !== world.formalHead ||
    (world.seal.head && world.seal.head !== world.formalHead)
  )
    throw new Error('source_head / seal.head / GitHub head SHA mismatch')
  if (world.remotePr.headSha !== world.formalHead)
    throw new Error('GitHub PR head is not the formal HEAD')
  if (world.formalTree !== auth.candidate_tree || world.seal.tree !== auth.candidate_tree)
    throw new Error('Formal tree is not the candidate tree')
  if (world.remoteMainSha !== auth.reviewed_base)
    throw new Error('Remote main moved; refresh and reseal')
  if (world.members.some((member) => !member.authorized || !member.released))
    throw new Error(
      'ReadySource authorized/released is insufficient without a sealed batch and unattended authorization, and both must still be true',
    )
  if (world.members.some((member) => !auth.workIds.includes(member.workId)))
    throw new Error('Authorization workIds do not cover every batch member')
  if (auth.workIds.some((id) => !world.members.some((member) => member.workId === id)))
    throw new Error('Authorization names a workId that is not in this batch')
  const bindings = world.draftBindings
  if (bindings.length === 0) throw new Error('Draft PR binding required')
  for (const binding of bindings) {
    if (binding.pr !== auth.pr || binding.headBranch !== auth.headBranch)
      throw new Error('Authorization PR/headBranch does not match draft binding')
  }
  if (new Set(bindings.map((binding) => binding.pr)).size !== 1)
    throw new Error('A workId cannot bind multiple PRs')
  if (world.remotePr.state !== 'OPEN') throw new Error('PR is not OPEN')
  if (world.remotePr.base !== 'main') throw new Error('PR base is not main')
  if (world.remotePr.mergeable !== 'MERGEABLE')
    throw new Error('PR is conflicted or mergeable unknown')
  if (world.remotePr.headRef !== auth.headBranch)
    throw new Error('PR head branch does not match authorization')
  if (world.releaseWindow.status !== 'none')
    throw new Error(`Release window is ${world.releaseWindow.status}; refuse new main updates`)
  if (world.pendingStaging) throw new Error('Previous merge is still awaiting staging verification')
  if (!world.deploy.allowMerge) throw new Error(world.deploy.reason)
  if (auth.human.status === 'blocked-charles') {
    const blocking = mergeBoundLeftovers(auth.human.leftovers, auth.workIds)
    if (blocking.length > 0) return { action: 'yield-blocked' }
    throw new Error('Human gate is blocked-charles and cannot pass merge')
  }
  const pendingMerge = mergeBoundLeftovers(auth.human.leftovers, auth.workIds)
  if (pendingMerge.length > 0)
    throw new Error('Pending merge-bound Charles leftover blocks unattended merge')
  if (auth.human.status !== 'passed' && auth.human.status !== 'not-applicable')
    throw new Error('Human gate must be passed or not-applicable with a checkable reason')
  assertCiAdmission(auth.ci, world.ciRuns, world.formalHead)
  if (world.alreadyMerged) return { action: 'confirm-only' }
  return { action: 'merge' }
}

export function evaluateUnattendedDeployAdmission(input: {
  triggerVerdict: 'confirmed-push-main' | 'needs-approval'
  triggerStatus: 'confirmed' | 'mismatch' | 'undeclared' | 'unconfirmable'
  declaredProduction: string | null
  declaredMainPushScope: 'staging-only' | 'production' | 'none' | null
  derivedMainPushScope: 'staging-only' | 'production' | 'none' | 'unknown'
}): UnattendedDeployAdmission {
  if (
    input.triggerStatus === 'mismatch' ||
    input.triggerStatus === 'undeclared' ||
    input.triggerStatus === 'unconfirmable' ||
    input.derivedMainPushScope === 'unknown'
  ) {
    return {
      allowMerge: false,
      allowRelease: false,
      reason: `Deploy trigger is ${input.triggerStatus}; unattended merge is refuse-closed`,
    }
  }
  if (
    input.triggerVerdict === 'confirmed-push-main' &&
    input.derivedMainPushScope === 'production'
  ) {
    return {
      allowMerge: false,
      allowRelease: false,
      reason: 'confirmed-push-main production is a release; refuse unattended merge',
    }
  }
  if (
    input.declaredMainPushScope === 'staging-only' &&
    input.derivedMainPushScope === 'production'
  ) {
    return {
      allowMerge: false,
      allowRelease: false,
      reason: 'staging-only declaration contradicts production main-push workflows',
    }
  }
  if (
    input.triggerVerdict === 'needs-approval' &&
    input.triggerStatus === 'confirmed' &&
    (input.declaredProduction === 'tag-v' || input.declaredProduction === 'manual') &&
    input.declaredMainPushScope === 'staging-only' &&
    input.derivedMainPushScope === 'staging-only'
  ) {
    return {
      allowMerge: true,
      allowRelease: false,
      reason: 'tag-v/manual production with confirmed staging-only main push; land without release',
    }
  }
  if (input.declaredMainPushScope === 'none' && input.derivedMainPushScope === 'none') {
    return { allowMerge: true, allowRelease: false, reason: 'main push has no deploy effect' }
  }
  if (!input.declaredMainPushScope) {
    return {
      allowMerge: false,
      allowRelease: false,
      reason: 'deploy.mainPushScope is undeclared; unattended merge stays disabled',
    }
  }
  return {
    allowMerge: false,
    allowRelease: false,
    reason: 'Unattended deploy admission did not match a confirmed safe shape',
  }
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${name}`)
  return value
}

export function parseUnattendedWorld(value: unknown): UnattendedWorld {
  if (!isRecord(value)) throw new Error('Unattended world must be an object')
  const extra = Object.keys(value).filter(
    (key) =>
      ![
        'callerRole',
        'landingOwner',
        'remotePr',
        'remoteMainSha',
        'formalHead',
        'formalTree',
        'seal',
        'members',
        'draftBindings',
        'ciRuns',
        'deploy',
        'releaseWindow',
        'pendingStaging',
        'doNotMerge',
        'alreadyMerged',
        'authorityRevoked',
      ].includes(key),
  )
  if (extra.length > 0) throw new Error(`Unknown unattended world field ${extra[0]}`)
  if (value.callerRole !== 'coordinator' && value.callerRole !== 'worker')
    throw new Error('Invalid callerRole')
  if (!isRecord(value.remotePr)) throw new Error('Invalid remotePr')
  if (
    value.remotePr.state !== 'OPEN' &&
    value.remotePr.state !== 'CLOSED' &&
    value.remotePr.state !== 'MERGED'
  )
    throw new Error('Invalid remotePr.state')
  if (
    value.remotePr.mergeable !== 'MERGEABLE' &&
    value.remotePr.mergeable !== 'CONFLICTING' &&
    value.remotePr.mergeable !== 'UNKNOWN'
  )
    throw new Error('Invalid remotePr.mergeable')
  if (
    !Array.isArray(value.remotePr.holds) ||
    value.remotePr.holds.some((item) => typeof item !== 'string')
  )
    throw new Error('Invalid remotePr.holds')
  if (!isRecord(value.seal)) throw new Error('Invalid seal')
  if (typeof value.seal.phase !== 'string' || !value.seal.phase.trim())
    throw new Error('Invalid seal.phase')
  if (!Array.isArray(value.members) || value.members.length === 0)
    throw new Error('Invalid members')
  const members = value.members.map((member, index) => {
    if (!isRecord(member)) throw new Error(`Invalid members[${index}]`)
    return {
      workId: requireString(member.workId, `members[${index}].workId`),
      authorized: requireBoolean(member.authorized, `members[${index}].authorized`),
      released: requireBoolean(member.released, `members[${index}].released`),
    }
  })
  if (!Array.isArray(value.draftBindings)) throw new Error('Invalid draftBindings')
  const draftBindings = value.draftBindings.map((binding, index) => {
    if (!isRecord(binding)) throw new Error(`Invalid draftBindings[${index}]`)
    return {
      workId: requireString(binding.workId, `draftBindings[${index}].workId`),
      pr: requirePositiveInt(binding.pr, `draftBindings[${index}].pr`),
      headBranch: requireString(binding.headBranch, `draftBindings[${index}].headBranch`),
    }
  })
  if (!Array.isArray(value.ciRuns)) throw new Error('Invalid ciRuns')
  const ciRuns: WorkflowRunSnapshot[] = value.ciRuns.map((run, index) => {
    if (!isRecord(run)) throw new Error(`Invalid ciRuns[${index}]`)
    if (!Array.isArray(run.jobs)) throw new Error(`Invalid ciRuns[${index}].jobs`)
    return {
      workflowFile: requireString(run.workflowFile, `ciRuns[${index}].workflowFile`),
      databaseId: requirePositiveInt(run.databaseId, `ciRuns[${index}].databaseId`),
      headSha: requireObjectId(run.headSha, `ciRuns[${index}].headSha`),
      event: requireString(run.event, `ciRuns[${index}].event`),
      status: requireString(run.status, `ciRuns[${index}].status`),
      conclusion:
        run.conclusion === null
          ? null
          : requireString(run.conclusion, `ciRuns[${index}].conclusion`),
      runAttempt: requirePositiveInt(run.runAttempt, `ciRuns[${index}].runAttempt`),
      jobs: run.jobs.map((job, jobIndex) => {
        if (!isRecord(job)) throw new Error(`Invalid ciRuns[${index}].jobs[${jobIndex}]`)
        return {
          name: requireString(job.name, `ciRuns[${index}].jobs[${jobIndex}].name`),
          status: requireString(job.status, `ciRuns[${index}].jobs[${jobIndex}].status`),
          conclusion:
            job.conclusion === null
              ? null
              : requireString(job.conclusion, `ciRuns[${index}].jobs[${jobIndex}].conclusion`),
        }
      }),
    }
  })
  if (!isRecord(value.deploy)) throw new Error('Invalid deploy')
  if (!isRecord(value.releaseWindow)) throw new Error('Invalid releaseWindow')
  if (
    value.releaseWindow.status !== 'none' &&
    value.releaseWindow.status !== 'active' &&
    value.releaseWindow.status !== 'unknown'
  )
    throw new Error('Invalid releaseWindow.status')
  return {
    callerRole: value.callerRole,
    landingOwner: requireString(value.landingOwner, 'landingOwner'),
    remotePr: {
      state: value.remotePr.state,
      mergeable: value.remotePr.mergeable,
      base: requireString(value.remotePr.base, 'remotePr.base'),
      headSha: requireObjectId(value.remotePr.headSha, 'remotePr.headSha'),
      headRef: requireString(value.remotePr.headRef, 'remotePr.headRef'),
      holds: value.remotePr.holds,
    },
    remoteMainSha: requireObjectId(value.remoteMainSha, 'remoteMainSha'),
    formalHead: requireObjectId(value.formalHead, 'formalHead'),
    formalTree: requireObjectId(value.formalTree, 'formalTree'),
    seal: {
      head:
        value.seal.head === undefined ? undefined : requireObjectId(value.seal.head, 'seal.head'),
      tree: requireObjectId(value.seal.tree, 'seal.tree'),
      hash: requireString(value.seal.hash, 'seal.hash'),
      phase: value.seal.phase,
    },
    members,
    draftBindings,
    ciRuns,
    deploy: {
      allowMerge: requireBoolean(value.deploy.allowMerge, 'deploy.allowMerge'),
      allowRelease: requireBoolean(value.deploy.allowRelease, 'deploy.allowRelease'),
      reason: requireString(value.deploy.reason, 'deploy.reason'),
    },
    releaseWindow: { status: value.releaseWindow.status },
    pendingStaging: requireBoolean(value.pendingStaging, 'pendingStaging'),
    doNotMerge: requireBoolean(value.doNotMerge, 'doNotMerge'),
    alreadyMerged: requireBoolean(value.alreadyMerged, 'alreadyMerged'),
    authorityRevoked: requireBoolean(value.authorityRevoked, 'authorityRevoked'),
  }
}
