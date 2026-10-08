# mode 分流判準

觸發點：SKILL.md Step 0（每一次啟動本 skill，判 mode 之前）與「進 mode」步。

# Rule 1 - 四種升級需求一個入口，依輸入與 cwd 分流；MUST 等 user 拍板

- Level: `MUST`

四種升級需求一個 skill 涵蓋：

- **Outdated batch**：一個 consumer 累積很久沒升、`pnpm outdated` 一坨要批升
- **Fleet sweep**：看到 upstream release、想跨 consumer 跟上同一個版本
- **Skills**：`npx skills` 裝進來的第三方 skill 落後上游，或上游新增了我們還沒裝的 skill
- **Machine**：本機裝的東西落後——mise 管的工具、全域 npm（含 agent runtime 自己）、
  手裝 binary（`~/.local/bin`）、MCP server（codebase-memory-mcp）

skill 開頭依輸入分流，**不要記四個 skill 名**。

### Step 0 — Mode dispatcher（最先讀）

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
| 提到 **submodule-tracked 上游**（「SpecFormula / aixbdd 上游動了」「specformula pin 落後」「audit-upstream-submodules 報落後」「fork 的 patch」「vendor/specformula」） | clade home | **Skills · submodule** | § Skills · Step S.1 的 submodule 段 → `docs/dev-guide.md` § 6.5 |
| `/version-upgrade machine`，或提到**本機裝的東西**落後（「supabase cli 該升了嗎」「codebase-memory-mcp 有新版嗎」「mise 那堆工具掃一下」「全域 npm / claude-code 自己的版本」） | 任意（本機唯一） | **Machine** | § Machine · Step M.1 |
| 提到 **self-hosted runner / staging / prod 機器上**預裝的 CLI 落後（「runner 上的 supabase cli 幾版」「migrate job 紅燈，是不是 CLI 太舊」） | 任意 | **C′ 訊號，不升版** | machine-mode.md § Step M.7 |
| 無參數但 cwd = clade home | — | STOP + 問意圖 | 見下方 § Disambiguation |

#### Disambiguation（cwd 與 input 不對）

- 在 consumer 給 pkg name → 問「你想 (A) 只對這個 consumer 升 (走 Outdated batch 但鎖單套件)、還是 (B) 跨 registry 全命中 consumer sweep (要 `cd ~/offline/clade` 再跑)？」
- 在 clade 無參數 → 問「你想 (A) sweep 哪個 pkg？(B) 進某個 consumer 跑 `pnpm outdated`？(C) 掃第三方 skill 的上游落後（Skills mode）？還是 (D) 掃本機 toolchain（Machine mode）？」
- 在 worktree（cwd 含 `-wt/`） + 無參數 → 視為已在 Outdated batch 中段，跳 Step O.0、直接續跑 Step O.2

**MUST 等 user 拍板**，**NEVER** 主線自選 mode。

## Good Example

- 這個例子是好的，因為輸入與 cwd 對得上就照表進 mode，對不上就問。

```text
在 clade home 收到「升 @nuxt/ui」→ Fleet + Discovery → fleet-mode.md Step F.1
```

## Bad Example

- 這個例子是壞的，因為cwd 與輸入不符時主線自選 mode。

```text
在 clade home 無參數 → 自行決定「那就掃 Skills」
```

# Rule 2 - 「Node 版本」同時命中 Fleet · Toolchain 與 Machine 時先分辨

- Level: `MUST`

**「Fleet · Toolchain」與「Machine」都會被「Node 版本」這句話命中，MUST 先分辨再走。**
兩者管的是同一個工具名底下的**兩個不同東西**，選錯會去改一個跟症狀無關的地方：

| 使用者其實在講 | 判準 | Mode |
| --- | --- | --- |
| repo 裡**宣告**的版本（`engines.node` / `.nvmrc` / CI `node-version` / `packageManager`）跨 consumer 不一致 | 症狀出現在 **CI** 或 **別台 consumer** 上 | **Fleet · Toolchain** |
| **這台機器上裝的**那個 node / 那支 CLI 落後 | 症狀出現在**本機指令**上（`node -v` 不對、某支 CLI 沒有新功能） | **Machine** |

判不出來就問，**NEVER** 自己挑一邊——兩邊的動作沒有交集，猜錯等於整趟白跑。

## Good Example

- 這個例子是好的，因為依症狀出現在 CI／別台 consumer 還是本機指令判定。

```text
「CI 的 node-version 跟 .nvmrc 不一致」→ 症狀在 CI → Fleet · Toolchain
```

## Bad Example

- 這個例子是壞的，因為判不出來時自己挑一邊。

```text
「Node 版本怪怪的」→ 直接跑 Machine mode 升本機 node
```

# Rule 3 - 三個軸決定哪些事不在本 skill：C 軸與 C′ 軸只出訊號

- Level: `MUST`

### 三個軸（決定哪些事**不**在這支 skill 裡）

| 軸 | 版本宣告在哪 | git 載體 | 落點 |
| --- | --- | --- | --- |
| **A. Repo-declared** | `package.json` / lockfile / workflow yaml / `.nvmrc` | ✅ commit | Outdated / Fleet / Skills mode |
| **B. Machine-installed** | mise config / 全域 npm / `~/.local/bin` / `.mcp.json` | ❌ | **Machine mode** |
| **C. Remote-deployed** | LXC / VM 上實際跑的版本 | ❌ | **不在本 skill**：`scripts/audit-remote-env-version-drift.ts` 出訊號，落地 relay 給該 consumer 的 session |
| **C′. Runner-installed** | self-hosted runner 上被 workflow 裸呼叫的預裝 binary（`supabase` / `gh` / `docker` / `node`…） | ❌ | **不在本 skill**：`scripts/audit-runner-toolchain-drift.ts` 出訊號（machine-mode.md § Step M.7），升級 relay 給該 consumer |

C 軸刻意留在外面：升遠端 staging / prod 的 runtime 是 consumer 的 production 動作，clade 主線
替它動手正是 `.claude/skills/clade-home/rules/clade-role-and-todo-discipline.md` § 反模式 逐字禁止的那件事。
**NEVER** 因為「使用者問的是版本、本 skill 就叫 version-upgrade」把 C 軸吸進來。

## Good Example

- 這個例子是好的，因為遠端環境的版本落後只出訊號並 relay 給該 consumer。

```text
「prod 上的 runtime 幾版」→ scripts/audit-remote-env-version-drift.ts 出訊號 → relay 給該 consumer 的 session
```

## Bad Example

- 這個例子是壞的，因為因為使用者問的是版本，就由 clade 主線動手升遠端環境。

```text
「staging 的 supabase 太舊」→ 主線 ssh 進去升版
```

# Rule 4 - 進 mode 之前 MUST 先完整讀該 mode 檔；主檔紀律不外溢到 Skills／Machine

- Level: `MUST`

進入 Outdated mode 後，**MUST** 先完整讀 [outdated-mode.md](outdated-mode.md) 再開始 Step O.1。主檔以下不再重述 Outdated mode 步驟。

進入 Fleet mode 後，**MUST** 先完整讀 [fleet-mode.md](fleet-mode.md) 再開始 Step F.1。主檔以下不再重述 Fleet mode 步驟。

進入 Skills mode 後，**MUST** 先完整讀 [skills-mode.md](skills-mode.md) 再開始 Step S.1。主檔以下不再重述 Skills mode 步驟。**Skills mode 不動 `package.json` / lockfile**，所以 `rules/A軸共用紀律判準.md` 的 Worktree gate 與 `references/pi-prompt-templates.md` 對它不適用；它的紀律在 skills-mode.md 自帶。

進入 Machine mode 後，**MUST** 先完整讀 [machine-mode.md](machine-mode.md) 再開始 Step M.1。主檔以下不再重述 Machine mode 步驟。**Machine mode 沒有任何 git 載體**——`rules/A軸共用紀律判準.md` 的 Worktree gate、Pi 派工模板、selective stage、三層 verify **全部零適用**，**NEVER** 因為它們寫在本 skill 就套過去；它自己的三條紀律（序列執行、先釘現版號、驗證要真實呼叫）在 machine-mode.md。

## Good Example

- 這個例子是好的，因為先完整讀 mode 檔再開始第一步。

```text
user 拍板 Skills mode → 完整讀 skills-mode.md → Step S.1（不跑 wt-gate、不用 Pi 派工模板）
```

## Bad Example

- 這個例子是壞的，因為把 A 軸的 Worktree gate 與三層 verify 套到 Machine mode。

```text
Machine mode 升 mise 工具前先開 worktree
```
