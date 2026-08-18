<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Commit Quality Gates — Reference

> 本檔是 commit skill 品質閘門的完整執行細節。主檔（SKILL.md）含流程概覽與 pointer；觸發特定 gate 時 MUST 先完整讀本檔對應 § 再繼續。

## § 0-Coord: Cross-Session Staged Pollution Detection

`commit-lock` 只擋同時兩個 `/commit`；**不**擋「commit 跑時別 session 在跑 publish / propagate / wt-helper add / rescue-consumer」造成 staged 區意外污染（已實證 3 條 incident，見 `docs/pitfalls/2026-05-{14,18,22}-*.md`）。Step 0-Coord 跑 3 個 detection signal **warn-only**，命中再用 `AskUserQuestion` 讓 user 決定等候還是強制繼續。

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

**解讀**：`AGE < 60` → 別 session 大機率仍活著正在 staging；`AGE >= 60` → stale lock（崩潰殘留，建議手動 `rm "$LOCK"` 但不在 Step 0-Coord 處理，留給 user 自決）。

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

接著用 **AskUserQuestion** 二擇一：

- **選項 A**：`label: "等候重試"`, `description: "退出 /commit，等 60 秒後重跑（推薦：避開 staged 污染風險）"`
- **選項 B**：`label: "強制繼續"`, `description: "接受 staged 污染風險繼續跑 Step 0-Scope（user 確認別 session 已結束時用）"`

選 A → 釋放 commit-lock 後 STOP；選 B → 輸出 `⚠️ 0-Coord 強制繼續（user 接受風險）`，進入 Step 0-Scope。

### 禁止項

- **NEVER** 把 Step 0-Coord 升級為 hard block；偽陽性 / 別 session 剛好結束的場景太多，warn-and-ask 是當前正解
- **NEVER** 嘗試自動 `rm .git/index.lock` 或清掉 sidecar — 那是別 session 的 SoT，誤刪比繼續跑風險更高
- **NEVER** 跳過 AskUserQuestion 自行決定繼續 — 命中時 user 必須親自選 A/B

> 同類 race 也存在於 **ad-hoc commit**（不走本 skill 的單檔 commit、HANDOFF 補一行就 commit、修 typo 就 commit 等）。預防規約見 `rules/core/commit.md` § Ad-hoc commit 必走 `git commit --only -- <paths>`。

---

## § 0-MR: 人工檢查 Gate（main / master 限定，硬擋無 override）

`.claude/rules/commit.trunk-gates.md` 「人工檢查 Gate」hard rule 的執行點（`commit.md` 只有一句 pointer，判定條件的 SoT 在 `commit.trunk-gates.md`）。**MUST** 在 Step 0 品質檢查之前 fail-fast，避免人工檢查未完的 change 浪費 5–15 min codex / screenshot review 時間。

### 判定流程

1. 確認當前 branch：

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   輸出 ∉ {`main`, `master`} → 輸出 `⏭️ 0-MR 跳過（branch=<name>）`，進入 Step 0。

2. 萃取本次 commit 觸及的 spectra change（含 staged + unstaged + untracked，排除 `archive/` 子目錄）：

   ```bash
   { git diff --name-only HEAD; git ls-files --others --exclude-standard; } \
     | grep -oE '^openspec/changes/[^/]+' \
     | grep -v '^openspec/changes/archive$' \
     | sort -u
   ```

   結果為空 → 輸出 `⏭️ 0-MR 跳過（本次變更未觸及任何 in-progress spectra change）`，進入 Step 0。

3. 對每個 change 讀 `<path>/tasks.md`，同時判定「非 `## 人工檢查` 段有 `- [x]`」與「`## 人工檢查` 段有 **leaf** `- [ ]`」（parent `#N` 有 scoped `#N.M` 子項時，parent 由子項 derive，**MUST** leaf-only 計，見 `.claude/rules/manual-review.md` 「Parent State Derivation」段）：

   ```bash
   awk '
     /^## /{ in_mr = (/^## *人工檢查/) ? 1 : 0; next }
     !in_mr && /^- \[x\]/ { has_impl = 1 }
     in_mr && /^- \[[ x]\] #[0-9]+ / {
       pid = $0; sub(/^- \[[ x]\] #/, "", pid); sub(/ .*/, "", pid)
       parent_pending[pid] = (/^- \[ \]/); next
     }
     in_mr && /^  - \[[ x]\] #[0-9]+\.[0-9]+ / {
       pid = $0; sub(/^  - \[[ x]\] #/, "", pid); sub(/\..*/, "", pid)
       has_scoped_child[pid] = 1
       if (/^  - \[ \]/) has_pending_leaf = 1
       next
     }
     END {
       for (p in parent_pending)
         if (parent_pending[p] && !(p in has_scoped_child)) has_pending_leaf = 1
       print (has_impl && has_pending_leaf) ? "BLOCK" : "OK"
     }
   ' "<path>/tasks.md"
   ```

   - `tasks.md` 不存在 → 視為 `OK`（尚未進入實作階段的 change）
   - 輸出 `BLOCK` → 列入 blocker，順便用同樣 leaf-only 邏輯抓出未勾 leaf 數量（同 awk 改 END 累加 `pending_count` 並 print）

4. **blocker list 非空時 → auto-triage（per [[review-gui-surface]] MUST 9）**：

   **MUST NOT** 直接停下叫 user 去 review-gui。改走 auto-triage：逐條讀 pending leaf item 的 annotation，判斷阻塞原因並自行推進 Claude 可處理的項目。

   1. 對每個 blocked change 的每個 pending leaf item，讀 tasks.md 該行判斷：

      | Item 狀態 | 判斷方式 | Claude 動作 |
      | --- | --- | --- |
      | `（fix-requested）` | 行內含 `（fix-requested）` | dispatch `/wt` 修 code → `wt-helper merge-back` → 重拍截圖 → strip `（fix-requested）` + `(claude-analyzed:)` → 更新 `(verified-*:)` annotation |
      | evidence missing | `[verify:ui]` / `[verify:api]` / `[verify:e2e]` 但無對應 `(verified-*:)` annotation | 走 [[agent-self-verification]] fallback chain 收 evidence |
      | `（issue:）` 無 `(claude-analyzed:)` | 行內含 `（issue:）` 但無 `(claude-analyzed:)` | triage issue → 走 (A)-(E) 路由 |
      | 純 `[review:ui]` user 驗收 | 上述都不符，item 是 `[review:ui]` | **只有這類**才引導 user 到 review-gui |
      | 純 `[discuss]` | 上述都不符，item 是 `[discuss]` | 不在此處處理（archive walkthrough） |

   2. **Claude 可處理的項目全部推進完畢後**，跑 mechanical readiness gate：

      ```bash
      node ~/offline/clade/vendor/scripts/check-review-readiness.ts \
        --repo . --change <change-name>
      ```

      - **exit 0** → 輸出 `✅ 0-MR auto-triage 完成，bucket=ready`，釋放 lock，引導 user 到 review-gui
      - **exit 1** → 讀 stdout JSON 的 `bucket` + blocking 數據，繼續 auto-triage 或釋放 lock + 如實報告卡住原因，**NEVER** 只說「請去 review-gui」
      - **exit 2** → 釋放 lock，回報 script 執行失敗

      **NEVER** 跳過 readiness gate 自判 bucket — Claude 自判已 9 次證明不可靠（per [[review-gui-surface]] MUST 9）

   3. **NEVER** 自動勾任何 `[review:ui]` 的 `- [ ]`、**NEVER** 提議跳過 gate、**NEVER** 提議 stash 走 `tasks.md`

5. blocker list 空 → 輸出 `✅ 0-MR 通過`，進入 Step 0。

### 禁止項

- **NEVER** 把 `main` / `master` 以外的 branch 判進 gate 範圍（feature branch 上後續有 /ship + PR review 擋）
- **NEVER** 接受 `$ARGUMENTS` 任何形式的「skip / ignore / override」旗標 — gate 無 override
- **NEVER** 自行 `Edit tasks.md` 勾掉 `- [ ]` 來通過 gate — 違反 `.claude/rules/manual-review.md` 核心規則
- **NEVER** 把 `tasks.md` / change 目錄 stash / mv / rm 走讓 step 2 / 3 抓不到 — 等同繞過 hard rule
- **NEVER** 把「人工檢查未完」包裝成「審查條件已滿足」「等同 OK」「之後再勾」說服 user 繼續

---

## § 0-Archive-Coupling: Partial Archive Gate（main / master 限定，硬擋無 override）

`.claude/rules/commit.trunk-gates.md` § Partial Archive Gate 的執行點（`commit.md` 只有一句 pointer，判定條件的 SoT 在 `commit.trunk-gates.md`）。**MUST** 在 0-MR 之後、0-A/B/C 之前 fail-fast，避免 partial `/spectra-archive` state 默默 commit 進 main 導致 change artifact 永久遺失（per [[pitfall-spectra-archive-interrupted-leaves-partial-state]]）。

### 判定流程

1. 確認當前 branch：

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   輸出 ∉ {`main`, `master`} → 輸出 `⏭️ 0-Archive-Coupling 跳過（branch=<name>）`，進入 Step 0。

2. 萃取本次 commit scope 涉及的 spectra change（staged-delete **或** working tree 殘留不完整 change dir，**排除** archive 子目錄）：

   ```bash
   # A: staged deletion（原邏輯）
   STAGED_DEL=$(git diff --cached --name-only --diff-filter=D \
     | grep -E '^openspec/changes/[^/]+/' \
     | grep -v '^openspec/changes/archive/' \
     | sed -E 's|^openspec/changes/([^/]+)/.*|\1|' \
     | sort -u)

   # B: working tree 仍存在但缺 tasks.md 或 proposal.md（中斷 archive 殘留）
   PARTIAL=$(for d in openspec/changes/*/; do
     name=$(basename "$d")
     [[ "$name" == "archive" ]] && continue
     [[ ! -f "$d/tasks.md" || ! -f "$d/proposal.md" ]] && echo "$name"
   done | sort -u)

   CHANGES=$(echo -e "${STAGED_DEL}\n${PARTIAL}" | sort -u | sed '/^$/d')

   # C: 減掉 parked change。`spectra park` 把 artifacts 從 disk 移進 SQLite blob，所以一個
   #    parked change 的整批檔案都會顯示成 deletion —— 那是 park 的預期副作用，不是 partial
   #    archive 殘骸。不減掉的話 gate 會對它報 MISSING_ARCHIVE_DIR，叫使用者去修一個從來
   #    不存在的 archive（<consumer-a> 2026-07-31 實證：propose 收尾 commit-to-git 後 park，兩張
   #    change 各 7 個檔全被判成殘骸）。
   PARKED=$(pnpm exec spectra list --parked --json 2>/dev/null \
     | sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' | sort -u)
   if [ -n "$PARKED" ]; then
     EXCLUDED=$(comm -12 <(echo "$CHANGES") <(echo "$PARKED"))
     CHANGES=$(comm -23 <(echo "$CHANGES") <(echo "$PARKED"))
     [ -n "$EXCLUDED" ] && echo "⏭️ 0-Archive-Coupling 排除 parked change：$(echo "$EXCLUDED" | tr '\n' ' ')（deletion 是 spectra park 副作用）"
   fi
   ```

   結果為空 → 輸出 `⏭️ 0-Archive-Coupling 跳過（無 spectra change staged-delete 或殘留）`，進入 Step 0。

   > **parked ≠ 殘骸（hard rule）**：本 gate 只抓 partial `/spectra-archive` state。一個 change
   > 同時出現在 deletion 清單與 `spectra list --parked` 時，**MUST** 判為 park 副作用並排除，
   > **NEVER** 對它報 `MISSING_ARCHIVE_DIR` —— parked change 本來就不該有 archive dir。

3. 對每個 change `<X>` 驗證**兩條件**：

   **條件 A — Archive directory 存在**：
   ```bash
   ARCH=$(find openspec/changes/archive -maxdepth 1 -type d -name "*${X}" 2>/dev/null | head -1)
   [ -n "$ARCH" ] && [ -f "$ARCH/tasks.md" ] && [ -f "$ARCH/proposal.md" ]
   ```
   失敗 → blocker `MISSING_ARCHIVE_DIR`，記下 `<X>`。

   **條件 B — Spec delta-sync 完整**（僅對 HEAD 內 `changes/<X>/specs/<cap>/` 存在的 cap 套用）：
   ```bash
   # 注意 trailing / — 沒加會回該目錄本身（一個 entry "specs"），加了才列子目錄
   for cap_path in $(git ls-tree -d --name-only HEAD "openspec/changes/<X>/specs/" 2>/dev/null); do
     cap=$(basename "$cap_path")
     # 該 cap 的 spec.md 在 openspec/specs/ 必須有 staged modification
     if ! git diff --cached --name-only -- "openspec/specs/$cap/spec.md" | grep -q . ; then
       # 例外：若 openspec/specs/$cap/ 不存在於 HEAD（純新 cap），untracked staging 也算（git status --porcelain）
       if ! git status --porcelain "openspec/specs/$cap/spec.md" 2>/dev/null | grep -qE '^A |^M |^\?\?'; then
         echo "BLOCKER: $X cap=$cap spec delta-sync missing"
       fi
     fi
   done
   ```
   任一 cap 失敗 → blocker `MISSING_SPEC_DELTA`，記下 `<X>` + cap list。

   **trailing slash hard rule**：`git ls-tree -d --name-only HEAD <dir-path>` 不加 trailing `/` 時返回該 dir 本身（一個 entry，等同 `ls -ld`）；加 `/` 才會列出子目錄（等同 `ls -d <dir>/*`）。沒加 → `cap_path="openspec/changes/<X>/specs"` → `cap="specs"` → 查 `openspec/specs/specs/spec.md` 永遠 missing → 任何 change 永遠 BLOCK（false positive）。詳見 `docs/pitfalls/2026-05-24-spectra-archive-interrupted-leaves-partial-state.md` § Why slipped past tests。

4. **blocker list 非空時**：

   1. **MUST** 立即釋放 lock：
      ```bash
      node .claude/scripts/commit-lock.mjs release
      ```

   2. 印出 blocker 報告（每條 change 列 `MISSING_ARCHIVE_DIR` / `MISSING_SPEC_DELTA <cap list>`）+ recovery hint：

      ```text
      ⛔ 0-Archive-Coupling 失敗 — partial /spectra-archive state detected

        <X>: MISSING_ARCHIVE_DIR (archive/YYYY-MM-DD-<X>/ 不存在)
        <Y>: MISSING_SPEC_DELTA (caps: burr-removal-workflow, focused-measurement-ui)

      可能成因：
        - /spectra-archive 跑到一半中斷（context out / shell bomb / user 切到別 task）
        - wt-helper merge-back stash 把 spec delta 收進 wt-merge-block/* stash 後沒人 reconcile

      Recovery（對每個失敗 change <X>）：
        DATE=$(date +%Y-%m-%d)
        SRC="openspec/changes/<X>"
        DEST="openspec/changes/archive/${DATE}-<X>"
        mkdir -p "$DEST/specs"
        git ls-tree -d --name-only HEAD "$SRC/specs/" 2>/dev/null \
          | xargs -n1 basename \
          | xargs -I{} mkdir -p "$DEST/specs/{}"
        for f in $(git ls-tree -r --name-only HEAD "$SRC" | sed "s|^$SRC/||"); do
          git show "HEAD:$SRC/$f" > "$DEST/$f"
        done

      若 spec delta 在 stash 內：
        git stash list | grep wt-merge-block
        git stash show 'stash@{N}' --name-only | grep '^openspec/specs/'
        git checkout 'stash@{N}' -- openspec/specs/<cap>/spec.md
        # 確認後 git stash drop 'stash@{N}'

      Recovery 完成後重跑 /commit。
      ```

   3. **NEVER** 自動修補（任何 mkdir / git show / stash extract 操作）— recovery 必須由 user 看完訊息決定（避免主線誤判 partial state、做出錯誤恢復）

5. blocker list 空 → 輸出 `✅ 0-Archive-Coupling 通過`，進入 Step 0。

### 禁止項

- **NEVER** 把 `main` / `master` 以外的 branch 判進 gate 範圍
- **NEVER** 接受 `$ARGUMENTS` skip / ignore / override 旗標
- **NEVER** 自行 `git restore --staged` 把 staged-deletes 退掉「敷衍 gate」— 那會掩蓋 in-flight archive state
- **NEVER** 自行 `mkdir + git show > file` 補建 archive dir — recovery 必由 user 決定（archive dir naming 含日期、是否該補 / partial 是否該 abort 都是判斷題）
- **NEVER** 把缺 archive dir 包裝成「user 早就 archive 過了，只是 archive dir 被別 session 清掉」— 沒 evidence 不要編造解釋
- **NEVER** 把整批 `openspec/changes/<X>/**` staged-deletes 用 `git rm` 重來 — 不解決問題，且會多一輪 staging churn

---

## § 0-A: 程式碼審查（simplify → Codex xhigh → 條件升 Codex max + Fable code-review max）

**審查策略**：

1. 主線先跑 `simplify` skill —— 它看 reuse / 精簡 / 過度設計 / altitude 這條軸，Pi Codex review 不會抓。先處理掉避免後續 codex 重複指出
2. 接著（若 fast-path 不命中）以背景方式跑 Pi Codex review xhigh（GPT-5.6-sol）—— 跨模型抓 bug / 邏輯 / 安全，盲點與 simplify / Claude 主線不同。**啟動後立即進入並行階段（見主檔「0-A/B/C 並行策略」）**，主線同步推進 0-C 並派 0-B subagent
3. 0-A.1 出現 Critical / Major → 進入 0-A.2 兩步驟：先派 Codex GPT-5.6-sol max 深度 review，再由 Fable（`claude-fable-5`）跑 `code-review` agent max，拿著 codex 的回饋做最終決策
4. 修正一律由 Claude Code 主線執行；所有並行軸的 finding 匯合後一次性修正

**模型分工**：

| 步驟 | 模型 | Effort | 職責 |
| --- | --- | --- | --- |
| 0-A.1 | Codex GPT-5.6-sol | xhigh | 跨模型盲點互補，抓 bug / 邏輯 / 安全 |
| 0-A.2 Step 1 | Codex GPT-5.6-sol | max | 深度搜尋所有可能問題 |
| 0-A.2 Step 2 | Fable `claude-fable-5` | max | 拿 Codex finding 做最終裁決 |

### 0-A.0 — simplify（主線，永遠跑、永遠先跑）

對本次 working tree 變更跑 simplify review + 自動修 —— 聚焦 reuse / 精簡 / efficiency / altitude，Pi Codex review 不會抓這條軸。simplify 修完的版本才是下一步 Pi Codex review 應該看的對象。

**執行方式：主線直接 `Skill(simplify)` 序跑**（`skill: "simplify"`）。

- **NEVER** 用 `Agent` 包一層再叫它做 simplify
- **NEVER** 在任何 prompt 裡叫 agent「launch N parallel review agents」之類自行 fan-out —— 四軸分工（Reuse / Simplification / Efficiency / Altitude）是 `simplify` skill 本體的內部實作，由它自己決定，抄出來的副本沒有更新通道

> **本段捨棄了哪一條防護（2026-08-04 TD-362 拍板，pilot 中）**：2026-06-04 起本段曾要求用 foreground `Agent`（`general-purpose`）跑手抄的四軸 prompt，為的是把 simplify 隔離在 subagent context，避免 `Skill(simplify)` 的 inline output 把 commit flow 的 continuation 指令推出 working memory（[[pitfall-commit-simplify-skill-nesting-stalls-flow]]）。
>
> 2026-08-04 反證該隔離**從未達成**（[[pitfall-commit-0a0-nested-fanout]]）：子 agent 完整報告仍以 agent-message 灌回主線（實測 ↓59.1k tokens），同時付出中間層空轉 4m41s、子 agent 互斥建議無仲裁者、prompt 範本與 skill 本體雙 SoT 漂移三項成本。既然包一層擋不住 context 灌入，「移除它會讓停頓回來」的隱含前提（現狀擋住了停頓）不成立——那個風險兩邊共有。
>
> 另一層理由：主線 Step 3 要把 simplify 的修正**分組 commit**，本來就必須知道改了什麼，隔離擋掉的是主線自己需要的東西。
>
> **停頓風險仍在**，由下面兩條防線承接（它們是 2026-06-04 當時不存在的，**NEVER** 隨 Agent-wrapping 一起刪）。pilot 期間若停頓復發，fallback **不是**回到手抄 fan-out prompt，而是 TD-362 登記的 designated fallback（單一 agent 自跑四軸、明文禁再 fan-out）。

主線收到 simplify 結果後：

- **有修正** → 一句話摘要（「simplify 修了 N 處：<列舉>」），deferred items 寫 `HANDOFF.md`（`[simplify]` prefix），**立即** fast-path 判斷
- **無修正** → 輸出 `✅ 0-A.0 完成（simplify 無修正）`，**立即** fast-path 判斷
- **NEVER** 把 simplify 的完整報告原文轉貼給 user —— 那是 context 膨脹 + 停頓的根因輸入端，轉貼等於自己把它二次放大

**Deferred items → HANDOFF（自動，不停住）**：simplify 指出「現在不做但值得做」的改善項 **MUST** 自動寫入 `HANDOFF.md` 的 `Next Steps` 區塊（一行一項，前綴 `[simplify]`），然後**立即繼續** fast-path 判斷。**NEVER** 停住等使用者確認。

**0-A.0 完成 ≠ 停頓點（hard rule）**：`Skill(simplify)` 完成後，主線 **MUST 在同一個 assistant turn 內** 輸出一行摘要 → 判斷 fast-path → 啟動 0-A.1/0-B/0-C。**NEVER** 在 simplify 完成後等 user 回應 — commit 流程是單一連續執行，中間不停。

跑完輸出 `✅ 0-A.0 完成（simplify 已 review + 修正{，N 項 deferred → HANDOFF}）` 後判斷 fast-path：

- **命中** → 輸出 `⏭️ 0-A.1/0-A.2 跳過（fast-path: diff <20 行、限 doc/config、無敏感路徑）`，進入 0-B/0-C 並行
- **不命中** → 進入 0-A.1

### 0-A.1 — Codex GPT-5.6-sol exec review (xhigh)，背景（並行軸 A）

**Watch contract**：背景啟動（`run_in_background: true`）取得 `<task-id>` 後，同一 turn 記錄 owner / deadline 並排 180s（[[agent-routing.codex-watch-protocol]] § ScheduleWakeup 用法守則 的具名例外）canonical `ASYNC_KEEPALIVE_CONTROL task=<task-id> owner=commit:codex-review deadline=<ISO>...` inert control wakeup；控制 turn 只准 `TaskOutput(block=false)`、重排同一訊息或排 lifecycle intervention，**NEVER** 讀 review output、重播 review 指令或做 mutation。實際 findings 只在 terminal notification + task-id claim 後讀取。啟動背景 process 後 MUST 立即進入並行階段，啟動 0-B（條件觸發）與 0-C。

```bash
.claude/scripts/codex-review-safe.sh xhigh
```

> codex-review-safe.sh 先凍結changeset，再呼叫Pi `openai-codex` review runner。Runner只允許`read,grep,find,ls`，沒有bash、write、edit或MCP；prompt injection無法取得mutation tool。這支script只review自家fleet diff，NEVER拿去review不可信第三方code。
>
> **changeset 由 script 自己收集後嵌進 prompt**（TD-320），codex 不再自行跑 `git diff`。兩個要判讀的 stderr 訊號：超出 `CODEX_REVIEW_MAX_DIFF_LINES`（預設 6000 行）的檔案會被整塊剔除並具名，**MUST** 當成該檔未被 review、NEVER 當作它通過；**exit 3** ＝ 收不到任何未提交變更（codex 未被呼叫），照 collection bug 處理，NEVER 當作 0-A.1 通過。

#### exit 4（配額耗盡）→ 換池重跑，NEVER 改派 Claude

**這條與 0-C 的 exit 4 處置相反，NEVER 類比。** 0-C 的 exit 4 可以「主線 foreground 自跑」，因為修 code 誰修都行；0-A.1 不行 —— 這道 gate 的**存在理由**就是不能由主線同池模型自審。實證（2026-08-19）：一個 session 在 0-A.1 撞額度後改派同池同模型的 Claude subagent 當 reviewer，形式上補了位、實質上 gate 是空的；換池後 Cursor 池的 gpt-5.6-sol 立刻多抓到兩條該 Claude reviewer 完全沒看到的 finding。

**現階段沒有安全的換池路徑（TD-520，見下）**，所以 exit 4 的處置是：

1. 主線 foreground 自 review
2. **MUST** 明示「**跨模型 gate 未達成**」—— NEVER 把主線自審講成 0-A.1 通過
3. **MUST** 在 `HANDOFF.md` 登記待補範圍（`git diff <base>..<head>`），配額恢復後補跑

**NEVER 改派 Claude subagent 充當跨模型 review。** 那是同池同模型，gate 實質為空 —— 主線自己 review 至少誠實，派一個同款模型只是把「未達成」偽裝成「達成」。**NEVER 降檔到 luna / haiku**（配額按 model 記，降檔換不到額度，只換到更差的 reviewer）。

> **為什麼不用 Cursor 池換池**：`codex-review-safe.sh` 有 `--pool cursor`，同檔換池在 [[agent-routing]] § 配額耗盡時的 fallback 紀律上是正確形狀。但 TD-520 已確認 cursor 池的模型**以同一 UID 執行且有 unrestricted Shell**，而 review prompt 內嵌的是待審 changeset。事後偵測（worktree snapshot 比對）對這種對手無效 —— baseline 本身就在它可寫的位置。**在拿到 OS 層隔離之前，`--pool cursor` NEVER 用於 0-A.1。** 該旗標保留是為了 default 池的防迴歸與後續隔離方案的接點。

> **cursor 池沒有工具面 enforcement — 已確認，非未決（TD-520）**：pi 的 `--tools read,grep,find,ls` 只是 pi 層 flag，cursor provider 下模型的執行**全部**走 Cursor SDK 原生工具，該 flag 對它們無效。2026-08-19 授權 probe 實測：模型自報可用工具含 `Shell` / `Delete` / `ApplyPatch` / `CallMcpTool` / `WebFetch` / `Subagent`，並**實際寫出了檔案**。三條 enforcement 路徑逐一查證全部不存在（SDK `LocalAgentOptions` 無工具面欄位、`--cursor-mode plan` 是 prompt guidance、`PI_CURSOR_SANDBOX=1` 本環境拒跑）。
>
> `--tools` 唯一還有的作用是**決定哪些原生執行會被回放進 events log**（回放條件 = builtin 七種 ∩ pi active tools）。推論反直覺但重要：**白名單越窄，稽核越盲** —— events log 能證明「有用 X」，永遠不能證明「沒用 Y」。
>
> 因此 `--pool cursor` **NEVER** 用來 review 不可信的第三方 code，也 **NEVER** 用於會接觸 secrets / prod 憑證的 changeset。自家 fleet diff 走這條的殘餘風險由 exit 6 接住其中一類（見下），其餘明列為不覆蓋。

#### exit 5（workspace 綁定不符）→ verdict 作廢

runner 比對 pi session 事件的 cwd 與 `--cwd`，realpath 不符即 exit 5。此時模型的檔案探索打在別的 repo 上，**verdict 作廢、NEVER 當作 0-A.1 通過**，照環境問題排查後重跑。

**缺 session 事件同樣 exit 5**（fail-closed）。這道 guard 的用途是「證明」綁定正確，拿不到證據就是證明不了 —— 放行等於 gate 只在 pi 願意提供證據時才存在，而攻擊面（prompt 內嵌的不可信 changeset）恰恰有動機讓它不提供。真 pi 每次 run 都吐 session 事件，所以這條在正常路徑上不會誤觸。

> 查 events log **MUST 用 runner 自己印的 `pi-codex-review: events log: <path>`**（出現在輸出頂端），**NEVER** 用 `ls -t /tmp/pi-codex-review-*` 撈「最新那個」—— `/tmp` 是全 session 共用、檔名只有 pid+ts，並行 session 下會撈到別人的 run。2026-08-19 就是這樣把另一個 repo 的 review log 誤讀成自己的，得出「跑錯 workspace」的錯誤結論，連帶用那份 log 錯誤地否證了一條真實的 Critical。

#### exit 6（review 期間 working tree 被改動）→ verdict 不可信 + 人工檢視

script 在 runner 前後各拍一次 worktree snapshot（HEAD + 暫存 index 的 `git write-tree` 單一 tree hash——原生涵蓋內容、executable bit、symlink target、binary，純 git 可攜——+ `git status --porcelain=v2`），不一致即 exit 6 並在 stderr 印出 `git diff-tree` 的逐檔明細。runner 的 verdict 先落檔、**通過 after-check 才放行到 stdout**——exit 6 時 verdict 被扣住不輸出，只認 heading / 表格的機械檢查不會誤判通過。baseline 拍在 changeset 收集**之前**（拍在之後的話，收集期間的並行修改會被寫進 baseline，review 過的是一份 stale changeset 而檢查靜默）。snapshot 本身 fail-closed：任一步 git 失敗即 exit 6（unborn HEAD 是合法狀態、不觸發），NEVER 留下「前後同樣殘缺所以比對通過」的假綠。

**write-tree 換法解的是可攜性與覆蓋率，不是安全性。** 它移除了 GNU coreutils 依賴、把 executable bit 與 symlink target 收進覆蓋範圍，但 `git write-tree` 一樣走 PATH 上的 `git` —— 上一段那個「同 UID 對手可劫持度量工具本身」的問題，換 tree hash **一點都沒解**。**NEVER** 把 snapshot 實作的改良讀成安全等級提升；封口的只有 bwrap。

**這是偵測控制，不是安全邊界 —— 對 adversarial injection 它結構性無效，別讓下一個人把它當 sandbox 用。** cursor 池 = 把有 unrestricted Shell 的模型放進呼叫者自己的 UID；同 UID 的對手可以竄改 `$WORK_DIR` baseline、劫持 PATH 上的 `git` 本身，任何 script 內的事後比對都騙得過（0-A.2 review 2026-08-19 定案）。它可靠接住的是**非對抗**的三類：並行 session 在 review 期間的編輯 / commit（實測發生率最高）、模型無惡意的誤寫事故、default 池 pi 層 enforcement 的回歸。它擋不住的包括：蓄意 mutation 後湮滅痕跡、資料外洩（WebFetch / MCP 送出去）、對其他 repo 或 `$HOME` 的破壞、以及**先改再還原**。

事前 enforcement 三條路已查證皆不存在（sdk `LocalAgentOptions` 無工具面欄位、`--cursor-mode plan` 只是 guidance、`PI_CURSOR_SANDBOX=1` 本環境拒跑，TD-520）；**對抗性場景的真修是 OS 層隔離（bwrap，可行性已驗、實作見 TD-520 處置節）**，落地前 cursor 池是明示接受風險的 fallback（script 起跑印 WARNING）。**接受的前提是「只 review 自家 fleet diff、不接觸 secrets / prod 憑證」**——那兩條邊界破了，MUST 改走 default 池或等配額恢復。default 池照跑本檢查（防 pi 層 enforcement 回歸）。

處置：**verdict 不可信、NEVER 當作 0-A.1 通過**。先人工檢視 stderr 的 snapshot diff 定性 —— 可能是 cursor 池被 prompt injection 帶去 mutation（此時被動到的檔 **NEVER 自動還原**，依 [[commit]] WIP 處置禁令交使用者拍板），也可能是並行 session 在 review 期間的正當編輯（此時 verdict 審的不是最終狀態，處置完重跑即可）。

**覆蓋邊界**：只偵測本 repo worktree 的 tracked + untracked 內容。**gitignored 檔（`.env`、`node_modules/` 等）、**/tmp、`$HOME`、其他 repo、MCP / 網路副作用在 cursor 池下**查不到也偵測不到** —— NEVER 把 exit 6 沒觸發講成「cursor 池 review 確認無副作用」。

- **NEVER** 就乾等到 codex 自己結束才看一眼 — 中途卡住（codex auth 過期、context 超量、模型拒答）會白等
- 結束條件：背景 process 結束、輸出含完成標記、或使用者叫停 — 才進入後續判斷

讀完 codex 輸出後依 **codex 自己輸出的 severity 標記**分情境處理（**此時 0-B / 0-C 應已並行完成或在收尾**）：

- **MUST** 檢查輸出含完整 `## Semantic Verdict` 表且覆蓋 patterns.json semantic 全部 id——缺表或缺列＝review 不完整，重跑 0-A.1，NEVER 當作通過
- **無 issue** → 輸出 `✅ 0-A.1 通過（Codex xhigh 無 issue）`，**跳過 0-A.2**，進入「並行匯合」
- **僅 Minor / Info 級 issue** → 主線逐一修完，輸出 `✅ 0-A.1 通過（Codex xhigh 僅 Minor/Info 已修）`，**跳過 0-A.2**，進入「並行匯合」
- **出現 Critical / Major 級 issue** → 主線逐一修完，**MUST** 進入 0-A.2

> **0-A.2 審的是「修正本身」，不是「還沒修的 finding」。** 修完 Critical / Major 之後 0-A.2 **仍然 MUST 跑**——0-A.1 的修法是全新、未經任何跨模型審查的 code，**NEVER** 假設它比原本的版本安全。
>
> | 開脫 | 現實 |
> | --- | --- |
> | 「finding 都修完了，0-A.2 沒東西可看」 | 0-A.2 要看的正是那批修法。修完才是它的輸入齊備，不是它失去對象 |
> | 「修法很小，不值得再跑一輪」 | 引入 regression 的修法通常都很小——大改動反而會被自己重讀 |
>
> 實證（<consumer-a> 2026-07-26）：0-A.1 的修法引入了一條 quota regression，正常使用者累積滿額後永久 429，由 0-A.2 的 Fable 裁決抓到。當時若因「finding 都修完了」跳過 0-A.2，會直接把功能壞掉的版本推上 production。

**Severity 來源**：以 codex 自己輸出的 severity 標記為準（Critical / Major / Minor / Info）。**NEVER** 由主線自行判定降級「這個其實沒那麼嚴重」—— codex 標 Major 就照 Major 處理，否則 0-A.2 條件觸發機制等於形同虛設。

#### finding 的三類分流

codex 看的是 working tree diff，但它讀得到整個 repo，因此會評論到**本次沒改的舊碼**。「一律修」對這類 finding 會把 unrelated fix 帶進本次 commit（違反 § Step 3 的分組紀律）；「不在本次範圍」則是本檔明文禁止的跳過藉口。出路是分流，不是二選一。

**每一個** finding **MUST** 落在下表三類之一，依序判定，第一個命中的為準：

| 可觀察 predicate | 類別 | 處置 |
| --- | --- | --- |
| finding 指涉的 code 出現在本次 diff 的 `+` 行 | **缺失類** | 照 codex 標的 severity 一律修。**位置無關**——修法要動到同檔別處、別的檔、或 diff 外的呼叫端，照修不誤 |
| 問題成立，但 finding 給的 `<file>:<line>` 指到本次 diff 以外（codex 的行號對不上 working tree） | **行號漂移** | 先定位到真正的位置，再照 severity 修。**NEVER** 因為「行號指到沒改的地方」就歸純舊碼 |
| 上兩類都不成立 | **純舊碼** | 不進本次 commit，但 **MUST** 當場登記 + 回報（見下）。**NEVER** silent drop |

判為**純舊碼**的 finding，**MUST** 在給 user 的回報中逐條輸出下列三行，**任一行留白或寫不出來就照 severity 修**：

```
PRE-EXISTING — 未觸碰：<file>:<line>（舉證本次 diff 不含此檔／此行）
               無因果：<本次變更為何不會觸發、加劇、或暴露它——一句話，指具體機制>
               登記：<TD-NNN | HANDOFF.md § …>
```

兩條舉證缺一不可：只證「沒碰到」不夠——本次變更可能讓一條原本走不到的舊路徑變成熱路徑；只證「無因果」也不夠——那是純舊碼判定的結論，不是它的前提。

登記走 `docs/tech-debt.md` 開 TD（跨 session 要追）或 `HANDOFF.md`（下一 session 就會碰），**NEVER** 只在 chat 講一句。「已經跟 user 說了」不算登記——chat 不是 session 之間的傳遞介面。

### 0-A.2 — Codex max + Fable code-review max（兩步驟，條件觸發）

**僅在 0-A.1 出現 Critical / Major 級 issue 時執行**，其他情況一律跳過。

0-A.2 分兩步驟，先用 Codex 深度 review，再用 Fable 拿 Codex 回饋做最終裁決：

**Step 1 — Codex GPT-5.6-sol exec review (max)**：

```bash
.claude/scripts/codex-review-safe.sh max
```

Codex 完成後，**把完整輸出存到變數**（後續餵給 Fable）。

**Verdict-presence check**（TD-246 — 防 context exhaustion 靜默跳過 review）：

Codex max 完成後 **MUST** 檢查輸出是否含 `## Review Verdict` heading。兩條路：

- **含 `## Review Verdict`** → 正常進 Step 2（Fable 裁決）
- **缺 `## Review Verdict`**（context exhaustion / 輸出截斷 / 任何非正常完成）→ **MUST** 向 user 報 warning「⚠ Codex max context exhaustion — 未產出 Review Verdict，fallback to 0-A.1 findings」，然後 **fallback**：跳過 Step 2 的 Codex 輸出，改用 0-A.1 xhigh findings 直接餵 Fable code-review agent 做裁決（prompt 改為「你收到 Codex GPT-5.6-sol (xhigh effort) 對本次 diff 的 review 結果」+ 0-A.1 輸出）。**NEVER** 重跑 `codex-review-safe.sh max`（context exhaustion 大概率重現）、**NEVER** 靜默跳過 0-A.2 當作通過。

**Step 2 — Fable `code-review` agent (max)**：

派 `code-review` agent（`subagent_type: "code-review"`、`model: "fable"`），prompt 包含：

1. 本次 working tree diff（`git diff HEAD` 摘要）
2. **0-A.2 Step 1 Codex 的完整 review 輸出**
3. 明確指示：「你的職責是**裁決**——對 Codex 列出的每個 finding 判定：(a) real issue → 標 severity + 建議修法；(b) false positive → 標 dismissed **並附具體反證**；(c) severity 不準確 → 重標。同時掃一遍 diff 找 Codex 漏掉的問題。輸出格式照 code-review agent 標準報告。」

Agent prompt 範本：

```
你收到 Codex GPT-5.6-sol (max effort) 對本次 working tree diff 的 review 結果。你的職責是做最終裁決。

## Codex Review 結果

<貼入 Codex Step 1 完整輸出>

## 你的任務

1. 對 Codex 列出的**每一個** finding 逐一判定：
   - real issue → 保留，確認或重標 severity（Critical/Major/Minor/Info），給具體修法建議
   - false positive → 標 `DISMISSED`，**MUST** 照下列格式輸出，`反證：` 欄不得留白：

     ```
     DISMISSED — 反證：<file>:<line> ／ <契約或規則條文的具體出處>
     說明：<一句話>
     ```

   - severity 不準確 → 重標並說明
2. **反證立不出來就不是 DISMISSED**：查證之後仍無法指出具體反證位置的 finding，**一律保留為 real issue**。你有完整 repo 讀取權，「判不出來」是查證還沒做完的訊號，不是終局狀態——先去讀 code、追呼叫端、必要時跑 test，讀完仍立不出反證就保留。
3. 獨立掃一遍 diff，找 Codex 漏掉的問題（Codex 跨模型盲點互補是你存在的原因）
4. 輸出標準 code-review 報告格式（含 Semantic Verdict 表）

對 real issue 不做修正——只判定 + 建議修法，修正由主線執行。
```

> **為什麼 dismiss 要舉證，而不是「判不出就放行」**：「無法確認為錯就放行」是給**只看得到 diff** 的裁決者的規則——那種裁決者對 repo 無知，放行是它誠實的預設。Fable 有完整 repo 讀取權，同一句話套到它身上就變成偷懶的授權。0-A 是 recall-first 設計，§ 0-A.1 的「NEVER 由主線自行降級 severity」是同一條軸的另一端：主線那邊已經堵住降級，裁決層這邊若沒有舉證門檻，洞只是從主線移到 Fable 身上。

讀完 Fable 輸出後，**先驗收 DISMISSED 的舉證，再判斷通過與否**：

**舉證驗收**：對 Fable 標 `DISMISSED` 的**每一條** finding，檢查它有沒有附具體反證（`<file>:<line>` 的 code、契約、或文件/規則條文）。**沒附反證的 DISMISSED 一律視同 real issue 處理**，照 Codex 原本標的 severity 走——**NEVER** 因為「Fable 是 max effort，它說 dismiss 應該有它的道理」就放行。裁決者省略舉證跟主線自行降級 severity 是同一種失效，`gates.md` § 0-A.1 已禁止後者。

驗收完才判斷：

- **無 real issue**（全部 dismissed **且逐條附反證**，或無新發現）→ 輸出 `✅ 0-A.2 通過（Codex max + Fable max 無 real issue）`，進入「並行匯合」
- **有 real issue** → 主線依 Fable 的裁決逐一修正，修完**直接進入「並行匯合」**（最多到 0-A.2，不做第 3 輪）

**為什麼兩步驟**：Codex（GPT-5.6-sol）和 Fable（claude-fable-5）模型盲點不同。Codex max 負責深度搜尋——用最高推理深度翻出所有可能問題；Fable max 負責裁決——以不同模型族的視角判定哪些是 real issue，過濾 false positive，並找 Codex 漏掉的問題。這比同一模型跑兩輪更有效。

### 0-A/B/C/D 並行匯合（收口檢查）

三軸完成後合併狀態檢查 + 條件觸發 0-D：

1. 0-A（Codex xhigh，or 條件升 Codex max + Fable code-review max，or fast-path skipped）：通過
2. 0-B（screenshot review）：通過或跳過
3. 0-C（pnpm check + pnpm test + pnpm run doctor）：全綠
4. 0-D（doc alignment）：通過或跳過

**0-D 執行時機**：三軸匯合後、大改動回扣之前。0-D 條件觸發（見下方 § 0-D），觸發時在主線 foreground 跑，修完再評估大改動回扣。

**大改動回扣**：若 0-A / 0-B / 0-C / 0-D 累計的修正**超過 50 行或跨 5 檔以上**，**MUST** 在此處重跑一次 `codex-review-safe.sh xhigh` 確認新引入的程式碼也過 codex 眼睛（codex 看的是啟動時 snapshot，後續大改動不在它覆蓋範圍）。小改動（< 50 行 / < 5 檔）視同安全跳過。

完成匯合後 **MUST** 用 metrics recorder 產生匯合行，**NEVER** 自己手打那行：

```bash
node .claude/scripts/0a-metrics.mjs record \
  --diff-lines <本次 diff 總行數> --diff-files <檔數> \
  --codex <xhigh|xhigh+max+fable|fast-path-skip> \
  --critical N --major N --minor N --info N \
  --a2 <true|false> --dismissed N --dismissed-unsubstantiated N \
  --screenshot <pass|skip> --doc <aligned|skip> \
  [--anomaly <td246-fallback|verdict-missing|large-change-rerun>]
```

它落一筆進 `.clade/0a-metrics.jsonl`（gitignored 的本地 telemetry）並印出匯合行：

```text
✅ 0-A/B/C/D 並行匯合通過（Codex xhigh、screenshot skip、check 全綠、doc skip）
```

**匯合行只能由本 script 產出**是刻意的結構耦合——漏跑就沒有那行輸出，比規約寫「MUST 記錄」更難靜默漏掉。

- `--dismissed-unsubstantiated` 填 § 0-A.2「舉證驗收」翻回 real issue 的條數（沒有就填 0）
- script 對流程矛盾會 exit 2 擋下（如 critical/major 非 0 卻 `--a2 false`）。那代表 0-A.2 該跑沒跑，**NEVER** 改參數繞過——回去補跑 0-A.2
- 累積後 `node .claude/scripts/0a-metrics.mjs summary` 看分佈。**這是 0-A 唯一的閾值調參依據**：fast-path 三條件、「大改動回扣」的 50 行／5 檔、pre-flight 規模 gate 要不要升 hard gate，都等這份分佈說話，NEVER 憑單次觀感調

**紀律禁止項**（每條皆對應壓力下違規模式或已知 rationalization）：

- **NEVER** 跳過 0-A.0（simplify 是常駐第一步，不視變更大小例外）
- **NEVER** 改用其他模型（Codex 必須 `gpt-5.6-sol`、Fable 必須 `claude-fable-5`）
- **NEVER** 把 codex 列出的問題判定為「建議性質」而跳過 —— 一律修
- **NEVER** 用「不在本次範圍」跳過 finding —— 該判定只有走 § 0-A.1「finding 的三類分流」判為**純舊碼**、且三行舉證逐行寫齊才成立；缺任一行照 severity 修
- **NEVER** 在 fast-path 條件未完全滿足時提早跳過 codex —— 三條件 AND，任一不滿足都跑
- **NEVER** 做第 3 輪 review（會無限拖長 commit 流程；0-A.1 + 0-A.2 兩輪處理不完代表變更太大，應先 split）
- **NEVER** 因 0-A.1 抓到 Critical/Major 後跳過 0-A.2 —— 一律進入 Codex max + Fable max 驗證
- **NEVER** 用主線自判把 codex 標的 Major / Critical 降級成 Minor 來跳過 0-A.2 —— severity 以 codex 輸出為準
- **NEVER** 跳過 0-A.2 的 Fable 步驟只跑 Codex max —— 兩步驟綁定，缺 Fable 裁決 = 0-A.2 未完成

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

**Dispatch 方式**：主線直派 Pi `--model grok-xai --effort low`（`--route routing-table --tier-basis table-row --table-row screenshot-review-verify`），指令與 brief 素材見 [[review-screenshot]] § 派遣方式。**NEVER** 用 `Agent` tool with `subagent_type: screenshot-review`——per `agent-routing.md` Routing Table 該列，四個模式（含 0-B）一律直派；wrapper 只在 dispatcher exit 3 後才開。exit 4 走 `--model grok-cursor` 同 effort 重派，**NEVER** 當機械故障。

**並行啟動**：觸發時 MUST 在 0-A.1 codex 背景 process 啟動的**同一個 assistant 回合**內送出 0-B dispatch —— **NEVER** 等 0-A.1 跑完才派（會浪費 3–5 min 的並行收益）。0-B 跑完回收 finding，與 0-A.1 / 0-C 的 finding 一起匯合修正。

問題修正後輸出 `✅ 0-B 通過`；不觸發則直接輸出 `⏭️ 0-B 跳過（無 UI 變更）`。

---

## § 0-C: CI 等效檢查（Fix-Verify Loop、並行軸 C）

**並行啟動**：MUST 在 0-A.1 codex 背景 process 啟動的**同一個 assistant 回合**內，主線 foreground 開跑 `pnpm check` —— 跟 codex 並行不阻塞。0-C 完成（含 fix loop 通過）後再 poll 0-A.1 與回收 0-B dispatch。

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

隨後 **MUST** 釋放 commit-lock（`node .claude/scripts/commit-lock.mjs release`）並 STOP。**NEVER** 跳過此 gate 繼續跑後續步驟。

若輸出 `has-doctor`，**必須**額外跑（**MUST** `pnpm run doctor`，**NEVER** 裸打 `pnpm doctor` — `doctor` 撞 pnpm 內建子命令，裸打跑的是 pnpm 自家 doctor 並 silent exit 0，`scripts.doctor` 的 vite-doctor scan 永遠不執行）：

```bash
pnpm run doctor
```

Doctor health score < 100 或 exit code ≠ 0 → **MUST block commit**，修復後重跑直到 health score 100/100 + 0 warnings + exit 0。**即使 warning 是既有、非本次 diff 引入**也必須修——每次 /commit 順手把既有 doctor warning 修掉，保持零警告 baseline。典型修法：移除 dead imports、修正 re-export 路徑、打斷 import cycles、套用 `readValidatedBody` 取代 raw body read。**NEVER** 以「非我引入」「既有 debt」為由跳過 doctor warning — 0-C gate 不區分新舊，一律全綠。

> **oxfmt batched false-positive**（vite-plus 0.1.21 已知 bug）：第一次 `pnpm format:check` 紅但 single-file `vp fmt --check <path>` 通過，是 batched bug 不是 format issue — **先**跑一次 `pnpm format`（vp fmt --write）再重跑 check 通常就過。**NEVER** 動 `.oxfmtignore` 或 LOCKED projection（`.claude/rules/` / `AGENTS.md` / `CLAUDE.md` / spectra change markdown）試圖讓 oxfmt 滿意 — 那是 governance violation。clade 中央倉 release flow 已在 `scripts/publish.ts` 主流程加 stable fmt pre-stage（兩輪 `vp fmt --write` + `vp fmt --check`），consumer 端 commit 流程不需再背 workaround SOP。詳見 `docs/pitfalls/2026-05-18-oxfmt-batched-check-false-positive.md`。

失敗時進入 loop：修復 → `pnpm format`（裸打 `vp fmt` 必須加 `--ignore-path .oxfmtignore`） → 重跑上述步驟 → 直到全綠。loop 的執行者依下方「fix loop 的 codex offload」規則決定（**預設背景 codex**；例外才主線直修）。

**Fix loop 的 codex offload（預設派背景 codex，主線不留在 foreground 修）**：

0-C 檢查發現失敗需要修補時，**預設**派背景 codex 跑 fix-verify loop，主線同回合繼續既有並行收尾（poll 軸 A、回收軸 B）— 三軸並行結構不變，軸 C 只是從「主線 foreground 修」換成「codex 背景修」：

```bash
node ~/offline/clade/vendor/scripts/codex-dispatch.ts \
  --template ~/offline/clade/vendor/snippets/codex-offload/templates/fix-verify-loop.template.md \
  --var <key>=<value> ...（依 template 變數表填：check 命令、失敗摘要 / log 等） \
  --label commit-0c-<slug> --model sol --effort high \
  --route routing-table --tier-basis table-row --table-row commit-0c-fix-verify
```

（`--route` / `--tier-basis` / `--table-row` 皆必填，缺就 exit 1。0-C fix-verify loop 是 Routing Table
明列的一列，故 `--route routing-table`；該列已列明 `sol high`，照列派 → `--tier-basis table-row`
＋ `--table-row commit-0c-fix-verify`（dispatcher 拿該列列明的 sol 交叉檢查 `--model`）。
同一輪要再修一次時帶 `--retry-of commit-0c-<前一個 slug>`，**NEVER** 改用 `<slug>2` 表達重試。）

（背景跑、stdout 單一 JSON；exit 0=全綠 / 2=修不到全綠（業務 fail）/ 3=機械故障 / 4=quota。exit 3 → 機械故障，主線 fallback foreground 自跑 fix loop；exit 4 → 配額擋，本列是 sol，依 [[agent-routing]] § 配額耗盡時的 fallback 紀律先走 `--model sol-cursor` 同 effort 重派（`-cursor` 變體的適用邊界受 TD-520 限制：**NEVER** 用於不可信第三方 code 或會接觸 secrets／prod 憑證的內容；0-A.1 review gate 已明文排除，見 `commit/gates.md` § 0-A.1），**NEVER** 當成機械故障；exit 2 → 失敗摘要回主線判斷，**不**重派同一 brief。）

**4.8-aware 範圍明寫**：**每一輪** 0-C 失敗都先做 dispatch 評估（含匯合修正 / 大改動回扣後重跑 0-C 又紅的輪次），不是只有第一輪。

**例外（主線直修，不派）**：

1. trivial 單點修 — 單檔 ≤5 行、typo / import 級
2. 失敗根因明顯涉及本次 commit 的設計判斷（修法本身要決策）— codex 只能猜，主線自修

**codex 完工後主線 MUST**：

1. 重跑 `pnpm check`（+ 條件觸發的 `pnpm test` / `pnpm run doctor`）確認全綠 — **不信 codex 自報**
2. `git diff` 確認 codex 改動 scope 只在修錯相關檔；scope 外 substantive change → revert 該段改動 + 主線自修（注意 working tree 含本次 commit 的 uncommitted 變更，**NEVER** `git checkout HEAD -- <file>` 整檔回退 — 會把本次 commit 的原始變更一起砍掉；用 Edit 撤掉 codex 引入的段落即可）

**禁止**用 `npx vitest run` / `npx eslint` 等個別工具替代 `pnpm check` / `pnpm test` / `pnpm run doctor`。若 `.claude/worktrees/` 干擾結果，先清理再跑。

通過後輸出 `✅ 0-C 通過（format/lint/typecheck/test/doctor 全綠）`。

---

## § 0-D: Doc Alignment 檢查（條件觸發、主線 foreground）

本次 diff 觸及的變更若涉及 docs/ 相關面向，**MUST** 在 0-C 完成後跑 doc alignment 檢查。0-D 不阻塞 0-A/0-B/0-C 並行（在三軸匯合後跑）。

### 觸發條件

以下**任一**成立即觸發（全不成立 → 輸出 `⏭️ 0-D 跳過（diff 無 doc-relevant 變更）`，進入匯合）：

1. diff 觸及 `docs/**` 本身
2. diff 觸及 `rules/core/**` / `rules/modules/**` / `vendor/snippets/**`（標準層有變 → docs 可能需同步）
3. diff 觸及 `scripts/*-audit.mjs`（audit signal 變更 → `docs/rule-enforcement-matrix.md` 或 `docs/dev-guide.md` 可能需更新）
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

隨後 **MUST** 釋放 commit-lock（`node .claude/scripts/commit-lock.mjs release`）並 STOP。**NEVER** 跳過此 gate 繼續跑後續步驟。

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

clade 有 13 條登記在 `registry/conventions.json` 的最佳實踐、58 個 cookbook。0-F 問的是「這次新增的東西，是不是既有資產已經涵蓋 / 該不該登記進去」——不問就會出現「登記了一大堆，實作還是各做各的」。

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
