---
description: shell script 的兩條身分／生命週期紀律——(1) 自己會 sudo 的腳本 MUST 有 EUID guard，否則被 sudo 前綴時 user-level toolchain 以 root 讀設定而失敗、錯誤訊息指不到真因；(2) trap body 引用的變數 MUST 在 trap 執行當下真的拿得到值，否則清理與回滾靜默變 no-op。兩條都在「寫完一支 .sh」的當下由 PostToolUse hook 觸發
paths: ['**/*.sh', 'ops/**', 'deploy/**', 'scripts/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/shell-script-safety.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Shell script safety

兩條紀律，成因不同但同一個外顯症狀：**腳本失敗了，而它印出來的最後一行與真因無關**。
兩條都出自同一個 pitfall（`2026-08-27-sudo-wrapping-self-elevating-script-breaks-user-toolchain`）。

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

**NEVER** 用「我這支不會有人加 `sudo` 跑」略過——2026-08-27 實測的那一支正是這樣寫的，
而**人看到 systemd 就會加 `sudo`**。deploy / install 腳本尤其如此：它們裝 unit 檔、
跑 `systemctl enable`，讀的人合理推論整支要 root。

真的設計成以 root 執行的腳本（自己不呼叫 `sudo`）本來就不命中；命中卻確實要 root 的，
檔內加 `sudo-euid-guard-exempt: <理由>`——**理由必填**，裸 marker 不生效。

### 自驗

```bash
node scripts/shell-safety-check.ts <你剛寫的檔>     # 命中 exit 1，乾淨 exit 0
```

**MUST 雙向實測，NEVER 只驗一邊**：`sudo` 前綴時 exit 2 並印出正確用法 ＋ 一般身分時
照常執行。只驗「加了 guard → 不報」證明不了 guard 真的擋得住東西。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 三條件全中（內部 `sudo` × user-level toolchain × 缺 guard）。**warn-only，不 block** —— 命中的多半是既有腳本被順手改了一行，擋下編輯治不了它，只會逼人繞過 hook |
| 消費端 | `plugins/hub-core/hooks/post-edit-shell-safety.sh`（PostToolUse `Edit|Write`，命中 `*.sh` 時就地判該單檔）＋ clade 的 `scripts/audit-sudo-euid-guard.ts` fleet 掃描（`/clade-health enforcement`／`full`）。兩者 import **同一份** `scripts/shell-safety-check.ts` 判定 |
| 載入路徑 | 本檔（paths-gated `**/*.sh`——編輯任何 shell script 即載入） |

## 2. `trap` body 引用的變數 MUST 在 trap 執行當下真的拿得到值

**bash 在跑 EXIT trap 之前已經收掉函式的 local scope。** 所以「賦值寫在 `trap` 之前」
完全不代表安全——這是最容易誤判的一點：

```bash
# 2026-08-27 實測（bash 5.3.9）
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

**NEVER 靠 `${var:-}` 當修法。** 它只治掉「噴 unbound」這個症狀，代價是把清理換成
no-op——**用一個看得見的錯誤，換一個看不見的錯誤**。冒號展開可以留著當保險，但
NEVER 讓它成為「變數拿不到值也沒關係」的理由。

### 自驗

沒有文字掃描能判這一條（2026-08-27 實測 fleet 14 repo / 818 支 `.sh`：四條文字判準疊完
真陽性 **0**、誤報 56，接成 audit 等於把整條 signal 關掉）。**正確的攔截層是出事那支腳本
自己的回歸測試**，而測試 **MUST 釘命題不釘實作形狀**：

- ✅ 釘「`release` / `previous` 不得出現在 `local` 宣告行」，或實跑最小 fixture 驗
  stderr 無 `unbound variable` **且** 清理目標確實被刪
- ❌ 釘「trap body 必須用 `${var:-}`」——那會把上表第二列（靜默 no-op）鎖成唯一合法寫法，
  正確修法反而被自己的測試擋掉

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | **informational — 不觸發任何東西**。刻意沒有 detector，理由見上方自驗段 |
| 消費端 | 讀到本節的人（paths-gated 載入）＋ 該腳本自己的回歸測試 |
| 載入路徑 | 本檔（paths-gated `**/*.sh`） |

> Cookbook 範本：`~/offline/clade/vendor/snippets/shell-script-safety/`。
