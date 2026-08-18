import { ElementTypes, NodeTypes, parse } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'

const IGNORED_COMPONENT_TAGS = new Set(['component'])

function toPascalCase(name) {
  if (!name.includes('-') && !name.includes('_')) {
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function toKebabCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

function extractTemplateBlock(content) {
  const sfc = parseSfc(content)
  return sfc.descriptor.template?.content ?? ''
}

function addIfComponentIdentifier(targetSet, rawName) {
  const name = rawName.replace(/^type\s+/, '').trim()
  if (!name) {
    return
  }

  if (/^[A-Z]/.test(name)) {
    targetSet.add(name)
  }
}

function parseImportClause(components, clause) {
  const trimmed = clause.trim()
  if (!trimmed || trimmed.startsWith("'")) {
    return
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const named = trimmed.slice(1, -1)
    const entries = named.split(',')
    for (const entry of entries) {
      const normalizedEntry = entry.trim()
      if (!normalizedEntry) {
        continue
      }

      const aliasParts = normalizedEntry.split(/\s+as\s+/i)
      const finalName = aliasParts[aliasParts.length - 1]
      addIfComponentIdentifier(components, finalName)
    }
    return
  }

  if (trimmed.includes(',')) {
    const [defaultImport, ...rest] = trimmed.split(',')
    addIfComponentIdentifier(components, defaultImport)
    parseImportClause(components, rest.join(','))
    return
  }

  if (trimmed.startsWith('*')) {
    const ns = trimmed.match(/^\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/)
    if (ns?.[1]) {
      addIfComponentIdentifier(components, ns[1])
    }
    return
  }

  addIfComponentIdentifier(components, trimmed)
}

function collectLocallyImportedComponents(content) {
  const sfc = parseSfc(content)
  const blocks = [sfc.descriptor.script?.content ?? '', sfc.descriptor.scriptSetup?.content ?? '']
  const components = new Set()
  const importRegex = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/gm

  for (const block of blocks) {
    if (!block.trim()) {
      continue
    }

    let match = importRegex.exec(block)
    while (match) {
      parseImportClause(components, match[1] ?? '')
      match = importRegex.exec(block)
    }
  }

  return components
}

function visitNode(node, onElement) {
  if (!node || typeof node !== 'object') {
    return
  }

  if (node.type === NodeTypes.ELEMENT) {
    onElement(node)
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visitNode(child, onElement)
    }
  }

  if (Array.isArray(node.branches)) {
    for (const branch of node.branches) {
      if (Array.isArray(branch.children)) {
        for (const child of branch.children) {
          visitNode(child, onElement)
        }
      }
    }
  }
}

export function collectTemplateComponentTags(content) {
  const template = extractTemplateBlock(content)
  if (!template) {
    return []
  }

  const root = parse(template)
  const tags = new Set()

  visitNode(root, (node) => {
    if (node.tagType !== ElementTypes.COMPONENT || !node.tag) {
      return
    }

    if (IGNORED_COMPONENT_TAGS.has(node.tag)) {
      return
    }

    tags.add(node.tag)
  })

  return [...tags]
}

function buildNormalizedRegisteredSet(registeredComponents) {
  const normalized = new Set()

  for (const name of registeredComponents) {
    normalized.add(name)
    normalized.add(toPascalCase(name))
    normalized.add(toKebabCase(name))
  }

  return normalized
}

function isRegisteredComponentTag(tag, normalizedRegisteredComponents) {
  return (
    normalizedRegisteredComponents.has(tag) ||
    normalizedRegisteredComponents.has(toPascalCase(tag)) ||
    normalizedRegisteredComponents.has(toKebabCase(tag))
  )
}

export function findUnresolvedComponentUsages(files, registeredComponents) {
  return analyzeComponentResolution(files, registeredComponents).unresolved
}

export function analyzeComponentResolution(files, registeredComponents) {
  const unresolved = []
  const parseErrors = []

  for (const file of files) {
    let tags = []
    let normalizedRegisteredComponents = buildNormalizedRegisteredSet(registeredComponents)

    try {
      tags = collectTemplateComponentTags(file.content)

      const localComponents = collectLocallyImportedComponents(file.content)
      if (localComponents.size > 0) {
        const fileRegisteredComponents = new Set(registeredComponents)
        for (const name of localComponents) {
          fileRegisteredComponents.add(name)
        }
        normalizedRegisteredComponents = buildNormalizedRegisteredSet(fileRegisteredComponents)
      }
    } catch (error) {
      parseErrors.push({
        filePath: file.filePath,
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    for (const tag of tags) {
      if (isRegisteredComponentTag(tag, normalizedRegisteredComponents)) {
        continue
      }

      unresolved.push({
        filePath: file.filePath,
        tag,
      })
    }
  }

  return {
    unresolved,
    parseErrors,
  }
}
