# § Machine mode — machine-installed 版本（B 軸）

管的是**裝在這台機器上、沒有 git 載體**的版本：mise 管的工具、`~/.local/bin` 的手裝
binary、全域 npm 套件（含 agent runtime 自己）、MCP server。

## 這個 mode 與另外三個不同型，主檔的紀律不共用

| 軸 | 版本宣告在哪 | git 載體 | 可 revert | 誰管 |
| --- | --- | --- | --- | --- |
| **A. Repo-declared** | `package.json` / lockfile / workflow yaml / `.nvmrc` / `engines` | ✅ commit | ✅ | Outdated / Fleet / Skills mode |
| **B. Machine-installed** | mise config / `~/.local/bin` / 全域 npm / `.mcp.json` | ❌ 無 | 靠重裝舊版 | **本 mode** |
| **C. Remote-deployed** | LXC / VM 上實際跑的版本 | ❌ 無 | ❌ 動到線上 | `scripts/audit-remote-env-version-drift.ts`，**不在本 skill** |

主檔 § Worktree gate、§ Pi prompt templates、Outdated mode 的 selective stage 與三層 verify
**全部是 A 軸的建構**，對 B 軸零適用。**NEVER 因為它們寫在主檔就套過來**——B 軸沒有 commit
可以驗 scope、沒有 lockfile 可以 revert、沒有 CI 可以驗綠。逐字反開脫：「保險起見還是開個
worktree」——worktree 對一個不產生任何檔案改動的操作沒有隔離作用，只是讓你以為有。

B 軸自己的三條，取代上述：

1. **一次一個工具，序列執行**。A 軸可以並行 fan-out（每個 consumer 各自的 worktree 互不相干），
   B 軸共用同一個 `PATH`、同一個 `~/.local/bin`、同一份 mise config——兩個並行升級會互相覆蓋，
   而且沒有 lockfile 記錄誰贏了
2. **升之前先記下現版號**，那是唯一的 rollback 座標（沒有 `git revert`）
3. **驗證 MUST 是一次真實呼叫**，`--version` 不算（見 § Step M.4）

---

## Step M.1 — 盤點（三個來源，缺一就得到「已對齊」的假訊號）

### M.1.1 mise-managed

```bash
mise outdated
```

**它只看得見浮動 pin 的工具。** exact-pinned 的（`config.toml` 寫死版號）requested == installed，
於是**永遠不會出現在 outdated 裡**，不論上游走多遠。

> 2026-09-10 實測：`mise outdated` 列出 6 支（bun / node / starship / zoxide / eza / fzf，全部
> pin `latest` 或 major）。同一時刻 exact-pinned 的 **gh 落後 7 個 minor**（2.93.0 → 2.100.0）、
> uv 落後 1 個 minor（0.11.26 → 0.12.12）、supabase 落後 1 個 minor
> （2.116.0 → 2.117.0）、go 落後 1 個 minor（1.26.4 → 1.27.1）——**一支都不在 outdated 輸出裡**。

**NEVER 拿 `mise outdated` 的空輸出（或短輸出）推論「都最新」。** 那正是本 mode 存在的理由：
四支落後最遠的工具，恰好是那個指令看不見的四支。exact-pinned 的要逐支問：

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

這一格裝的是 **agent runtime 本身**（`@anthropic-ai/claude-code`、`@openai/codex`、
`@earendil-works/pi-coding-agent`、`@google/gemini-cli`）與 clade 依賴的 CLI
（`vite-plus` 即 `vp`、`agent-browser`、`ntn`、`@sentry/cli`）。**這些是 fleet 每天在用的東西，
而它們一支都不在任何 repo 的 `package.json` 裡**——不掃這一格就完全沒有訊號。

> 2026-09-10 實測：10 支全域套件裡 **8 支落後**，包含 `agent-browser` 0.32.3 → 0.37.1（5 個
> minor）、`ntn` 0.19.2 → 0.23.3（4 個 minor）、`npm` 自己 11.13.0 → 12.0.2（跨大版）。
> 與 M.1.1 不同的是 `npm outdated -g` **看得見全部**（它沒有 exact-pin 的概念），所以這一格
> 的失敗模式不是假訊號，是**根本沒人跑過**。

### M.1.3 手裝 binary（`~/.local/bin`）

沒有 registry，只能逐支列。現行清單與上游：

| binary | 現版查法 | 上游 | 升級路徑 |
| --- | --- | --- | --- |
| `rtk` | `rtk --version` | `github.com/rtk-ai/rtk`（binary 內字串證實） | **無 self-update 子指令**，走上游 release |
| `codebase-memory-mcp` | `codebase-memory-mcp --version` | — | **有 self-update**：`codebase-memory-mcp update` |

**要加一支進這張表，MUST 先查證它的上游**（`strings <binary> | grep github.com`、`--help` footer、
config 檔的 Docs 行）。**NEVER 憑套件名猜 GitHub org**——猜錯會把升級指向別人的 repo。

### M.1.4 MCP server

```bash
cat .mcp.json
```

**`.mcp.json` 只寫 `command`，不帶版本**——`codebase-memory-mcp` 那筆逐字只有
`{"type":"stdio","command":"codebase-memory-mcp"}`。所以「現在跑的是哪版」**問不出來**，
要去問那支 binary 自己（M.1.3）。**NEVER 從 `.mcp.json` 推論版本狀態**，它對此零訊號。

---

## Step M.2 — Node 升級是特例，MUST 先過這道 gate

**mise 升 node 會建一個新的 install 目錄，全域 npm 套件不會跟過去。**

> 2026-09-10 實測：`~/.local/share/mise/installs/node/` 底下只有 `24.16.0` 一個實體目錄，
> `24` / `24.16` / `latest` / `lts` / `lts-krypton` 全是指向它的 symlink。10 支全域套件
> （`@anthropic-ai/claude-code` 2.1.267、`@openai/codex` 0.153.4、
> `@earendil-works/pi-coding-agent` 0.84.4、`@google/gemini-cli` 0.56.0、`@sentry/cli`、
> `agent-browser`、`ntn`、`vite-plus`、`corepack`、`npm`）全部掛在
> `24.16.0/lib/node_modules` 底下。

所以升 node **同時砍掉整套 agent runtime——包含你自己正在跑的那一支**。這不是「可能有副作用」，
是必然結果：新版本目錄是空的。

升 node 之前 **MUST** 依序做完這三件：

1. **把現有全域清單釘下來**——這是唯一的還原座標：

   ```bash
   BEFORE=$(mktemp -t global-npm-before.XXXXXX)
   npm ls -g --depth=0 > "$BEFORE"; echo "$BEFORE"; cat "$BEFORE"
   ```

   **MUST 用 `mktemp`，NEVER 寫死 `/tmp/global-npm-before.txt`**：固定檔名是全機器所有
   session 共用同一個檔，被覆寫時輸出看起來完全正常
   （`scripts/audit-fixed-temp-paths.ts` 會攔這種寫法）。

2. **回報給 user 並等確認**——這一步 **NEVER** 自主執行。理由不是保守：升級當下 agent 自己的
   runtime 會消失，**沒有任何 session 活著把它裝回來**，所以「做到一半失敗」在這裡等於機器上
   沒有可用的 agent。這是本 skill 唯一一個 **MUST 由 user 在場執行**的動作。

3. **升完逐支重裝**，並拿第 1 步那份清單逐行對帳。

**NEVER 把 node 升級混進任何批次。** 它 MUST 是單獨一次、前後都有對帳的操作。

---

## Step M.3 — 升級（一次一個，序列）

| 來源 | 指令 |
| --- | --- |
| mise 浮動 pin | `mise upgrade <tool>` |
| mise exact-pinned | 改 `~/.config/mise/config.toml` 的版號 → `mise install <tool>` → `mise use <tool>@<ver>` |
| 全域 npm | `npm i -g <pkg>@<ver>` |
| `codebase-memory-mcp` | `codebase-memory-mcp update` |
| `rtk` | 從 `github.com/rtk-ai/rtk` release 取對應 asset 覆蓋 `~/.local/bin/rtk` |

**`~/.config/mise/config.toml` 不在任何 git repo 裡**（實測 `git rev-parse` 回
`not a git repository`）。所以改它**沒有 diff、沒有歷史、沒有 revert**——改之前先備份，
且備份路徑 **MUST 帶隨機段**（同上，`audit-fixed-temp-paths.ts` 判準）：

```bash
cp ~/.config/mise/config.toml "$(mktemp -t mise-config-before.XXXXXX)"
```

**NEVER** 依賴記憶還原它。

---

## Step M.4 — 驗證：`--version` 不算驗證

`<tool> --version` 回新版號，只證明**檔案被換掉了**。它對「這支工具還能不能用」零訊號——
一個相依 glibc 版本不符、或抓錯 arch 的 binary，`--version` 一樣印得出來。

**MUST 跑一次真實呼叫**，逐工具：

| 工具 | 真實呼叫 |
| --- | --- |
| `vp` | `cd ~/offline/clade && vp check`（要看到它真的跑完，不是印 usage） |
| `supabase` | `supabase --version && supabase projects list`（或任一需要 CLI 邏輯的子指令） |
| `rtk` | `rtk git status`（proxy 到真的 git，看得到輸出） |
| `codebase-memory-mcp` | `codebase-memory-mcp cli list_projects`（走一次真的 tool 呼叫）。**NEVER 用 `index_status`**——它 MUST 帶 `project` 參數，不帶會回 `missing required argument`，那個錯誤與「升壞了」同形 |
| `gh` | `gh auth status` |
| `node` | `node -e 'console.log(1+1)'` ＋ **M.1.2 全域清單對帳** |
| agent runtime（claude-code / codex / pi） | 起一次最小 session 並看到它回應 |

**NEVER 只憑 `--version` 或「安裝指令沒報錯」宣告完成**——per CLAUDE.md § 除錯與驗證，
任何完成宣告前 MUST 有實際驗證。

---

## Step M.5 — 落檔

B 軸沒有 commit，所以**升級這件事本身不留任何痕跡**。要留就 MUST 顯式寫：

- 升了**且驗過**：不必登記（跑一次 M.1 就重新量得到現況）
- 升到一半失敗 / 被 rollback：**MUST** 登進 `docs/tech-debt.md` 一條 TD，寫明卡在哪、
  現在停在哪個版本。**NEVER** 只在對話裡講——B 軸沒有 git 載體，對話關掉就什麼都不剩
- 發現某支工具的上游查不出來：**MUST** 登 TD，**NEVER** 猜一個 repo 填進 M.1.3 的表

---

## Step M.6 — C 軸不歸本 mode，但問到時 MUST 指向訊號

使用者問「遠端 dev / staging / prod 上跑的是哪個版本」時，**NEVER** 在本 mode 裡動手，也
**NEVER** 只回一句「那是 consumer 自治區」就停手——那句話不是動作。跑訊號：

```bash
node ~/offline/clade/scripts/audit-remote-env-version-drift.ts
```

它分**六類**輸出，**MUST 分開讀**——每一類對應的動作都不同，混讀會做錯事：

| 類別 | 意思 | 動作 |
| --- | --- | --- |
| `drift` | 量得到且落後（目前唯一量得到的是 Cloudflare Workers 的 `compatibility_date`） | relay 給該 consumer |
| `invalid` | 讀到一個值但它不是有效日期 | 修那個值。**不列入「量得到」的分母** |
| `ambiguous` | 同一個檔給出多個相異日期（top-level ＋ 多個 `[env.*]` 覆寫） | 先確定哪一個才是 production。**本 audit NEVER 替你挑一個**——挑錯的輸出與挑對的同形 |
| `data-missing` | platform 有 probe 但這台沒有可讀的值 | 再分兩種：root 底下沒有設定檔（確認 config 位置或 platform 宣告）／有檔但缺欄位（補欄位） |
| `undeclared` | `consumers-meta.json` 根本沒有這台的 entry | **漏登記，不是不部署**——補宣告 |
| `unmeasurable` | 結構上量不到（self-host 的 `deploy` 區塊沒有主機識別欄位） | 補 schema 欄位，見 [[TD-1062]] |

**除了 `drift` 之外的五類全部 NEVER 讀成 aligned、NEVER 進 drift 的分母**，否則這支 audit 會恆綠而 C 軸依然零覆蓋。

**「量得到」那張表帶 `宣告 platform` 欄**：starter 的 template 宣告 `platform: none`
（consumer-meta 的 `$comment` 逐字是 "Template project — no auth, no DB, no deploy."）卻有
`wrangler.jsonc`。它值得出訊號——每台新 consumer 都從那份設定長出來——但**它沒有遠端**，
那一列不是「遠端在跑的版本」。宣告欄就是用來看這個落差的，**NEVER** 把該欄是 `none` 的列
當成遠端 drift 去 relay。

**宣告與檔案不一致時以「量不到」處置**：一台宣告 `self-host` 的 consumer 若目錄裡躺著
沒在部署的 `wrangler.jsonc`，audit 報 `unmeasurable` 並附「另偵測到 … 宣告與檔案不一致」——
**NEVER** 拿那個檔案的值當這台的遠端版本。

有 `drift` 就 **relay 給該 consumer 的 session**（per
`.claude/rules/local/clade-role-and-todo-discipline.md` § Consumer 工作命中時 MUST relay），
**NEVER** 登記進 clade 的 HANDOFF 就當作處置完畢。

---

# 禁止事項（Machine mode 限定）

- **NEVER** 拿 `mise outdated` 的輸出當完整盤點——exact-pinned 的工具結構上不會出現在裡面
- **NEVER** 並行升多支工具——共用 `PATH` / `~/.local/bin` / 單一 mise config，沒有 lockfile 記錄誰贏
- **NEVER** 自主升 node——它會砍掉包含自己在內的整套 agent runtime，MUST 由 user 在場執行
- **NEVER** 把 node 升級混進批次
- **NEVER** 用 `--version` 當驗證，MUST 有一次真實呼叫
- **NEVER** 改 `~/.config/mise/config.toml` 之前不備份——它不在任何 repo 裡，沒有 revert
- **NEVER** 憑套件名猜 binary 的 GitHub 上游
- **NEVER** 對 C 軸（遠端 dev / staging / prod 環境）動手。訊號由
  `scripts/audit-remote-env-version-drift.ts` 出，落地 relay 給該 consumer 的 session，
  per `.claude/rules/local/clade-role-and-todo-discipline.md` § Consumer 工作命中時 MUST relay。
  逐字反開脫：「ssh 過去 `apt upgrade` 很快」——快不快不是判準，那是 production 動作且不可 revert
