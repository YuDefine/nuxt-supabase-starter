#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_SKILL_SECTIONS = ['Launch', 'Doctor', 'Drive', 'Evidence', 'Cleanup', 'Helpers']
const REQUIRED_INDEX_SECTIONS = [
  'Baseline preconditions',
  'Driving conventions',
  'Proof and skip reporting',
  'Feature entry contract',
  'Features',
]
const REQUIRED_FEATURE_SECTIONS = [
  'Sub-features',
  'How to get to it (user POV)',
  'Driving it with <harness>',
  'Gotchas',
]

function h2Sections(content) {
  return content
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())
}

function matchesHarnessHeading(actual, expected) {
  if (expected !== 'Driving it with <harness>') return actual === expected
  return /^Driving it with .+/.test(actual)
}

function checkOrderedSections(actual, expected, location, errors) {
  let previousIndex = -1
  for (const section of expected) {
    const currentIndex = actual.findIndex((value) => matchesHarnessHeading(value, section))
    if (currentIndex === -1) {
      errors.push(`${location}: missing H2 "${section}"`)
      continue
    }
    if (currentIndex <= previousIndex) errors.push(`${location}: H2 "${section}" is out of order`)
    previousIndex = currentIndex
  }
}

function markdownTargets(content) {
  return [...content.matchAll(/\]\(\.\/([^)#]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1])
}

export function validateFeatureMap(targetDirectory) {
  const target = resolve(targetDirectory)
  const errors = []
  const skillPath = join(target, 'SKILL.md')
  const featuresDirectory = join(target, 'features')
  const indexPath = join(featuresDirectory, 'README.md')

  if (!existsSync(skillPath)) errors.push(`${skillPath}: missing`)
  if (!existsSync(indexPath)) errors.push(`${indexPath}: missing`)
  if (errors.length > 0) return { ok: false, target, features: [], errors }

  const skill = readFileSync(skillPath, 'utf8')
  checkOrderedSections(h2Sections(skill), REQUIRED_SKILL_SECTIONS, skillPath, errors)

  const index = readFileSync(indexPath, 'utf8')
  checkOrderedSections(h2Sections(index), REQUIRED_INDEX_SECTIONS, indexPath, errors)

  const featureFiles = readdirSync(featuresDirectory)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .toSorted()
  const indexedFiles = [...new Set(markdownTargets(index))].toSorted()

  for (const file of featureFiles.filter((name) => !indexedFiles.includes(name))) {
    errors.push(
      `${relative(target, join(featuresDirectory, file))}: missing from features/README.md`,
    )
  }
  for (const file of indexedFiles.filter((name) => !featureFiles.includes(name))) {
    errors.push(`features/README.md: dead feature link ${file}`)
  }

  for (const file of featureFiles) {
    const featurePath = join(featuresDirectory, file)
    const feature = readFileSync(featurePath, 'utf8')
    if (!feature.startsWith('# ')) errors.push(`${relative(target, featurePath)}: missing H1`)
    checkOrderedSections(
      h2Sections(feature),
      REQUIRED_FEATURE_SECTIONS,
      relative(target, featurePath),
      errors,
    )
  }

  return { ok: errors.length === 0, target, features: featureFiles, errors }
}

function main() {
  const target = process.argv[2]
  const json = process.argv.includes('--json')
  if (!target) {
    console.error('usage: check-feature-map.mjs <verify-skill-dir> [--json]')
    process.exit(2)
  }

  const result = validateFeatureMap(target)
  if (json) console.log(JSON.stringify(result, null, 2))
  else if (result.ok)
    console.log(`feature-map valid: ${basename(result.target)} (${result.features.length})`)
  else for (const error of result.errors) console.error(error)
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
