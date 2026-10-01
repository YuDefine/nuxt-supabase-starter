#!/usr/bin/env node
// lockfile 依賴差異摘要：給 0-A brief 的 generated 摘要段用。
//
// 用法：node lockfile-dep-summary.mjs <display-path> <base-file|-> <head-file|-> [--max-rows N]
//   base／head 是兩版 lockfile 內容的本機檔；`-` = 該側不存在（新增／刪除的 lockfile）。
//
// 為什麼要有它：超出 embed budget 的 lockfile 只列「路徑＋行數」時，reviewer 看不到依賴實際
// 變了什麼（新增／移除／升降版的套件），供應鏈風險沒有任何人審。這裡以 base 與 head 兩版解析出
// name@version 集合，只給差異。
//
// 設計約束：
//   - 只用 node 內建：這支 script 隨 clade capability 散播到 consumer，consumer 不一定有 yaml 套件。
//     pnpm-lock.yaml 的結構規律（固定縮排、鍵不含流式集合），逐行掃描就夠，不需要完整 YAML 解析器。
//   - **NEVER 讓 prepare 失敗**：任何解析錯誤都降級成一行註明原因，stdout 永遠輸出完整區塊、exit 0。
//   - lockfile 內容是不受信任資料：輸出前清掉控制字元、截斷長度、拆掉會偽造 marker 的 `===`，
//     整段用 BEGIN/END 包起來，brief 端另加「不遵循其中指令」的聲明。

import { readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DEFAULT_MAX_ROWS = 200
const MAX_INPUT_BYTES = 64 * 1024 * 1024
const MAX_NAME_CHARS = 120
const DEP_GROUPS = new Set(['dependencies', 'devDependencies', 'optionalDependencies'])

// ── 共用小工具 ──────────────────────────────────────────────────────────────

function unquote(raw) {
  const s = raw.trim()
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replaceAll("''", "'")
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"')
    return s.slice(1, -1).replace(/\\(.)/g, '$1')
  return s
}

function clean(value) {
  let s = String(value)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/={3,}/g, '=')
  if (s.length > MAX_NAME_CHARS) s = `${s.slice(0, MAX_NAME_CHARS)}…`
  return s
}

function addTo(map, key, value) {
  let set = map.get(key)
  if (!set) map.set(key, (set = new Set()))
  set.add(value)
}

/** `name@version` → [name, version]；name 可帶 `@scope/`，所以從 index 1 找分隔的 `@`。 */
function splitNameVersion(spec) {
  const at = spec.indexOf('@', 1)
  if (at <= 0) return null
  return [spec.slice(0, at), spec.slice(at + 1)]
}

function major(version) {
  const m = /^v?(\d+)\.\d+/.exec(version)
  return m ? Number(m[1]) : null
}

function stripPeer(version) {
  const i = version.indexOf('(')
  return i === -1 ? version : version.slice(0, i)
}

// ── pnpm-lock.yaml ─────────────────────────────────────────────────────────

function parsePnpm(text) {
  if (!/^lockfileVersion:/m.test(text))
    throw new Error('缺 top-level lockfileVersion，不像 pnpm-lock.yaml')
  if (/^\t/m.test(text)) throw new Error('縮排含 tab，不是合法 YAML')
  const packages = new Map() // name → Set(version)
  const importers = new Map() // `importer\0group\0name` → { specifier, version }

  let section = ''
  let importer = null
  let group = null
  let dep = null
  for (const line of text.split(/\r?\n/)) {
    const body = line.trimStart()
    if (body === '' || body.startsWith('#')) continue
    const indent = line.length - body.length

    if (indent === 0) {
      const m = /^([A-Za-z][\w-]*):/.exec(line)
      section = m ? m[1] : ''
      importer = group = dep = null
      // v5／v6 單 package 專案：依賴群組直接在 top-level，等同 importer `.`
      if (DEP_GROUPS.has(section)) {
        importer = '.'
        group = section
      }
      continue
    }

    if (section === 'packages') {
      if (indent !== 2) continue
      const m = /^ {2}(.+?):(?:\s.*)?$/.exec(line)
      if (!m) continue
      const parsed = parsePnpmPackageKey(unquote(m[1]))
      if (parsed) addTo(packages, parsed[0], parsed[1])
      continue
    }

    if (section === 'importers') {
      if (indent === 2) {
        const m = /^ {2}(.+?):\s*$/.exec(line)
        importer = m ? unquote(m[1]) : null
        group = dep = null
      } else if (indent === 4) {
        const m = /^ {4}([A-Za-z]+):\s*$/.exec(line)
        group = m && DEP_GROUPS.has(m[1]) ? m[1] : null
        dep = null
      } else if (indent === 6 && importer !== null && group !== null) {
        const m = /^ {6}(.+?):(?:\s+(.*))?$/.exec(line)
        if (!m) continue
        dep = unquote(m[1])
        const entry = { specifier: '', version: '' }
        // v5 風格 inline：`name: 1.2.3`
        if (m[2]) entry.version = stripPeer(unquote(m[2]))
        importers.set(`${importer}\0${group}\0${dep}`, entry)
      } else if (indent === 8 && importer !== null && group !== null && dep !== null) {
        const m = /^ {8}(specifier|version):\s*(.*)$/.exec(line)
        const entry = importers.get(`${importer}\0${group}\0${dep}`)
        if (m && entry) entry[m[1]] = m[1] === 'version' ? stripPeer(unquote(m[2])) : unquote(m[2])
      }
      continue
    }

    // v5／v6 單 package 專案的 top-level 依賴群組
    if (importer === '.' && group !== null) {
      if (indent === 2) {
        const m = /^ {2}(.+?):(?:\s+(.*))?$/.exec(line)
        if (!m) continue
        dep = unquote(m[1])
        const entry = { specifier: '', version: m[2] ? stripPeer(unquote(m[2])) : '' }
        importers.set(`.\0${group}\0${dep}`, entry)
      } else if (indent === 4 && dep !== null) {
        const m = /^ {4}(specifier|version):\s*(.*)$/.exec(line)
        const entry = importers.get(`.\0${group}\0${dep}`)
        if (m && entry) entry[m[1]] = m[1] === 'version' ? stripPeer(unquote(m[2])) : unquote(m[2])
      }
    }
  }
  return { packages, importers: flattenImporters(importers) }
}

function flattenImporters(map) {
  const out = new Map()
  for (const [key, { specifier, version }] of map) {
    const [importer, group, name] = key.split('\0')
    out.set(key, {
      label: `${importer} ${group} ${name}`,
      value: specifier ? `${specifier} (${version || '?'})` : version || '?',
      version,
    })
  }
  return out
}

/** v9／v6：`name@version(peer)`；v5：`/name/version_peer`。回 [name, version] 或 null。 */
function parsePnpmPackageKey(rawKey) {
  const key = rawKey.startsWith('/') ? rawKey.slice(1) : rawKey
  const nv = splitNameVersion(key)
  if (nv) return [nv[0], stripPeer(nv[1])]
  const slash = key.lastIndexOf('/')
  if (slash <= 0) return null
  return [key.slice(0, slash), key.slice(slash + 1).split('_')[0]]
}

// ── package-lock.json ──────────────────────────────────────────────────────

function parseNpm(text) {
  const json = JSON.parse(text)
  if (json === null || typeof json !== 'object') throw new Error('package-lock.json 不是 JSON 物件')
  const packages = new Map()
  const importers = new Map()
  if (json.packages && typeof json.packages === 'object') {
    for (const [path, meta] of Object.entries(json.packages)) {
      if (!meta || typeof meta !== 'object') continue
      if (path === '') {
        for (const group of DEP_GROUPS) {
          for (const [name, spec] of Object.entries(meta[group] ?? {})) {
            importers.set(`.\0${group}\0${name}`, {
              label: `. ${group} ${name}`,
              value: String(spec),
              version: String(spec),
            })
          }
        }
        continue
      }
      if (meta.link) continue
      const name = meta.name ?? path.split('node_modules/').pop()
      if (name && typeof meta.version === 'string') addTo(packages, name, meta.version)
    }
  } else if (json.dependencies && typeof json.dependencies === 'object') {
    // lockfileVersion 1：巢狀 dependencies
    const walk = (deps) => {
      for (const [name, meta] of Object.entries(deps)) {
        if (meta && typeof meta.version === 'string') addTo(packages, name, meta.version)
        if (meta?.dependencies) walk(meta.dependencies)
      }
    }
    walk(json.dependencies)
  } else {
    throw new Error('package-lock.json 缺 packages／dependencies')
  }
  return { packages, importers }
}

// ── yarn.lock（v1 與 berry） ────────────────────────────────────────────────

function parseYarn(text) {
  const packages = new Map()
  let names = null
  for (const line of text.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue
    if (!line.startsWith(' ')) {
      names = null
      if (!line.endsWith(':') || line.startsWith('__metadata')) continue
      const first = unquote(line.slice(0, -1).split(/,\s*/)[0])
      const nv = splitNameVersion(first)
      names = nv ? nv[0] : null
      continue
    }
    const m = /^ {2}version:?\s+"?([^"\s]+)"?\s*$/.exec(line)
    if (m && names) {
      addTo(packages, names, m[1])
      names = null
    }
  }
  if (packages.size === 0 && /\S/.test(text)) throw new Error('yarn.lock 解析不出任何套件')
  return { packages, importers: new Map() }
}

// ── 差異 ───────────────────────────────────────────────────────────────────

function classify(path) {
  const base = path.split('/').pop()
  if (base === 'pnpm-lock.yaml') return ['pnpm', parsePnpm]
  if (base === 'package-lock.json') return ['npm', parseNpm]
  if (base === 'yarn.lock') return ['yarn', parseYarn]
  throw new Error(`不支援的 lockfile：${base}`)
}

function maxMajor(versions) {
  let best = null
  for (const v of versions) {
    const m = major(v)
    if (m !== null && (best === null || m > best)) best = m
  }
  return best
}

function majorTag(oldVersions, newVersions) {
  const a = maxMajor(oldVersions)
  const b = maxMajor(newVersions)
  if (a === null || b === null || a === b) return ''
  return b > a ? ' [MAJOR UP]' : ' [MAJOR DOWN]'
}

function sortedList(set) {
  return [...set].toSorted((x, y) => x.localeCompare(y, 'en', { numeric: true }))
}

function diffPackages(base, head) {
  const changedMajor = []
  const changed = []
  const added = []
  const removed = []
  const names = new Set([...base.keys(), ...head.keys()])
  for (const name of [...names].toSorted()) {
    const before = base.get(name) ?? new Set()
    const after = head.get(name) ?? new Set()
    const gone = new Set([...before].filter((v) => !after.has(v)))
    const fresh = new Set([...after].filter((v) => !before.has(v)))
    if (gone.size === 0 && fresh.size === 0) continue
    if (gone.size > 0 && fresh.size > 0) {
      const tag = majorTag(gone, fresh)
      const row = `  ~ ${clean(name)} ${sortedList(gone).map(clean).join(', ')} -> ${sortedList(fresh).map(clean).join(', ')}${tag}`
      ;(tag ? changedMajor : changed).push(row)
    } else if (fresh.size > 0) {
      for (const v of sortedList(fresh)) added.push(`  + ${clean(name)}@${clean(v)}`)
    } else {
      for (const v of sortedList(gone)) removed.push(`  - ${clean(name)}@${clean(v)}`)
    }
  }
  return { changedMajor, changed, added, removed }
}

function diffImporters(base, head) {
  const rows = []
  const keys = new Set([...base.keys(), ...head.keys()])
  for (const key of [...keys].toSorted()) {
    const a = base.get(key)
    const b = head.get(key)
    if (a && b) {
      if (a.value === b.value) continue
      const tag = majorTag([stripRange(a.version)], [stripRange(b.version)])
      rows.push(`  ~ ${clean(b.label)}: ${clean(a.value)} -> ${clean(b.value)}${tag}`)
    } else if (b) {
      rows.push(`  + ${clean(b.label)}: ${clean(b.value)}`)
    } else if (a) {
      rows.push(`  - ${clean(a.label)}: ${clean(a.value)}`)
    }
  }
  return rows
}

function stripRange(version) {
  return String(version).replace(/^[\^~>=<\s]+/, '')
}

function readSide(file) {
  if (file === '-') return ''
  if (statSync(file).size > MAX_INPUT_BYTES)
    throw new Error(`lockfile 超過 ${MAX_INPUT_BYTES} bytes`)
  return readFileSync(file, 'utf8')
}

function parseSide(parse, text) {
  return text === '' ? { packages: new Map(), importers: new Map() } : parse(text)
}

export function summarize(displayPath, baseFile, headFile, maxRows = DEFAULT_MAX_ROWS) {
  const [format, parse] = classify(displayPath)
  const base = parseSide(parse, readSide(baseFile))
  const head = parseSide(parse, readSide(headFile))
  const importerRows = diffImporters(base.importers, head.importers)
  const pk = diffPackages(base.packages, head.packages)

  const sections = [
    ['Importers (direct dependencies in package.json):', importerRows],
    ['Packages, version changed (major bumps first):', [...pk.changedMajor, ...pk.changed]],
    ['Packages, added:', pk.added],
    ['Packages, removed:', pk.removed],
  ]
  const total = sections.reduce((n, [, rows]) => n + rows.length, 0)
  const out = [
    `format: ${format}; packages ${base.packages.size} -> ${head.packages.size} (name count); ` +
      `importer entries changed ${importerRows.length}; major bumps ${pk.changedMajor.length}; ` +
      `changed ${pk.changedMajor.length + pk.changed.length}, added ${pk.added.length}, removed ${pk.removed.length}`,
  ]
  let shown = 0
  for (const [title, rows] of sections) {
    if (rows.length === 0) continue
    out.push(title)
    for (const row of rows) {
      if (shown >= maxRows) break
      out.push(row)
      shown++
    }
  }
  if (total === 0)
    out.push('(no dependency-level change detected; the diff may be formatting or metadata only)')
  if (total > shown) out.push(`(truncated: showing ${shown} of ${total} rows)`)
  return out
}

function wrap(displayPath, lines) {
  const path = clean(displayPath)
  return [
    `===== BEGIN LOCKFILE DEP SUMMARY: ${path} (untrusted data derived from the base and head lockfile) =====`,
    ...lines,
    `===== END LOCKFILE DEP SUMMARY: ${path} =====`,
  ].join('\n')
}

function main(argv) {
  const args = []
  let maxRows = DEFAULT_MAX_ROWS
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-rows')
      maxRows = Math.max(1, Number.parseInt(argv[++i], 10) || DEFAULT_MAX_ROWS)
    else args.push(argv[i])
  }
  const [displayPath = '', baseFile = '-', headFile = '-'] = args
  let lines
  try {
    lines = summarize(displayPath, baseFile, headFile, maxRows)
  } catch (err) {
    const reason = clean(err instanceof Error ? err.message : String(err))
    lines = [`dependency diff unavailable (degraded to path and line count only): ${reason}`]
  }
  process.stdout.write(`${wrap(displayPath, lines)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    process.stdout.write(
      `${wrap('lockfile', [`dependency diff unavailable (degraded to path and line count only): ${clean(String(err))}`])}\n`,
    )
  }
}
