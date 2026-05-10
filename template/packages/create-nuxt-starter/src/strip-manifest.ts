import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'pathe'

const STARTER_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const DEFAULT_STRIP_MANIFEST_PATH = join(STARTER_ROOT, 'presets', '_base', 'strip-manifest.json')
const ALLOWED_CONSUMERS = ['create-clean', 'scaffolder'] as const

export type StripManifestConsumer = (typeof ALLOWED_CONSUMERS)[number]

export interface StripManifestEntry {
  path?: string
  glob?: string
  reason: string
  consumers: StripManifestConsumer[]
  required: boolean
}

export interface StripManifest {
  schema_version: 1
  entries: StripManifestEntry[]
}

export interface ApplyStripManifestOptions {
  consumer: StripManifestConsumer
}

export interface StripManifestResult {
  stripped: string[]
  skipped: string[]
}

interface NormalizedStripManifestEntry extends StripManifestEntry {
  selector: string
  selectorField: 'path' | 'glob'
}

export class StripManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripManifestError'
  }
}

export function loadStripManifest(manifestPath = DEFAULT_STRIP_MANIFEST_PATH): StripManifest {
  if (!existsSync(manifestPath)) {
    throw new StripManifestError(`strip-manifest.json is missing: ${manifestPath}`)
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (error) {
    throw new StripManifestError(
      `strip-manifest.json is malformed JSON: ${(error as Error).message}`
    )
  }

  return validateManifest(manifest, { manifestPath })
}

export function validateManifest(
  value: unknown,
  options: { manifestPath?: string } = {}
): StripManifest {
  const manifestPath = options.manifestPath ?? 'strip-manifest.json'

  if (!isRecord(value)) {
    fail(manifestPath, 'manifest must be an object')
  }

  if (value.schema_version !== 1) {
    fail(manifestPath, `unknown schema_version ${String(value.schema_version)}`)
  }

  if (!Array.isArray(value.entries)) {
    fail(manifestPath, 'entries must be an array')
  }

  const entries = value.entries.map((entry, index) => validateEntry(entry, index, manifestPath))

  return {
    schema_version: 1,
    entries,
  }
}

export function applyStripManifest(
  targetDir: string,
  manifest: StripManifest,
  options: ApplyStripManifestOptions
): StripManifestResult {
  if (!ALLOWED_CONSUMERS.includes(options.consumer)) {
    throw new StripManifestError(`strip-manifest.json: unknown consumer ${options.consumer}`)
  }

  const stripped: string[] = []
  const skipped: string[] = []
  const applicableEntries = manifest.entries
    .map((entry) => normalizeEntry(entry))
    .filter((entry) => entry.consumers.includes(options.consumer))

  for (const entry of applicableEntries) {
    const matches = resolveMatches(targetDir, entry)

    if (matches.length === 0) {
      if (entry.required) {
        throw new StripManifestError(
          `strip-manifest.json: required ${entry.selectorField} is absent: ${entry.selector}`
        )
      }
      skipped.push(entry.selector)
      continue
    }

    for (const match of matches) {
      rmSync(join(targetDir, match), { recursive: true, force: true })
      stripped.push(match)
    }
  }

  return { stripped, skipped }
}

function validateEntry(entry: unknown, index: number, manifestPath: string): StripManifestEntry {
  if (!isRecord(entry)) {
    fail(manifestPath, `entries[${index}] must be an object`)
  }

  const hasPath = Object.hasOwn(entry, 'path')
  const hasGlob = Object.hasOwn(entry, 'glob')
  if (hasPath === hasGlob) {
    fail(manifestPath, `entries[${index}] must include exactly one of path or glob`)
  }

  const selectorField = hasPath ? 'path' : 'glob'
  const selector = normalizeSelector(entry[selectorField], selectorField, index, manifestPath)

  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    fail(manifestPath, `entries[${index}].reason must be a non-empty string`)
  }

  if (!Array.isArray(entry.consumers) || entry.consumers.length === 0) {
    fail(manifestPath, `entries[${index}].consumers are required`)
  }

  const consumers = entry.consumers.map((consumer) => {
    if (typeof consumer !== 'string' || !isAllowedConsumer(consumer)) {
      fail(manifestPath, `entries[${index}].consumers has unknown consumer: ${String(consumer)}`)
    }
    return consumer
  })

  if (typeof entry.required !== 'boolean') {
    fail(manifestPath, `entries[${index}].required must be boolean`)
  }

  return {
    [selectorField]: selector,
    reason: entry.reason,
    consumers,
    required: entry.required,
  }
}

function normalizeEntry(entry: StripManifestEntry): NormalizedStripManifestEntry {
  if (entry.path) {
    return { ...entry, selector: entry.path, selectorField: 'path' }
  }
  return { ...entry, selector: entry.glob as string, selectorField: 'glob' }
}

function normalizeSelector(
  value: unknown,
  fieldName: 'path' | 'glob',
  index: number,
  manifestPath: string
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(manifestPath, `entries[${index}].${fieldName} must be a non-empty string`)
  }

  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    fail(manifestPath, `entries[${index}].${fieldName} absolute paths are not allowed: ${value}`)
  }

  const normalized = value.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.includes('..')) {
    fail(manifestPath, `entries[${index}].${fieldName} path traversal is not allowed: ${value}`)
  }

  const resolved = resolve('/', normalized)
  const relativePath = relative('/', resolved)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    fail(manifestPath, `entries[${index}].${fieldName} escapes root: ${value}`)
  }

  return normalized
}

function resolveMatches(targetDir: string, entry: NormalizedStripManifestEntry): string[] {
  if (entry.path) {
    return existsSync(join(targetDir, entry.path)) ? [entry.path] : []
  }

  const matcher = globToRegExp(entry.glob as string)
  return walk(targetDir).filter((relativePath) => matcher.test(relativePath))
}

function walk(rootDir: string, relativeDir = ''): string[] {
  const absoluteDir = join(rootDir, relativeDir)
  if (!existsSync(absoluteDir)) return []

  const results: string[] = []
  for (const dirent of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name
    results.push(relativePath)
    if (dirent.isDirectory()) {
      results.push(...walk(rootDir, relativePath))
    }
  }
  return results
}

function globToRegExp(glob: string): RegExp {
  let pattern = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    const next = glob[i + 1]
    if (char === '*' && next === '*') {
      pattern += '.*'
      i++
    } else if (char === '*') {
      pattern += '[^/]*'
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`^${pattern}$`)
}

function isAllowedConsumer(value: string): value is StripManifestConsumer {
  return ALLOWED_CONSUMERS.includes(value as StripManifestConsumer)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(manifestPath: string, message: string): never {
  throw new StripManifestError(`${manifestPath}: ${message}`)
}
