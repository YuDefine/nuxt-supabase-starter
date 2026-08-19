#!/usr/bin/env node
// CLADE:VENDOR-SCRIPT
//
// normalize-commit-emoji — 把 commit header 的 emoji 依 type 改寫成正解（prepare-commit-msg layer）
//
// 為什麼是改寫而不是拒絕：emoji 對 type 是 1:1 全覆蓋映射（見 commitlint.config.ts 的
// type-enum），所以 emoji **不承載 type 以外的任何資訊**——它是冗餘欄位。冗餘欄位用
// `commit-msg` 事後拒絕處理，只會製造「commit → 被擋 → 改 → 重試」的迴圈，而且 commitlint
// 報的是 `subject may not be empty`（真因在 emoji，照訊息去查會愈改愈遠，見
// pitfall-commitlint-emoji-type-mismatch-reports-subject-empty）。改寫是資訊上無損的。
//
// **NEVER 在本檔另寫一份 emoji × type 映射**：映射一律從 commitlint.config.ts 讀。兩份會漂，
// 而漂掉的那天本 hook 會把正確的 emoji 改成錯的——比不做還糟。
//
// type 本身寫錯（該 fix 卻寫 feat）補正不了，那**不是**冗餘欄位，仍由 commit-msg 擋下。
// 本檔絕不放寬任何 commitlint 規則。
//
// 失敗一律 fail-open（exit 0 不改寫）：讀不到 config、解不出映射、header 不成形，都退回
// 既有行為讓 commit-msg 判定。normalize 是便利層，不是 gate——它壞掉時不該擋住任何人 commit。
//
// 由 ~/clade vendor/husky/ 散播，請勿直接編輯 consumer 副本。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [msgPath, source] = process.argv.slice(2)

// merge / squash 的 header 由 git 產生（`Merge branch …`），不是 conventional header。
// template 的內容還沒被人寫過，改寫沒有對象。
if (!msgPath || source === 'merge' || source === 'squash' || source === 'template') process.exit(0)
if (!existsSync(msgPath)) process.exit(0)

const root = process.env.CLADE_REPO_ROOT ?? process.cwd()

// 優先讀 repo root 的 commitlint.config.ts —— 那正是 commit-msg 實際執行的那一份，
// 讀別份會讓 normalize 與 enforce 對不上。root 沒有才退回 vendor 源檔。
const configPath = [
  join(root, 'commitlint.config.ts'),
  join(root, 'commitlint.config.js'),
  join(root, 'vendor', 'commitlint', 'commitlint.config.ts'),
].find((p) => existsSync(p))
if (!configPath) process.exit(0)

const emojiByType = parseEmojiMap(readFileSync(configPath, 'utf8'))
// 解出來的映射太小 = 解析失敗（config 結構變了）。用一個明顯不可能的正解去改寫比不改寫更糟。
if (emojiByType.size < 5) process.exit(0)

const raw = readFileSync(msgPath, 'utf8')
const lines = raw.split('\n')
const headerIdx = lines.findIndex((l) => l.trim() !== '' && !l.startsWith('#'))
if (headerIdx === -1) process.exit(0)

const header = lines[headerIdx]
// fixup! / squash! / amend! 的 header 由 git 組出來指向另一則 commit，改寫會讓它失去指向。
if (/^(fixup|squash|amend)!/.test(header) || /^(Merge|Revert) /.test(header)) process.exit(0)

// 前綴 emoji 選填：漏 emoji（`chore: x`）同樣是可補正的冗餘欄位缺失，一併補上。
const m = header.match(/^(?:([^\p{L}\p{N}\s][^\s]*)\s+)?([A-Za-z]+)(\([^)]*\))?(!?):\s*(.*)$/u)
if (!m) process.exit(0)

const [, currentEmoji, type, scope = '', bang = '', subject] = m
const want = emojiByType.get(type.toLowerCase())
// type 不在映射內 = type 本身非法，不是 emoji 的問題。留給 commit-msg 擋。
if (!want) process.exit(0)
if (currentEmoji === want) process.exit(0)

lines[headerIdx] = `${want} ${type}${scope}${bang}: ${subject}`
writeFileSync(msgPath, lines.join('\n'), 'utf8')
process.stderr.write(
  `prepare-commit-msg: emoji 已依 type 正規化 ${currentEmoji ?? '(缺)'} → ${want}（type=${type}）\n`,
)

/**
 * 從 commitlint config 原始碼文字抽出 emoji × type 映射。
 *
 * 刻意用文字解析而不是 import：本檔跑在 git hook 裡，consumer 的 node 版本與 TS loader
 * 狀態不一致，import 失敗會讓整條 normalize 靜默消失；文字解析對任何 node ≥18 一致。
 * 讀的仍然是 SoT 檔本身，沒有第二份映射。
 */
function parseEmojiMap(src: string): Map<string, string> {
  const map = new Map<string, string>()
  const block = src.match(/'type-enum':\s*\[[\s\S]*?\[([\s\S]*?)\]/)
  if (!block) return map
  for (const [, literal] of block[1].matchAll(/'([^']+)'/g)) {
    const parts = literal.trim().split(/\s+/)
    if (parts.length !== 2) continue
    const [emoji, typeName] = parts
    if (!/^[a-z]+$/.test(typeName)) continue
    map.set(typeName, emoji)
  }
  return map
}
