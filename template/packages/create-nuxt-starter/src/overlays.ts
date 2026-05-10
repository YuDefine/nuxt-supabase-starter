import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'pathe'

const DEFAULT_OVERLAYS_DIR = resolve(import.meta.dirname, '..', 'templates', 'overlays')

type SelectionValue = string | boolean | number | string[] | undefined

export type OverlaySelections = Record<string, SelectionValue>

export interface OverlayCondition {
  key: string
  values: string[]
}

export interface OverlayFileEntry {
  path: string
  when?: Record<string, string[]>
}

export type OverlayFileSpec = string | OverlayFileEntry

export interface OverlayPackageJsonDelta {
  remove_scripts?: string[]
  add_scripts?: Record<string, string>
  remove_dependencies?: string[]
  add_dependencies?: Record<string, string>
  remove_dev_dependencies?: string[]
  add_dev_dependencies?: Record<string, string>
}

export interface OverlayManifest {
  name: string
  description?: string
  requires?: Record<string, string[]>
  conflicts_with?: Array<string | OverlayCondition>
  add?: OverlayFileSpec[]
  remove?: OverlayFileSpec[]
  package_json?: OverlayPackageJsonDelta
}

export interface ApplyOverlayOptions {
  overlaysDir?: string
}

export interface ApplyOverlayResult {
  added: number
  removed: number
  packageJsonChanged: boolean
}

export class OverlayCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverlayCompatibilityError'
  }
}

export function validateOverlayCompatibility(
  manifest: OverlayManifest,
  selections: OverlaySelections
): void {
  const overlayName = manifest.name || '(unnamed overlay)'

  for (const [key, allowedValues] of Object.entries(manifest.requires || {})) {
    const actualValue = selections[key]
    if (!selectionMatches(actualValue, allowedValues)) {
      throw new OverlayCompatibilityError(
        `Overlay ${overlayName} requires ${key} to be one of ${allowedValues.join(
          ', '
        )}, got ${formatSelectionValue(actualValue)}`
      )
    }
  }

  for (const conflict of manifest.conflicts_with || []) {
    if (typeof conflict === 'string') {
      if (selectionMatches(selections.overlays, [conflict])) {
        throw new OverlayCompatibilityError(`Overlay ${overlayName} conflicts with ${conflict}`)
      }
      continue
    }

    const actualValue = selections[conflict.key]
    if (selectionMatches(actualValue, conflict.values)) {
      throw new OverlayCompatibilityError(
        `Overlay ${overlayName} conflicts with ${conflict.key}=${formatSelectionValue(actualValue)}`
      )
    }
  }
}

export function applyOverlay(
  targetDir: string,
  overlayName: string,
  selections: OverlaySelections,
  options: ApplyOverlayOptions = {}
): ApplyOverlayResult {
  const overlaysDir = options.overlaysDir || DEFAULT_OVERLAYS_DIR
  const overlayDir = join(overlaysDir, overlayName)
  const manifestPath = join(overlayDir, 'manifest.json')

  if (!existsSync(manifestPath)) {
    throw new Error(`Overlay ${overlayName} not found at ${manifestPath}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as OverlayManifest
  validateOverlayCompatibility(manifest, selections)

  let removed = 0
  for (const removeSpec of manifest.remove || []) {
    const relativePath = resolveOverlayFilePath(removeSpec)
    if (!matchesWhen(removeSpec, selections)) continue

    const targetPath = join(targetDir, relativePath)
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true })
      removed++
    }
  }

  let added = 0
  for (const addSpec of manifest.add || []) {
    const relativePath = resolveOverlayFilePath(addSpec)
    if (!matchesWhen(addSpec, selections)) continue

    const srcPath = join(overlayDir, 'add', relativePath)
    if (!existsSync(srcPath)) {
      throw new Error(`Overlay ${manifest.name} add file is missing: ${relativePath}`)
    }

    const destPath = join(targetDir, relativePath)
    mkdirSync(dirname(destPath), { recursive: true })
    cpSync(srcPath, destPath, { recursive: true })
    added++
  }

  const packageJsonChanged = applyPackageJsonDelta(targetDir, manifest.package_json)

  return { added, removed, packageJsonChanged }
}

function applyPackageJsonDelta(
  targetDir: string,
  delta: OverlayPackageJsonDelta | undefined
): boolean {
  if (!delta) return false

  const pkgPath = join(targetDir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`Cannot apply package_json delta: ${pkgPath} does not exist`)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  const scripts = ensureObject(pkg, 'scripts')
  const dependencies = ensureObject(pkg, 'dependencies')
  const devDependencies = ensureObject(pkg, 'devDependencies')

  for (const scriptName of delta.remove_scripts || []) {
    delete scripts[scriptName]
  }
  Object.assign(scripts, delta.add_scripts || {})

  for (const dependencyName of delta.remove_dependencies || []) {
    delete dependencies[dependencyName]
  }
  Object.assign(dependencies, delta.add_dependencies || {})

  for (const dependencyName of delta.remove_dev_dependencies || []) {
    delete devDependencies[dependencyName]
  }
  Object.assign(devDependencies, delta.add_dev_dependencies || {})

  pkg.scripts = sortObject(scripts)
  pkg.dependencies = sortObject(dependencies)
  pkg.devDependencies = sortObject(devDependencies)

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return true
}

function ensureObject(target: Record<string, unknown>, key: string): Record<string, string> {
  const value = target[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, string>
  }

  const next: Record<string, string> = {}
  target[key] = next
  return next
}

function resolveOverlayFilePath(spec: OverlayFileSpec): string {
  const relativePath = typeof spec === 'string' ? spec : spec.path
  const normalized = normalize(relativePath)

  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
    throw new Error(`Unsafe overlay path: ${relativePath}`)
  }

  return normalized
}

function matchesWhen(spec: OverlayFileSpec, selections: OverlaySelections): boolean {
  if (typeof spec === 'string' || !spec.when) return true

  return Object.entries(spec.when).every(([key, allowedValues]) =>
    selectionMatches(selections[key], allowedValues)
  )
}

function selectionMatches(actualValue: SelectionValue, allowedValues: string[]): boolean {
  if (Array.isArray(actualValue)) {
    return actualValue.some((value) => allowedValues.includes(value))
  }

  return allowedValues.includes(String(actualValue))
}

function formatSelectionValue(value: SelectionValue): string {
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  const sortedEntries: Array<[string, T]> = []

  for (const entry of Object.entries(obj)) {
    const insertAt = sortedEntries.findIndex(([key]) => entry[0].localeCompare(key) < 0)
    if (insertAt === -1) {
      sortedEntries.push(entry)
    } else {
      sortedEntries.splice(insertAt, 0, entry)
    }
  }

  return Object.fromEntries(sortedEntries)
}
