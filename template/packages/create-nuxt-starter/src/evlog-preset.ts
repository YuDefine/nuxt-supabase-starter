import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'pathe'
import type { EvlogPreset } from './types'

const PRESET_DIR_MAP: Record<Exclude<EvlogPreset, 'none'>, string> = {
  baseline: 'evlog-baseline',
  'd-pattern-audit': 'evlog-d-pattern-audit',
  'nuxthub-ai': 'evlog-nuxthub-ai',
}

const SKIP_FILES = new Set(['PRESET.md'])

export function applyEvlogPreset(
  targetDir: string,
  preset: EvlogPreset,
  starterRoot: string
): { applied: number; skipped: number } {
  if (preset === 'none') return { applied: 0, skipped: 0 }

  const presetDir = resolve(starterRoot, 'presets', PRESET_DIR_MAP[preset])
  if (!existsSync(presetDir)) {
    throw new Error(`[evlog-preset] preset directory not found: ${presetDir} (preset='${preset}')`)
  }

  let applied = 0
  let skipped = 0

  function walk(srcDir: string, relPath = ''): void {
    for (const entry of readdirSync(srcDir)) {
      const srcPath = join(srcDir, entry)
      const relSubPath = relPath ? join(relPath, entry) : entry
      const destPath = join(targetDir, relSubPath)
      const stat = statSync(srcPath)

      if (stat.isDirectory()) {
        walk(srcPath, relSubPath)
        continue
      }

      if (SKIP_FILES.has(entry)) {
        skipped++
        continue
      }

      mkdirSync(dirname(destPath), { recursive: true })
      cpSync(srcPath, destPath)
      applied++
    }
  }

  walk(presetDir)
  return { applied, skipped }
}

export function describeEvlogPreset(preset: EvlogPreset): string {
  switch (preset) {
    case 'none':
      return '不套 evlog（純 Nuxt + Supabase starter）'
    case 'baseline':
      return 'T1 baseline — drain pipeline + 5 件套 enricher + sampling/redaction + client transport'
    case 'd-pattern-audit':
      return 'baseline + O1 D-pattern audit chain（HMAC-signed audit log + diff-cron）'
    case 'nuxthub-ai':
      return 'NuxtHub D1 drain + AI agent context（cost tracking + SSE/MCP child logger）'
  }
}
