---
description: 新增或修改 mechanical checker、CI gate、contract checker、allowlist 時套用；防止 scope 不透明、依賴缺失誤判綠燈與 canonical check 漂移
paths: ['scripts/**/*', 'vendor/scripts/**/*', '.github/workflows/**/*', 'package.json', 'pnpm-workspace.yaml']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/checker-contract.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Checker Contract

Mechanical checker 的綠燈是一項可重現的 contract claim：它只證明輸出明寫的 scope 已被完整執行，不能把「沒有執行」包裝成「沒有違規」。本規約對**每一支** mechanical checker、**每一個**安全／contract gate、**每一條** CI check entry 與**每一份**既有債務 allowlist 生效。

## REQUIRED output contract

**每一支** mechanical checker 在 pass、finding、N/A 與 infrastructure error 四種結果下，都 **MUST** 輸出以下欄位；JSON 模式使用同名 keys，文字模式使用同順序 labels：

```text
<checker>: <pass|finding|N/A|infrastructure-error>
scope: roots=<實際掃描目錄>; patterns=<實際納入 pattern>; mode=<tracked|staged|filesystem>
skipped: <排除目錄/pattern/原因；沒有就寫 none>
```

`scope` **MUST** 是本次 invocation 的實際值，不得只在 `--help` 或 source comment 宣告。沒有 applicable target 時可回 N/A；目錄、symlink、env 或執行依賴缺失時不得回 N/A，必須走 infrastructure error。

## Fail-closed Iron Law

**違反字面就是違反精神。**

```text
安全類／contract 類 gate 的依賴缺失 = INFRASTRUCTURE ERROR，NEVER = 綠燈。
```

**每一個**安全類／contract 類 gate 都 **MUST** fail-closed。以下任一條件成立時，checker **MUST** 輸出 `infrastructure-error`、列出缺失依賴，並回傳 non-zero：

- 必要 vendor file 或 symlink 不存在、dangling、不可讀
- contract 所需 env var 不存在或格式無法驗證
- scanner／parser／runtime dependency 無法載入
- 預期掃描 root 應存在，但 filesystem 或 Git 無法列舉

「本次 scope 內確實沒有 applicable target」與「checker 沒有能力執行」是不同狀態。前者可 N/A，後者 **MUST** infrastructure error；**NEVER** catch 後回空陣列、印 skip 再 exit 0。

### Red Flags

發現自己正在想以下任一句就 **STOP**，先把 dependency contract 補完整：

- 「vendor 不在，這個 consumer 就先略過」
- 「env 沒設，所以沒有東西可檢查」
- 「scanner load 失敗，回空 findings 比較不擋開發」

### Pipeline 回傳值當判斷依據時，下游提前退出命令一律 herestring

**每一個**把 pipeline 回傳值交給條件式的地方（`if cmd | grep -q …`、`cmd | grep -q … && …`），若下游是提前退出命令（`grep -q` / `head` / `sed q` / `awk … exit`）且腳本有 `set -o pipefail`，**MUST** 改 herestring，或讓下游直接讀檔：

- ✅ `grep -q PAT <<< "$content"` ／ `grep -q PAT "$file"`
- ❌ `echo "$content" | grep -q PAT`

下游命中即 `exit 0`，上游收到 SIGPIPE(141)，`pipefail` 讓整條 pipeline 回非零 → 條件式走**相反**分支，命中被判成沒命中。這是 fail-open：gate 有執行、有 exit code，只是判斷反了。只在上游輸出超過 pipe buffer（~64KB）且命中行在前段時發生，小樣本測試永遠正常——而那正是「大批量變更」這個 gate 最該啟動的形狀。

存量掃 `node ~/offline/clade/scripts/audit-gate-coverage.mjs` § 4。實證見 `~/offline/clade/docs/pitfalls/2026-07-25-grep-q-pipefail-sigpipe-false-negative.md`。

## 執行載體（檔案存在 ≠ 有東西會執行它）

Gate、checker、composite action 的檔案落在 repo 裡，**不代表**有任何東西會呼叫它。這兩件事之間
永遠隔著一個**執行載體**：git hook 的接線、CI workflow 的 `uses:`、`package.json` script 的引用、
或另一支 script 的 import。載體缺席時 gate 不會報錯、不會有 exit code、不會留 log——它只是不存在，
而檔案清單看起來完全正常。

**每一個**回報採用率／enforcement 狀態的 audit 都 **MUST** 驗到載體那一層，**NEVER** 用
`existsSync(<檔>)` 直接當結論：

| 被檢查的東西 | 載體 predicate（MUST 一併驗） |
| --- | --- |
| pre-commit / pre-push check script | `git rev-parse --git-path hooks/<name>` 指到的檔存在**且**（走 husky 時）`.husky/<name>` 存在**且**內容真的呼叫該 runner |
| composite action（`.github/actions/<name>/`） | 有 workflow 檔含 `uses: ./.github/actions/<name>` |
| CLI script（`scripts/*.mjs`） | `package.json` script、hook、或 CI step 內有呼叫它的字串 |
| 被 gate 以 `[[ -f "$X" ]] \|\| exit 0` 守衛的依賴 | 該路徑在散播清單內（否則 gate 在**每一個** consumer 都靜默 exit 0） |
| config / preset 檔 | 有檔案 import 或讀取它 |

`core.hooksPath` 是**取代**不是疊加：設了之後 git 完全不看 `.git/hooks/`，留在那裡的 hook 是死檔。
判斷 hook 是否會執行 **MUST** 問 git（`git rev-parse --git-path`），**NEVER** 直接 stat
`.git/hooks/<name>`。

把上表套到 clade 全部既有閘門後的實測清單（每個閘門的型態／載體／fail-open 條件／繞過方式）在
`~/offline/clade/docs/enforcement-matrix.md`。要依賴某個閘門兜底之前先在那份對照，**NEVER** 憑
「我們有這支 script」推論它會執行。

### Red Flags

發現自己正在寫以下任一句就 **STOP**，補上載體檢查：

- 「`existsSync(hookPath)` → 回報 enforced」
- 「三支 script 都在，所以這個能力已落地」
- 「action 目錄有散播過去，所以 CI 有在跑」
- 「規約寫了 MUST 接進 `pnpm check`，所以 consumer 應該有接」

實證：`vendor/review-rules/scan.mjs` 從未列進散播清單，`review-rules-ban.sh` 的
`[[ -f "$SCAN_ENGINE" ]] || exit 0` 讓機械層規則在全 fleet 一條都沒跑過；同一輪普查另發現
clade drift gate 因 `core.hooksPath` 在全部 consumer 失效、`review-rules-scan` composite action
散播到全 fleet 但零 workflow 引用。三者的 audit 當時全部報綠。

## 判準綁事實，不綁命名或結構慣例

Checker 的每一條判準 **MUST** 綁在**可觀察的行為事實**上。命名慣例、目錄結構、檔名前綴這類「通常是這樣」的規律**不是事實**——它們在寫 checker 的當下看起來成立，實際上只是樣本剛好都符合。

下筆前對**每一條**判準問一次：**「這條綁的是事實，還是我以為大家都會遵守的慣例？」** 答案是後者就換一條。

### 判準替換對照

| 想判斷的 | ❌ 綁慣例 | ✅ 綁事實 |
| --- | --- | --- |
| 這個 repo 有沒有部署流程 | workflow 檔名含 `deploy` | 讀 workflow 的 `name:` 與 job key |
| 這個 worktree 是不是在做這個 change | 路徑不是 main | tasks.md 的實際勾選數（fork-time snapshot 必然 ≤ 真實進度） |
| 這筆記錄是否已存在 | 標題字串比對 | 業務唯一鍵的組合 |
| 這個 phase 是不是 UI 層 | 標題含 `view` | 該格式自帶的顯式標記（`（非 view）` / `（view-only phase）`） |

前兩列都是實證：`audit-consumer-meta-adoption.mjs` 曾用檔名判準誤報「<consumer-b> 沒有部署流程」——它的 deploy job 住在 `ci.yml` 裡（`name: CI / Deploy` + `jobs.deploy` 做 rsync + SSH）；`notion-sync.mjs` 曾用「非 main」選 worktree，選到鄰居 change 的 worktree，因為**每個 worktree 都帶著 fork 當下的全部 change 目錄**。第四列是「`（非 view）`含 view」的反向誤判。

### 慣例判準的失敗形狀

它不會噴錯，它會**安靜地給出看起來合理的錯答案**——這比 crash 難發現得多。三個實證裡有兩個是靠人看到結果不對才抓到，不是靠測試。

### Red Flags

- 「檔名是 `deploy.yml` 所以這是部署流程」← 檔名不是契約，`name:` 和 `on:` 才是
- 「大家都把 X 放在 Y 目錄」← 「大家都」是樣本觀察，不是保證
- 「不如要求所有 consumer 改成 <某個命名> 這樣好判斷」← **方向反了**。工具遷就既有架構，不是架構遷就工具。真要求對齊，先確認那個對齊本身在架構上站得住（例如拆 workflow 會不會逼人把 `needs:` 改成 `workflow_run`）

## Canonical check entry

Consumer 的 canonical check entry 是 `package.json` 的 `scripts.check`。**每一條** CI workflow 都 **MUST** 執行 canonical entry（通常為 `pnpm check`）；workspace 內的子 package check 由 root canonical entry 統一 dispatch。

CI **NEVER** 手拆 lint、typecheck、audit、contract checker 清單來重刻 `scripts.check`。新增、移除或改名 checker 時只改 canonical entry；CI 保持呼叫同一入口，避免 package.json 與 workflow 形成雙重維護來源。

## Allowlist ratchet

既有債務 **MUST** 用 allowlist ratchet 收斂；allowlist entry 至少包含 `ruleId`、`path` 與可比較的 finding fingerprint／count。每次執行 **MUST** 同時判斷三個方向：

1. **新債**：finding 不在 allowlist，或 count 增加 → finding，擋下 gate。
2. **已修**：allowlist entry 已無對應 finding → stale allowlist finding，明寫要刪除的 entry。
3. **路徑腐爛**：allowlist path 不存在、已移動或不再落在 scope → path-rot finding，明寫舊 path 與目前 scope。

Ratchet 的目標是讓債務帳本自清並逐步歸零。**NEVER** 為了讓 gate 通過而調鬆 regex、縮小 roots、增加 broad exclusion、把 error 改成 warning，或整份重寫 allowlist／baseline；合法 scope 變更必須先更新 checker contract，再更新 allowlist 並附實際 scan evidence。

### Baseline 重寫紀律

Baseline（`review-rules-baseline.json` 等 ratchet 帳本檔）是**債務紀錄**，不是**通關工具**。重寫它會把當下所有違規一次吸收成「既有債」，gate 從此對它們永遠沉默——這是唯一能讓 ratchet 完全自廢的操作，而且成本低到隨手可為。

**違反字面就是違反精神。**

```text
BASELINE 只在債務已清償或帳本結構改變時重寫，NEVER 在 gate 擋下你的當下重寫。
```

**每一次**重寫 baseline 都 **MUST** 落在下列三種情境之一，並在 commit message 寫明是哪一種：

| 合法情境 | 可觀察 predicate | 重寫後應該看到 |
| --- | --- | --- |
| ① 存量清償 | 已修掉既有違規，重寫前 `--ratchet` 就是綠的 | entry 總數**減少** |
| ② 規則新增／pattern 收緊 | 同一次 commit 動了 `patterns.json` 的 rule 或 pattern | 只有該 `ruleId` 的 entry 增加 |
| ③ 檔案搬移／改名 | 違規總數不變，只有 path 改變 | 總 count 不變 |

**NEVER 在 `--ratchet` 擋下 push 的當下重寫 baseline**——那個 exit code 2 指的就是這次 diff 新增的違規。正解是修掉違規，或在該行加規則自帶的豁免標記（如 `lazy-atomic-ok` / `heavy-lib-ok` / `data-no-srcset`）並在該行寫明理由。

| 正要說出口的話 | 實際情況 |
| --- | --- |
| 「反正這些違規本來就在 codebase 裡」 | gate 已經比對過 baseline。它報出來就代表這幾筆**不**在 baseline 內。 |
| 「baseline 就是拿來記錄現況的，現況變了當然更新」 | ratchet 的「現況」定義是**上次清償後的狀態**，不是「我剛寫完 code 的狀態」。 |
| 「先重寫解掉 push，等等再回來修」 | 重寫之後 gate 對這幾筆永遠沉默，「等等」沒有任何觸發點。要延後就開 TD 條目，不要動 baseline。 |
| 「這是別人留下的違規，不該擋我」 | 別人的違規已在 baseline 內、不會擋你。擋你的是這次 diff 新增的那幾筆。 |

#### Red Flags

發現自己正要做以下任一件事就 **STOP**：

- 在 `--ratchet` 失敗訊息之後、還沒改任何 source 檔之前就跑 `--write-baseline`
- 為了「先讓 CI 綠」把 baseline 一起 commit 進同一個 feature commit

#### 掃描範圍 MUST 與 gate 一致

Baseline **MUST** 用與 ratchet gate 同範圍的指令產生。`review-rules` 的 gate 固定跑 `--all --layer all --ratchet`，因此：

```bash
node vendor/review-rules/scan.mjs --all --layer all --write-baseline
```

用較窄範圍（`--layer ratchet`、`--staged`）寫出的 baseline 會漏記範圍外的存量違規，那些違規在 gate 端被判成新增 → 直接擋死 push，錯誤訊息還指向一堆早就存在的舊 code。`scan.mjs` 對範圍不一致的 `--write-baseline` 已 fail-closed 拒絕寫入（exit 2）；baseline 內的 `_meta.fileset` / `_meta.layer` 記錄產生時的實際範圍。

## 違反回報格式

**每一筆** finding 與 infrastructure error 都 **MUST** 可直接定位與修復：

```text
- [<ruleId>] <path>:<line|N/A>
  found: <觀察到的值或缺失依賴>
  expected: <contract 要求>
  action: <最小修復或要刪除的 allowlist entry>
```

只印總數、只印 boolean、或只寫「check failed」都不符合回報 contract。跨檔 finding 的 `path` 填主要責任檔，其餘關聯檔放在 `found`。

## 為什麼

- <consumer-b> 的 `check-error-leaks` 曾只掃 `server/api`；實際 handler 位於其他 server API roots，checker 綠燈沒有涵蓋那些路徑。這證明 scope 必須由輸出可見且由 invocation 明確傳入。
- Contract 檢查曾在 vendor dependency 缺失時 silent skip；輸出看起來沒有 finding，但 contract 並未執行。這證明依賴缺失必須是 infrastructure error。
- <consumer-a> CI 曾手拆步驟，漏跑 `package.json` canonical `check` 內已宣告的 `audit:enforce`。這證明 CI 必須呼叫 canonical entry，不能維護第二份 checker 清單。

這三項都是 checker claim 與實際 coverage 不一致；本規約用可觀察 scope、fail-closed 狀態、單一 canonical entry 與 allowlist ratchet 讓 claim 可驗證。
