import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { analyzeComponentResolution } from './lib/vue-component-resolution.mts'

const BUILT_IN_COMPONENTS = new Set([
  'Transition',
  'TransitionGroup',
  'KeepAlive',
  'Teleport',
  'Suspense',
  'RouterLink',
  'RouterView',
])

async function collectVueFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectVueFiles(fullPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(fullPath)
    }
  }

  return files
}

async function readVueFiles(projectRoot) {
  const scanDirs = ['app']
  const vueFiles = []

  for (const dir of scanDirs) {
    const fullDir = join(projectRoot, dir)
    try {
      vueFiles.push(...(await collectVueFiles(fullDir)))
    } catch {
      // ignore missing dir
    }
  }

  const results = []
  for (const filePath of vueFiles) {
    const content = await readFile(filePath, 'utf8')
    results.push({ filePath, content })
  }

  return results
}

async function loadRegisteredComponents(projectRoot) {
  const componentsDtsPath = join(projectRoot, '.nuxt/components.d.ts')
  const content = await readFile(componentsDtsPath, 'utf8')

  const registered = new Set(BUILT_IN_COMPONENTS)
  const regex = /^\s*export const ([A-Za-z][A-Za-z0-9_]*):/gm

  let match = regex.exec(content)
  while (match) {
    registered.add(match[1])
    match = regex.exec(content)
  }

  return registered
}

function printUnresolvedReport(projectRoot, unresolved) {
  const grouped = new Map()

  for (const item of unresolved) {
    const file = relative(projectRoot, item.filePath)
    if (!grouped.has(file)) {
      grouped.set(file, new Set())
    }
    grouped.get(file)?.add(item.tag)
  }

  console.error('Vue component resolution check failed: unregistered component tags found')
  console.error('')

  for (const [file, tags] of grouped.entries()) {
    console.error(`- ${file}`)
    for (const tag of [...tags].toSorted((a, b) => a.localeCompare(b))) {
      console.error(`  - <${tag}>`)
    }
  }

  console.error('')
  console.error(`Total ${unresolved.length} unresolved component usages.`)
  console.error(
    'Hint: if you just added a component, verify the file name and path, then run nuxt prepare / typecheck.'
  )
}

function printParseErrorReport(projectRoot, parseErrors) {
  console.error('Vue template syntax check failed: unparseable templates found')
  console.error('')

  for (const item of parseErrors) {
    const file = relative(projectRoot, item.filePath)
    console.error(`- ${file}`)
    console.error(`  - ${item.message}`)
  }

  console.error('')
  console.error(`Total ${parseErrors.length} files with template syntax errors.`)
}

async function run() {
  const projectRoot = process.cwd()

  let registeredComponents
  try {
    registeredComponents = await loadRegisteredComponents(projectRoot)
  } catch (error) {
    console.error(
      'Cannot read .nuxt/components.d.ts. Please run nuxt prepare or pnpm typecheck first.'
    )
    if (error instanceof Error) {
      console.error(error.message)
    }
    process.exitCode = 1
    return
  }

  const files = await readVueFiles(projectRoot)
  const analysis = analyzeComponentResolution(files, registeredComponents)

  if (analysis.parseErrors.length > 0) {
    printParseErrorReport(projectRoot, analysis.parseErrors)
    process.exitCode = 1
    return
  }

  if (analysis.unresolved.length > 0) {
    printUnresolvedReport(projectRoot, analysis.unresolved)
    process.exitCode = 1
    return
  }

  console.log(`Vue component resolution check passed (scanned ${files.length} .vue files)`)
}

await run()
