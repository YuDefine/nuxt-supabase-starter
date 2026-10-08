# Pi prompt templates（Outdated／Fleet 兩 mode 共享）

由 SKILL.md「派工模板」步在要生成 Pi／subagent 升版 prompt 時讀取。`vendor/scripts/version-upgrade-template-drift-audit.ts` 以本檔的 `## § A`／`## § B` 標題切段比對，標題 NEVER 改名。

> **Authoring source**：`~/offline/clade/vendor/snippets/pi-upgrade-prompts/{first-pass,research}.md`（clade-only，不散播）。本檔 § A § B inline 是 plugin cache 副本，**改其中一處時兩邊都要同步**——改完跑 `node vendor/scripts/version-upgrade-template-drift-audit.ts` 驗證兩份仍一致。未來會由 TD-129 dispatch script 機械化渲染。

First-pass與research的**每一份**生成prompt都MUST包含`workspace_access: mutation`段；這是carrier capability，不是任務摘要。Dispatcher首跳用`--workspace-access mutation`，每一個retry照exit payload保留該值。

## § A — First-pass 派工 prompt（per-package）

主線 / subagent 在生 prompt 時用 substitution：
- `<pkg>` / `<from>` / `<to>` / `<wt-path>` / `<branch>` / `<PM>` / `<lockfile>`：每個 package 不同
- `<install-flag>`：依 deps/devDeps 偵測（Outdated mode Step O.1.3）或 brief 的 `dep_or_devdep`（Fleet mode），`dep` 用空字串、`devDep` 用 `-D`
- `<baseline-paths>`：跑 `cd <wt-path> && git status --porcelain` 動態抓 unstaged + untracked
- `<plan-first-block>`：patch 升版時填空字串、minor/major 時填下方 Plan-first 區段
- `<verification-steps>`：依升版類型填 typecheck（patch）/ typecheck + build（minor）/ typecheck + build + test（major）
- `<changelog-block>`：**changelog-aware mode 才填**（Fleet mode 從 brief 渲染），非 changelog 模式留空白

模板：

```markdown
[DELEGATED-BY-CLAUDE-CODE]

# Task: 升級 <pkg> 從 <from> 到 <to>

## Workspace Capability

`workspace_access: mutation`。這份 brief 會修改 working tree、lockfile、Git index 並建立 commit；dispatcher 與每一個 quota fallback 都 **MUST** 保留 `--workspace-access mutation`。

你在 worktree `<wt-path>`（branch `<branch>`）跑。Package manager 是 `<PM>`。

<changelog-block>

<plan-first-block>

## Git Baseline

worktree 內這些 path 是 main fork 過來的 in-flight 變更，**不要動**：

<baseline-paths>

你的工作範圍**只動**：`package.json` + `<lockfile>`。

## 升版步驟

1. `<PM> add <install-flag> <pkg>@<to>`
<verification-steps>
N. 全綠後 commit

## Commit Authorization

**允許**：
- Selective stage：`git add package.json <lockfile>`
- Commit：`git commit -m "🧹 chore: wt upgrade-<pkg>-<from>→<to>"`（emoji-conventional commitlint 合規）

**禁止**：
- `git add -A` / `git add .`
- `--no-verify`（per `rules/core/commit.md` hard rule）
- `git push` / `git stash` / `git commit --amend`
- 修改 view 層檔（`.vue` / `.tsx` / `.jsx` / `app/pages/` 等）— 升 deps 不該動 view
- 動 Git Baseline 列的 in-flight 檔案

## 回報格式（MUST，stdout 結尾輸出）

成功：
`​`​`
PHASE_RESULT: SUCCESS
COMMIT: <sha>
FILES_CHANGED: package.json, <lockfile>
VERIFICATION: <依驗證步驟回報>
`​`​`

失敗：
`​`​`
PHASE_RESULT: FAILURE
STAGE_FAILED: <install | typecheck | build | test>
ERROR_TAIL:
<≤ 30 行 error message>
HYPOTHESIS: <一句話猜為什麼炸>
SUGGESTED_NEXT: <要不要升 research / 要查什麼 issue / changelog>
`​`​`

失敗時**不要**自己 commit、不要強過 fail、不要刪 / revert lockfile。
```

**`<plan-first-block>` 填充**（minor / major 才填，patch 留空）：

```markdown
## Plan-first（MUST）

在動任何 Edit / Write / Bash 寫入動作之前，先在 stdout 輸出 `## Plan` section：
- 預期要改的檔案
- 預期的驗證指令
- 預期影響範圍

Plan 寫完**立刻**繼續執行，不要等確認。
```

**`<verification-steps>` 填充**：

- Patch：`2. <PM> typecheck → 0 errors`
- Minor：`2. <PM> typecheck → 0 errors\n3. <PM> build → 成功（若有 build script）`
- Major：`2. <PM> typecheck → 0 errors\n3. <PM> build → 成功\n4. <PM> test 相關測試 → 全綠`

**`<changelog-block>` 填充**（Changelog-aware mode 才填，非 changelog 模式留空白）：

```markdown
## Changelog（orchestrator 預先研究，不用再 web search）

Release: <release_url>

### Breaking changes

- **<category>**: <description>
  Before: `<before>`
  After: `<after>`
  Affected APIs: <affected_apis joined>

### Callsites in this consumer（orchestrator 預先掃過）

- `<file>:<line>` 使用 `<symbol>`

### 動手範圍

除了 `package.json` + `<lockfile>` 之外，**可以**改上面 callsites 列到的檔案來套用 BC 修正。**NEVER** 改 callsites 清單外的其他 source code（即使「順手很合理」也不行 — 那是 unrelated refactor）。
```

## § B — Research 派工 prompt（escalation）

```markdown
[DELEGATED-BY-CLAUDE-CODE]

# Task: 升級 <pkg> 從 <from> 到 <to>（research mode）

## Workspace Capability

`workspace_access: mutation`。這份 brief 會修改 working tree、lockfile、Git index 並建立 commit；dispatcher 與每一個 quota fallback 都 **MUST** 保留 `--workspace-access mutation`。

Medium 已經失敗一次。失敗 tail：

\`\`\`
<first-pass-failure-tail>
\`\`\`

Pi 自報原因：<first-pass-hypothesis>

## 你的工作流程

**Phase R（Research，MUST 先做）**：
1. 用 **github** plugin 查 `<pkg>` 的 GitHub repo：
   - releases / tags / changelog → 找 `<from>` → `<to>` 之間的 breaking changes
   - issues 用關鍵字搜失敗的 error message
   - migration guide / upgrade guide pull request
2. 用 **agent-browser** 或 web search：
   - `<pkg> migration guide <to>` / `<pkg> breaking changes <to>`
   - 套件官方 docs site
3. 把研究結果濃縮成 `## Research Findings` section 輸出（≤ 20 行）

**Phase P（Plan，研究完才寫）**：

依 Research Findings 寫 `## Plan` section：要改哪些 source code 檔、預期驗證步驟、預期影響範圍。

**Phase I（Implement）**：

跟 first-pass 派工一樣（install → typecheck → build → test → commit），但 commit message 改成：

\`\`\`
🧹 chore: wt upgrade-<pkg>-<from>→<to> (researched <最關鍵的 issue/release URL slug>)
\`\`\`

## Git Baseline / Commit Authorization

同 first-pass 派工，不重述。

## 回報格式

成功時 stdout 結尾：
\`\`\`
PHASE_RESULT: SUCCESS
COMMIT: <sha>
RESEARCH_KEY_FINDINGS:
- <一行 breaking change 摘要>
RESEARCH_URLS:
- <release URL>
VERIFICATION: typecheck PASS, build PASS, test PASS
\`\`\`

失敗時：
\`\`\`
PHASE_RESULT: FAILURE
STAGE_FAILED: <stage>
ERROR_TAIL:
<≤ 30 行>
RESEARCH_FINDINGS_SO_FAR:
<線索>
WHY_STUCK: <一句話為什麼即使查到資訊也卡住>
\`\`\`
```
