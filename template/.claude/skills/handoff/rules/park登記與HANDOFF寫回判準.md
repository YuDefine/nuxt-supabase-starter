<!-- 跨檔的「下方／上方 §」皆指 rules/ 下同名段落 -->

## park — 只做交接寫入

**進入條件（MUST 先驗）**：user 顯式打了 `/handoff park`，或裸 `/handoff` 已依 Step 1 § park gate 取得 user 允許。兩者皆非 → **NEVER 開始寫入**，回 Step 1 § park gate 先問。

只做以下，不做 reorganize、不做下一步推薦：

1. **盤點當前 session 未完項**（**只**從 per-session 來源蒐集）：
   - 當前對話與已載入 task carrier 記錄取當前 session 所有未 completed task
   - 當前 chat 對話脈絡（我剛在做、user 剛交辦但沒做完的工作）

   **NEVER** 把以下當「當前 session 未完項」（這些屬於別 session 或檔案系統狀態，不是當前 chat 在做的事）：
   - ❌ `tasks/<date>-*.md` 既有 unchecked 項
   - ❌ 既有 plan package `tasks.md` 的 unchecked 項
   - ❌ `git status` dirty 檔案

   例外：若當前 chat 對話脈絡明確指向某個 tasks/<date>-*.md / plan package / dirty file 就是當前 session 在動的，那才算當前 session 工作 —— 由對話脈絡決定歸屬，不是由檔案存在決定。

2. **逐項分類升級**（依 `rules/core/session-tasks.md` 升級路徑表）：

   | 未完項類型 | 升級到 |
   | --- | --- |
   | 下一 session 要立刻接手的 in-progress 工作 | `HANDOFF.md` `## In Progress` section |
   | 被 blocker 卡住（缺權限 / 缺決策 / 等外部） | `HANDOFF.md` `## Blocked` |
   | 這個 session 開著的 work 停在外部依賴（PR 合入 / release / CI） | 先 release commit lock，再 `flow work wait <work> --on pr:…\|release:…\|ci:… --resume '<條件成立後那一步>'`；waker 在條件成立時讓 `flow status --stalled` 出 `wake-ready`。**NEVER** 握著 lock 停著等，也 **NEVER** 只靠 Monitor（session 一斷線它就消失）；沒登記就停，attended Stop gate 會擋一次 |
   | 等待外部 signal（合約 / ramp 日期 / 第三方 API ready） | 有 `specs/truth/work-lifecycle.md` → `flow plan open`；未遷移 consumer 才建 `TD-NNN` |
   | 未來才做、可排優先序 | repo 根目錄 `ROADMAP.md` `## Next Moves` |
   | 規模膨脹（要動 spec / design review / 跨多檔） | 走 `/specify` 開 plan package（新增範圍先拍板） |
   | 純放棄 | 直接刪 |

3. **寫入**：依分類 Edit / Write 對應檔案，path **MUST** 用 Step 1.5 解析出的 `$MAIN_WT_PATH/<rel>` 絕對路徑（即使當前 cwd 在 linked worktree）。格式與落點判準走下方 § HANDOFF 寫回契約（三條，寫入前逐條過）。HANDOFF.md `## In Progress` 條目 MUST 含：
   - work slug / task 名稱
   - **ambient `CLADE_WORK_ID` 非空時：那個 work id**（寫成 `work: W-…` 一行；[[flow-work-tracking]] § 單向指向 的具名例外）。env 是空的就不寫，**NEVER** 去猜或去查一個 id
   - 主要檔案路徑（讓接手者直接跳）
   - 目前做到哪裡 / 還剩什麼
   - 已踩過的坑（避免下一 session 重踩）
   - **若來自 [[wt]] 的 `rules/改tracked檔前先隔離判準.md` Rule 5 死鎖**：額外加 Stop hook 攔點摘要、missing acceptance criterion、改過檔案的 selective stash ref（若有，例 `stash@{0}: <slug>-handoff`）、下一 session 接手指引（指名 carrier 路徑與剩下的 phase；實作先隔離 worktree，收尾先驗當前 evidence 與人的 gate）
3b. **spine 收尾（ambient `CLADE_WORK_ID` 非空時 MUST，空則整步跳過）**：二擇一，依**步驟 2 分類後是否還有要交接的殘工**判：

   ```bash
   # (a) 無殘工要交接（步驟 2 分類後沒有任何項進 HANDOFF/TD/ROADMAP）→ 宣告完成
   node ~/offline/clade/vendor/scripts/flow/flow.ts work done "$CLADE_WORK_ID" \
     --verification '<跑了什麼、輸出是什麼——一句可查證的實跑摘要>'

   # (b) 有殘工要交接 → 這件事停在某個 prose 段等人接手，不是完成
   node ~/offline/clade/vendor/scripts/flow/flow.ts work park "$CLADE_WORK_ID" \
     --carrier '<handoff:<段名> | td:TD-NNN | tasks:<路徑>>' --note '<一句話：停在哪、等什麼>'
   ```

   `--carrier` 必填，填**步驟 3 實際寫進去的那個落點**。**NEVER 在 (b) 的情況下走 (a)**，也 **NEVER** 用「剩下都是小事」跳過這一判——答案就是步驟 2 有沒有寫進 HANDOFF。沒有 ambient work 時 **NEVER** 為了留紀錄現鑄一個新 work。兩支指令都 **fail-open**：非 0 exit **NEVER** 擋 park 的其餘步驟。

4. **清理 session-tasks**：所有未完項升級完成後 → 只處置「當前 session 自己開的」`tasks/<date>-*.md`：有 `specs/truth/work-lifecycle.md` → 刪（`git rm`）；未遷移 consumer 才 `mv tasks/archive/` 或刪（依 `rules/core/session-tasks.md`「NEVER 動別人的 tasks 檔」）。若當前 session 從頭到尾沒開 tasks 檔，跳過此步。

   接著掃**無主檔**：`tasks/` 內**檔名 timestamp 與 mtime 都** >7 天的 `<date>-*.md`（兩個條件都 MUST 驗）。有 `specs/truth/work-lifecycle.md` → 只刪 **已追蹤且與 HEAD 一致** 的過期檔（`git ls-files --error-unmatch -- <file>` 成功且 `git diff --quiet HEAD -- <file>`）；untracked 或 dirty 的留下，**NEVER** `mv tasks/archive/`。未遷移 consumer 才整檔 `mv tasks/archive/`。**只 `mv` 或刪，NEVER `Edit`、NEVER 代跑升級路徑**。SoT 在 `rules/core/session-tasks.operations.md` § 寫入規約補充（paths-gated，所以操作句寫在這裡）。

   ```bash
   # 列出無主檔：mtime >7 天 且 檔名日期 >7 天（不含 archive/、lessons.md）
   find tasks -maxdepth 1 -name '[0-9]*-*.md' -mtime +7 \
     | while read -r f; do
         d=$(basename "$f" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
         [ $(( ($(date +%s) - $(date -d "$d" +%s)) / 86400 )) -gt 7 ] && echo "$f"
       done
   ```

   **接著掃 archivable**（收尾證據，優先於上面的年齡推定）：檔頭宣告了 `work_id:` 且該 work 在本 repo
   flow spine 上真的跑完過（至少一個 interval span 收尾、無 in-flight、無 fail）的檔 → 有 `specs/truth/work-lifecycle.md`
   就刪（同上：只刪已追蹤且與 HEAD 一致的），未遷移 consumer 才整檔 `mv tasks/archive/`，**不必等 7 天**。**NEVER 自己判**，清單一律讀 audit：

   ```bash
   node ~/offline/clade/scripts/audit-stale-tasks.ts --consumer <consumer_id> --json \
     | jq -r '.rows[].archivable[]'
   ```

   `--consumer` 不在 registry 時跳過這段。audit 保證 archivable 與 stale 互斥，不必去重。**NEVER 因為某個檔沒宣告 `work_id:` 就把它當違例**。
5. **Worktree & Stash audit**：跑 **Step 3 共用 audit block**（見下文）。park 為「靜默寫入」—— audit 段寫進 HANDOFF.md，但**不**在 chat 訊息輸出 audit 全文或摘要（避免雜訊干擾當前 session 交接收尾）。
6. **回報**：一句話總結升級數量（如「升級 3 到 HANDOFF / 1 到 plan / 砍 2」；未遷移 consumer 寫「1 到 tech-debt」）。**禁止**追加「下一步建議」或「要不要繼續做 X」。Audit 因為靜默不出現在回報；user 想看走 HANDOFF.md。

## HANDOFF 寫回契約（park / next 共用）

依 `follow-up-register.md` § 主動消化，同步驗證並關閉本次完成的工作，回讀 flow 關卡後移出主清單：有 `specs/truth/work-lifecycle.md` → 在承載它的 `work.md` 標 Open work、truth 變動在 `truth-delta.md` 加列（`/truth-delta`；舊 `plan.md` package 才 `flow plan apply-delta`），**NEVER** 改 `docs/tech-debt.md` 的 Status；未遷移 consumer 才關 TD。HANDOFF 移除完成流水帳，已有 plan／TD 的未完項只保留指針。等待訊號、部分完成及未驗收工作保留具體接手入口。

**每一次**往 `HANDOFF.md` 寫待辦之前先過下列各條。

### 1. 待辦 MUST 是 checkbox 行，NEVER 是散文段

`- [ ] <一句話說要做什麼> — <檔案路徑或指令>`

coordinator 就緒池掃描時 `- [ ]` 未勾項 = 一個 candidate，純文字段落只算**一個** candidate。寫五件事就寫五行。

### 2. 結案段的 checkbox MUST 全部是 `- [x]`

heading 標了結案（`✅` / `~~刪除線~~` / 已完成 / 已解除 / 已消解 / 已答 / 本輪已清）而 body 還留著 `- [ ]` 的段，**對 rotate 完全免疫**（`collectDeadSections()` 跳過帶未勾項的段）。

收段時二選一，**NEVER** 兩者都不做就標結案：把未完項勾掉，或把它搬去 `## In Progress` / plan（未遷移 consumer 為 TD）/ `tasks/`。

機械防線：`handoff-scan.ts` 的 `tier-a-done-section-stalled`（warn）。它 warn 時**唯一**正確處置是上面那個二選一，NEVER 把 heading 的結案標記拿掉來讓訊號消失。

### 3. 已有 plan／TD 編號的內容只留一行 pointer

有 `specs/truth/work-lifecycle.md`：`- [ ] <work-id> — <一句話> → specs/plans/<work-id>/work.md`（舊 TD id 經 `specs/truth/legacy-ids.json` 解析到現行承載者再指過去）。未遷移 consumer：`- [ ] TD-NNN — <一句話> → docs/tech-debt.md`。

正文（重現步驟、已排除方案、驗收 predicate）只留在 plan／TD entry。

### 4. Load-bearing claim MUST 帶當下實查的 receipt

**判準**：把這句宣稱刪掉，接手者會不會做出**不同的分工決定**？會 → 它是 load-bearing。
典型四類：驗收入口可用、evidence 已就緒、產物已依約命名、球在誰手上（`flow gates` 有沒有卡）。

這類宣稱 MUST 寫成「判定來源 ＋ 當下結果」，**NEVER** 寫成自由文字斷言：

```markdown
<!-- ✅ 判定成立 -->
**驗收入口**（2026-09-17 實查 `flow gates --repo-only --require-empty` exit 3，ui-judgement 2 張）

<!-- ✅ 判定不成立 —— 誠實寫缺口，NEVER 省略不提 -->
**驗收入口：無。** `flow gates --repo-only --require-empty` exit 0（0 張卡）——
三條 item 尚無 `(verified-*)` evidence，**球在 agent 這邊**。

<!-- ❌ 自由文字斷言：事後無法分辨「我以為做完」與「我驗過做完」 -->
三條 item 的 evidence 都已備妥，只需看圖點 OK。
```

### 5. 驗收失敗項 MUST 寫成 `acceptance-gap` 待辦，NEVER 寫成單點修補

交接要列驗收階段發現的 bug（客戶／HR 驗收、發版後 smoke、staging 實走、主管抽驗）時（宣告 aixbdd 的 consumer 與 clade home），所在功能範圍沒有 truth 覆蓋的，待辦寫「經 work-route 開 `acceptance-gap`」並附它的 work id 指針，**NEVER** 寫成「修 X 那一處」交給接手者直接修；照 work-route skill 的 `rules/工作種類與必要產物.md` Rule 6 在 `work.md`（舊 package：`plan.md`）`## Scope inventory` 建盤點表；已有 truth 覆蓋的照 work-route 開 `bug-covered`。

### 一段能留在 HANDOFF 的充要條件

「接手者開工前 5 分鐘內必須讀到」**且**「30 天內會失效」。兩條都要成立。

| 判定 | 落點 |
| --- | --- |
| 兩條都中 | 留在 HANDOFF |
| 只中前者（耐久知識，不會過期） | 有 `specs/truth/work-lifecycle.md` → `specs/truth/` 或既有唯一機器 owner；未遷移 consumer 才寫 `docs/rule-rationale/`。跨 consumer 的教訓一律走 `/oops`（寫 clade truth） |
| 只中後者（任務級細節，接手者不必先讀） | 有 `specs/truth/work-lifecycle.md` → 承載該任務的 plan；未遷移 consumer 才寫該任務的 TD entry body。兩者都可用 `tasks/<date>-<slug>.md` |
| 兩條都不中 | 刪 |

**搬不是刪**：綁單一任務的坑進該任務的 plan，跨任務可復用的走 `/oops`（寫 clade truth；`docs/pitfalls/` 已退役，呼叫端遷移與否都不寫）。

**HANDOFF 沒有整檔 KB／行數門檻。** 活段太肥走 `section_max_kb` / `entry_max_lines`（換載體，不是 rotate 觸發）。
