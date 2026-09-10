---
name: version-upgrade
description: consumer outdated batch、fleet 套件 sweep、skill 上游同步、本機 toolchain 升級。
metadata:
  clade:
    invocation: explicit
    permission_tier: action
disable-model-invocation: true
---


# version-upgrade — 統一版本升級入口

四種升級需求一個 skill 涵蓋：

- **Outdated batch**：一個 consumer 累積很久沒升、`pnpm outdated` 一坨要批升
- **Fleet sweep**：看到 upstream release、想跨 consumer 跟上同一個版本
- **Skills**：`npx skills` 裝進來的第三方 skill 落後上游，或上游新增了我們還沒裝的 skill
- **Machine**：本機裝的東西落後——mise 管的工具、全域 npm（含 agent runtime 自己）、
  手裝 binary（rtk）、MCP server（codebase-memory-mcp）

skill 開頭依輸入分流，**不要記四個 skill 名**。

## 名字為什麼不是 dep-upgrade（2026-09-10 改名）

管的對象從第一天起就不只是 dependency——actions 與 skills 都不是——加上 Machine mode
之後更不是。三個候選被否決的理由值得留著，因為它們各自對應一個真實的邊界：

| 候選 | 否決理由 |
| --- | --- |
| `env-upgrade` | clade 全域「env」一致指 **deploy environment**（`rules/core/deploy-env-identity.md`、`db-preview-env.md`），也就是本 skill 明確**不做**的 C 軸。用它命名等於用唯一不做的事替 skill 命名 |
| 裸 `upgrade` | 撞 Claude Code 內建 `/upgrade`（訂閱升級） |
| `version-sweep` | 「sweep」暗示 fleet，對 single-consumer 的 Outdated batch 與單機的 Machine mode 都不貼 |

## 三個軸（決定哪些事**不**在這支 skill 裡）

| 軸 | 版本宣告在哪 | git 載體 | 落點 |
| --- | --- | --- | --- |
| **A. Repo-declared** | `package.json` / lockfile / workflow yaml / `.nvmrc` | ✅ commit | Outdated / Fleet / Skills mode |
| **B. Machine-installed** | mise config / 全域 npm / `~/.local/bin` / `.mcp.json` | ❌ | **Machine mode** |
| **C. Remote-deployed** | LXC / VM 上實際跑的版本 | ❌ | **不在本 skill**：`scripts/audit-remote-env-version-drift.ts` 出訊號，落地 relay 給該 consumer 的 session |

C 軸刻意留在外面：升遠端 staging / prod 的 runtime 是 consumer 的 production 動作，clade 主線
替它動手正是 `.claude/rules/local/clade-role-and-todo-discipline.md` § 反模式 逐字禁止的那件事。
**NEVER** 因為「使用者問的是版本、本 skill 就叫 version-upgrade」把 C 軸吸進來。

## Step 0 — Mode dispatcher（最先讀）

依**輸入**跟 **cwd** 分流：

| 觸發 | cwd 預期 | Mode | 跳到 |
| --- | --- | --- | --- |
| 純命令 `/version-upgrade`（無參數） | consumer root（有 `package.json` + lockfile 或 `.github/workflows/`） | **Outdated batch** | § Outdated · Step O.1 |
| `/version-upgrade actions` | consumer root（有 `.github/workflows/`） | **Outdated batch（only actions）** | § Outdated · Step O.1（skip O.1-npm） |
| 給 GitHub release URL（`https://github.com/.../releases/tag/v<ver>`） | clade home | **Fleet** | § Fleet · Step F.1 |
| 給 `<pkg>@<ver>` / `<pkg> v<ver>` / `<pkg> <ver>` | clade home | **Fleet** | § Fleet · Step F.1 |
| 給純 pkg name（「升 @nuxt/ui」、「無腦升 X」） | clade home | **Fleet + Discovery** | § Fleet · Step F.1 |
| 給 package manager / runtime 本身（「升 pnpm」、「fleet packageManager 統一」、「Node 版本統一」） | clade home | **Fleet · Toolchain** | § Fleet · Step F.1，**再讀 fleet-mode.md § Toolchain sweep 分支** |
| `/version-upgrade skills`，或提到 **skill** 上游 / 落後 / 新增（「supabase skill 上游更新了我們有跟嗎」「掃一下 skill 有沒有落後」） | clade home | **Skills** | § Skills · Step S.1 |
| `/version-upgrade machine`，或提到**本機裝的東西**落後（「supabase cli 該升了嗎」「rtk / codebase-memory-mcp 有新版嗎」「mise 那堆工具掃一下」「全域 npm / claude-code 自己的版本」） | 任意（本機唯一） | **Machine** | § Machine · Step M.1 |
| 無參數但 cwd = clade home | — | STOP + 問意圖 | 見下方 § Disambiguation |

**「Fleet · Toolchain」與「Machine」都會被「Node 版本」這句話命中，MUST 先分辨再走。**
兩者管的是同一個工具名底下的**兩個不同東西**，選錯會去改一個跟症狀無關的地方：

| 使用者其實在講 | 判準 | Mode |
| --- | --- | --- |
| repo 裡**宣告**的版本（`engines.node` / `.nvmrc` / CI `node-version` / `packageManager`）跨 consumer 不一致 | 症狀出現在 **CI** 或 **別台 consumer** 上 | **Fleet · Toolchain** |
| **這台機器上裝的**那個 node / 那支 CLI 落後 | 症狀出現在**本機指令**上（`node -v` 不對、某支 CLI 沒有新功能） | **Machine** |

判不出來就問，**NEVER** 自己挑一邊——兩邊的動作沒有交集，猜錯等於整趟白跑。

### Disambiguation（cwd 與 input 不對）

- 在 consumer 給 pkg name → 問「你想 (A) 只對這個 consumer 升 (走 Outdated batch 但鎖單套件)、還是 (B) 跨 registry 全命中 consumer sweep (要 `cd ~/offline/clade` 再跑)？」
- 在 clade 無參數 → 問「你想 (A) sweep 哪個 pkg？(B) 進某個 consumer 跑 `pnpm outdated`？(C) 掃第三方 skill 的上游落後（Skills mode）？還是 (D) 掃本機 toolchain（Machine mode）？」
- 在 worktree（cwd 含 `-wt/`） + 無參數 → 視為已在 Outdated batch 中段，跳 Step O.0、直接續跑 Step O.2

**MUST 等 user 拍板**，**NEVER** 主線自選 mode。

## 共用基礎（**只有 Outdated 與 Fleet 兩個 A 軸 mode 用到**）

| 基礎 | 出處 |
| --- | --- |
| Worktree gate | [[worktree-default]] §1，wt-helper 開 / merge-back。**機械檢查點見下方 § Worktree gate（fail-closed）** |
| Pi 派工模板 | `vendor/snippets/pi-upgrade-prompts/{first-pass,research}.md`（authoring source），SKILL.md § Pi prompt templates 是 plugin cache 副本 |
| Pi watch protocol | [[agent-routing.pi-watch-protocol]] |
| Selective stage on main | 一律 `git add package.json <lockfile>` + 額外指定檔，**NEVER** `git add -A` |
| Commit msg（commitlint-aware） | subagent / pi 端讀 consumer commitlint config 後生 compliant msg |

### Worktree gate（fail-closed）

**本節只管 A 軸的兩個 mode（Outdated / Fleet）。** Skills mode 與 Machine mode 不動 `package.json` / lockfile，gate 對它們零適用——**NEVER** 為了「保險」對一個不產生檔案改動的操作開 worktree，那沒有隔離作用，只讓你以為有。

Mode 分流拍板後、跑**任何** `pnpm add` / `git add` / `git commit` 之前，**MUST** 先跑：

```bash
node ~/offline/clade/vendor/scripts/wt-gate.ts --for version-upgrade
```

exit 0 才可繼續。exit 2（cwd 在 main working tree）**MUST** 停下開 worktree 再重跑，
**NEVER** 加 `|| true`、**NEVER** 改判成 warning、**NEVER** 因為「這次只改兩個檔」跳過。
gate 沒有 `--allow-main` escape hatch，這是刻意的。

> 這條在 2026-07-29 之前只是文字規約，實測擋不住：<consumer-b> 的 sweep 在 main 生出 per-package
> 迴圈跑起來，`git add package.json` 撈走另一個 session 未 commit 的 `pnpm version patch`，
> 同時 `.git/index.lock` 讓對方的 `git commit` 直接失敗（TD-277）。commit message 的
> `wt ` 前綴當時**不**保證真的在 worktree——接上 gate 之後才保證。

---

## Mode 分流

進入 Outdated mode 後，**MUST** 先完整讀 [outdated-mode.md](outdated-mode.md) 再開始 Step O.1。主檔以下不再重述 Outdated mode 步驟。

進入 Fleet mode 後，**MUST** 先完整讀 [fleet-mode.md](fleet-mode.md) 再開始 Step F.1。主檔以下不再重述 Fleet mode 步驟。

進入 Skills mode 後，**MUST** 先完整讀 [skills-mode.md](skills-mode.md) 再開始 Step S.1。主檔以下不再重述 Skills mode 步驟。**Skills mode 不動 `package.json` / lockfile**，所以主檔的 Worktree gate 與 Pi 派工模板對它不適用；它的紀律在 skills-mode.md 自帶。

進入 Machine mode 後，**MUST** 先完整讀 [machine-mode.md](machine-mode.md) 再開始 Step M.1。主檔以下不再重述 Machine mode 步驟。**Machine mode 沒有任何 git 載體**——主檔的 Worktree gate、Pi 派工模板、selective stage、三層 verify **全部零適用**，**NEVER** 因為它們寫在主檔就套過去；它自己的三條紀律（序列執行、先釘現版號、驗證要真實呼叫）在 machine-mode.md。

---

# § Fleet mode carve-out 准入（SoT）

> 本節是 [[clade-role-and-todo-discipline]] § upstream-driven dep migration 的准入條件 SoT（2026-08-02 自該 rule 移入）；rule 端只留觸發判定 stub。Fleet 流程 Step F.2.3 對本節逐條自查。

每次 Fleet sweep **必須**全部滿足：

- ✅ 變動一對一對應上游 release 列出的 BC（rename / removal / signature change / config schema 變更）— 找不到對應 clause 的改動，不准帶進來
- ✅ 每個 consumer 各自開 worktree（per [[worktree-default]]），不在 main 直接動
- ✅ 每個 consumer 一個 atomic commit，依該 consumer `registry/consumers.json` 的 `workflow_model` 走（trunk-based 直接 push、pr-merge-based 開 PR）
- ✅ 一次 sweep 只處理「**一個套件 × 一個 target version**」，不跨多套件 / 多 release 混在同一 sweep
- ✅ Toolchain sweep（pnpm / Node 自身）額外一條：target **MUST 是 `latest` dist-tag 指到的版本**，pre-release tag 一律不進 fleet（toolchain 壞掉是全 consumer 同時無法 build，不像單一套件只影響用到它的地方）
- ✅ 命中該套件的 consumer 才動；沒命中的 consumer **NEVER** 順便動其他東西

**禁止帶搭**（即使在 Fleet 編排內也禁）：

- ❌ clade 自行發想的 refactor / cleanup（即使「順手很好做」）
- ❌ 把標準層改動（rules / vendor / skills）混進 dep migration commit
- ❌ 把 unrelated 套件升版搭便車進來

**這條 carve-out 不適用於**：

- Framework major migration（Nuxt 3→4 / Next 14→15）— 仍需專屬 plan，不走 fleet skill
- consumer 自家業務 bug fix / feature
- 「我覺得 N 個 consumer 該統一寫法」這種 clade 發想的改動 — 仍是「替 consumer 規劃實作」反模式

**觸發判定**：能不能在 upstream release notes / changelog 找到「導致這個 mod 的具體 BC clause」。找不到，就不在 carve-out 範圍內，照原規則走：**relay 給該 consumer 的 session**（per [[clade-role-and-todo-discipline]] § Consumer 工作命中時 MUST relay），主線不徒手 sweep。

---

# § Pi prompt templates（兩 mode 共享）

> **Authoring source**：`~/offline/clade/vendor/snippets/pi-upgrade-prompts/{first-pass,research}.md`（clade-only，不散播）。下方 § A § B inline 是 plugin cache 副本，**改其中一處時兩邊都要同步**。未來會由 TD-129 dispatch script 機械化渲染。

First-pass與research的**每一份**生成prompt都MUST包含`workspace_access: mutation`段；這是carrier capability，不是任務摘要。Dispatcher首跳用`--workspace-access mutation`，每一個retry照exit payload保留該值並排除所有`*-cursor`。

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

`workspace_access: mutation`。這份 brief 會修改 working tree、lockfile、Git index 並建立 commit；dispatcher 與每一個 quota fallback 都 **MUST** 保留 `--workspace-access mutation`。**NEVER** 選 `grok-cursor`、`luna-cursor` 或 `sol-cursor`；它們只承接 readonly inspection／review。

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
SUGGESTED_NEXT: <要不要升 high research / 要查什麼 issue / changelog>
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

`workspace_access: mutation`。這份 brief 會修改 working tree、lockfile、Git index 並建立 commit；dispatcher 與每一個 quota fallback 都 **MUST** 保留 `--workspace-access mutation`。**NEVER** 選 `grok-cursor`、`luna-cursor` 或 `sol-cursor`；它們只承接 readonly inspection／review。

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

---

# 禁止事項（Outdated 與 Fleet 兩個 mode 都受約束；Skills mode 見 skills-mode.md 尾段、Machine mode 見 machine-mode.md 尾段）

- **NEVER** 在 main working tree 跑 — Outdated 與 Fleet 都受此規約，由 `wt-gate.ts` fail-closed 強制（見 § Worktree gate）
- **NEVER** 主線自己改 `package.json` 或在升版階段（Step O.2）跑 `pnpm add` / `pnpm install`（升版全程委派給 pi / subagent）。**例外**：Step O.3.2.c post-merge-back `pnpm install` 是 setup chore，不是升版動作
- **NEVER** first-pass 失敗就直接問使用者 — 必須先自動升 research（`--effort high`）
- **NEVER** high 也失敗就主線自己接手 — 必須 runtime-native question interface 讓使用者選
- **NEVER** 把正在審查的 mutation carrier 先說成允許再在同一個決策反悔；若 carrier 是 `grok-cursor`，該 carrier 單一結論必須是拒絕，允許的 route 仍是 `grok-xai`。
- runtime-native question interface 分成兩個能力判定：沒有 structured question 但普通對話與 exec session 可用時，直接在當前對話詢問使用者，**NEVER** 換 runtime；使用者已選 retry 但沒有可驗證的 background execution/completion surface 時，只阻擋依賴該 dispatch 的步驟、保留 worktree 與 durable task，**NEVER** 宣稱整個互動不可用。
- **NEVER** 把 merge-back 當「下一步」丟給 user 自己跑（per [[worktree-default]] §5）
- pi 派工 prompt 第一行 MUST 含 `[DELEGATED-BY-CLAUDE-CODE]` marker（codex 端 Runtime Gate 驗證此 marker 存在）
- **NEVER** 派 pi 時把 sandbox 換成 `read-only` / `workspace-write`（會擋 MCP）
- **NEVER** 把上列Pi sandbox mode與`workspace_access`混為一談：version-upgrade一律是`mutation`，fallback排除每一個`*-cursor`；Cursor readonly security boundary不為升版放寬
- **NEVER** `git add -A` / `git add .` 在 main — 一律 selective stage

Mode-specific 禁止事項見 [outdated-mode.md](outdated-mode.md)、[fleet-mode.md](fleet-mode.md)、[skills-mode.md](skills-mode.md) 與 [machine-mode.md](machine-mode.md) 尾段。

# 相關規約

- [[clade-role-and-todo-discipline]] § upstream-driven dep migration — carve-out 觸發判定 stub（准入條件 SoT 在本檔 § Fleet mode carve-out 准入）
- [[worktree-default]] §1, §5 — worktree gate + skill-owned lifecycle
- Parallel Subagent Fan-out（user-global runtime policy）+ [[agent-routing.dispatch-execution]] § Subagent 回報契約 — Fleet mode 長駐 subagent + thin brief + 4-status 規約
- [[agent-routing.pi-watch-protocol]] — pi 派工 + watch + Runtime Gate marker
- [[commit]] — Outdated mode main 端 selective stage 後的 `/commit` 收尾流程


## Claude host contract

Resolve `<skills-root>` and `<native-skills>` to `.claude/skills/`. The shared `npx skills` CLI remains the installer and uses the commands in the common workflow. For mutation dispatch, use `Bash(run_in_background=true)` and collect with `TaskOutput`/`TaskStop`; use `ScheduleWakeup` for the single inert keepalive. User questions use the native question surface, with plain conversation as the fallback when structured questions are unavailable.

Runtime bindings: `<runtime-target>` is `claude`; `<runtime-agent>` is `claude-code`.
