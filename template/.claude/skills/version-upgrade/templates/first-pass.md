# First-pass 派工 prompt 樣板（per item）

由 `phases/consumer-batch.md` Step C.1 與 `phases/fleet.md` Step F.6 讀取；first-pass 失敗後的升級用 `templates/research.md`。

First-pass與research的**每一份**生成prompt都MUST包含`workspace_access: mutation`段；這是carrier capability，不是任務摘要。Dispatcher首跳用`--workspace-access mutation`，每一個retry照exit payload保留該值。

主線 / subagent 在生 prompt 時用 substitution：
- `<pkg>` / `<from>` / `<to>` / `<wt-path>` / `<branch>` / `<PM>` / `<lockfile>`：每個 package 不同
- `<install-flag>`：依 `inventory.py` 的 `dependencyType`（Step B.1）或 brief 的 `dep_or_devdep`（Phase F），`dep` 用空字串、`devDep` 用 `-D`
- `<baseline-paths>`：跑 `cd <wt-path> && git status --porcelain` 動態抓 unstaged + untracked
- `<plan-first-block>`：patch 升版時填空字串、minor/major 時填下方 Plan-first 區段
- `<verification-steps>`：依升版類型填 typecheck（patch）/ typecheck + build（minor）/ typecheck + build + test（major）
- `<changelog-block>`：**changelog-aware mode 才填**（Fleet 從 brief 渲染），非 changelog 模式留空白

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

