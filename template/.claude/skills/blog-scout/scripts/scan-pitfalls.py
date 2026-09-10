#!/usr/bin/env python3
"""blog-scout 素材掃描器 — 盤點 clade docs/pitfalls/ 並做聚類與敏感度初判。

輸出三段（stdout, markdown）：
  1. inventory  — 條目數、severity / status / discovered 年月分佈
  2. clusters   — public-tag pair 聚類（>= --min-cluster 條才列），每群列成員與敏感度
  3. sensitivity — 三級初判統計（高/中/低）

敏感度初判規則（機械初篩，MUST 由人工用 <consumer-k> CLAUDE.md 藏招準則複核）：
  高 — tags 命中內部工具/工作流 tag（故事本體是內部架構，藏招準則擋「內部工具名與系統架構」）
  中 — body（去 frontmatter 後）含禁詞（去敏感化改寫後可寫；卡「禁詞清單」）
  低 — 以上皆無（公開技術棧素材，直接可寫）

禁詞與內部 tag 清單的 SoT 是 <consumer-k>/CLAUDE.md § 禁詞 與 clade docs/pitfalls/tags.yml；
本檔內建清單會漂移 — skill workflow Step 1 要求先讀 SoT，發現落差用 --banned-extra 補。

stdlib only；唯讀，不寫任何檔。
"""

import argparse
import collections
import glob
import itertools
import os
import re
import sys

# 內部工具 / 工作流 tag：故事離開這些系統就不成立 → 敏感度「高」
INTERNAL_TAGS = {
    'review-gui', 'spectra', 'spectra-workflow', 'work-loop', 'change-loop',
    'worktree', 'merge-back', 'auto-stash', 'agent-routing', 'pi-dispatch',
    'herdr', 'manual-review', 'verify-ui', 'verify-channels', 'screenshot-review',
    'sonnet-fallback', 'claude-analyzed', 'fix-requested', 'bucket-classification',
    'premature-handoff', 'workflow-discipline', 'rules', 'propagate-gap',
    'evidence-collection', 'verification-lease', 'commit', 'self-referential-gate',
}

# 禁詞（body 掃描用；SoT: <consumer-k>/CLAUDE.md § 禁詞）
BANNED = [
    'clade', 'spectra', 'review-gui', 'wt-helper', 'pi-dispatch', 'work-loop',
    'herdr', '<consumer-a>', '<consumer-b>', '<consumer-d>', '<consumer-i>', '<client-a>', '<client-b>',
    '~/offline/',
]

SEV_ORDER = ['critical', 'high', 'mid', 'low']


def parse_entry(path, banned_re):
    text = open(path, encoding='utf-8').read()
    m = re.match(r'^---\n(.*?)\n---\n', text, re.S)
    if not m:
        return None
    fm, body = m.group(1), text[m.end():]

    def field(name):
        mm = re.search(rf'^{name}:\s*(.+)$', fm, re.M)
        return mm.group(1).strip() if mm else ''

    tg = re.search(r'^tags:\n((?:\s+-\s+.+\n)+)', fm, re.M)
    tags = [t.strip().lstrip('- ').strip()
            for t in tg.group(1).strip().split('\n')] if tg else []
    banned_hits = len(banned_re.findall(body))
    if set(tags) & INTERNAL_TAGS:
        sens = '高'
    elif banned_hits:
        sens = '中'
    else:
        sens = '低'
    title = re.search(r'^#\s+(.+)$', body, re.M)
    return {
        'file': os.path.basename(path),
        'severity': field('severity'),
        'status': field('status'),
        'discovered': field('discovered'),
        'tags': tags,
        'public_tags': [t for t in tags if t not in INTERNAL_TAGS],
        'sensitivity': sens,
        'banned_hits': banned_hits,
        'title': title.group(1).strip() if title else '(no H1)',
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pitfalls-dir',
                    default=os.path.expanduser('~/offline/clade/docs/pitfalls'))
    ap.add_argument('--include-archive', action='store_true',
                    help='連 _archive/ 一起掃（audit 慣例：archive 仍可查）')
    ap.add_argument('--min-cluster', type=int, default=3,
                    help='tag pair 至少幾條素材才列為候選群（預設 3）')
    ap.add_argument('--banned-extra', default='',
                    help='逗號分隔的補充禁詞（SoT 有新條目時用這裡補，不改本檔）')
    args = ap.parse_args()

    banned = BANNED + [w.strip() for w in args.banned_extra.split(',') if w.strip()]
    banned_re = re.compile('|'.join(re.escape(w) for w in banned), re.I)

    paths = sorted(glob.glob(f'{args.pitfalls_dir}/2*.md'))
    if args.include_archive:
        paths += sorted(glob.glob(f'{args.pitfalls_dir}/_archive/*/*.md'))
    entries = [e for e in (parse_entry(p, banned_re) for p in paths) if e]
    if not entries:
        print(f'掃不到任何可解析的 pitfall（dir={args.pitfalls_dir}）', file=sys.stderr)
        return 1

    # ── 1. inventory ──
    print(f'## Inventory\n\n{len(entries)} 條（dir: {args.pitfalls_dir}'
          f'{", 含 _archive" if args.include_archive else ""}）\n')
    sev = collections.Counter(e['severity'] for e in entries)
    print('severity: ' + '  '.join(f'{k}={sev.get(k, 0)}' for k in SEV_ORDER))
    st = collections.Counter(e['status'] for e in entries)
    print('status:   ' + '  '.join(f'{k}={v}' for k, v in st.most_common()))
    ym = collections.Counter(e['discovered'][:7] for e in entries if e['discovered'])
    print('discovered: ' + '  '.join(f'{k}={v}' for k, v in sorted(ym.items())))

    # ── 3 的統計先算，群組列表要用 ──
    sens = collections.Counter(e['sensitivity'] for e in entries)

    # ── 2. clusters ──
    pairs = collections.defaultdict(list)
    for e in entries:
        for a, b in itertools.combinations(sorted(set(e['public_tags'])), 2):
            pairs[(a, b)].append(e)
    # 排序鍵是「可寫成員數」（低+中），不是原始條數。兩者在本資料集上幾乎反相關：
    # 最大的幾群（cli-tooling / git / cross-session）全是內部工具坑，低+中 = 0，
    # 一條都寫不出來。按條數排會讓可寫的群沉到第 10 名之後，每次跑都要先讀 200 行
    # 用不到的東西。tiebreak 才用總條數。
    def usable(members):
        return sum(1 for m in members if m['sensitivity'] in ('低', '中'))

    clusters = sorted(((k, v) for k, v in pairs.items()
                       if len(v) >= args.min_cluster),
                      key=lambda kv: (-usable(kv[1]), -len(kv[1])))
    print(f'\n## Clusters（public-tag pair，≥{args.min_cluster} 條）\n')
    for (a, b), members in clusters:
        smix = collections.Counter(m['sensitivity'] for m in members)
        print(f'### {a} + {b} — {len(members)} 條'
              f'（低={smix.get("低", 0)} 中={smix.get("中", 0)} 高={smix.get("高", 0)}）')
        for m in sorted(members, key=lambda m: SEV_ORDER.index(m['severity'])
                        if m['severity'] in SEV_ORDER else 9):
            print(f'- [{m["severity"]}/{m["sensitivity"]}] {m["file"]} — {m["title"]}')
        print()

    # ── 3. sensitivity ──
    print('## Sensitivity（機械初判，MUST 人工複核）\n')
    print('  '.join(f'{k}={sens.get(k, 0)}' for k in ('低', '中', '高')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
