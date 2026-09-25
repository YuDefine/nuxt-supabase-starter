---
description: shell script 的身分與清理生命週期——自己呼叫 sudo 且使用 user-level toolchain 的腳本、trap 引用函式區域變數、清理或回滾靜默未執行
paths: ['**/*.sh', 'ops/**', 'deploy/**', 'scripts/**']
---
<!-- Clade native rule; source: rules/core/shell-script-safety.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Shell script safety

三條紀律，成因不同但同一個外顯症狀：**腳本失敗了，而它印出來的最後一行（或完全沒有輸出）與真因無關**。
§ 1、§ 2 出自 pitfall `2026-08-27-sudo-wrapping-self-elevating-script-breaks-user-toolchain`，§ 3 見節末 pitfall。

## 1. 自己會 `sudo` 的腳本 MUST 有 EUID guard

一支腳本**只在需要 root 的那幾步自己呼叫 `sudo`**、其餘以呼叫者身分跑，同時又引用
user-level toolchain（`mise exec` / `mise run` / `asdf` / `nvm use` / `$HOME/.local/bin`）——
這種腳本的執行前提是「以一般使用者身分跑」。外面再包一層 `sudo` 時，toolchain 會以 root
身分讀使用者的 per-user 設定而失敗。

**MUST** 在 `set -euo pipefail` 之後、第一個實際動作之前加：

```bash
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  echo "以一般使用者身分執行；需要 root 的步驟腳本會自己呼叫 sudo。" >&2
  exit 2
fi
```

`exit 2` 不是 1：與「腳本正常執行但失敗」區分開，讓呼叫端看得出是**用法**錯誤。

**NEVER** 用「我這支不會有人加 `sudo` 跑」略過——**人看到 systemd 就會加 `sudo`**。

真的設計成以 root 執行的腳本（自己不呼叫 `sudo`）本來就不命中；命中卻確實要 root 的，
檔內加 `sudo-euid-guard-exempt: <理由>`——**理由必填**，裸 marker 不生效。

### 自驗

```bash
node scripts/shell-safety-check.ts <你剛寫的檔>     # 命中 exit 1，乾淨 exit 0
```

**MUST 雙向實測，NEVER 只驗一邊**：`sudo` 前綴時 exit 2 並印出正確用法 ＋ 一般身分時照常執行。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 三條件全中（內部 `sudo` × user-level toolchain × 缺 guard）。**warn-only，不 block** |
| 消費端 | 執行上方自驗的 agent；Claude hook `capabilities/core/hooks/post-edit-shell-safety.sh`（PostToolUse `Edit|Write`）；clade 的 `scripts/audit-sudo-euid-guard.ts` fleet 掃描。三者共用 `vendor/scripts/shell-safety-check.ts`（consumer 投影為 `scripts/shell-safety-check.ts`）。Codex／Cursor 的事件接線須另有實測證據 |
| 載入路徑 | 本檔 frontmatter 的 paths，由各 runtime adapter 交付 |

## 2. `trap` body 引用的變數 MUST 在 trap 執行當下真的拿得到值

**bash 在跑 EXIT trap 之前已經收掉函式的 local scope。** 所以「賦值寫在 `trap` 之前」
完全不代表安全——這是最容易誤判的一點：

```bash
# 實測（bash 5.3.9）
f() { local release; release="$(mktemp -d)"; trap 'echo "<${release:-UNSET}>"' EXIT; false; }
f      # → <UNSET>
```

這會往**兩個方向**壞，而兩個方向的修法不同：

| 寫法 | `set -u` 下發生什麼 | 為什麼難察覺 |
| --- | --- | --- |
| `trap 'rm -rf "$release"' EXIT` | trap 自己噴 `unbound variable` | 那行是**最後一行輸出**，讀的人會拿它當真因，而真因在更早 |
| `trap 'rm -rf "${release:-}"' EXIT` | `rm -rf ""` = no-op，**靜默不清理** | 完全沒有輸出。回滾類的更糟：`rollback_release ""` 會走進「沒有可退回的前一份」分支並以成功收場 |

**MUST**：trap body 要引用的變數**不宣告 `local`**，改用檔案級全域——全域在 EXIT trap
拿得到值，清理與回滾才會真的執行。

**NEVER 靠 `${var:-}` 當修法**——它把看得見的錯誤換成看不見的 no-op。冒號展開可留著當保險，但 NEVER 讓它成為「拿不到值也沒關係」的理由。

### 自驗

沒有文字掃描能判這一條（實測真陽性 0）。攔截層是該腳本自己的回歸測試，**MUST 釘命題不釘實作形狀**：

- ✅ 釘「`release` / `previous` 不得出現在 `local` 宣告行」，或實跑最小 fixture 驗
  stderr 無 `unbound variable` **且** 清理目標確實被刪
- ❌ 釘「trap body 必須用 `${var:-}`」——那會把上表第二列（靜默 no-op）鎖成唯一合法寫法，
  正確修法反而被自己的測試擋掉

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | **informational — 不觸發任何東西**。刻意沒有 detector，理由見上方自驗段 |
| 消費端 | 編輯適用腳本的 agent ＋ 該腳本自己的回歸測試 |
| 載入路徑 | 本檔 frontmatter 的 paths，由各 runtime adapter 交付；本節沒有文字掃描 detector |

## 3. `pkill -f` / `pgrep -f` 的 pattern MUST 不會命中發出它的那個 shell

`pkill -f` 比對完整 command line，而發出指令的 shell 的 cmdline 就含 pattern 字串，於是殺掉自己。`pgrep -f | head -1` 同理。

```bash
pkill -f "nuxt dev"; sleep 3; pnpm test:bdd > bdd.log 2>&1   # exit 144，bdd.log 連建都沒建
```

症狀是 exit 143 / 144 ＋ 零輸出（像 timeout），或 exit 144 ＋ 目標行程照跑。**NEVER 因為 `pkill` 回非 0 就認為它至少部分生效。** 看到 exit 143 / 144 且沒有輸出，先查這條指令有沒有 `pkill -f` / `pgrep -f`，再考慮 harness 問題。

**MUST 依身分定位，NEVER 依字串比對**——三選一：

```bash
P=$(ss -lptn 'sport = :3090' | grep -oP 'pid=\K[0-9]+' | head -1); [ -n "$P" ] && kill "$P"
[ -f .nuxt/dev.pid ] && kill "$(cat .nuxt/dev.pid)"
pgrep -f "nuxt dev" | grep -vx "$$" | grep -vx "$PPID" | xargs -r kill   # 真的要 pattern 才用
```

危險的是行內組合指令與 agent 一次性指令（腳本檔內通常安全），因此「先停某個 process、再做別的事」**MUST 收斂成腳本檔**（`scripts/dev-stop.sh`）。

「等某行程結束」的場景（`until ! pgrep -f …`）用 `[v]itest` 字元類，見 `vendor/snippets/wait-loop/`；「殺」的場景字元類不夠，要依 port / pidfile 定位。

**沒有 port 也沒有 pidfile 時，結構識別是 `/proc/<pid>/cwd`**：

```bash
for p in $(pgrep -f '<pattern>'); do
  echo "pid=$p cwd=$(readlink /proc/$p/cwd)"      # 先看，不動
done
kill -TERM <逐一確認過的 pid>                       # 確認 cwd 屬於自己這棵樹才殺
```

要指認一個行程，用結構識別，NEVER 用它的表面形狀。

### 3.1 同根因的第二條路徑：`kill -- -$pgid` 帶走呼叫端

`kill -TERM -- "-$pgid"` 殺整個 process group 時，**呼叫端多半就在那個 group 裡**。危險的是 `set +m`，也就是非互動腳本的預設：

| 條件 | 背景 child 的 pgid | `kill -- -<child 的 pgid>` |
| --- | --- | --- |
| `set +m`（**腳本預設**） | **等於呼叫端的** | 呼叫端收到 SIGTERM，後續一行都沒跑 |
| `set -m`（job control 開） | 自己獨立一個 | 只打到那個 job，呼叫端存活 |

**NEVER 把它記成「`set -m` 才危險」**（方向相反），**也 NEVER 靠 `set -m` 當防護**。

正解是遞迴逐層取子行程，與 job control 狀態無關：

```bash
kill_tree() { for c in $(pgrep -P "$1"); do kill_tree "$c"; done; kill -TERM "$1" 2>/dev/null; }
```

實作見 `vendor/scripts/scan-scope-watchdog.sh`。**NEVER** 用 process group 當「這棵樹」的識別。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | **informational — 不觸發任何東西**。`rg -n 'p(kill\|grep) -f'` 與 `rg -n 'kill .*-- *"?-\$'` 只能列出候選，兩條判準（pattern 會不會出現在呼叫端自己的 cmdline／呼叫端在不在那個 process group 裡）都沒有文字形狀 |
| 消費端 | 下複合 shell 指令的 agent；撰寫 dev/test 腳本的人 |
| 載入路徑 | 本檔 frontmatter 的 paths；agent 直接下的一次性指令由本節正文承接，不經 paths |

> Pitfall：`docs/pitfalls/2026-09-07-pkill-f-pattern-kills-issuing-shell.md`

> Cookbook 範本：`~/offline/clade/vendor/snippets/shell-script-safety/`。
