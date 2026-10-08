# § Machine mode — machine-installed 版本（B 軸）

管的是**裝在這台機器上、沒有 git 載體**的版本：mise 管的工具、`~/.local/bin` 的手裝
binary、全域 npm 套件（含 agent runtime 自己）、MCP server。

`rules/A軸共用紀律判準.md` 的 Worktree gate、Pi 模板、selective stage、三層 verify 都不適用（沒有 git 載體）。本 mode 自己的三條：

1. **一次一個工具，序列執行**：共用同一個 `PATH`／`~/.local/bin`／mise config，並行會互相覆蓋
2. **升之前先記下現版號**，那是唯一的 rollback 座標
3. **驗證 MUST 是一次真實呼叫**，`--version` 不算（Step M.4）

---

## Step M.1 — 盤點（三個來源，缺一就得到「已對齊」的假訊號）

### M.1.1 mise-managed

```bash
mise outdated
```

它只看得見浮動 pin 的工具；exact-pinned 的永遠不會出現。**NEVER** 拿空輸出推論「都最新」，逐支問：

```bash
# 對每一支 mise 工具，把 pinned 與 latest 並排（含 exact-pinned）
mise ls --json 2>/dev/null | node -e '
const t=JSON.parse(require("fs").readFileSync(0,"utf8"));
for (const k of Object.keys(t)) console.log(k)
' | while read -r tool; do
  printf "%-12s installed=%-12s latest=%s\n" "$tool" \
    "$(mise ls "$tool" 2>/dev/null | awk "NR==1{print \$2}")" \
    "$(mise latest "$tool" 2>/dev/null)"
done
```

### M.1.2 全域 npm 套件（**含 agent runtime 自己**）

```bash
npm ls -g --depth=0
npm outdated -g --depth=0
```

含 agent runtime 本身（`@anthropic-ai/claude-code`、`@openai/codex`、`@earendil-works/pi-coding-agent`、`@google/gemini-cli`）與 `vite-plus`、`agent-browser`、`ntn`、`@sentry/cli`——它們不在任何 repo 的 `package.json`，不掃就沒有訊號。

### M.1.3 手裝 binary（`~/.local/bin`）

沒有 registry，只能逐支列。現行清單與上游：

| binary | 現版查法 | 上游 | 升級路徑 |
| --- | --- | --- | --- |
| `codebase-memory-mcp` | `codebase-memory-mcp --version` | — | **有 self-update**：`codebase-memory-mcp update` |

加一支進表 **MUST** 先查證上游（`strings <binary> | grep github.com`、`--help` footer），**NEVER** 憑套件名猜 GitHub org。

### M.1.4 MCP server

```bash
cat .mcp.json
```

`.mcp.json` 只寫 `command` 不帶版本，版本要問 binary 自己（M.1.3），**NEVER** 從 `.mcp.json` 推論。

---

## Step M.2 — Node 升級是特例，MUST 先過這道 gate

mise 升 node 建新的 install 目錄，全域 npm 套件（掛在 `~/.local/share/mise/installs/node/<ver>/lib/node_modules`）不會跟過去——**整套 agent runtime 連同你自己正在跑的那支都會消失**。

升 node 之前 **MUST** 依序做完這三件：

1. **把現有全域清單釘下來**——這是唯一的還原座標：

   ```bash
   BEFORE=$(mktemp -t global-npm-before.XXXXXX)
   npm ls -g --depth=0 > "$BEFORE"; echo "$BEFORE"; cat "$BEFORE"
   ```

   **MUST** 用 `mktemp`，**NEVER** 寫死固定檔名（`audit-fixed-temp-paths.ts` 會攔）。

2. **回報給 user 並等確認**，**NEVER** 自主執行：升級後沒有任何 session 活著能把 runtime 裝回來。這是本 skill 唯一 **MUST 由 user 在場執行**的動作。

3. **升完逐支重裝**，並拿第 1 步那份清單逐行對帳。

**NEVER** 把 node 升級混進任何批次。

---

## Step M.3 — 升級（一次一個，序列）

| 來源 | 指令 |
| --- | --- |
| mise 浮動 pin | `mise upgrade <tool>` |
| mise exact-pinned | 改 `~/.config/mise/config.toml` 的版號 → `mise install <tool>` → `mise use <tool>@<ver>` |
| 全域 npm | `npm i -g <pkg>@<ver>` |
| `codebase-memory-mcp` | `codebase-memory-mcp update` |

`~/.config/mise/config.toml` 不在 git 裡，改之前 **MUST** 備份到帶隨機段的路徑：

```bash
cp ~/.config/mise/config.toml "$(mktemp -t mise-config-before.XXXXXX)"
```

---

## Step M.4 — 驗證：`--version` 不算驗證

`--version` 只證明檔案換了（glibc 不符或 arch 錯的 binary 一樣印得出來）。**MUST** 逐工具跑一次真實呼叫：

| 工具 | 真實呼叫 |
| --- | --- |
| `vp` | `cd ~/offline/clade && vp check`（要看到它真的跑完，不是印 usage） |
| `supabase` | `supabase --version && supabase projects list`（或任一需要 CLI 邏輯的子指令） |
| `codebase-memory-mcp` | `codebase-memory-mcp cli list_projects`（走一次真的 tool 呼叫）。**NEVER 用 `index_status`**——它 MUST 帶 `project` 參數，不帶會回 `missing required argument`，那個錯誤與「升壞了」同形 |
| `gh` | `gh auth status` |
| `node` | `node -e 'console.log(1+1)'` ＋ **M.1.2 全域清單對帳** |
| agent runtime（claude-code / codex / pi） | 起一次最小 session 並看到它回應 |

只憑 `--version` 或「安裝指令沒報錯」不能宣告完成。

---

## Step M.5 — 落檔

- 升了且驗過：不必登記
- 升到一半失敗 / 被 rollback：**MUST** 登記，寫明卡在哪、停在哪個版本，**NEVER** 只在對話裡講
- 查不出上游：**MUST** 登記，**NEVER** 猜一個 repo 填進 M.1.3

登記落點：有 `specs/truth/work-lifecycle.md` 的 repo 寫進承載本次升版的 plan Open work（**NEVER** 新 TD）；未遷移 consumer 才登 `docs/tech-debt.md` TD。

---

## Step M.6 — C 軸不歸本 mode，但問到時 MUST 指向訊號

使用者問遠端 dev / staging / prod 跑的版本時，**NEVER** 在本 mode 動手，也 **NEVER** 只回「那是 consumer 自治區」就停。跑訊號：

```bash
node ~/offline/clade/scripts/audit-remote-env-version-drift.ts
```

預設**不連任何遠端**。`deploy.hosts[]` 的 ssh 探測要明確帶 `--probe-hosts`（跨機器 side effect，只在有授權的 session 跑，同 § M.7 的 `--probe`；`pnpm audit:manual` 批次也不會觸發）：

```bash
node ~/offline/clade/scripts/audit-remote-env-version-drift.ts --probe-hosts [--official-compose <path>]
```

六類（Workers／宣告面）輸出 **MUST** 分開讀：

| 類別 | 意思 | 動作 |
| --- | --- | --- |
| `drift` | 量得到且落後（目前唯一量得到的是 Cloudflare Workers 的 `compatibility_date`） | relay 給該 consumer |
| `invalid` | 讀到一個值但它不是有效日期 | 修那個值。**不列入「量得到」的分母** |
| `ambiguous` | 同一個檔給出多個相異日期（top-level ＋ `[env.*]` 覆寫） | 先確定哪一個是 production；audit 不替你挑 |
| `data-missing` | platform 有 probe 但這台沒有可讀的值 | 再分兩種：root 底下沒有設定檔（確認 config 位置或 platform 宣告）／有檔但缺欄位（補欄位） |
| `undeclared` | `consumers-meta.json` 根本沒有這台的 entry | **漏登記，不是不部署**——補宣告 |
| `unmeasurable` | node runtime 版本結構上量不到（self-host 沒有 runtime probe；宣告與檔案不一致也歸此） | self-hosted Supabase 主機改看下面的 `hosts` 段：consumer 在 `.claude/consumer-meta.json` 補 `deploy.hosts[]`（`rules/core/consumer-meta.md` § 遠端主機）。補宣告不是升版，NEVER 影響 exit code |

第七類 `hosts`（`--probe-hosts` 才有；`deploy.hosts[]` 每台 `{ role, ssh, stack, composeDir }`，唯讀 `ssh <alias> cat <composeDir>/docker-compose.yml` 比官方 self-hosted compose 的 image tag）：

| 狀態 | 意思 | 動作 |
| --- | --- | --- |
| `aligned` | image tag 與官方 compose 一致 | 無 |
| `drift` | 有 image 與官方不同／缺／多 | relay 給該 consumer 的 session 升版，**NEVER** 從 clade ssh 進去改 |
| `unreachable` | ssh 連不上（exit 255／逾時） | 修 ssh alias 或網路。**NEVER** 讀成 aligned |
| `unreadable` | 連得上但讀不到 compose（缺 `composeDir`、檔不存在、stack 無 probe） | 補 `composeDir` 或確認路徑。**NEVER** 讀成 aligned |
| `no-baseline` | 官方 compose 取不到（`gh api` 失敗） | 修 gh 認證或帶 `--official-compose <path>`。**NEVER** 讀成 aligned |
| （未探測） | 有宣告但沒帶 `--probe-hosts` | 要量就在有授權的 session 帶旗標；未探測 **NEVER** 讀成 aligned |

- `drift` 以外的五類（與 `hosts` 的 `unreachable`／`unreadable`／`no-baseline`／未探測）**NEVER** 讀成 aligned、**NEVER** 進 drift 分母
- 「量得到」表的 `宣告 platform` 欄是 `none` 的列（如 starter template 帶 `wrangler.jsonc`）沒有遠端，**NEVER** 當成遠端 drift relay
- 宣告與檔案不一致（宣告 `self-host` 卻有 `wrangler.jsonc`）報 `unmeasurable`，**NEVER** 拿檔案值當遠端版本
- 有 `drift` 就 **relay 給該 consumer 的 session**（`clade-role-and-todo-discipline.md` § Consumer 工作命中時 MUST relay），**NEVER** 只登記 HANDOFF

---

## Step M.7 — C′ 軸：self-hosted runner 上的預裝 binary（TD-724）

workflow 在 self-hosted runner 上裸呼叫機器預裝的 CLI（沒有 setup step、沒有 lockfile）時，A／B／C 三軸都掃不到它。
CI 紅燈的表面症狀讀起來像 migration 或程式寫壞（某 consumer 2026-08-28：supabase CLI 落後 44 個 minor，
報 `cannot insert multiple commands into a prepared statement`），**MUST** 先跑：

```bash
node ~/offline/clade/scripts/audit-runner-toolchain-drift.ts                    # 靜態：誰在哪台 runner 裸呼叫什麼
node ~/offline/clade/scripts/audit-runner-toolchain-drift.ts --probe --upstream # 串行 ssh <bin> --version（registry 的 probeArgs 可覆寫）＋ 比上游 latest（node 取釘的 major 的 LTS）
```

宣告面是 `registry/runner-toolchain.json`（runner 的 owner／labels／sshTarget，binary 的 upstream／setupUses）。
`--probe` 對 prod 主機是跨機器 side effect：只在有授權的 session 跑，且腳本本身串行、一條 `--version`。

| 狀態 | 動作 |
| --- | --- |
| `behind` | relay 給該 consumer 的 session 升級，或改用 setup action 釘版本；**NEVER** 在 clade 主線 ssh 上去升 |
| `probe-failed`（`failure=connect`） | 修 ssh 連線或 sshTarget |
| `probe-failed`（`failure=command`） | ssh 通了但遠端指令失敗：該 binary 不在 runner 上，或探測指令不對（改 registry 的 `probeArgs`，如 go 用 `version`） |
| `probe-failed`（`failure=parse`） | 指令成功但輸出讀不出版本：看 `reason` 的輸出，補 `probeArgs` 或 `parseVersion` |
| `undeclared-runner` | 在 `runners[]` 補這組標籤所在的 runner |
| `unmeasurable` | 補 `sshTarget`，或帶 `--probe` |
| `upstream-unknown` | 補 `upstream`，或帶 `--upstream` |
| `repo-pinned` | 已回到 repo 宣告（setup action），歸 Outdated batch 掃 |

- `unmeasurable`／`probe-failed`／`upstream-unknown` **NEVER** 讀成 current
