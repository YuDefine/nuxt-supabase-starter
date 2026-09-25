---
description: 新增或修改 mechanical checker、CI gate、contract checker、allowlist 時套用；防止 scope 不透明、依賴缺失誤判綠燈與 canonical check 漂移
paths: ['scripts/**/*', 'vendor/scripts/**/*', '.github/workflows/**/*', 'package.json', 'pnpm-workspace.yaml']
---
<!-- Clade native rule; source: rules/core/checker-contract.md; edit canonical source -->

# Checker Contract

<!-- clade-targets: claude,codex,cursor -->

Mechanical checker 的綠燈是一項可重現的 contract claim：它只證明輸出明寫的 scope 已被完整執行，不能把「沒有執行」包裝成「沒有違規」。本規約對**每一支** mechanical checker、**每一個**安全／contract gate、**每一條** CI check entry 與**每一份**既有債務 allowlist 生效。

## REQUIRED output contract

**每一支** mechanical checker 在 pass、finding、N/A 與 infrastructure error 四種結果下，都要輸出以下欄位；JSON 模式使用同名 keys，文字模式使用同順序 labels：

```text
<checker>: <pass|finding|N/A|infrastructure-error>
scope: roots=<實際掃描目錄>; patterns=<實際納入 pattern>; mode=<tracked|staged|filesystem>
skipped: <排除目錄/pattern/原因；沒有就寫 none>
completeness: <complete|partial|unknown>
```

`scope` 要是本次 invocation 的實際值，不得只在 `--help` 或 source comment 宣告。沒有 applicable target 時可回 N/A；目錄、symlink、env 或執行依賴缺失時不得回 N/A，必須走 infrastructure error。

### completeness 與結果是正交的兩軸

`pass|finding` 回答「掃到的合不合格」，`completeness` 回答「scope 掃完了沒」。兩軸分開輸出；`pass` + `partial` 是合法組合，不要塌縮成單一綠燈。

| 值 | 何時用 |
| --- | --- |
| `complete` | 宣告的 scope 全數執行完 |
| `partial` | scope 內有單元被跳過（逾時、單檔 parse 失敗、明確 deferred）。同時要在 `skipped:` 列出被跳過的單元 |
| `unknown` | checker 無法確定自己掃完沒（glob 展開被上游截斷、列舉命令回傳值不可信） |

### Exit code 契約

**每一支** checker 的 exit code 要讓消費端分得出「跑完了有問題」與「沒跑成」：

| 結果 | exit code |
| --- | --- |
| `pass` / `N/A` | 0 |
| `finding` | 1 |
| `infrastructure-error` | 2 |

消費端（CI job、pre-commit hook、gate-runner）收到 2 時不得當成「檢查過了沒問題」，也不要當成一般違規去 retry——它代表這個 gate 這次根本沒有執行。

**鎖的是語義軸，不是數字**（例：`pi-dispatch.ts` 用 2 業務 fail／3 mechanical failure／4 quota gate 也合法）。不要為了對齊數字去改既有 dispatcher 或 checker。

## Fail-closed Iron Law

```text
安全類／contract 類 gate 的依賴缺失 = INFRASTRUCTURE ERROR，不等於綠燈。
```

**每一個**安全類／contract 類 gate 都要 fail-closed。以下任一條件成立時，checker 要輸出 `infrastructure-error`、列出缺失依賴，並回傳 non-zero：

- 必要 vendor file 或 symlink 不存在、dangling、不可讀
- contract 所需 env var 不存在或格式無法驗證
- scanner／parser／runtime dependency 無法載入
- 預期掃描 root 應存在，但 filesystem 或 Git 無法列舉

「本次 scope 內確實沒有 applicable target」與「checker 沒有能力執行」是不同狀態。前者可 N/A，後者一律 infrastructure error；不要 catch 後回空陣列、印 skip 再 exit 0。

`completeness` 非 `complete` 時同理：不要讓消費端只讀 exit code（`pass` + `partial` 也是 0）就下「通過」結論。

### Pipeline 回傳值當判斷依據時，下游提前退出命令一律 herestring

**每一個**把 pipeline 回傳值交給條件式的地方（`if cmd | grep -q …`、`cmd | grep -q … && …`），若下游是提前退出命令（`grep -q` / `head` / `sed q` / `awk … exit`）且腳本有 `set -o pipefail`，要改 herestring，或讓下游直接讀檔：

- ✅ `grep -q PAT <<< "$content"` ／ `grep -q PAT "$file"`
- ❌ `echo "$content" | grep -q PAT`

下游命中即退出，上游收 SIGPIPE(141)，`pipefail` 讓 pipeline 回非零 → 命中被判成沒命中（fail-open）。只在上游輸出超過 pipe buffer（~64KB）時發生，小樣本測試永遠正常。

存量掃 `node ~/offline/clade/scripts/audit-gate-coverage.ts` § 4。實證見 `~/offline/clade/docs/pitfalls/2026-07-25-grep-q-pipefail-sigpipe-false-negative.md`。

### 上游具副作用時，提前退出命令會把它腰斬

上游若是會寫檔、刪檔、改遠端狀態的流程，下游提前退出會把它殺在中途（「舊的刪了、新的還沒建」）。不需要 `pipefail`、exit code 是 0、沒有錯誤訊息。

```bash
# ❌ 上游是會刪檔再重建的同步流程，head 讀滿 5 行就退出 → 上游被 SIGPIPE 殺在「刪完、還沒建」
node scripts/sync-something.ts | head -5

# ✅ 先落檔再讀，是「想看輸出」與「不截斷上游」唯一相容的寫法
#    落檔路徑用 mktemp 產唯一名（固定路徑是全機器共用，會讀到別 session 的輸出）
OUT="$(mktemp -t sync-out.XXXXXXXXXX)"
node scripts/sync-something.ts > "$OUT" 2>&1; echo "EXIT=$?"
head -20 "$OUT"
```

兩條紀律：

- **想限制輸出量時先重導向到檔案再讀**，不要對可能具副作用的命令直接 `| head` / `| sed q` / `| grep -m1`
- **寫先刪後建的流程時，把刪除延後到重建材料備妥之後**（或先寫 staging 再 atomic rename），讓中斷點不落在「舊的沒了、新的沒來」

實證見 `~/offline/clade/docs/pitfalls/2026-07-31-sigpipe-truncates-side-effecting-script.md`。

## 執行載體（檔案存在 ≠ 有東西會執行它）

Gate、checker、composite action 的檔案存在，不代表有東西會呼叫它。中間隔著**執行載體**（git hook 接線、CI `uses:`、`package.json` script、另一支 script 的 import）；載體缺席時 gate 靜默不存在。

**每一個**回報採用率／enforcement 狀態的 audit 都要驗到載體那一層，不要用
`existsSync(<檔>)` 直接當結論：

| 被檢查的東西 | 載體 predicate（一併驗） |
| --- | --- |
| pre-commit / pre-push check script | `git rev-parse --git-path hooks/<name>` 指到的檔存在**且**（走 husky 時）`.husky/<name>` 存在**且**內容真的呼叫該 runner |
| composite action（`.github/actions/<name>/`） | 有 workflow 檔含 `uses: ./.github/actions/<name>` |
| CLI script（`scripts/*.mjs`） | `package.json` script、hook、或 CI step 內有呼叫它的字串 |
| 被 gate 以 `[[ -f "$X" ]] \|\| exit 0` 守衛的依賴 | 該路徑在散播清單內（否則 gate 在**每一個** consumer 都靜默 exit 0） |
| config / preset 檔 | 有檔案 import 或讀取它 |

`core.hooksPath` 是**取代**不是疊加：設了之後 git 完全不看 `.git/hooks/`，留在那裡的 hook 是死檔。
判斷 hook 是否會執行要問 git（`git rev-parse --git-path`），不要直接 stat
`.git/hooks/<name>`。

把上表套到 clade 全部既有閘門後的實測清單（每個閘門的型態／載體／fail-open 條件／繞過方式）在
`~/offline/clade/docs/enforcement-matrix.md`。要依賴某個閘門兜底之前先在那份對照，不要憑
「我們有這支 script」推論它會執行。

## 判準綁事實，不綁命名或結構慣例

Checker 的每一條判準都綁在**可觀察的行為事實**上。命名慣例、目錄結構、檔名前綴只是樣本剛好符合，不是事實；失敗時不噴錯，只安靜給出合理的錯答案。

下筆前對**每一條**判準問一次：**「這條綁的是事實，還是我以為大家都會遵守的慣例？」** 答案是後者就換一條。想「乾脆要求所有 consumer 改成某個命名，這樣好判斷」時，方向是反的：工具遷就既有架構，不是架構遷就工具；真要求對齊，先確認那個對齊本身在架構上站得住（例如拆 workflow 會不會逼人把 `needs:` 改成 `workflow_run`）。

### 判準替換對照

| 想判斷的 | ❌ 綁慣例 | ✅ 綁事實 |
| --- | --- | --- |
| 這個 repo 有沒有部署流程 | workflow 檔名含 `deploy` | 讀 workflow 的 `name:` 與 job key |
| 這個 worktree 是不是在做這個 change | 路徑不是 main | tasks.md 的實際勾選數（fork-time snapshot 必然 ≤ 真實進度） |
| 這筆記錄是否已存在 | 標題字串比對 | 業務唯一鍵的組合 |
| 這個 phase 是不是 UI 層 | 標題含 `view` | 該格式自帶的顯式標記（`（非 view）` / `（view-only phase）`） |

## Canonical check entry

Consumer 的 canonical check entry 是 `package.json` 的 `scripts.check`。**每一條** CI workflow 都要執行 canonical entry（通常為 `pnpm check`）；workspace 內的子 package check 由 root canonical entry 統一 dispatch。

CI 不要手拆 lint、typecheck、audit、contract checker 清單來重刻 `scripts.check`。新增、移除或改名 checker 時只改 canonical entry；CI 保持呼叫同一入口，避免 package.json 與 workflow 形成雙重維護來源。

## Allowlist ratchet

既有債務一律用 allowlist ratchet 收斂；allowlist entry 至少包含 `ruleId`、`path` 與可比較的 finding fingerprint／count。每次執行都要同時判斷三個方向：

1. **新債**：finding 不在 allowlist，或 count 增加 → finding，擋下 gate。
2. **已修**：allowlist entry 已無對應 finding → stale allowlist finding，明寫要刪除的 entry。
3. **路徑腐爛**：allowlist path 不存在、已移動或不再落在 scope → path-rot finding，明寫舊 path 與目前 scope。

Ratchet 的目標是讓債務帳本自清並逐步歸零。不要為了讓 gate 通過而調鬆 regex、縮小 roots、增加 broad exclusion、把 error 改成 warning，或整份重寫 allowlist／baseline；合法 scope 變更必須先更新 checker contract，再更新 allowlist 並附實際 scan evidence。

### Baseline 重寫紀律

Baseline（`review-rules-baseline.json` 等）是債務紀錄，不是通關工具：重寫它會把當下所有違規吸收成既有債，gate 從此永遠沉默。

```text
BASELINE 只在債務已清償或帳本結構改變時重寫，不在 gate 擋下你的當下重寫。
```

**每一次**重寫 baseline 都要落在下列三種情境之一，並在 commit message 寫明是哪一種：

| 合法情境 | 可觀察 predicate | 重寫後應該看到 |
| --- | --- | --- |
| ① 存量清償 | 已修掉既有違規，重寫前 `--ratchet` 就是綠的 | entry 總數**減少** |
| ② 規則新增／pattern 收緊 | 同一次 commit 動了 `patterns.json` 的 rule 或 pattern | 只有該 `ruleId` 的 entry 增加 |
| ③ 檔案搬移／改名 | 違規總數不變，只有 path 改變 | 總 count 不變 |

**不要在 `--ratchet` 擋下 push 的當下重寫 baseline**——那個 exit code 2 指的就是這次 diff 新增的違規。正解是修掉違規，或在該行加規則自帶的豁免標記（如 `lazy-atomic-ok` / `heavy-lib-ok` / `data-no-srcset`）並在該行寫明理由。要延後就開 TD 條目，不要動 baseline——重寫之後 gate 對這幾筆永遠沉默，「等等再修」沒有任何觸發點。

#### 掃描範圍 MUST 與 gate 一致

Baseline 要用與 ratchet gate 同範圍的指令產生。`review-rules` 的 gate 固定跑 `--all --layer all --ratchet`，因此：

```bash
node vendor/review-rules/scan.mjs --all --layer all --write-baseline
```

較窄範圍寫出的 baseline 會漏記存量，gate 端判成新增而擋死 push。`scan.mjs` 對範圍不一致的 `--write-baseline` 已 fail-closed（exit 2），`_meta.fileset` / `_meta.layer` 記錄實際範圍。

## 違反回報格式

**每一筆** finding 與 infrastructure error 都要可直接定位與修復：

```text
- [<ruleId>] <path>:<line|N/A>
  found: <觀察到的值或缺失依賴>
  expected: <contract 要求>
  action: <最小修復或要刪除的 allowlist entry>
```

只印總數、只印 boolean、或只寫「check failed」都不符合回報 contract。跨檔 finding 的 `path` 填主要責任檔，其餘關聯檔放在 `found`。
