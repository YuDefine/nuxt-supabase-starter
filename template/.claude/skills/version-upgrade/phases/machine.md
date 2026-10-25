# Phase M — 本機 machine-installed 版本（B 軸，`<理由>.machine`）

管的是**裝在這台機器上、沒有 git 載體**的版本：mise 管的工具、`~/.local/bin` 的手裝
binary、全域 npm 套件（含 agent runtime 自己）、MCP server。

`rules/A軸共用紀律判準.md` 的 Worktree gate、Pi 模板、selective stage、三層 verify 都不適用（沒有 git 載體）。本 Phase 自己的三條：

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

含 agent runtime 本身（`@anthropic-ai/claude-code`、`@earendil-works/pi-coding-agent`）與 `vite-plus`、`agent-browser`、`ntn`、`@sentry/cli`——它們不在任何 repo 的 `package.json`，不掃就沒有訊號。

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

### M.1.5 對 fleet 共同目標（MUST，NEVER 只比上游 latest）

M.1.1–M.1.4 比的是「本機 vs 上游」。fleet 有共同目標的工具（`~/offline/clade/registry/toolchain.json` 裡 policy ≠ measure-only 的）還要比「本機 vs SoT」——本機產生 committed 產物（types、lockfile）的版本與 CI／部署不同，產物就會漂：

```bash
node ~/offline/clade/scripts/audit-ci-toolchain-parity.ts --matrix --consumer clade   # 每個工具段落的「dev（本機）」列
```

本機高於 SoT 的 exact 工具（例：本機 supabase 比 fleet pin 新）**NEVER** 讀成「已最新所以沒事」：要嘛降回 SoT，要嘛走 Phase P Step P.5 把 SoT 往上調。

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
| agent runtime（claude-code / pi） | 起一次最小 session 並看到它回應 |

只憑 `--version` 或「安裝指令沒報錯」不能宣告完成。

---

## Step M.5 — 落檔

- 升了且驗過：不必登記
- 升到一半失敗 / 被 rollback：**MUST** 登記，寫明卡在哪、停在哪個版本，**NEVER** 只在對話裡講
- 查不出上游：**MUST** 登記，**NEVER** 猜一個 repo 填進 M.1.3

登記落點：有 `specs/truth/work-lifecycle.md` 的 repo 寫進承載本次升版的 plan Open work（**NEVER** 新 TD）；未遷移 consumer 才登 `docs/tech-debt.md` TD。
