#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/preservation-inventory.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/preservation-inventory.ts

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  capacityRequirement,
  inventoryTree,
  PRESERVATION_POLICY_ID,
  type CapacityRequirement,
  type SourceInventory,
} from './preservation-policy.ts'
import { preservationProfileFor, unknownProfileFields } from './preservation-profiles.ts'

interface RegistryConsumer {
  consumer_id: string
}

interface Registry {
  consumers: RegistryConsumer[]
}

interface LocalConsumer {
  consumerId: string
  path: string
  flow: string
}

export interface ConsumerInventoryReceipt {
  consumerId: string
  path: string
  flow: string
  profile: { id: string; unknownFields: string[] }
  state: 'INVENTORIED' | 'UNKNOWN' | 'INVENTORY_FAILED'
  inventory?: Pick<SourceInventory, 'digest' | 'entryCount' | 'logicalBytes' | 'allocatedBytes'>
  capacity?: CapacityRequirement
  error?: string
}

export interface FleetInventoryReceipt {
  schemaVersion: 1
  policy: string
  generatedAt: string
  repoRoot: string
  registryPath: string
  localPath: string
  consumers: ConsumerInventoryReceipt[]
  drift: { kind: 'unregistered-local' | 'missing-local'; consumerId: string; path?: string }[]
}

function readRegistry(path: string): Registry {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { consumers?: unknown }).consumers)
  )
    throw new Error(`Invalid consumer registry: ${path}`)
  const consumers = (parsed as { consumers: unknown[] }).consumers
  if (
    consumers.some(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as { consumer_id?: unknown }).consumer_id !== 'string',
    )
  )
    throw new Error(`Consumer registry has an invalid consumer entry: ${path}`)
  return { consumers: consumers as RegistryConsumer[] }
}

function readLocal(path: string): LocalConsumer[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [consumerPath, flowToken = 'flow=unknown'] = line.split(/\s+/)
      const match = /^flow=(.+)$/.exec(flowToken)
      if (!consumerPath || !match) throw new Error(`Invalid consumers.local line: ${line}`)
      return { consumerId: basename(consumerPath), path: consumerPath, flow: match[1] }
    })
}

export function inventoryConsumers(options: {
  repoRoot: string
  registryPath?: string
  localPath?: string
}): FleetInventoryReceipt {
  const repoRoot = resolve(options.repoRoot)
  const registryPath = resolve(repoRoot, options.registryPath ?? 'registry/consumers.json')
  const localPath = resolve(repoRoot, options.localPath ?? 'consumers.local')
  const registry = readRegistry(registryPath)
  const local = readLocal(localPath)
  const registryIds = new Set(registry.consumers.map((consumer) => consumer.consumer_id))
  const identify = (entry: LocalConsumer): string => {
    const normalized = resolve(entry.path)
    const exact = registry.consumers.find((consumer) =>
      normalized.endsWith(`/${consumer.consumer_id}`),
    )
    if (exact) return exact.consumer_id
    const nested = registry.consumers.find((consumer) =>
      normalized.includes(`/${consumer.consumer_id}/`),
    )
    return nested?.consumer_id ?? entry.consumerId
  }
  const identifiedLocal = local.map((entry) => ({ ...entry, consumerId: identify(entry) }))
  const inventoryOne = (entry: LocalConsumer): ConsumerInventoryReceipt => {
    const path = resolve(entry.path)
    const profile = preservationProfileFor(
      entry.consumerId,
      path,
      resolve(repoRoot, '.clade/preservation'),
    )
    if (!existsSync(path))
      return {
        consumerId: entry.consumerId,
        path,
        flow: entry.flow,
        profile: { id: profile.id, unknownFields: unknownProfileFields(profile) },
        state: 'UNKNOWN',
        error: 'consumer root is absent; no inventory was performed',
      }
    try {
      const inventory = inventoryTree(path)
      return {
        consumerId: entry.consumerId,
        path,
        flow: entry.flow,
        profile: { id: profile.id, unknownFields: unknownProfileFields(profile) },
        state: 'INVENTORIED',
        inventory: {
          digest: inventory.digest,
          entryCount: inventory.entryCount,
          logicalBytes: inventory.logicalBytes,
          allocatedBytes: inventory.allocatedBytes,
        },
        capacity: capacityRequirement(path, inventory),
      }
    } catch (error) {
      return {
        consumerId: entry.consumerId,
        path,
        flow: entry.flow,
        profile: { id: profile.id, unknownFields: unknownProfileFields(profile) },
        state: 'INVENTORY_FAILED',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const consumers: ConsumerInventoryReceipt[] = [
    inventoryOne({ consumerId: 'clade', path: repoRoot, flow: 'main' }),
    ...identifiedLocal.filter((entry) => entry.consumerId !== 'clade').map(inventoryOne),
  ]
  const drift = [
    ...identifiedLocal
      .filter((entry) => !registryIds.has(entry.consumerId))
      .map((entry) => ({
        kind: 'unregistered-local' as const,
        consumerId: entry.consumerId,
        path: resolve(entry.path),
      })),
    ...registry.consumers
      .filter(
        (entry) =>
          !identifiedLocal.some((localEntry) => localEntry.consumerId === entry.consumer_id) &&
          entry.consumer_id !== 'clade',
      )
      .map((entry) => ({ kind: 'missing-local' as const, consumerId: entry.consumer_id })),
  ]
  return {
    schemaVersion: 1,
    policy: PRESERVATION_POLICY_ID,
    generatedAt: new Date().toISOString(),
    repoRoot,
    registryPath,
    localPath,
    consumers,
    drift,
  }
}

async function writeThenExit(payload: string, code: number): Promise<never> {
  await new Promise<void>((resolveOutput) => process.stdout.write(payload, () => resolveOutput()))
  process.exit(code)
}

async function main(): Promise<never> {
  const args = process.argv.slice(2)
  const repoRoot =
    args.find((arg) => arg.startsWith('--repo='))?.slice('--repo='.length) ?? process.cwd()
  const output = args.find((arg) => arg.startsWith('--write='))?.slice('--write='.length)
  const receipt = inventoryConsumers({ repoRoot })
  if (output)
    writeFileSync(resolve(repoRoot, output), JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
  const failed =
    receipt.consumers.some((consumer) => consumer.state !== 'INVENTORIED') ||
    receipt.drift.length > 0
  return writeThenExit(JSON.stringify(receipt, null, 2) + '\n', failed ? 1 : 0)
}

function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) await main()
