#!/usr/bin/env node
/* eslint-disable no-console */
/* oxlint-disable no-console */

/**
 * /commit Step 6-A 發版序列中途失敗時，判定要從哪一步接著做。
 *
 * 讀 package.json 版本、working tree 與 HEAD 的版本差、最近的 `🚀 deploy:` commit、
 * origin/<branch>、本機與 remote 的 `v<版本>` tag，選填 `--push-error <file>`（上一趟 push 的
 * stderr），印 `resume_from=<代碼>`。代碼對動作表在 commit skill 的 `release-push.md`
 * § 序列中途失敗的復原；本檔輸出的代碼集合是那張表的唯一定義。
 *
 * Usage:
 *   node release-resume.mjs [--repo PATH] [--remote origin] [--branch main]
 *     [--push-error FILE] [--no-fetch]
 *
 * stdout 每行 `key=value`，最後一行固定是 `resume_from=`。
 * exit 0 = 判定完成；exit 2 = 用法錯或 git／檔案讀取失敗（此時 `resume_from=unknown`）。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEPLOY_PREFIX = '🚀 deploy:'
const DEPLOY_SCAN_DEPTH = 50

function parseArgs(argv) {
  const opts = {
    repo: process.cwd(),
    remote: 'origin',
    branch: 'main',
    pushError: null,
    fetch: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} 需要值`)
      return next
    }
    if (arg === '--repo') opts.repo = resolve(value())
    else if (arg === '--remote') opts.remote = value()
    else if (arg === '--branch') opts.branch = value()
    else if (arg === '--push-error') opts.pushError = value()
    else if (arg === '--no-fetch') opts.fetch = false
    else throw new Error(`未知參數 ${arg}`)
  }
  return opts
}

function git(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function gitOk(repo, args) {
  try {
    git(repo, args)
    return true
  } catch {
    return false
  }
}

function versionOf(raw, label) {
  const version = JSON.parse(raw).version
  if (typeof version !== 'string' || version === '') throw new Error(`${label} 沒有 version`)
  return version
}

// `--push-error` 只用來分出「被 tag-position 以外的 pre-push check 擋下」；其餘情形都由 git 狀態判。
function blockedByOtherPrePushCheck(text) {
  return text
    .split('\n')
    .some((line) => /\[clade pre-push\].*✗/.test(line) && !/tag-position/.test(line))
}

function remoteTagCommit(repo, remote, tag) {
  const out = git(repo, ['ls-remote', '--tags', remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
  if (out === '') return null
  const rows = out.split('\n').map((line) => line.split('\t'))
  const peeled = rows.find(([, ref]) => ref === `refs/tags/${tag}^{}`)
  return (peeled ?? rows[0])[0]
}

function decide(opts) {
  const { repo, remote, branch } = opts
  const facts = {}
  const upstream = `refs/remotes/${remote}/${branch}`
  if (opts.fetch) git(repo, ['fetch', '--quiet', remote, `+refs/heads/${branch}:${upstream}`])

  const version = versionOf(readFileSync(join(repo, 'package.json'), 'utf8'), 'package.json')
  const tag = `v${version}`
  const head = git(repo, ['rev-parse', 'HEAD'])
  const headVersion = versionOf(git(repo, ['show', 'HEAD:package.json']), 'HEAD:package.json')
  facts.version = version
  facts.head = head

  const deployLine = git(repo, ['log', `-n${DEPLOY_SCAN_DEPTH}`, '--format=%H%x09%s', 'HEAD'])
    .split('\n')
    .map((line) => line.split('\t'))
    .find(
      ([, subject = '']) =>
        subject.startsWith(DEPLOY_PREFIX) &&
        new RegExp(`\\b${tag.replaceAll('.', '\\.')}\\b`).test(subject),
    )
  const deploy = deployLine?.[0] ?? null
  facts.deploy_commit = deploy ?? 'none'

  // `--no-fetch` 是給連不上 remote 時用的：ls-remote 失敗就當 remote 沒有這個 tag 往下判；
  // 真的已經有，推 tag 會被 `already exists` 拒絕，再帶 stderr 重跑即可。
  let remoteTag = null
  try {
    remoteTag = remoteTagCommit(repo, remote, tag)
    facts.remote_tag = remoteTag ?? 'none'
  } catch (error) {
    if (opts.fetch) throw error
    facts.remote_tag = 'unreachable'
  }
  let localTag = null
  try {
    localTag = git(repo, ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`])
  } catch {}
  facts.local_tag = localTag ?? 'none'

  if (remoteTag !== null)
    return {
      facts,
      route: remoteTag === head || remoteTag === deploy ? 'tag-published' : 'next-version',
    }
  if (version !== headVersion) return { facts, route: 'retry-commit' }
  if (deploy === null) return { facts, route: 'not-in-release' }

  const deployOnRemote = gitOk(repo, ['merge-base', '--is-ancestor', deploy, upstream])
  facts.deploy_on_remote = String(deployOnRemote)
  if (!deployOnRemote) return { facts, route: 'retry-push-main' }

  const [localOnly, remoteOnly] = git(repo, [
    'rev-list',
    '--left-right',
    '--count',
    `HEAD...${upstream}`,
  ])
    .split('\t')
    .map(Number)
  facts.local_only_commits = String(localOnly)
  facts.remote_only_commits = String(remoteOnly)
  if (localOnly > 0 && remoteOnly === 0) return { facts, route: 'push-main-then-tag' }
  if (localOnly === 0 && remoteOnly > 0) return { facts, route: 'rerun-on-new-head' }
  // 兩邊各有 commit（rebase 會把別人的 commit 拉進來），或 HEAD 已不是 deploy commit：
  // 光看 git 拓樸分不出 deploy..HEAD 是自己的修正還是別人的 commit，舊版號打上去可能落在別人的 commit 上。
  if (remoteOnly > 0 || head !== deploy) {
    facts.after_deploy = git(repo, ['rev-list', '--count', `${deploy}..HEAD`])
    return { facts, route: 'confirm-tip' }
  }
  if (localTag !== null && localTag !== head) return { facts, route: 'retag-local' }
  if (opts.pushError !== null && blockedByOtherPrePushCheck(readFileSync(opts.pushError, 'utf8')))
    return { facts, route: 'fix-check-then-push-tag' }
  return { facts, route: 'push-tag' }
}

function main() {
  let result
  try {
    result = decide(parseArgs(process.argv.slice(2)))
  } catch (error) {
    console.error(`release-resume: ${error instanceof Error ? error.message : String(error)}`)
    console.log('resume_from=unknown')
    process.exit(2)
  }
  for (const [key, value] of Object.entries(result.facts)) console.log(`${key}=${value}`)
  console.log(`resume_from=${result.route}`)
}

main()
