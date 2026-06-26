#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# review-rules-ban (pre-commit, staged) — 掃 staged .vue 檔，擋住 patterns.json 定義的機械規則違規
#
# 讀 vendor/review-rules/patterns.json，對本次 staged *.vue 跑 grep。
# severity=error 命中 → exit 1 擋 commit；severity=warning → 印但不擋。
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

PATTERNS_FILE="$PROJECT_ROOT/vendor/review-rules/patterns.json"

# patterns.json 不存在 → 跳過（consumer 尚未 propagate）
[[ -f "$PATTERNS_FILE" ]] || exit 0

# 蒐集本次 staged 的 .vue（NUL-separated → newline for node）
STAGED=$(git diff --cached --name-only --diff-filter=ACM -- '*.vue' 2>/dev/null || true)

# 無 staged .vue → 跳過
[[ -z "$STAGED" ]] && exit 0

# Node 做全部邏輯
# 兩種 matching 模式：
#   multiLine: false (default) — 逐行 grep（適合單行 pattern）
#   multiLine: true            — 整檔 multi-line match（適合跨行 Vue template props）
#
# pattern 含 `<ComponentName[^>]*prop=` 形式時自動升級成 multiLine。
# multiLine 模式把每個 `<Tag ... >` / `<Tag ... />` 區塊展平成單行再 match，
# 回報的行號是 tag 起始行。
exec node -e "
const fs = require('fs');
const patternsFile = process.argv[1];
const stagedFiles = process.argv[2].split('\n').filter(Boolean);

const data = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
const rules = data.rules.filter(r => r.fileGlob === '*.vue');
let hasError = false;

// 從 template 抽出每個 HTML/Vue tag 區塊（含起始行號）
// 把 <Tag\n  prop=\"val\"\n  prop2=\"val2\"\n/> 展平成單行
function extractTags(content) {
  const tags = [];
  const re = /<[A-Z][A-Za-z]*(?:\s|\n)(?:[^>]|\n)*?\/?>/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const before = content.slice(0, m.index);
    const line = before.split('\n').length;
    const flat = m[0].replace(/\n\s*/g, ' ');
    tags.push({ line, flat, raw: m[0] });
  }
  return tags;
}

// 判斷 pattern 是否需要 multiLine（含 <ComponentName[^>]* 跨屬性匹配）
function needsMultiLine(pattern) {
  return /^<[\[(]?[A-Z].*\[\^>\]/.test(pattern);
}

for (const rule of rules) {
  const re = new RegExp(rule.pattern);
  const excludeRe = rule.excludePattern ? new RegExp(rule.excludePattern) : null;
  const multiLine = rule.multiLine === true || needsMultiLine(rule.pattern);

  let filesToScan = stagedFiles;
  if (rule.scanPaths && rule.scanPaths.length > 0) {
    filesToScan = stagedFiles.filter(f => rule.scanPaths.some(p => f.startsWith(p)));
  }
  if (filesToScan.length === 0) continue;

  const hits = [];
  for (const file of filesToScan) {
    try {
      const content = fs.readFileSync(file, 'utf8');

      if (multiLine) {
        const tags = extractTags(content);
        for (const tag of tags) {
          if (re.test(tag.flat)) {
            if (excludeRe && excludeRe.test(tag.flat)) continue;
            hits.push({ file, line: tag.line, text: tag.flat.slice(0, 120) });
          }
        }
      } else {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            if (excludeRe && excludeRe.test(lines[i])) continue;
            hits.push({ file, line: i + 1, text: lines[i].trim() });
          }
        }
      }
    } catch {}
  }

  if (hits.length === 0) continue;

  const icon = rule.severity === 'error' ? '❌' : '⚠️';
  process.stderr.write(icon + ' [' + rule.id + '] ' + rule.message + '\n');
  for (const h of hits) {
    process.stderr.write('  ' + h.file + ':' + h.line + ': ' + h.text + '\n');
  }
  process.stderr.write('  Fix: ' + rule.fix + '\n\n');

  if (rule.severity === 'error') hasError = true;
}

process.exit(hasError ? 1 : 0);
" "$PATTERNS_FILE" "$STAGED"
