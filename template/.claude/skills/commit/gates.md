# Commit Quality Gates — Reference


> 本檔是 commit skill 品質閘門的完整執行細節。主檔（SKILL.md）含流程概覽與 pointer；觸發特定 gate 時 MUST 先完整讀本檔對應 § 再繼續。

## 受控交付的 evidence binding

受控執行帶有 acceptance contract 時，每個本次適用的 gate receipt MUST 綁定 contract digest、
受測 artifact digest、producer family、reviewer family／session 與 evidence ID。
`verifyCommitGateBindings()` 的 requiredGates 與 independentReviewGates 取本 skill 本次實際判定，
包含既有 fast-path 及重審條件。主線收割只驗 plan 結果；simplify、code／UI review、checks 與
Critical／Major 裁決仍逐步執行。換 pane 保留同一 model family，不能充當獨立 review。
內容或契約改變時，舊 receipt 不替新版本背書；依既有 gate 規則補驗後才接受整合。

## § 0-Coord: Cross-Session Staged Pollution Detection

`commit-lock` 只擋同時兩個 `/commit`；**不**擋「commit 跑時別 session 在跑 publish / propagate / wt-helper add / rescue-consumer」造成 staged 區意外污染（已實證 3 條 incident，見 `docs/pitfalls/2026-05-{14,18,22}-*.md`）。Step 0-Coord 跑 3 個 detection signal **warn-only**，命中先探測具體持有者、確認範圍與當前可用的協調通道；未解的決策才交給使用者。

### Signal 1: `.git/index.lock` mtime < 60 秒

別 session 正在 staging（git add / git commit / git checkout 過程中會建這個 lock，正常結束會自動移除）。

```bash
GIT_DIR=$(git rev-parse --git-dir)
LOCK="$GIT_DIR/index.lock"
if [[ -f "$LOCK" ]]; then
  NOW=$(date +%s)
  LOCK_MTIME=$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null)
  AGE=$((NOW - LOCK_MTIME))
  if (( AGE < 60 )); then
    echo "SIGNAL_1_HIT: index.lock age=${AGE}s path=$LOCK"
  fi
fi
```

**解讀**：年齡只提供活動線索；任何年齡都不能單獨證明原 owner 已結束，也不授權刪除 index.lock。命中後查實際行程與 checkout，保留鎖原狀。

### Signal 2: publish.ts untracked stash sidecar

`scripts/publish.ts` 的 `--stash-untracked` flow 跑時會在 `.spectra/stash-meta-<tag>.json` 落 sidecar（含 pid / cwd / fileList），publish 完成才 cleanup。看到 sidecar 代表 publish 流程**還在跑或崩潰未收尾**。

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
SIDECARS=("$REPO_ROOT"/.spectra/stash-meta-*.json)
if [[ -f "${SIDECARS[0]}" ]]; then
  for f in "${SIDECARS[@]}"; do
    [[ -f "$f" ]] || continue
    echo "SIGNAL_2_HIT: publish stash sidecar=$f"
  done
fi
```

**解讀**：任一 sidecar 存在 → 別 session 的 publish flow 仍未收尾；commit 時若擴大 staging 範圍可能跟 publish 的 auto-stash pop 撞 conflict。

### Signal 3: wt-helper baseline stash 在 60 秒內建立

`vendor/scripts/wt-helper.ts cmdAdd --baseline-strategy stash` 會建 `wt-baseline/<slug>/<session-id>/<iso>` stash entry，建完立刻 apply + drop。stash list 裡看到 `wt-baseline/` 命名且 reflog timestamp < 60s → wt-helper add 可能還在跑。

```bash
git stash list --format='%gd %ct %gs' 2>/dev/null \
  | awk -v now=$(date +%s) '
    /wt-baseline\// {
      age = now - $2
      if (age < 60) {
        printf "SIGNAL_3_HIT: wt-baseline stash age=%ds entry=%s\n", age, $1
      }
    }'
```

**解讀**：命中 → wt-helper add 流程未結束；此時 commit 跑下去可能撞 wt-helper 中段的 stash apply / index reset 序列。

### 命中處置

**全部 silent**（三條 signal 都沒命中）→ 直接輸出 `✅ 0-Coord 通過（無 cross-session 污染信號）`，進入 Step 0-Scope。

**任一 signal 命中** → stderr 印 warn block：

```text
⚠️ 0-Coord: 偵測到 cross-session 活動信號

  <列出命中的 SIGNAL_N_HIT 行>

可能後果：
  - 別 session 正在 staging → 你的 git add 可能跟它的 index 寫入互踩
  - publish flow 未收尾 → 你的 commit 可能跟 auto-stash pop 撞 conflict
  - wt-helper add 中途 → baseline staged index 可能污染你的 selective stage

建議處置（mitigation hint）：
  1. 等 60 秒後重跑 /commit（最常見：別 session 馬上結束就乾淨了）
  2. 跑 git status / git stash list / ls .spectra/ 確認別 session 真實狀態
  3. 確認別 session 沒在跑後再繼續
```

接著依 `scope-discipline` 的歸屬探測契約查實際 work／session／checkout、預定內容與 gate baseline。前三個 signal 全靜默只表示未命中這三種線索，不證明沒有其他寫入者。

| 持有者與能力 | 動作 |
| --- | --- |
| 已確認前景 session，且有可用並已授權的具名通道 | 先協調 scope、交接與完成事件。對方即將 land 時等該事件並重驗；交接已完成則進 0-Scope；對方接手本 ceremony 則收回 writer、釋放本 owner lock 後退出 |
| 已確認背景 runner 沒有互動通道 | 不把訊息送到無法轉達的 idle pane；保留本輪需求，按 runtime-lifecycle 收尾，不接管仍在寫入的內容 |
| 人類編輯、持有者未明、缺通道或具名協調逾時 | 完成可行的唯讀探測後，向使用者呈現具體未解處與候選動作；既有同範圍決定仍有效 |

需要新決定時提供「退出本次並保留工作」與「確認具體交接／風險後繼續」；使用當前入口可用的詢問工具或直接對話。使用者選擇繼續不免除 WIP 所有權與後續品質 gate；未授權外送訊息時不執行協調工具。等待綁具名事件與既有 timeout 契約，逾時回報，不無限輪詢。

### 禁止項

- **NEVER** 因 warn 自動刪除 `.git/index.lock`、sidecar 或其他 session 的狀態。
- **NEVER** 把 signal 命中升級成不可解除的 hard gate；先驗實際狀態，偽陽性與已完成的活動可以收口。
- **NEVER** 略過可執行的歸屬探測與已授權協調，直接把未消化的 A／B 交給使用者；缺通道時則明示缺口，不虛構對話。

> 同類 race 也存在於 **ad-hoc commit**（不走本 skill 的單檔 commit、HANDOFF 補一行就 commit、修 typo 就 commit 等）。預防規約見 `rules/core/commit.md` § Ad-hoc commit 必走 `git commit --only -- <paths>`。

---

## § 0-MR: 人工檢查 Gate（main / master 限定，硬擋無 override）

`.claude/rules/commit.trunk-gates.md` 「人工檢查 Gate」hard rule 的執行點（`commit.md` 只有一句 pointer，判定條件的 SoT 在 `commit.trunk-gates.md`）。**MUST** 在 Step 0 品質檢查之前 fail-fast，避免人工檢查未完的工作浪費 5–15 min pi / screenshot review 時間。

**判定粒度是 pathspec 交集，不是 repo 級 freeze**：一件工作判 BLOCK 時，被擋的是「落在該 carrier 的那些路徑」，不是本次 `/commit` 的整個 dirty set。理由與判定式在下方 § 判定粒度。

### 判定流程

1. 確認當前 branch：

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   輸出 ∉ {`main`, `master`} 且當前 path 不是 helper 登記的 batch integration → 輸出 `⏭️ 0-MR 跳過（branch=<name>）`，進入 Step 0。

2. 萃取本次 commit 觸及的 work item carrier（含 staged + unstaged + untracked）：

   ```bash
   { git diff --name-only HEAD; git ls-files --others --exclude-standard; } \
     | grep -E '^(tasks/[^/]+\.md|specs/plans/[^/]+/tasks\.md)$' \
     | sort -u
   ```

   結果為空 → 輸出 `⏭️ 0-MR 跳過（本次變更未觸及任何進行中的 work item carrier）`，進入 Step 0。

3. **批次 integration 直接進 step 4**，不得因來源未 land 而 SKIP；普通 main 模式才依下列規則查來源：

   來源尚未正式落地時，普通 main 的 annotation 更新不代表該來源 code 已納入本次提交；本步只用於普通 main。Batch integration 已含固定來源的實作，必須在落地前檢查其驗收狀態。

   ```bash
   # 主判定：wt-helper 已算好 mergedToMain
   node scripts/wt-helper.ts list --json 2>/dev/null \
     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
         let l=[];try{l=JSON.parse(s)}catch{process.exit(2)}
         process.exit(l.some(w=>w.path.split("/").pop()===process.argv[1]&&!w.mergedToMain)?0:1)})' "<X>"
   ```

   - **exit 0** → 該 change SKIP，輸出 `⏭️ 0-MR 跳過 <X>（worktree 未 land，code 不在 main）`
   - **exit 1** → worktree 目錄名與 change name 不同名，跑 fallback（下方）
   - **exit 2** → `wt-helper` 不可用 / JSON 壞掉，**MUST** 保守走 step 4 現行判定，**NEVER** 因工具失敗放行

   ```bash
   # fallback：掃 session/* branch，看哪條帶著 <X> 的改動且尚未進 main
   for b in $(git branch --list 'session/*' --format='%(refname:short)'); do
     git merge-base --is-ancestor "$b" main && continue
     git diff --name-only "main...$b" | grep -q "^<carrier 路徑>" && { echo UNLANDED; break; }
   done
   ```

   印出 `UNLANDED` → 同樣 SKIP。無輸出 → 進 step 4 現行判定。

   > 來源 archive gate 與批次 commit gate 都保留；來源未驗收不進 ready，batch 審查發現驗收失效時保留整批，不以普通 main 的 SKIP 放行。

4. 對每個 change 跑機械判定（「非 `## 人工檢查` 段有 `- [x]`」與「`## 人工檢查` 段有 **leaf** `- [ ]`」同時成立 → BLOCK；parent `#N` 有 scoped `#N.M` 子項時由子項 derive，leaf-only 計，見 `.claude/rules/manual-review.md` 「Parent State Derivation」段）：

   ```bash
   node ~/offline/clade/vendor/scripts/commit-mr-gate.ts judge "<path>/tasks.md"
   ```

   - 印 `OK` → 該 change 不擋（含 `tasks.md` 不存在：尚未進入實作階段）
   - 印 `BLOCK pending=<n>` → 列入 blocker list，`<n>` 是未勾 leaf 數
   - 腳本不存在（clade checkout 不在 `~/offline/clade`）→ 對該 change **視為 BLOCK**，**NEVER** 因工具缺席放行

5. **blocker list 非空時 → auto-triage（per [[review-gui-surface]] MUST 9）**：

   **MUST NOT** 直接停下叫 user 去 review-gui。改走 auto-triage：逐條讀 pending leaf item 的 annotation，判斷阻塞原因並自行推進主線可處理的項目。

   1. 對每個 blocked change 的每個 pending leaf item，讀 tasks.md 該行判斷：

      | Item 狀態 | 判斷方式 | 主線動作 |
      | --- | --- | --- |
      | `（fix-requested）` | 行內含 `（fix-requested）` | 在既有來源修 code → 在該來源重拍截圖 → strip `（fix-requested）` + `(claude-analyzed:)` → 更新 `(verified-*:)` annotation |
      | evidence missing | `[verify:ui]` / `[verify:api]` / `[verify:e2e]` 但無對應 `(verified-*:)` annotation | 走 [[agent-self-verification]] fallback chain 收 evidence |
      | `（issue:）` 無 `(claude-analyzed:)` | 行內含 `（issue:）` 但無 `(claude-analyzed:)` | triage issue → 走 (A)-(E) 路由 |
      | 純 `[review:ui]` user 驗收 | 上述都不符，item 是 `[review:ui]` | **只有這類**才引導 user 到 review-gui |
      | 純 `[discuss]` | 上述都不符，item 是 `[discuss]` | 不在此處處理（archive walkthrough） |

   2. **主線可處理的項目全部推進完畢後**，跑 mechanical readiness gate：

      ```bash
      node ~/offline/clade/vendor/scripts/check-review-readiness.ts \
        --repo . --change <change-name>
      ```

      - **exit 0** → 輸出 `✅ 0-MR auto-triage 完成，bucket=ready`，釋放 lock，引導 user 到 review-gui
      - **exit 1** → 讀 stdout JSON 的 `bucket` + blocking 數據，繼續 auto-triage 或釋放 lock + 如實報告卡住原因，**NEVER** 只說「請去 review-gui」
      - **exit 2** → 釋放 lock，回報 script 執行失敗

      **NEVER** 跳過 readiness gate 自判 bucket — Claude 自判已 9 次證明不可靠（per [[review-gui-surface]] MUST 9）

   3. **NEVER** 自動勾任何 `[review:ui]` 的 `- [ ]`、**NEVER** 提議跳過 gate、**NEVER** 提議 stash 走 `tasks.md`

6. **批次模式** auto-triage 後仍有 blocker → 保留 integration 與全部來源，停止 seal／land；修復後重驗。需排除未就緒來源時 cancel 後重登記合格來源再 prepare，不能切掉幾個 artifacts 卻帶走該來源 code。**普通 main 模式** auto-triage 跑完後 blocker list 仍非空 → 把每件 BLOCK 工作的 carrier 路徑（`tasks/<X>.md`，或整個 `specs/plans/<X>/**`）記為 **withheld scope**，輸出 `⏸️ 0-MR 保留 <X>（pending=<n>；withheld: <carrier 路徑>）`，**進入 Step 0**（不是停下）。withheld scope 由後面兩步消費：

   - **Step 3 分組**：withheld scope 內的路徑不進任何 group（分組唯一的機械排除）。它們留在 working tree，Step 5-A 照「仍有 uncommitted 變更」登記進 HANDOFF，並寫明卡在哪件工作的哪幾個 leaf。
   - **Step 4 每個 group commit 前**：

     ```bash
     node ~/offline/clade/vendor/scripts/commit-mr-gate.ts intersect \
       --block <X> [--block <Y>] -- <該 group 的 pathspec>
     ```

     exit 0 → 該 group 照常 `git commit --only -- <pathspec>`。exit 1 → stdout 列出的路徑落在 withheld scope，**該 group NEVER commit**；把那些路徑移出 group 後重跑，剩餘路徑才 commit。stdout 印 `pathspec-empty`（`--` 後沒有路徑，等同不帶 `--only` 的 `git commit -a`）→ 整個 dirty set 視為交集，**NEVER** 放行。

     **pathspec 只接受具名檔或該 plan package 目錄以下的路徑。** withheld 路徑的祖先目錄（`.`、`tasks`、`specs`、`specs/plans`，含尾斜線、含 `..`）、含 glob 字元 `* ? [`、以 `:` 開頭的 pathspec magic、絕對路徑，這四種會讓 git 把 withheld 檔一起收進 commit，helper 判定不了就一律視為交集（stdout 印該路徑、stderr 印 `pathspec-<ancestor|glob|magic|absolute>`，exit 1）。把 group 的 pathspec 改寫成逐一具名檔再重跑，**NEVER** 用 `-- .` / `-- tasks` 這種寫法「一次帶出」。

   blocker list 空 → 輸出 `✅ 0-MR 通過`，進入 Step 0。

### 判定粒度：pathspec 交集，不是 repo 級 freeze（TD-897）

批次來源已完成必要驗收才入 ready；integration 在 main 落地前再走本 gate。Blocker 會保留整批，不以 pathspec 切除 carrier 後放行來源 code。普通 main 的歷史存量仍用 pathspec 交集，避免無關工作的 carrier 狀態連坐其他工作。每筆正式 commit 依 SKILL.md Step 4 使用具名 pathspec。

實證（<consumer-a> 2026-09-03）：三件工作實作已 land、worktree 已 cleanup，人工檢查各剩 4–6 個 user-bound leaf（LINE LIFF 實機、production APPLY 授權）。repo 級 freeze 下 main 上任何 `/commit` 都落不了地，被連坐的是 `scripts/ai-control-plane/phase-6a-gate5-driver.ts` 這類與三件工作無關的檔。pathspec 交集下同一個 dirty set：三件工作的 carrier 被 withheld、其餘 group 照常 commit，三件工作的 auto-triage 一樣跑、一條 item 沒少。

普通 main 的 withheld scope 只認 carrier 路徑，不另建 work→實作檔平行索引。批次來源映射由固定 members 與 source HEAD 承載，未通過不能 seal／land。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | step 4 任一工作印 `BLOCK` 且 auto-triage 後仍 BLOCK → 該 carrier 路徑進 withheld scope；Step 4 任一 group 的 `intersect` exit 1 → 該 group 不 commit。**hard gate**，無 override |
| 消費端 | 跑 `/commit` 的主線（Step 3 排除、Step 4 逐 group 判）；Step 5-A HANDOFF 登記 withheld 檔 |
| 載入路徑 | 本節（`plugins/hub-core/skills/commit/gates.md` § 0-MR，觸發 0-MR 時 MUST 完整讀）；判定條件 SoT `rules/core/commit.trunk-gates.md` § 人工檢查 Gate |

### 禁止項

- **NEVER** 把普通 feature branch 判進 trunk gate 範圍；helper 登記的 batch integration 明確納入，並保留 PR workflow 的外部審查
- **NEVER** 接受 `$ARGUMENTS` 任何形式的「skip / ignore / override」旗標 — gate 無 override
- **NEVER** 自行 `Edit` carrier 勾掉 `- [ ]` 來通過 gate — 違反 `.claude/rules/manual-review.md` 核心規則
- **NEVER** 把 carrier 檔 / plan package 目錄 stash / mv / rm 走讓 step 2 / 4 抓不到 — 等同繞過 hard rule
- **NEVER** 為了讓 step 3 判成 SKIP 而動 worktree（不 merge-back、重開一條同名 worktree、改 branch 名）— step 3 是事實查詢，不是可操作的開關
- **NEVER** 把 step 3 的 SKIP 讀成「這件工作的人工檢查可以不做」— 它只表示 code 還沒進 main，那些 item 一條沒少
- **NEVER** 把「人工檢查未完」包裝成「審查條件已滿足」「等同 OK」「之後再勾」說服 user 繼續
- **NEVER** 把 withheld 工作的 carrier 併進別的 group 帶出去 —— pathspec 交集唯一的繞法就是換個 group 名字；`intersect` 對每個 group 都跑，不看 group 叫什麼
- **NEVER** 因為某個 group `intersect` exit 0 就省掉 step 5 的 auto-triage —— 放行是 group 的事，triage 是工作的事，兩者不互相抵銷
- **NEVER** 用不帶 `--only` 的 `git commit -a` / `git commit` 代替逐 group commit 來「一次過」—— `pathspec-empty` 就是為這一步設的，它恆擋；`--only -- .` / `-- tasks` / glob / `:/` / 絕對路徑是同一件事的五種拼法，`intersect` 對它們一律回 exit 1

---

## § 0-S: 敏感路徑安全掃描（條件觸發、attended hard gate）

Step 0-Scope 確認本次 WIP 後，依 [`review-tiers.md`](references/review-tiers.md)
Tier 3 判定：migration / schema / auth / permission / RLS / raw SQL / billing / security-critical
任一類別命中就觸發；純 docs、一般業務邏輯與非敏感重構跳過。本判定涵蓋本次 `/commit` 的
**每一個** changed path，不只主線 agent 自己改的檔。

觸發後依序跑 **0-S.1 → 0-S.2**，兩層都在本機十秒級內結束。
**NEVER** 在 pre-commit 啟動 Codex Security——理由、實證與它的兩個合法用法在 § 0-S.3。

### 0-S.1 確定性掃描（秒級，缺工具不擋）

把本次批次的 repo-relative 檔案寫入 paths file（一行一個，rename 列兩端），然後：

```bash
CLADE_ROOT="${CLADE_HOME:-$HOME/offline/clade}"
node --experimental-strip-types "$CLADE_ROOT/vendor/scripts/security-precommit.ts" \
  --target "$(git rev-parse --show-toplevel)" \
  --paths-file <本次批次清單>
```

| exit | 意義 | 處置 |
| --- | --- | --- |
| `0` | 兩支都 clean，或未安裝的那支記 `skipped` | 進 0-S.2 |
| `1` | 有 secret / SAST 命中 | 停止本次 commit，修正後重跑 0-S.1 |
| `2` | 某支跑了但沒跑完（`error`） | 停止本次 commit；掃描沒跑完等於沒掃，**NEVER** 讀成乾淨 |

工具未安裝時該支記 `skipped` 並印安裝指令，**NEVER** 因此跳過整個 0-S——
0-S.2 不依賴任何本機安裝，它照跑。

### 0-S.2 `/security-review`（分鐘級，本 gate 的 hard 層）

對本批 diff invoke Claude Code 內建 `/security-review`。它讀得到完整變更語境，
走本 session 既有額度，**沒有**外部配額或美元停止線。

High / Critical finding → 停止本次 commit。每一條 **MUST** 先走 `security-evidence finding`
（Severity / Confidence / Coverage / Proof Gap 判讀），verdict 是 `accept` 或
`needs more validation` 才登 TD 並修；`unsupported` 記進 report 不修。
**NEVER** 看到 High 標籤就直接改 code。

### 0-S.3 Codex Security：**NEVER** 在 pre-commit

它的範圍不由呼叫端決定。`working-tree` 模式的 `--paths-file` 只用來建私有快照
（`scripts/security-scan.ts:310`），傳給 scanner 的參數只有 `--working-tree`（`:657`），
範圍靠 scanner 自己去 diff 那個快照。推導成功就跑得完，失敗就是整個 repo，
而 `--max-cost` 只能讓它在燒完錢時停下、不能讓它少做事。

2026-09-07 fleet ledger 實測，41 次掃描成功 2 次：

| 觀察 | 數字 |
| --- | --- |
| clade 唯一成功（分母收斂到 5） | 37m05s / $24.58 / 31.4M input token / 0 findings |
| <consumer-a>（分母沒收斂：14 檔請求 → 6,330） | $15 只推進 22/6,330，線性外推整個 repo ≈ $4,300 USD |
| <consumer-b> / <consumer-a> 合計 | 16 次，0 次成功 |

**NEVER** 用「拉高 `--max-cost`」或「改排在 nightly」處理跑不完——兩者都建立在
「成本可預估」的前提上，而分母沒收斂時那個前提不成立。

它剩下兩個合法用法，**都不在 commit 路徑上**：

- `path --path <relative> [--path ...]`：唯一真的把範圍交給呼叫端的模式
  （`:645-647` 直接傳 `--path`，不建快照）。2026-09-07 實跑 `preflight (0/2 files)`，
  分母就是請求的檔數。
- `baseline`：由 operator 明確執行的完整 repository 掃描，
  `node "$CLADE_ROOT/scripts/security-scan.ts" baseline --target <repo> --max-cost <見 security-scan.md>`。
  它不會因一般 commit 自動啟動，也不由 path scan 冒充。

兩者的 exit 分流、`failure_class` 放行契約與 `--max-cost` 怎麼給，見
[security-scan.md](security-scan.md)。

Git pre-commit hook 只跑快速 LOCKED drift check。

gate 自己的可用度跑 `node scripts/audit-security-gate-readiness.ts`（warn-only）：
它量 0-S.1 兩支工具在不在，以及各 consumer ledger 有沒有撞頂未收斂的 run。
**NEVER** 把它綠燈讀成「0-S 掃過了」——它量的是 gate 有沒有能力跑，不是誰跑過。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | Tier 3 命中 → 0-S.1 exit 1 / 2 或 0-S.2 有 High / Critical 就**擋住本次 commit**。0-S.1 的 `skipped` 不擋 |
| 消費端 | 跑 `/commit` 的 attended agent（本節）；`security-precommit.ts` 自己判 exit |
| 載入路徑 | 本節（`plugins/hub-core/skills/commit/gates.md`，`/commit` 必經） |

---

## § 0-A: 程式碼審查（simplify → 0-A.1 → 條件式 0-A.2）

**每次 dispatch 或 fallback 前 MUST 完整讀 [review-policy.md](review-policy.md)**，分開驗證 scope、fresh context、實際模型差異、品質與唯讀載體。以下角色不固定由哪個 runtime 執行；原生呼叫方式見本檔末尾投影的 runtime 操作段。

1. 主線先完成 0-A.0；修完的 snapshot 才交給 reviewer。
2. Fast-path 不成立時啟動 0-A.1 獨立跨模型 review，並行 0-B 與 0-C。每個背景工作綁 owner、實際 handle、deadline 與收回方法；不把另一個 runtime 的參數交給本端工具。
3. 0-A.1 出 Critical／Major 時，修正後進 0-A.2 深度 review 與跨模型裁決。兩個步驟缺一仍未完成。
4. Findings 由主線匯合、查證與修正；各軸的背景 reviewer 不同時寫受審檔。

### 0-A.0 — simplify（主線，永遠先跑）

對本次變更檢查 reuse、精簡、效率與抽象層次，完成必要修正後再凍結 review snapshot。當前入口提供已安裝 `simplify` skill 時由主線直接呼叫；缺少原生 invocation API 時讀取可用技能全文依其契約執行，沒有技能時由主線明確覆核上述四軸並記錄結果。不虛構 `Skill` 工具或宣稱呼叫過未執行的技能。

技能內部的委派仍受當前 routing 與授權約束；主線不外包一層只為重新呼叫同一技能，也不手抄其 fan-out 結構。收到結果後只摘要修正與 deferred 項，deferred 依來源 repo 的 HANDOFF 契約登記，立即判 fast-path／啟動下一步，不等使用者重複授權。不轉貼整份中間報告。

Fast-path 的三條件以 SKILL.md 的同一份定義為準：diff <20 行、只含允許的 doc/config、無敏感路徑，三條全中才能跳過 0-A.1／0-A.2；0-A.0、0-B 的觸發判定與 0-C 仍執行。

### 0-A.1 — 獨立跨模型 review（並行軸 A）

Reviewer 看完整 frozen changeset 與驗收契約，以一般 review 的已核准推理深度查邏輯、安全、跨檔影響及適用 semantic patterns。共用 CLI 載體可使用：

```bash
bash "$COMMIT_SKILL_DIR/scripts/codex-review-safe.sh" medium
```

**使用該 CLI 前 MUST 完整讀 [runner-safety.md](runner-safety.md)**；`COMMIT_SKILL_DIR` 的取得方式與依賴檢查見 runtime-lifecycle。其他載體同樣要提供完整 snapshot、唯讀／隔離、真實 identity、完整 verdict 與對應來源。工具白名單不受底層 runtime 執行時，必須由核准的 OS 隔離承接，不能只相信參數名字。

| 實際結果 | 動作 |
| --- | --- |
| 啟動／等待中 | 記錄 handle 與 owner，透過本端完成事件或 bounded wait 收回同一工作；並行推進其他軸，不能重播命令代替等待 |
| 配額耗盡 | 依 review-policy 另選仍合格且已授權的候選；CLI 可依自身 NEXT 換池，但仍須驗模型差異。無候選則 gate 未完成 |
| Scope 缺檔／截斷、缺 verdict／Semantic Verdict id、workspace 綁定失敗 | 對應範圍未被完整 review；修復取證後再執行，不能記 PASS |
| Snapshot 漂移／不明 mutation | 先查具體 diff 與歸屬；已確認為合法並行工作可移至隔離 fixture 後重跑，不明或非預期 mutation 保留現場並處理授權，不自動覆寫 |
| 完整結果，無 issue | 0-A.1 通過，0-A.2 不觸發 |
| 只有 Minor／Info | 逐項修復並驗證，0-A.2 不觸發 |
| 含 Critical／Major | 逐項修復後進 0-A.2；修法本身是新的受審範圍 |

**Severity 以 reviewer 的輸出為準，NEVER 由主線自行降級來避開 0-A.2。** 缺少完整 `## Semantic Verdict` 表或適用 id 時，review 未完成。宣告通過須附實際 reviewer 與 snapshot／結果指標，不用預設模型名字填模板。

| 開脫 | 現實 |
| --- | --- |
| 「finding 都修完了，0-A.2 沒東西可看」 | 0-A.2 要看的正是修法及其 regression |
| 「修法很小，不值得再跑一輪」 | Critical／Major 是觸發條件，不以修法行數取消 |

#### finding 的三類分流

reviewer 看的是 working tree diff，但它讀得到整個 repo，因此會評論到**本次沒改的舊碼**。「一律修」對這類 finding 會把 unrelated fix 帶進本次 commit（違反 § Step 3 的分組紀律）；「不在本次範圍」則是本檔明文禁止的跳過藉口。出路是分流，不是二選一。

**每一個** finding **MUST** 落在下表三類之一，依序判定，第一個命中的為準：

| 可觀察 predicate | 類別 | 處置 |
| --- | --- | --- |
| finding 指涉的 code 出現在本次 diff 的 `+` 行 | **缺失類** | 照 reviewer 標的 severity 一律修。**位置無關**——修法要動到同檔別處、別的檔、或 diff 外的呼叫端，照修不誤 |
| 問題成立，但 finding 給的 `<file>:<line>` 指到本次 diff 以外（reviewer 的行號對不上 working tree） | **行號漂移** | 先定位到真正的位置，再照 severity 修。**NEVER** 因為「行號指到沒改的地方」就歸純舊碼 |
| 上兩類都不成立 | **純舊碼** | 不進本次 commit，但 **MUST** 當場登記 + 回報（見下）。**NEVER** silent drop |

判為**純舊碼**的 finding，**MUST** 在給 user 的回報中逐條輸出下列三行，**任一行留白或寫不出來就照 severity 修**：

```
PRE-EXISTING — 未觸碰：<file>:<line>（舉證本次 diff 不含此檔／此行）
               無因果：<本次變更為何不會觸發、加劇、或暴露它——一句話，指具體機制>
               登記：<TD-NNN | HANDOFF.md § …>
```

兩條舉證缺一不可：只證「沒碰到」不夠——本次變更可能讓一條原本走不到的舊路徑變成熱路徑；只證「無因果」也不夠——那是純舊碼判定的結論，不是它的前提。

登記走 `docs/tech-debt.md` 開 TD（跨 session 要追）或 `HANDOFF.md`（下一 session 就會碰），**NEVER** 只在 chat 講一句。「已經跟 user 說了」不算登記——chat 不是 session 之間的傳遞介面。

### 0-A.2 — 深度 review + 跨模型裁決（兩步驟，條件觸發）

只在 0-A.1 出 Critical／Major 時執行；修復後的完整 snapshot 是輸入。

1. 合格深度 reviewer 以已核准的深度檔檢查修法與連帶影響。使用共用 CLI 時為 `codex-review-safe.sh medium`，完整限制同 runner-safety。保存完整輸出，不只摘錄結論。
2. 與深度 reviewer 不同模型族的合格裁決者取得該 snapshot、原始 0-A.1 findings 與深度結果，逐條確認 real issue、附反證 dismiss 或重標 severity，另查漏項。裁決者唯讀，主線負責修復。Cursor 主線的 Fable 裁決走 Herdr create-only：缺 pane 時 **MUST** 主動 `herdr-session-handoff.ts --launcher ccw --new-tab --coordinate --model claude-fable-5-1 --effort medium --route manual --tier-basis adjudication`（quota／`account_unavailable` 再 `cc`）。**裁決者的檔位就是 `medium`，與 0-A.1 的 Fable fallback 同一格**——`--tier-basis adjudication` 記的是「這個檔位是判出來的、不是查表查到的」，**NEVER** 讀成「裁決者所以可以升檔」：Fable 的天花板是 `medium`，`max` 對 Claude child 不可達（2026-09-10 那 4 個 Fable pane 就是這個誤讀）。**NEVER** 把「無 Herdr pane／Herdr 不可用」當成可跳過 0-A.2 或整場 `/commit` 的出口。`idle`／`done` 不是完成。兩個 launcher 都用盡才准留下 launcher／exit／evidence dir 的 receipt，再寫 durable follow-up。**NEVER** `--relay`，**NEVER** 叫 user 開 Claude 或貼 prompt。

#### 裁決者結構性缺席時的延後路徑（TD-1052 (c)，Charles 2026-09-10 拍板）

**這條解的是「合格裁決者一個都不存在」，NEVER 是「我沒找到人」或「開 pane 失敗」。**
後兩者的處置在上一段（MUST 先開 pane，兩個 launcher 都用盡才准留 receipt），本路徑不取代它。

**四個條件全中才成立，缺一條就回到「0-A.2 保持未完成」**：

| # | 條件 | 怎麼算數 |
| --- | --- | --- |
| 1 | 0-A.2 **第 1 步（深度 review）已經跑完**且有完整輸出 | 延後的只有裁決那一步。深度 review 沒跑完 = 整個 0-A.2 未完成，與本路徑無關 |
| 2 | `review-policy.md` 認可的合格裁決者中，**與深度 reviewer 不同模型族的那些全部不可得** | **MUST 逐個實跑過**並留下輸出。routing-table `code-review` 列的具名候選一個都不能只憑印象跳過 |
| 3 | 有一份**實跑憑證檔**，內容是條件 2 那次失敗的原始輸出，且是**本次 `/commit` 內**跑出來的 | `0a-metrics.mjs` 機械檢查三件：檔存在、非空、**內容含 `RESULT: quota-blocked`**（`codex-review-safe.sh` 的穩定輸出契約）。**開 pane 失敗留下的 launcher／exit receipt 不是這個**——那條路的處置在本節上方，機械層現在也擋得住冒充。「本次跑出來的」目前**只由本行紀律承載**，CLI 不驗新鮮度：**NEVER** 沿用前一次 `/commit` 的憑證 |
| 4 | 有一張**承載補跑的 flow work item**，且它**真的在 spine 上** | `node ~/offline/clade/vendor/scripts/flow/flow.ts open <slug> --origin td:TD-1052 --title '<snapshot dir> @ <base sha>'` 先開卡（consumer 端沒有自己的 `vendor/scripts/flow/`，走全路徑；`--origin td:` scheme 合法；`--title` 是 `flow.ts` 既有 flag）。`0a-metrics.mjs` 會在 `<repo>/.clade/flow/events.jsonl` 逐行找那個 `work_id`，查無、格式不對、或該 repo 根本沒有 spine，**都拒收**——沒有 spine 就沒有「之後會被叫回來」。**卡的 `--title` MUST 含這次 review 的 snapshot dir 與 base sha**——補跑要的是「同一份 snapshot ＋ 原始 0-A.1 findings ＋ 深度結果」，而 ledger 只留得住 receipt 路徑與 work id，這兩樣可能已被清。`<snapshot dir>` 是本次 review 報告落腳的目錄，慣例 `~/.cache/clade/review-snapshots/<date>-<slug>/`——它不是 commit skill 自己的產物，是 dispatch 那次自訂的落點，**MUST** 寫實際路徑，不是這個慣例字面 |

記錄用 `escalated-a2-deferred`，**NEVER** 用 `escalated` 加一個編出來的 adjudicator：

```bash
node .claude/scripts/0a-metrics.mjs record \
  --review-mode escalated-a2-deferred \
  --reviewer '<實際跑深度 review 的 runtime/model>' \
  --a2 true --critical <n> --major <n> --minor <n> --info <n> \
  --a2-deferral-receipt '<條件 3 的憑證檔絕對路徑>' \
  --a2-deferral-work-id '<條件 4 的 work id>' \
  --diff-lines <n> --diff-files <n> --dismissed <n> --dismissed-unsubstantiated <n> \
  --screenshot <pass|skip> --doc <aligned|skip>
```

上表的每一條都在 CLI 層擋，**不是留給紀律**——只有條件 3 的「本次跑出來的」除外，該格逐字標在表裡。
這是刻意的：延後裁決與跳過裁決事後看起來完全一樣，差別只在有沒有東西會把它叫回來，
而**註解與規約 NEVER 該承諾程式碼沒做的事**（2026-09-10 的 0-A.1 review 就是抓到本路徑第一版
犯了這個——`--a2-deferral-work-id` 當時只驗非空，填一個不存在的卡號一樣通過）。

同時提供 `--adjudicator` 會被**拒收**：有裁決者就不叫延後。該組合唯一的用途是把一次真的
裁決記成延後、或把一次延後粉飾成有人看過，所以它在 CLI 層就擋掉，不留給紀律。

**本路徑放行的是 land，NEVER 是 finding。** 0-A.1 與深度 review 判出的每一條缺失類 finding
**仍然 MUST 修完**才 land——延後的只有「第三方逐條覆核 dismiss 與漏項」那一步。
逐字反開脫：「反正沒有裁決者會來看，那幾條 Minor 就先留著」——那不在本裁決的射程內。

**補跑是義務不是提醒。** 條件 2 的阻塞解除後（典型是配額回復），MUST 以**同一份 snapshot**
＋ 原始 0-A.1 findings ＋ 深度結果交給合格裁決者走完第 2 步，並在該 work item 上收口。
`--a2-deferral-work-id` 之所以是必填，就是為了讓這件事有一個會浮出來的載體——
**NEVER** 把它當成一個備註欄位隨手填一個不存在的 id。

**匯合行印 ✅ 之後會另外印一行「0-A.2 裁決已延後，NEVER 讀成完成」**。看到那一行仍然收工，
與沒有跑 0-A.2 的差別只有 ledger 裡一個 boolean。

深度輸出缺 `## Review Verdict`（含截斷／context exhaustion）時，明示深度階段未完整；不盲重跑相同耗盡命令。保留已有 findings，由合格裁決者以完整最新 diff、原始 0-A.1 輸出與相同完整性契約接手。只有它實際覆蓋缺失範圍並產出完整 verdict 才可收口；否則 0-A.2 保持未完成。

裁決輸出對**每一條** dismissed finding 提供：

```text
DISMISSED — 反證：<file>:<line> ／ <契約或規則條文的具體出處>
說明：<一句話>
```

先驗每條反證再判通過。無反證的 dismissal 保留為 real issue，沿原 severity 處理；模型／effort 的名稱不能代替查證。有 real issue 時主線修復並跑相關驗證；無 real issue 或全部有反證時完成該階段。

**最多兩輪 discovery review（0-A.1／0-A.2）**。兩輪後仍無法收斂，拆成可獨立驗收的範圍或依具體 blocker 升級，不能無限重派相同 brief。此上限不取消修復後必要的 verify-only 與下方大改動 snapshot 回扣。

### 0-A/B/C/D 並行匯合（收口檢查）

收回每個實際工作結果後核對：0-A 通過或合法 fast-path；0-B 通過或未觸發；0-C 全綠。接著條件執行 0-D，再做大改動回扣；0-E／0-F 依自己的觸發與阻擋契約處理。

**大改動回扣**：0-A／0-B／0-C／0-D 匯合後累計修正**超過 50 行或跨 5 檔以上**時，MUST 讓合格 reviewer 對新 snapshot 再驗，確認新內容也被覆蓋。未到門檻仍跑修法相應的驗證；不能把舊 snapshot 的 PASS 當成新內容的 review。

實際匯合完成後使用 metrics recorder，記錄真實結果與身份：

```bash
node "$COMMIT_SKILL_DIR/scripts/0a-metrics.mjs" record \
  --review-mode <independent|escalated|escalated-a2-deferred|fast-path-skip> \
  --reviewer <實際runtime/model> [--adjudicator <實際runtime/model>] \
  --diff-lines <行數> --diff-files <檔數> \
  --critical N --major N --minor N --info N \
  --a2 <true|false> --dismissed N --dismissed-unsubstantiated N \
  --screenshot <pass|skip> --doc <aligned|skip>
```

Fast-path 不填未執行的 reviewer；escalated 記實際裁決者；`escalated-a2-deferred` 依上方
§ 0-A.2「裁決者結構性缺席時的延後路徑」多帶 `--a2-deferral-receipt` 與 `--a2-deferral-work-id`，
**NEVER** 同時帶 `--adjudicator`（有裁決者就不叫延後，CLI 會拒收）。`--dismissed-unsubstantiated` 是反證不足被保留為 real issue 的條數。Recorder 的參數檢查不證明 review 真有執行，須同時保留各軸原始 receipt；參數矛盾時修正流程或記錄，不能填假值讓它通過。舊 `--codex` CLI／歷史記錄是相容資料，不要求新入口冒充該模型組合。

本地 `.clade/0a-metrics.jsonl` 是閾值評估依據；`summary` 的歷史數據與本次結果分開。Fast-path 與大改動門檻的變更需據分佈判定，不憑單次觀感調整。

**未完成的 gate 不產生通過匯合行，也不進 commit。** Reviewer 不可用、配額不足、缺隔離／身份／完整輸出都不能以主線自審補位。發現自己正用「另一個 fresh agent」代替模型差異、或用啟動成功代替完成，就是回上表補證據的時刻。

Heavy gate 的 `exit 75` 代表 `gate-slot.sh` 等不到 slot、inner command 尚未執行；不是 typecheck／OOM 的證據。依 [[pitfall-heavy-gate-exit-75-reads-as-typecheck-failure]] 查實際 holder 與執行輸出，不能用增大 heap 或等待參數修錯層。

---

## § 0-B: UI Design Review（條件觸發、並行軸 B）

```bash
# tracked modified + untracked 新增的 .vue
{ git diff --name-only; git ls-files --others --exclude-standard -- '*.vue'; } | sort -u
```

**同時滿足才觸發**：

1. 變更含 `.vue` 檔的 `<template>` 區塊（含 untracked 新增頁面）
2. 屬於下列之一：新增頁面/元件、佈局結構變動、互動流程變動、大範圍樣式調整

**不觸發**：純 `<script>` / `<style>` 微調、composable / store / API 純邏輯、測試、文件、設定檔、單純重構不影響視覺輸出。

**Dispatch 前 MUST 完整讀 [review-policy.md](review-policy.md)**，確認真實圖片存取、視覺品質資格、fresh context 與可用載體；brief 帶完整 item、截圖與互動證據，依本檔 native 操作段執行。取證走 `screenshot-review-verify` Gemini 3.8 Flash high；Design Review 與截圖符合性由 fresh Claude Opus 5（effort: medium） 讀實際圖片後完成。取證與判定分開 dispatch；Opus 5 無法執行時帶實際原因走對應 GPT-5.6 Sol（effort: high）fallback，保留 fresh context／圖片／gate 要求；fallback 仍失敗時保留 0-B 未完成。

**並行啟動**：有真實並行載體時，0-A.1 啟動後同回合啟動已觸發的 0-B；收回 findings 後與 0-A.1／0-C 匯合修正。缺並行能力時依 review-policy 記錄同步載體限制，不略過視覺 gate。

問題修正後輸出 `✅ 0-B 通過`；不觸發則直接輸出 `⏭️ 0-B 跳過（無 UI 變更）`。

---

## § 0-C: CI 等效檢查（Fix-Verify Loop、並行軸 C）

**並行啟動**：0-A.1 的 snapshot 已凍結且有可收回的背景 handle 時，同回合啟動 0-C；各軸回報後匯合。缺非同步能力時依 review-policy 的同步執行契約，所有檢查仍要完成。

跑下列指令確保 **format / lint / typecheck / test / doctor 全部 0 errors + 0 warnings + 0 test failures**：

```bash
pnpm check
```

**同一次 commit 已經被 CI-only 失敗打回過第二次**時，別再逐發修——**MUST** 讀 `~/offline/clade/vendor/snippets/ci-parity/`，它有本機重現 CI 條件的 checklist 與兩個 consumer 的實際 churn 案例（<consumer-b> 曾為此連發六個修復 commit）。

**接著無條件跑一次測試**（多數 consumer 的 `check` 只有 format/lint/typecheck，**CI 才跑完整 test**，本地不補跑就會在 push 後才看到測試失敗）：

```bash
pnpm test          # 或 vp test run / pnpm test:unit，依 consumer 設定
```

**NEVER 先判斷 `pnpm check` 有沒有涵蓋 test 再決定跑不跑。** 本步驟原本用 `/test|vitest/.test(scripts.check)` 做這個判斷，比對的是整條 `&&` 串接命令的字串，於是任何**名字裡帶 `test`** 的 sibling script 都會誤觸——實測 <consumer-a> 的 `check:dual-test-config` / `check:e2e-paths` 與 <consumer-c> 的 `check:test-roots` 全部中招，三者都跟跑測試無關。誤觸 → 「必須額外跑」的條件不成立 → 補跑被跳過 → 0-C 在零測試覆蓋下判綠，且因為兩個分支都不 exit non-zero，判錯跟判對外觀完全一樣（<consumer-a> v0.103.0 實際踩到：兩條既有測試已紅，0-C 沒抓到）。

`check` 真的已含 test 時這裡會重跑一次；**重跑的成本遠低於靜默不跑**，且沒有啟發式就沒有判錯的可能。對應 [[pitfall-check-includes-test-substring-false-positive]]、TD-311。

**檢查是否有 `scripts.doctor`**（vite-doctor import graph 健康度檢查：cycles、broken imports/exports、phantom deps）：

```bash
node -e "const s=require('./package.json').scripts; console.log(s.doctor?'has-doctor':'no-doctor')"
```

若輸出 `no-doctor` → **MUST block commit**，印出安裝指引後中止：

```text
⛔ 0-C 失敗 — vite-doctor 未安裝

vite-doctor 是 commit 品質閘門的必要組件（import graph 健康度：cycles、broken imports/exports、phantom deps）。

安裝步驟：
  1. pnpm add -D vite-doctor
  2. 在 package.json scripts 加入：
       "doctor": "vite-doctor scan . --max-warnings 0"
  3. Nuxt 專案：在 nuxt.config.ts 加入 module：
       import { doctorConfig } from './vendor/doctor-shared/preset.ts'
       modules: [['vite-doctor/nuxt', doctorConfig]]
  4. 安裝完成後重跑 /commit

詳見 .claude/rules/vite-doctor.md
```

隨後 **MUST** 釋放 commit-lock（依 [runtime-lifecycle.md](runtime-lifecycle.md)「背景工作與退出」，帶原 tuple 與 owner token）並 STOP。**NEVER** 跳過此 gate 繼續跑後續步驟。

若輸出 `has-doctor`，**必須**額外跑（**MUST** `pnpm run doctor`，**NEVER** 裸打 `pnpm doctor` — `doctor` 撞 pnpm 內建子命令，裸打跑的是 pnpm 自家 doctor 並 silent exit 0，`scripts.doctor` 的 vite-doctor scan 永遠不執行）：

```bash
pnpm run doctor
```

Doctor health score < 100 或 exit code ≠ 0 → **MUST block commit**，修復後重跑直到 health score 100/100 + 0 warnings + exit 0。**即使 warning 是既有、非本次 diff 引入**也必須修——每次 /commit 順手把既有 doctor warning 修掉，保持零警告 baseline。典型修法：移除 dead imports、修正 re-export 路徑、打斷 import cycles、套用 `readValidatedBody` 取代 raw body read。**NEVER** 以「非我引入」「既有 debt」為由跳過 doctor warning — 0-C gate 不區分新舊，一律全綠。

> **oxfmt batched false-positive**（vite-plus 0.1.21 已知 bug）：第一次 `pnpm format:check` 紅但 single-file `vp fmt --check <path>` 通過，是 batched bug 不是 format issue — **先**跑一次 `pnpm format`（vp fmt --write）再重跑 check 通常就過。**NEVER** 動 `.oxfmtignore` 或 LOCKED projection（`.claude/rules/` / `AGENTS.md` / `CLAUDE.md` / `.clade/vendor/**`）試圖讓 oxfmt 滿意 — 那是 governance violation。clade 中央倉 release flow 已在 `scripts/publish.ts` 主流程加 stable fmt pre-stage（兩輪 `vp fmt --write` + `vp fmt --check`），consumer 端 commit 流程不需再背 workaround SOP。詳見 `docs/pitfalls/2026-05-18-oxfmt-batched-check-false-positive.md`。

失敗時進入 loop：修復 → `pnpm format`（裸打 `vp fmt` 必須加 `--ignore-path .oxfmtignore`） → 重跑上述步驟 → 直到全綠。loop 的執行者依下方「fix loop 的 pi offload」規則決定（**預設背景 pi**；例外才主線直修）。

**Fix loop 的 pi offload（預設派背景 pi，主線不留在 foreground 修）**：

0-C 檢查發現失敗需要修補時，**預設**派背景 pi 跑 fix-verify loop，主線同回合繼續既有並行收尾（poll 軸 A、回收軸 B）— 三軸並行結構不變，軸 C 只是從「主線 foreground 修」換成「pi 背景修」：

```bash
node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
  --template ~/offline/clade/vendor/snippets/pi-offload/templates/fix-verify-loop.template.md \
  --var <key>=<value> ...（依 template 變數表填：check 命令、失敗摘要 / log 等） \
  --var max_iterations=2 \
  --label commit-0c-<slug> --model grok-xai --effort high \
  --workspace-access mutation \
  --route routing-table --tier-basis table-row --table-row commit-0c-fix-verify
```

（`--route` / `--tier-basis` / `--table-row` 皆必填，缺就 exit 1。0-C 第一手是 Routing Table
〔`commit-0c-fix-verify`〕列，已列明 `grok-xai high`，照列派 → `--tier-basis table-row`
＋ `--table-row commit-0c-fix-verify`。`--var max_iterations=2` 是本列的次數上限：同一 dispatch
內最多 2 輪 check→fix，到上限仍紅 MUST 報 `fail` 而非 `pass`。）

**升級到 Sol（同一輪 0-C，不是新的 commit）**——命中任一即派，**NEVER** 再給 grok 同一份 brief：

1. grok dispatch 回 `fail` / `uncertain` / exit 2（2 輪用盡或自報修不到）
2. grok 報 `pass` 但主線重跑 `pnpm check`（+ test / doctor）仍紅
3. grok-xai exit 4（本列是 mutation，dispatcher payload 跳過 grok-cursor 並指向 Sol 升級列；**NEVER** 跳過升級列，**NEVER** 退回 Claude 或 native `cx`）

```bash
node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
  --template ~/offline/clade/vendor/snippets/pi-offload/templates/fix-verify-loop.template.md \
  --var <key>=<value> ...（帶 grok 留下的 remaining_failures） \
  --var max_iterations=none \
  --label commit-0c-<slug>-sol --model sol --effort high \
  --workspace-access mutation \
  --route routing-table --tier-basis table-row --table-row commit-0c-fix-verify-escalate \
  --retry-of commit-0c-<grok-slug>
```

（升級列已列明 `sol high`。`--retry-of` 指 grok 那一發，**NEVER** 改用 `<slug>2` 表達重試。
`max_iterations=none` 只受 template「同一 error 連續 3 輪沒收斂」約束。）

（背景跑、stdout 單一 JSON；exit 0=全綠 / 2=修不到全綠（業務 fail）/ 3=機械故障 / 4=quota。
exit 3 → 機械故障，依 dispatcher/watch protocol 處理，**不**冒充品質失敗；
exit 4 在 grok 第一手 → 逐字採用 dispatcher payload，跳過 `grok-cursor` 並走上方 Sol 升級列，**NEVER**當成機械故障；
exit 4 在 Sol 升級列 → 明示 provider/quota blocker，**NEVER** 改派 Astra implementation、Claude-hosted GPT 或 native `cx`；
exit 2 在 grok 第一手 → 走升級列；exit 2 在 Sol 升級列 → 依 payload 走 Astra `implementation-decision` readonly，patch 回 Sol，**不**讓 Astra 修 code。）

修改範圍與前置授權持續適用；未知或活躍他人 WIP 不因修 gate 就可覆寫。

**每一輪需要修復時先判執行者**：單檔 ≤5 行的 typo／import 級修正、或根因涉及本次設計判斷時由主線處理；其他可獨立驗證的機械修復依目前已核准 routing／使用者模型指定選 worker。可用本 runtime 的原生載體，不要求所有主線先換到 Pi。沒有可用 worker 或機械 transport 故障時主線接手，品質標準不變；這不構成 0-A 獨立 reviewer 的替代。

Worker brief 帶具體 failures、命令、允許檔案、禁止修改的主線範圍與回報格式。第一位 worker 最多兩輪 check→fix；仍 fail／uncertain，或主線複跑仍紅時，升級有能力處理剩餘根因的合格執行者，不重派同一 brief。相同 error 連續三輪無收斂時停止盲修、回到根因與 scope 決策。

使用 Pi CLI 的既有載體時，沿當前 `commit-0c-fix-verify`／`commit-0c-fix-verify-escalate` row、`--route`／`--tier-basis`／`--table-row` 與 `--retry-of` 契約。Exit 2 是業務未收斂、3 是機械故障、4 是 quota；按實際結果判定，不能拿 quota 當故障來繞過 candidate admission。其他 native adapter 回報等價的 pass／finding／infrastructure-error／quota 狀態，不捏造 Pi exit code。

**Worker 完工後主線 MUST**：

1. 重新執行 `pnpm check`、明確 test command 與 `pnpm run doctor`，取得真實 exit／完整結果；worker 自報不算通過。
2. 比對開始前的 diff／內容與 worker 實際修改，確認 scope。需要撤掉 worker 越界變更時先停止仍在寫入的 worker，再只撤其新增的段落；不能整檔還原 HEAD 丟掉原本 WIP，也不能覆寫其他人的並行修改。

**禁止**用 `npx vitest run` / `npx eslint` 等個別工具替代 `pnpm check` / `pnpm test` / `pnpm run doctor`。若工作樹路徑干擾結果，先按所有權及 lifecycle 契約處理，再跑正式命令；不能藉修 gate 任意清理其他工作。

通過後輸出 `✅ 0-C 通過（format/lint/typecheck/test/doctor 全綠）`。

---

## § 0-D: Doc Alignment 檢查（條件觸發、主線 foreground）

本次 diff 觸及的變更若涉及 docs/ 相關面向，**MUST** 在 0-C 完成後跑 doc alignment 檢查。0-D 不阻塞 0-A/0-B/0-C 並行（在三軸匯合後跑）。

### 觸發條件

以下**任一**成立即觸發（全不成立 → 輸出 `⏭️ 0-D 跳過（diff 無 doc-relevant 變更）`，進入匯合）：

1. diff 觸及 `docs/**` 本身
2. diff 觸及 `rules/core/**` / `rules/modules/**` / `vendor/snippets/**`（標準層有變 → docs 可能需同步）
3. diff 觸及 `scripts/*-audit.mjs`（audit signal 變更 → `registry/audits.json` 的 `cadence` / `consumers` 或 `docs/dev-guide.md` 可能需更新）
4. diff 觸及 `[packages/<pkg>/]{server/api,server/utils,server/routes,app/components,app/pages,composables}/**` 或 `[packages/<pkg>/]nuxt.config.ts`（業務碼 / 框架設定有變 → consumer docs/ 可能需對齊）
5. diff 含 bug fix（commit message 含 `fix` type）→ pitfall 覆蓋檢查

```bash
DIFF_FILES=$(git diff --name-only HEAD)
HAS_DOC=$(echo "$DIFF_FILES" | grep -E '^docs/' | head -1)
HAS_RULES=$(echo "$DIFF_FILES" | grep -E '^rules/(core|modules)/' | head -1)
HAS_SNIPPETS=$(echo "$DIFF_FILES" | grep -E '^vendor/snippets/' | head -1)
HAS_AUDIT=$(echo "$DIFF_FILES" | grep -E '^scripts/.*-audit\.mjs$' | head -1)
HAS_BIZ=$(echo "$DIFF_FILES" | grep -E '^(packages/[^/]+/)?(server/(api|utils|routes)|app/(components|pages)|composables)/' | head -1)
HAS_CONFIG=$(echo "$DIFF_FILES" | grep -E '^(packages/[^/]+/)?nuxt\.config\.(ts|js)$' | head -1)
# fix type 在 Step 3 分組後才能判，0-D 先用 diff 中有無 pitfall-related file 近似
HAS_PITFALL_REF=$(echo "$DIFF_FILES" | grep -E '^docs/pitfalls/' | head -1)

if [[ -z "$HAS_DOC$HAS_RULES$HAS_SNIPPETS$HAS_AUDIT$HAS_BIZ$HAS_CONFIG$HAS_PITFALL_REF" ]]; then
  echo "⏭️ 0-D 跳過（diff 無 doc-relevant 變更）"
else
  echo "0-D 觸發：需要 doc alignment 檢查"
fi
```

### 檢查 A — Cross-reference 驗證（機械化）

掃 `docs/` 中所有 `[[...]]` cross-ref，驗證 target 存在（rules/core/ 檔名、pitfall id、memory name）：

```bash
grep -rn '\[\[' docs/ --include="*.md" 2>/dev/null \
  | sed -E 's/.*\[\[([^]]+)\]\].*/\1/' \
  | sort -u \
  | while read ref; do
    # 嘗試 match rules/core/<ref>.md、docs/pitfalls/*<ref>*.md、或 memory
    found=0
    [[ -f "rules/core/${ref}.md" ]] && found=1
    [[ -f "rules/modules/${ref}.md" ]] && found=1
    ls docs/pitfalls/*"${ref}"*.md 2>/dev/null | head -1 | grep -q . && found=1
    [[ $found -eq 0 ]] && echo "BROKEN_REF: [[${ref}]]"
  done
```

任何 `BROKEN_REF` → **MUST** 修復（更新引用或移除過時 cross-ref）。

### 檢查 B — docs/ 內路徑引用驗證（機械化）

掃 `docs/` 中引用的檔案路徑（backtick 包裹的相對路徑），驗證 target 仍存在：

```bash
grep -rnoE '`[a-zA-Z][a-zA-Z0-9._/-]+\.(md|mjs|ts|mts|sh|json|yml|yaml)`' docs/ --include="*.md" 2>/dev/null \
  | sed -E 's/.*`([^`]+)`.*/\1/' \
  | sort -u \
  | while read fpath; do
    # 嘗試以 repo root 解析
    [[ -f "$fpath" ]] || echo "STALE_PATH: $fpath"
  done
```

`STALE_PATH` → 修正路徑（檔案已搬/改名）或移除引用。

### 檢查 C — Pitfall 覆蓋對齊（diff 含 bug fix 時）

若 diff 觸及了某 pitfall 的 `prevention.ref` 指向的檔案：

```bash
for pit in docs/pitfalls/*.md; do
  refs=$(grep -A1 'ref:' "$pit" 2>/dev/null | grep -v '^--$' | sed -E 's/.*ref: *"?([^"]+)"?.*/\1/' | head -5)
  for r in $refs; do
    base=$(echo "$r" | sed 's/#.*//')
    if echo "$DIFF_FILES" | grep -qF "$base"; then
      echo "PITFALL_TOUCH: $(basename $pit) ref=$base — 檢查 prevention.status 是否需更新"
    fi
  done
done
```

命中 `PITFALL_TOUCH` → **MUST** 讀該 pitfall 的 `prevention:` 段，確認 status 是否因本次修改需更新（`open` → `implemented`、或 `implemented` 但行為已改需補 regression-evidence）。

### 檢查 D — 受眾文件忠實度（review-level，非機械化）

**適用場景**：diff 觸及業務碼（`server/api/`、`app/components/`、`app/pages/`、`composables/`）、或新增 rules/snippets、或 docs/ 本身有大範圍改動。

**三方受眾檢查清單**（主線自行 review，不開 subagent）：

| 受眾 | docs 位置（典型） | 檢查項 |
| --- | --- | --- |
| **非技術人員**（客戶 / PM） | `docs/user-guide/`、`docs/business/`、VitePress 首頁 hero | 新功能是否有使用說明？既有說明是否因 UI/流程變更過時？截圖是否對齊當前版本？ |
| **開發者** | `docs/solutions/`、`docs/decisions/`、`docs/guides/`、`docs/modules/`、`docs/dev-guide.md` | API 改動 → 對應 solution/guide 是否更新？新模組 → 有沒有 module doc？架構決策 → decision record 是否需更新？ |
| **維運者** | `docs/operations/`、`docs/ops/`、`docs/runbooks/` | config/env 變更 → runbook 是否更新？deploy 流程變更 → ops doc 是否對齊？新 migration → rollback SOP 是否存在？ |

**VitePress 場景額外檢查**：若專案有 `docs/.vitepress/config.{ts,mts}`，新增的 docs/*.md MUST 已加入 sidebar config；被刪/搬移的 page MUST 已從 sidebar/nav 移除。

**執行方式**：主線列出 diff 涉及的受眾面向 → 逐條對 docs/ 檢查 → 有缺失就當場補、修路徑、更新內容。

### 修復 loop

檢查 A/B 的 `BROKEN_REF` / `STALE_PATH` → 修 → 重跑驗證 → 直到 0 issues。
檢查 C 的 `PITFALL_TOUCH` → 更新 status/evidence → 不需重跑（人工判斷）。
檢查 D 的受眾缺口 → 補 doc → format（`pnpm format`）→ 確認。

通過後輸出 `✅ 0-D 通過（doc alignment: N ref OK, M path OK, pitfall K/K 對齊{, 受眾文件已補齊}）`。

### 紀律禁止項

- **NEVER** 跳過檢查 A/B 的機械化驗證（「只改了一行 docs 不用掃」不成立 — 一行改動可能 break 交叉引用）
- **NEVER** 把檢查 D 當「可選建議」而不修 — diff 觸及業務碼卻不更新對應 docs = 下一個接手者看到的文件不忠實

---

## § 0-E: evlog map 覆蓋率 Gate（條件觸發、主線 foreground）

CI 的 `evlog-map-gate` action 是最後一道；0-E 是第一道。差別在成本：commit 當下補一行 `log.set` 是 5 秒，push 後被 CI 擋是一輪來回。

### 觸發條件

本次 diff（tracked modified + untracked 新增）含**任一** entry point 檔案：

```bash
git status --porcelain | awk '{print $NF}' | grep -E \
  '(server/(api|routes|middleware|tasks)/|app/pages/|pages/|app/.*/route\.ts$|app/.*/page\.tsx$|middleware\.ts$)'
```

無命中 → 0-E 未觸發，在完成報告標明「未觸發＋原因」。

### Step 1 — 專案是否採用 evlog

```bash
node -e "const p=require('./package.json');const d={...p.dependencies,...p.devDependencies};console.log(d.evlog?'has-evlog':'no-evlog')"
```

`no-evlog` → 0-E **N/A**（evlog map 只量 evlog 插樁，沒裝 evlog 的專案不適用）。標明 N/A 後跳過。

### Step 1.5 — 這個 repo 的佈局掃得到嗎（先於必裝判定）

```bash
npx evlog map --no-write --json 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).map.routes.length?'scannable':'zero-routes')}catch{console.log('no-cli')}})"
```

`no-cli`（CLI 還沒裝，量不出來）→ 往下走 Step 2 的必裝判定。

`scannable` → 往下走 Step 2、Step 3。

`zero-routes` → **不是滿分，是什麼都沒掃到**。CLI 這時會回報 score 100，那個 100 是假的。**MUST block commit**，除非 repo 內有有效的明文放行單（Step 3 的 gate 會自己判定，見下）。

**Nuxt layer monorepo 的正解**（<consumer-a> 型：各 layer 有 `nuxt.config.ts` + `server/api/`，但沒有 `package.json`）—— `@evlog/cli` 靠 `package.json` 定位 project root，補上去就掃得到：

```bash
# 1. 每個 layer 補一份 private package.json
cat > packages/<layer>/package.json <<'JSON'
{ "name": "@<scope>/<layer>", "version": "0.0.0", "private": true }
JSON

# 2. 在 pnpm-workspace.yaml 明確排除，維持 install 拓撲不變
#    packages:
#      - 'packages/*'
#      - '!packages/<layer>'

# 3. 驗證 workspace 拓撲沒變（數量 MUST 與補之前相同）
pnpm -r list --depth -1

# 4. 逐 layer 產 baseline，gate 用可重複的 --cwd 一次掃完
npx evlog map --cwd packages/<layer>
```

**NEVER** 只補 `package.json` 而不加 workspace 排除 —— `packages/*` 這類 glob 會把它們變成真的 workspace package，install 拓撲與依賴解析都會改變。

### Step 2 — `@evlog/cli` 必裝（比照 0-C 的 doctor）

```bash
node -e "const p=require('./package.json');const d={...p.dependencies,...p.devDependencies};console.log(d['@evlog/cli']?'has-map-cli':'no-map-cli')"
```

`no-map-cli` → **MUST block commit**，印出安裝指引後中止：

```text
⛔ 0-E 失敗 — @evlog/cli 未安裝

evlog map 是 commit 品質閘門的必要組件（entry point 觀測性覆蓋率：wide-event、context、
structured-errors、audit、error-handling 五類 check）。本次 diff 動到 entry point，
但沒有工具能判斷這些 handler 出事時說不說得出原因。

安裝步驟：
  1. pnpm add -D @evlog/cli
  2. 產生 baseline 並 commit：
       npx evlog map            # 寫出 evlog.map.json
       git add evlog.map.json
  3. 安裝完成後重跑 /commit

詳見 .claude/rules/evlog-adoption.md § Coverage 維度（evlog map）
     與 ~/offline/clade/vendor/snippets/evlog-map/README.md
```

隨後 **MUST** 釋放 commit-lock（依 [runtime-lifecycle.md](runtime-lifecycle.md)「背景工作與退出」，帶原 tuple 與 owner token）並 STOP。**NEVER** 跳過此 gate 繼續跑後續步驟。

### Step 3 — 跑 gate（預設 strict）

```bash
# MUST mktemp 唯一路徑——固定路徑是全機器所有 consumer 共用，多 session 會互相覆寫
CHANGED="$(mktemp -t evlog-map-changed.XXXXXXXXXX)"
git status --porcelain | awk '{print $NF}' > "$CHANGED"
node .github/actions/evlog-map-gate/gate.ts \
  --baseline evlog.map.json \
  --changed-files "$CHANGED" \
  --mode min-score

# layer monorepo：--cwd 可重複，每個 layer 各自帶 <layer>/evlog.map.json baseline
node .github/actions/evlog-map-gate/gate.ts \
  --cwd packages/core --cwd packages/ehr --cwd packages/trac \
  --changed-files "$CHANGED"
```

**strict（預設）兩條判定**，任一違反即 exit 1：**整個 repo 的每一個 entry point 零失敗 check**、**零 suppression**。判定不看全域整數分——那個數字被 `Math.round` 與 suppression 稀釋，不能當 boolean。

`--mode ratchet` 是過渡選項（全域分不得低於 baseline、本次 diff 觸及的 entry point 必須滿分、suppressed 不得增加），**只在該 repo 已登記推向 strict 的 TD 時**才可暫時使用。

另有一條 false-green 硬擋：掃出 0 個 entry point 直接 fail。**唯一出路**是 repo 根的 `evlog.map.waiver.json`，四個欄位（`reason` / `tracking` / `approved_by` / `expires`）全部必填、`expires` 過期即自動恢復硬擋。缺檔、缺欄位、日期格式錯、已過期一律擋。格式見 `vendor/snippets/evlog-map/monorepo-layers.md`。

### Step 4 — 修復 loop

gate 紅燈時，對它列出的**每一個** entry point 逐個處理，二選一：

1. **補插樁**（預設）：`npx evlog map <該檔路徑> --no-write` 拿單點報告（**MUST** 帶 `--no-write`，不帶會改寫 tracked 的 `evlog.map.json`），照 `Suggested shape` 補 `useLogger(event)` + `log.set({...})`；`structured-errors` 失敗就給 `createError` 補 `why` / `fix`
2. **登記豁免**（例外）：留 `// evlog-map-disable-next-line <check> — <理由>`，理由 MUST 寫「為什麼這個 entry point 不可插樁」，不是「趕著 commit」

修完重跑 Step 3 直到綠燈，然後更新 baseline 並納入本次 commit：

```bash
npx evlog map              # 重寫 evlog.map.json
git add evlog.map.json
```

### 紀律禁止項

- **NEVER** 用 `// evlog-map-disable-next-line` 讓 gate 轉綠而不寫理由 —— disable 是登記豁免，不是過 gate 的手段；gate 的第三條判定就是為了擋這個
- **NEVER** 以「這個 gap 是既有的、非本次 diff 引入」跳過 —— strict 判定看的是**整個 repo**，既有 gap 同樣要補。「不是我引入的」不是出路
- **NEVER** 為了讓 commit 過去而把 `--mode` 降回 `ratchet` —— 降級是 repo 級決策，MUST 先登記 TD 並讓 user 拍板，不是單次 commit 的逃生門
- **NEVER** 手改 `evlog.map.json` 讓分數對得上 —— baseline MUST 由 `npx evlog map` 重新產生
- **NEVER** 把 `zero-routes` 報成「0-E 通過」或「覆蓋率 100」—— 它的語義是**量不到**。放行單放行時完成報告 MUST 寫「0-E 已放行（掃不到，追蹤：<tracking>）」，**NEVER** 寫成 ✅
- **NEVER** 為了讓 commit 過去而現寫一張放行單 —— 放行單是「這個佈局技術上量不到」的登記，不是「這次趕時間」的出口。Nuxt layer monorepo 已有正解（Step 1.5），先照做

通過後輸出 `✅ 0-E 通過（evlog map strict：N 個 entry point 全數零失敗、零 suppression）`。

## § 0-F: 最佳實踐交叉比對（條件觸發、主線 foreground）

clade 在 `registry/conventions.json` 登記了一批最佳實踐，`vendor/snippets/` 有對應 cookbook（數量由 bp-scan 實跑輸出，本檔不 inline）。0-F 問的是「這次新增的東西，是不是既有資產已經涵蓋 / 該不該登記進去」——不問就會出現「登記了一大堆，實作還是各做各的」。

### 觸發條件

diff 觸及下列**任一**（全不成立 → 輸出 `⏭️ 0-F 跳過（diff 無新資產）`）：

1. 新增 `vendor/snippets/<topic>/` 目錄
2. 新增 `scripts/*audit*.mjs` / `vendor/scripts/*audit*.mjs`
3. 新增 `plugins/*/skills/<name>/SKILL.md`
4. 新增 `rules/core/**` / `rules/modules/**`

```bash
node "${CLADE_HOME:-$HOME/offline/clade}/scripts/bp-scan.ts" --changed-only
```

### 判讀（兩類可靠度不同，NEVER 混為一談）

| 類別 | 可靠度 | 處理 |
| --- | --- | --- |
| **A 類**（新資產沒接上管道） | 機械精確、無偽陽性 | commit 前補掉。三種缺口各有明確修法，script 輸出已寫在每條後面 |
| **B 類**（主題詞命中的既有 convention） | **有偽陽性** | 人工看一眼「這條是不是已經涵蓋我要做的事」。是 → 改用既有的；不是 → 忽略 |

A 類的三種缺口：snippet 無入向 pointer、新 audit 未登記 `registry/audits.json`、新 skill 缺 `evals/skills/<name>/cases.json`（EDD）。

### 反過來的情況：這次做的東西**該**被登記

script 抓不到「這是一條新的最佳實踐」——那是語意判斷。若本次改動確立了一條之後每個專案都該照做的做法，走 `/bp` 登記，**NEVER** 讓它只活在這次 commit 的 diff 裡。

- **NEVER** 把 B 類命中講成「確定重複」再據此砍掉自己的改動 —— 它是詞彙比對，不是語意重複偵測
- **NEVER** 為了消 A 類的 snippet 警告補一條沒人會走到的假 pointer；真正的選項是補真 pointer 或刪掉該 snippet

0-F 是 **advisory**：`bp-scan.ts` 永遠 exit 0，不擋 commit。A 類有命中卻選擇不處理時，完成報告 MUST 寫明哪一條、為什麼。

通過後輸出 `✅ 0-F 通過（A 類 N 條已處理／B 類 M 條已判讀）`。


## Claude commit operations

每次先核對本入口實際 catalog，以下是 Claude Code 的操作映射，不外推 Claude Web／Desktop 已有相同工具。

- Simplify：有 `Skill` 且技能已安裝時直接呼叫 `simplify`；其內部委派照當前 routing。結果回來後立即繼續 ceremony。
- Review：符合共用資格的 CLI runner 由 Bash 執行；工具實際支持 `run_in_background` 才帶此參數。保存返回 task id；以對應 TaskOutput／完成通知收回同一工作，核對 terminal exit 與完整輸出。使用 Agent 時從本次 catalog 取真實名稱與 model 值，以不帶 maker history 的 fresh context 派遣。
- Watch：有 ScheduleWakeup 才使用目前已安裝 keepalive 契約；喚醒只處理該 id 的控制面，不重播 review 命令。沒有喚醒 API 時用已有背景 handle 的 bounded wait。Timeout 不取消工作、不代表 PASS。
- UI：`screenshot-review` 只有在實際可用且符合 review-policy 的視覺資格時派遣，附完整 item、截圖及互動證據；不是有同名檔就算能看圖。
- 協調／詢問：有已授權的具名 agent 通道時先協調；需要使用者資訊時用本入口實際可用的詢問工具或直接對話。AskUserQuestion 不是授權的唯一載體，既有同範圍回答不重問。
- Exit：先收回或安全停止本次會寫入的背景工作，再依 runtime-lifecycle 以原 work/runtime/session/token 釋放鎖。完成事件缺席時保留 gate 未完成與具體 handle，不宣稱已退出。

每次 receipt 記實際 runtime、model 與隔離方式；本段不把 Claude 主線視為固定模型，也不代替共用跨模型判定。
