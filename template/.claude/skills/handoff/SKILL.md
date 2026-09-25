---
name: handoff
description: Session 交接與 bounded delegation。Use when `/handoff` 要登記進度、在支援的 runtime 交給 successor，或由 Codex upstream 派 native bounded work。NOT for 單純 commit 收尾（走 `/commit`）。
license: MIT
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: action
---

<!-- clade-skill-scope: both -->

# /handoff

> Runtime host-specific relay/fanout restrictions and launcher/tool bindings are supplied by the selected runtime adapter. The shared rules below define durable handoff semantics and fail-closed boundaries.

Session 交接管理。非 Codex runtime 的四個 arg 依下方契約收工；Codex 先走下一節的 native boundary，upstream task 保留責任與控制權。

## Codex native boundary（MUST 早於 Step 0.1 與任何 Herdr preflight）

當前 host 是 Codex 時，**在讀取或執行任何 Herdr／`herdr-session-handoff.ts`／`--launcher cx` 步驟前停止共用 successor 流程**：

- 同一個 upstream Codex task 保留 change、user 對話、驗收與收尾責任；`relay`／`fanout`／`next` **NEVER** 把 upstream 轉成 successor、另開外部 Codex launcher，或因 native subagent 完成而強制結束 upstream。
- 可切成 bounded GPT 工作時，依當前 schema 使用 `collaboration.spawn_agent`；一件 serial work 派一個，互不依賴的多件 work 才平行派。upstream 等待、收割 outcome、驗 scope 並繼續負責。
- user 真正要求的是把整個 Codex 對話位置交給另一個 user-owned successor 時，當前 native surface 不提供這個能力；保留 durable state 並回報具體 blocker。**NEVER** 用 Herdr、`cx resume`、外部 launcher 或其他 runtime 冒充。
- `collaboration.spawn_agent` 或所需 model／effort 不可用時，回報該 capability blocker；**NEVER** fallback 到外部 pane。被派出的 native subagent 只完成 brief 內 bounded work 並回報 parent，自己不 invoke `relay`／`fanout`。
- **唯一外部 transport 例外**：user 當次明確點名 Devin bounded worker 時，upstream 可經 `herdr-session-handoff.ts` 以 create-only `--launcher devin` 派工並用 `--coordinate` 收割；routing 仍強制 exact Devin catalog model／effort。它是 worker 不是 successor——upstream 保留責任，`--relay`、cx successor 與其他 launcher 維持拒絕，無法驗證的 Codex 來源一律 fail closed。

Codex 在本節完成分流後 **NEVER 繼續進入下方 relay／fanout Herdr 步驟**（Devin bounded worker 例外是 helper 的 create-only dispatch，不是下方 successor 流程）。`park` 仍可只寫 durable handoff state，但不因此關閉或移交 upstream task。

## Step 0.1 — Value-first continuation gate（四種模式共用）

`park`、`relay`、`fanout`、`next` 都 MUST 先判斷是否仍值得保留 continuation。只有目前可驗證的 customer／product demand、current incident／data-security risk，或直接阻擋交付且可 bounded fix 的 blocker 至少一項成立，才可列為 continuation candidate；age、unknown、未落地、commit 數與「可能有價值」都不算。三者皆無時標記 `retired`／`cancelled`、保存 evidence、continuation candidates 固定為 0；歷史 worktree／branch 依下方 § 3.5.1 入口處理。`relay`／`fanout` 的 dispatch details 見 [dispatch-common.md](dispatch-common.md) § 0.1；`park` 也受本 gate 約束，即使不開 pane。

## Step 0 — 解析參數

先解析 invocation args，**在 Step 1 之前分流**：

| Args | 開幾個 pane | 動作 |
| --- | --- | --- |
| 無參數 | 依判定結果 | **先過 Step 0.5 context 預算 gate**，未被 gate 改道才進 Step 1 兩層自動判定，落到 `park`／`relay`／`fanout`／`next` 其一 |
| `park` / `park <一句工作描述>` | 0 | 進 § park：只把未完項登記進 HANDOFF／TD／ROADMAP，收工。**user 顯式打 `park` 本身就是允許**，不必再問 |
| `relay` / `relay <一句工作描述>` | 1 successor | **MUST Read [relay-steps.md](relay-steps.md) 全文並照順序執行** |
| `fanout` / `fanout <一句工作描述>` | N worker + 1 successor | **MUST Read [fanout-steps.md](fanout-steps.md) 全文並照順序執行** |
| `next` | 依盤點結果 | **先過 Step 0.5 context 預算 gate**；未被改道才進 § next：先跑 health gate／worktree／TD hygiene 盤點，再決定派什麼，收工 |

**判準是「手上有幾件可平行的工作」，而預設方向是「派出去」**：1 件（含多件但彼此 serial）→ `relay`；N ≥ 2 件可平行 → `fanout`；還不知道有幾件 → `next`（盤點完會落到前三者之一）；**0 件才輪到 `park`，而裸 `/handoff` 自動判定落到 `park` 時 MUST 先取得 user 允許**（見 Step 1 § park gate）。

`relay` 與 `fanout` 是**優先選項**，判定成立就直接派，**NEVER** 再回頭問 user「要不要派」（接手的 pane 是互動式的，可以直接問 user）。

「可平行」走 [dispatch-steps.md](dispatch-steps.md) § Serial vs Parallel 評估的四條 rubric，**四條全成立**才算。任一條不成立就是 serial，合併成一份 brief 走 `relay`。

**`relay` 與 `fanout` 的共用底座是 [dispatch-common.md](dispatch-common.md)**：preflight、durable thin brief 紀律、`--label` 要求、runtime cleanup、parent worktree lifecycle、收工訊息契約。兩支 steps 檔只寫各自差異。

> `now` 已於本版**廢除**：舊 `/handoff now <task pointer>` 一律改走 `relay`（單件）或 `fanout`（多件可平行）。

## Step 0.5 — Session context 預算 gate（MUST，早於 Step 1）

**`next` 是四個 arg 裡唯一會在當前 session 燒掉大量 context 的**（前載一連串 scan，終點 2B.5 在當前 session 內呼下一件工作）——那正是 [[session-tasks]] § Session context 預算 過門檻後 MUST 停的事。**本 gate 對裸 `/handoff` 與顯式 `next` 同等生效。**

### 可觀察 predicate（用訊號，NEVER 憑感覺估）

門檻取 [[session-tasks]] § Session context 預算的 launcher profile（數字的 SoT 是 `session-context-budget-warn.sh` 的 profile 表）。`ccx` 不是可用 launcher：live `ccx` handoff fail closed，不自行改派其他 runtime；只有 user 明確點名時才可改交仍支援的 launcher。會進入共用 Herdr 流程的 runtime 原生繼承當前 session（`cc → cc`、`ccw → ccw`、`ccg → ccg`）；Codex 已由上方 native boundary 分流，工作 routing 不得覆蓋。判定材料只認下列三種**在 transcript 裡看得到**的訊號：

1. `session-context-budget-warn` hook 已在本 session 響過（它逐字報「session context 已達 Nk」）
2. user 在訊息裡明講了 context 用量（「目前已經 43%」「快滿了」）
3. harness 顯示的 context 百分比

三者皆無 → 視為未過門檻，照 Step 1 正常判。**NEVER** 因為「感覺跑很久了」就自行判定過門檻，
也 **NEVER** 因為「還沒看到 hook」就無視 user 明講的百分比。

**身分豁免照 [[session-tasks]] § 身分豁免**（in-process subagent、Herdr 顧問 pane `CLADE_ADVISORY_SESSION=1`、Fable 系列主線不改道）。**NEVER** 從工作性質自評身分。

### 分流

| 可觀察 predicate | 動作 |
| --- | --- |
| 已過**該 launcher 的 hard tier** | **跳過** 2B.0–2B.1.9 全部 scan（盤點本身有價值，但要由乾淨 session 做），改依**當前已知**的殘工件數直接落 `relay`／`fanout`；**每一項**都講得出具體外部條件時才 `park`（仍受 § park gate 管）。**NEVER** 因為「已經滿了、沒餘裕再派」就直接 `park`——那一級是**最該派**的時刻 |
| 已過**該 launcher 的 soft tier** | **NEVER 落 `next`**。改依 Step 1 第二層的件數判：≥1 件派得出去 → `relay`（1 件或多件 serial）／`fanout`（N 件可平行）；0 件 → `park` |
| 未過門檻 | 不改道，照 Step 1 兩層判定 |

被本 gate 改道時 **MUST** 在宣布偵測結果那句話裡寫出來（例：「偵測到 `relay`（Step 0.5：context
已達 43%，過第一級門檻故不落 `next`；第二層：1 件派得出去）」），**NEVER** 靜默改道。

### 逐字反開脫

- ❌「盤點很快，跑完再收」——`next` 的四個 scan ＋ triage 就是「大工作段」本身，不是收尾
- ❌「先跑 scan 看看有什麼，再決定要不要收工」——順序反了，過門檻就是收工，scan 交給下一個 session
- ❌「user 是打 `next`，我照做就好」——顯式 arg 不豁免本 gate（見上）
- ❌「只差 2B.5 dispatch 沒做，其他都跑完了」——2B.5 正是把新工作塞進這個 session 的那一步
- ❌「context 已經過第二級了，沒餘裕再派，先登記就好」——跳過的是 scan，不是派工（見上表第一列）

## Step 1 — 偵測模式（只有裸 `/handoff` 才跑）

顯式帶了 arg 就**跳過本步**，直接進對應分支（Step 0.5 的 gate 除外，它對顯式 `next` 也生效）。

「Session」=**當前這個 chat session**，不是 working tree / git state / 檔案系統狀態（那些都可能來自別的並行 session）。

分兩層判：**先判當前 session 有沒有未交辦工作**，有的話**再判其中幾件派得出去**。

### 第一層 — 當前 chat session 有沒有未交辦工作

**有**（任一條成立）→ 進第二層：
- 當前對話與已載入 task carrier 記錄顯示當前 session 任何 `in_progress` 或 `pending` task（該 inventory 是 per-session host state，可信）
- 當前 chat 對話脈絡明顯顯示 user 正在 mid-task（我剛在做某事還沒收尾、user 剛交辦一個多步驟工作做到一半）
- Stop hook 攔住但 acceptance 未滿足 + 處於 [[worktree-default.detail]] §8 死鎖（cwd 在 main + main 已 dirty）且當前 session 已自評不適合走 §7 分支 A（context 不寬裕 / 剩餘 work 不小 / 無法 selective stash）

**沒有** → `next`：以上皆否（即使 working tree 髒、tasks/ 有別 session 的 unchecked、`specs/plans/**` 有別 session 的 active work，都仍走 `next` —— 那些屬於別 session 的責任）。

**禁止訊號**（這些都不算「當前 session」狀態）：
- ❌ `git status --short` 有 dirty file
- ❌ `tasks/<YYYY-MM-DD-HHMM>-*.md` 存在或有 unchecked 項
- ❌ `specs/plans/NNN-<slug>/tasks.md` 有 unchecked 項
- ❌ `HANDOFF.md` 有 In Progress 段落

### 第二層 — 其中幾件派得出去

對**每一項**未交辦工作問「它派得出去嗎」。**「派不出去」MUST 講得出具體外部條件**，只有兩類算數：等一個具體外部 signal、被別 session 的未 commit 檔擋住（判準 SoT 在 [[session-tasks.operations]] § 收工三步，此處不複述）。「需要人判斷」「要謹慎」「這個比較複雜」「要 attended」**都不是**外部條件——派出去的是互動式 pane，需要拍板的直接在那個 pane 問 user。

| 派得出去的件數 | 落到 |
| --- | --- |
| 1，或多件但彼此 **serial** | `relay` — 直接派，不問 |
| N ≥ 2 且四條 parallel rubric 全成立 | `fanout` — 直接派，不問 |
| 0（**每一項**都講得出具體外部條件） | `park` — **MUST 先過下方 § park gate** |

### park gate（裸 `/handoff` 專用，MUST）

**可觀察 predicate：這一輪 `/handoff` 會不會開出任何 pane？** 不會 → **MUST 依詢問操作取得 user 允許才 park**，**NEVER** 自行決定。允許的形式只有兩種：user 顯式打了 `/handoff park`，
或 user 對這一次的詢問答了「可以」。

問法 MUST 附**為什麼派不出去**——逐項列出那個具體外部條件，讓 user 當場判得出理由站不站得住。
問句 MUST 給 `park` 與「還是派出去」兩個選項，**NEVER** 只問「這樣可以嗎」。

Predicate 綁的是**結果**不是路徑，所以「先自己做掉再 park」同樣命中（同樣沒有 pane 被開出來）。

**Rationalization table（逐字實錄，看到自己正要說出其中一句就停）**：

| 藉口 | 現實 |
| --- | --- |
| 「這件是單檔 2 分鐘的收尾，交出去等於讓下一個 session 重建 context」 | 照這句判，結果是**沒有任何 pane 被派出去**。工作量小不是外部條件，是偏好 |
| 「它是本 session 自己造出來的殘留，先做完再收工比較乾淨」 | 「誰造的」不改變它派不派得出去。做完再 park 的可觀察結果與直接 park 相同 |
| 「先登記起來，下個 session 會看到」 | 登記是 [[session-tasks.operations]] § 收工三步的**第 2 步**；第 1 步是派出去。跳過第 1 步就是這條 gate 要擋的 |
| 「這幾件還是我自己比較清楚」 | context 在 durable brief 裡，不在你腦裡。寫不出 brief 才是真的講不清楚——那要說出來，不是拿來當不派的理由 |
| 「需要人判斷 / 要謹慎 / 要 attended」 | 派出去的是**互動式** pane，要拍板的直接在那個 pane 問 user。這在第二層已經明講過，不是外部條件 |
| 「user 剛才叫我 handoff，意思就是收工登記」 | `/handoff` 的四個 arg **全部**收工，差別只在開幾個 pane。「收工」推不出「不派」 |

**Red flags（發現自己在想這些就停下來重判）**：

- 正在盤算「做完這一件就沒有未交辦工作了」
- 正在把某項的「派不出去」理由寫成形容詞（複雜 / 敏感 / 微小 / 收尾性質）而不是具體外部 signal
- 已經開始寫 HANDOFF 升級條目，但還沒問過 user

宣布偵測結果一句話，**兩層都要寫**：「偵測到 `fanout`（第一層：當前對話與已載入 task carrier 記錄有 3 個 in-progress；第二層：3 件都派得出去且檔案不重疊）」或「偵測到 `next`（當前 session 清空）」。落到 `park` 時**第三段要寫 gate 結果**：「park gate：已取得 user 允許」或「park gate：詢問中」。

## Step 1.5 — 路徑解析 invariant（park / next 共用）

`HANDOFF.md` / `docs/tech-debt.md`（未遷移 consumer）/ `ROADMAP.md` 是「跨工作全局狀態」，**不該** per-worktree 分裂。

**MUST** 在進入 park / next 寫入動作前先解析 main worktree absolute path：

```bash
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -z "$GIT_COMMON_DIR" ]; then
  echo "warn: not inside a git repo; falling back to cwd for HANDOFF writes" >&2
  MAIN_WT_PATH="$(pwd)"
else
  # linked worktree: .git/worktrees/<slug>/.. → main repo's .git dir
  # so dirname(GIT_COMMON_DIR) 是 main worktree path（main 與 linked 都成立）
  MAIN_WT_PATH="$(dirname "$GIT_COMMON_DIR")"
fi
```

實際操作：所有 `HANDOFF.md` / `ROADMAP.md` 寫入路徑都用 `$MAIN_WT_PATH/<rel>` 絕對路徑（Edit / Write tool 的 `file_path` 參數）。未遷移 consumer 才寫 `docs/tech-debt.md` / `docs/archives/<yyyy-mm>-<topic>.md`。**禁止**用 cwd-相對路徑寫這幾個檔。其餘檔案（`.claude/rules/local/*.md` 讀取、`tasks/<date>-*.md` 清理）保持 cwd 相對行為。有 `specs/truth/work-lifecycle.md` 時 **NEVER** append 月份 handoff archive、**NEVER** 開新 TD、**NEVER** `mv` 進 `tasks/archive/`（刪完成檔，歷史由 git 追溯）。

### 當前 session 被隔離、寫不進 main 時（background job / cwd 已在 worktree）

`$MAIN_WT_PATH` 解析出來是 main worktree 的絕對路徑，但**有些 session 根本不准寫進去**：background job 的隔離 guard 會擋掉 shared checkout 的所有編輯，cwd 已在 linked worktree 的 session 同樣不該直接動 main。這時 **NEVER** 改寫成 cwd-相對路徑繞過（那正是本節要防的分裂），改走 worktree + merge-back：

1. `node vendor/scripts/wt-helper.ts add <slug> --task-summary "<一句話：這棵樹要做什麼>"`，進該 worktree
2. 在 **worktree 內**編輯 `HANDOFF.md`（未遷移 consumer 才含 `docs/tech-debt.md`；有 `specs/truth/work-lifecycle.md` 時改寫 `specs/plans/<work-id>/plan.md`）（它們 fork 自乾淨 main，內容與 main 一致）
3. `node vendor/scripts/wt-helper.ts merge-back <slug>`（先 `--dry-run` 確認不會捲進別 session WIP）
4. **MUST 在 main 補一次 `git commit --only -- HANDOFF.md <其他寫過的檔>`**

第 4 步不可省：`merge-back` 只把改動 squash 進 main 的 index，HEAD 不動。

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
   - **若來自 [[worktree-default.detail]] §8 死鎖**：額外加 Stop hook 攔點摘要、missing acceptance criterion、改過檔案的 selective stash ref（若有，例 `stash@{0}: <slug>-handoff`）、下一 session 接手指引（指名 carrier 路徑與剩下的 phase；實作先隔離 worktree，收尾先驗當前 evidence 與人的 gate）
3b. **spine 收尾（ambient `CLADE_WORK_ID` 非空時 MUST，空則整步跳過）**：二擇一，依**步驟 2 分類後是否還有要交接的殘工**判：

   ```bash
   # (a) 無殘工要交接（步驟 2 分類後沒有任何項進 HANDOFF/TD/ROADMAP）→ 宣告完成
   node ~/offline/clade/vendor/scripts/flow/flow.ts done "$CLADE_WORK_ID" \
     --verification '<跑了什麼、輸出是什麼——一句可查證的實跑摘要>'

   # (b) 有殘工要交接 → 這件事停在某個 prose 段等人接手，不是完成
   node ~/offline/clade/vendor/scripts/flow/flow.ts park "$CLADE_WORK_ID" \
     --carrier '<handoff:<段名> | td:TD-NNN | tasks:<路徑>>' --note '<一句話：停在哪、等什麼>'
   ```

   `--carrier` 必填，填**步驟 3 實際寫進去的那個落點**。**NEVER 在 (b) 的情況下走 (a)**，也 **NEVER** 用「剩下都是小事」跳過這一判——答案就是步驟 2 有沒有寫進 HANDOFF。沒有 ambient work 時 **NEVER** 為了留紀錄現鑄一個新 work。兩支指令都 **fail-open**：非 0 exit **NEVER** 擋 park 的其餘步驟。

4. **清理 session-tasks**：所有未完項升級完成後 → 只 `mv` / 刪「當前 session 自己開的」`tasks/<date>-*.md`（依 `rules/core/session-tasks.md`「NEVER 動別人的 tasks 檔」）。若當前 session 從頭到尾沒開 tasks 檔，跳過此步。

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
   flow spine 上真的跑完過（至少一個 interval span 收尾、無 in-flight、無 fail）的檔 → 同樣整檔
   `mv tasks/archive/`，**不必等 7 天**。**NEVER 自己判**，清單一律讀 audit：

   ```bash
   node ~/offline/clade/scripts/audit-stale-tasks.ts --consumer <consumer_id> --json \
     | jq -r '.rows[].archivable[]'
   ```

   `--consumer` 不在 registry 時跳過這段。audit 保證 archivable 與 stale 互斥，不必去重。**NEVER 因為某個檔沒宣告 `work_id:` 就把它當違例**。
5. **Worktree & Stash audit**：跑 **Step 3 共用 audit block**（見下文）。park 為「靜默寫入」—— audit 段寫進 HANDOFF.md，但**不**在 chat 訊息輸出 audit 全文或摘要（避免雜訊干擾當前 session 交接收尾）。
6. **回報**：一句話總結升級數量（如「升級 3 到 HANDOFF / 1 到 plan / 砍 2」；未遷移 consumer 寫「1 到 tech-debt」）。**禁止**追加「下一步建議」或「要不要繼續做 X」。Audit 因為靜默不出現在回報；user 想看走 HANDOFF.md。

## HANDOFF 寫回契約（park / next / work-loop 共用）

依 `follow-up-register.md` § 主動消化，同步驗證並關閉本次完成的工作，回讀 flow 關卡後移出主清單：有 `specs/truth/work-lifecycle.md` → 在承載它的 plan 標 Open work／`flow plan apply-delta`，**NEVER** 改 `docs/tech-debt.md` 的 Status；未遷移 consumer 才關 TD。HANDOFF 移除完成流水帳，已有 plan／TD 的未完項只保留指針。等待訊號、部分完成及未驗收工作保留具體接手入口。

**每一次**往 `HANDOFF.md` 寫待辦之前先過下列各條。

### 1. 待辦 MUST 是 checkbox 行，NEVER 是散文段

`- [ ] <一句話說要做什麼> — <檔案路徑或指令>`

work-loop 掃描時 `- [ ]` 未勾項 = 一個 candidate，純文字段落只算**一個** candidate。寫五件事就寫五行。

### 2. 結案段的 checkbox MUST 全部是 `- [x]`

heading 標了結案（`✅` / `~~刪除線~~` / 已完成 / 已解除 / 已消解 / 已答 / 本輪已清）而 body 還留著 `- [ ]` 的段，**對 rotate 完全免疫**（`collectDeadSections()` 跳過帶未勾項的段）。

收段時二選一，**NEVER** 兩者都不做就標結案：把未完項勾掉，或把它搬去 `## In Progress` / plan（未遷移 consumer 為 TD）/ `tasks/`。

機械防線：`handoff-scan.ts` 的 `tier-a-done-section-stalled`（warn）。它 warn 時**唯一**正確處置是上面那個二選一，NEVER 把 heading 的結案標記拿掉來讓訊號消失。

### 3. 已有 plan／TD 編號的內容只留一行 pointer

有 `specs/truth/work-lifecycle.md`：`- [ ] <work-id> — <一句話> → specs/plans/<work-id>/plan.md`（舊 TD id 經 `specs/truth/legacy-ids.json` 解析到現行承載者再指過去）。未遷移 consumer：`- [ ] TD-NNN — <一句話> → docs/tech-debt.md`。

正文（重現步驟、已排除方案、驗收 predicate）只留在 plan／TD entry。

### 4. Load-bearing claim MUST 帶當下實查的 receipt

**判準**：把這句宣稱刪掉，接手者會不會做出**不同的分工決定**？會 → 它是 load-bearing。
典型四類：驗收入口可用、evidence 已就緒、產物已依約命名、球在誰手上（`flow gates` 有沒有卡）。

這類宣稱 MUST 寫成「判定來源 ＋ 當下結果」，**NEVER** 寫成自由文字斷言：

```markdown
<!-- ✅ 判定成立 -->
**驗收入口**（2026-09-17 實查 `flow gates --repo-only --require-empty` exit 3，ui-judgement 2 張）：
https://review-gui.<maintainer-domain>/projects/<repo>

<!-- ✅ 判定不成立 —— 誠實寫缺口，NEVER 省略不提 -->
**驗收入口：無。** `flow gates --repo-only --require-empty` exit 0（0 張卡）——
三條 item 尚無 `(verified-*)` evidence，**球在 agent 這邊**。

<!-- ❌ 自由文字斷言：事後無法分辨「我以為做完」與「我驗過做完」 -->
三條 item 的 evidence 都已備妥，只需看圖點 OK。開面板就好。
```

**人工驗收入口另有 Iron Law**（`rules/core/proactive-skills.manual-review-entry.md` § 交付入口前置查詢）：
入口**永遠**是 `flow gates --repo-only` 實查過的面板位址（格式同上方 ✅ 範例），寫進 HANDOFF / `tasks/*.md` 時同樣適用——**NEVER** 寫任何 shell 指令（`pnpm review:ui`、`cd … && pnpm …`）或 loopback URL 當入口。

### 一段能留在 HANDOFF 的充要條件

「接手者開工前 5 分鐘內必須讀到」**且**「30 天內會失效」。兩條都要成立。

| 判定 | 落點 |
| --- | --- |
| 兩條都中 | 留在 HANDOFF |
| 只中前者（耐久知識，不會過期） | `specs/truth/` 或既有唯一機器 owner；未遷移 consumer 才寫 `docs/pitfalls/` / `docs/rule-rationale/` |
| 只中後者（任務級細節，接手者不必先讀） | 該任務的 TD entry body，或 `tasks/<date>-<slug>.md` |
| 兩條都不中 | 刪 |

**搬不是刪**：綁單一任務的坑進該任務的 plan，跨任務可復用的走 `/oops`。

**HANDOFF 沒有整檔 KB／行數門檻。** 活段太肥走 `section_max_kb` / `entry_max_lines`（換載體，不是 rotate 觸發）。

## next — 盤點 + 推薦

### 2B.0 Session-end pitfall sweep（呼叫 /oops Mode C；`/oops` 屬 maintenance/full capability，repo 沒有它時跳過整段並繼續 2B.1）

在動 HANDOFF.md 前，先回顧當前 chat session transcript 掃 missed lessons。觸發訊號：

- user 糾正 Claude 的訊號（「不對」「不是這樣」「不要這樣做」「重做」「應該先 X」）
- session 中解過的 cryptic runtime error 或 stack trace
- 升 npm 套件大版 / 動 evlog / Supabase RLS / Cloudflare Workers config / nuxt-security / Better Auth / supabase-js 過程中發現的非預期行為
- 跨 consumer 散播某 fix 過程中發現新的 contract 變更

對每個 candidate **MUST** 判斷分流：

| Candidate 等級 | 動作 |
| --- | --- |
| 符合 `/oops` Mode B 四條件齊備（root cause / detection / fix / prevention） | dispatch `/oops`。有 `specs/truth/work-lifecycle.md` 時寫入 truth／plan，**NEVER** 新 pitfall 檔；未遷移 consumer 才走 `docs/pitfalls/` |
| 工作習慣 / 流程更正（user 糾正做法、強調某流程） | dispatch `/oops` Mode B 輕量降級 → 寫 `<consumer>/tasks/lessons.md`（能變成規約的走規約源檔，不進 memory） |
| 純個人偏好，無法歸進任何規約檔或 lessons | 先問 user 要不要寫進 memory，**取得同意才寫**；未同意就跳過 |
| 只給當前 repo 的 self-improvement lesson | dispatch `/oops` Mode B 輕量降級 → 寫 `<consumer>/tasks/lessons.md` |
| 一次性 typo / 純業務邏輯 bug / 純設計問題 | 跳過（不該成為 pitfall 也不該佔 memory 槽位） |

若 sweep 為空（無 candidate）→ 一句話宣告「無 missed lesson」繼續 2B.1。

**禁止行為**：

- ❌ 把 sweep candidate 一次塞給 user 讓他選哪些要記 — 主動分流後直接 dispatch，user 看結果（唯一例外是上表的 memory 列：寫 memory 一律先問）
- ❌ 把 candidate 暫存到 HANDOFF.md `outstanding` 段 — sweep 是 session 內 cleanup，不該變成跨 session 待辦
- ❌ 強推 candidate 升級到 pitfall — 不符四條件就降級或跳過，不硬塞

### 2B.1 HANDOFF.md Health Gate（hard step）

**MUST Read [scan-steps.md](scan-steps.md) § 2B.1 before proceeding** — 含 2B.1b 100% rotate 指令、audit、JSON schema、reorganize 表、dead-section 處置表、寫入規約。

摘要：先跑 `rotate-handoff-done.ts`（每次 `next` 的第一個寫入：100% 清掉可 rotate 的紀錄，不詢問、不看 KB 門檻）。JSON `retired: true` = clade home／已遷移 repo：完成段從主檔刪除、**不**寫月份 archive。未遷移 consumer 才搬進 archive。接著 `handoff-scan.ts --json` 讀 `healthGate` → fail 回報 user → 2B.1c reorganize。三 sub-step 完才進 2B.1.5。

`tier-a-dead-section` warn 的處置在 [scan-steps.md](scan-steps.md) § 2B.1d dead-section 處置（Tier A）—— 拆條 / 關條 / 知識語態重寫三選一，第四格「防重做 marker」偵測器已自動豁免、**NEVER 刪**。該 sub-step 不寫任何檔，逐段判即可，處置不完不擋 2B.1.5。

### 2B.1.5 Worktree & Stash 稽核

跑 **Step 3 共用 audit block**（見下文）。next 完成 audit 後，在 chat 訊息加一行摘要：「Audit: N 個 worktree / M 個 stash 寫進 HANDOFF.md `## Worktree & Stash Audit` 段」。具體判定邏輯不在此重複，避免兩處規約走 drift。

### 2B.1.7 Human gates scan（hard rule）

**MUST Read [scan-steps.md](scan-steps.md) § 2B.1.7 before proceeding** — 含 raw 形狀、family 分組寫法、SoT 判定、scan 失敗 fallback。

摘要：從 §2B.1a 同一次 handoff-scan 輸出讀 `reviewGuiReadiness` 段（`flow gates`）→ 依 family 寫入 `$MAIN_WT_PATH/HANDOFF.md` `## Review-gui Readiness` 段（整段覆寫）。Outstanding 推薦 **MUST** 引用 scan 結果。park 不執行。

### 2B.2 盤點剩餘 outstanding

從以下來源蒐集 outstanding 工作。**所有 active item 一律列入盤點並推薦處理** — drift scan 的 `active-section-stale`（14d）是 escalation threshold，不是 grace period；未超過 14d 的 active item **同樣 MUST 列入 outstanding**，不得因「尚未觸發 stale signal」而省略或降低優先序。

- 整理後的 `HANDOFF.md`
- **有 `specs/truth/work-lifecycle.md`（`techDebtHygiene.raw.retired: true`）**：outstanding **先**讀 `jq '.planInventory.raw' "$SCAN"` 三桶（**可做** / **卡人** / **該 RETIRE**）。每列的 `next` 欄是給 agent 的下一動（claim → `flow.ts plan show` / `plan readiness` → `/implement`；卡人寫明 `waitingOn`；RETIRE 寫 close/GC）。**NEVER** 把 `techDebtHygiene.raw.plans[]` 或 `flow plan list` 全表平鋪成接著做；**NEVER** 對半成品推 `/work-route`、第二次 `/specify` 或 `flow plan open` 當入口。**NEVER** 為列 outstanding 讀 `docs/tech-debt.md`、NEVER 對其中條目推薦 stamp Last reviewed／補 Resolution／wontfix（凍結舊載體）；下面三層 TD 規則整段不適用
- 未遷移 consumer 的未解決 TD-NNN — 三層來源**全部**取自 §2B.1a 落檔的 `techDebtHygiene.raw`（`jq '.techDebtHygiene.raw' "$SCAN"`）。**NEVER 為了列 outstanding 整讀 `docs/tech-debt.md` 主檔**；需要細節時用 raw 的 `lineNo` **定點 Read**。優先序分三層，**MUST** 依此排序，**NEVER** 平鋪混在一起：
  1. **stale**（`techDebtHygiene.raw.stale[]`，>60d 無 Last reviewed）— 最高優先，`discAge` 越大越前。每條 **MUST** 附三選一（做掉 / wontfix / stamp Last reviewed），但 stamp Last reviewed 列為最後選項，不推薦
  2. **aging**（`techDebtHygiene.raw.aging[]`，>14d 含被 snooze 的）— 第二優先，`discAge` 越大越前。每條 **MUST** 主動追問 blocker：「什麼卡關？能現在推進嗎？」。對 `snoozed: true` 的項目明確指出「已 stamp Last reviewed 但仍未解決 — 不應再延期」
  3. **其他 open TD** — 取 `raw.open[]` 扣掉已在前兩層的 id，按 `discovered` 排序，正常列入 outstanding：

     ```bash
     jq -r '.techDebtHygiene.raw | ((.stale + .aging) | map(.id)) as $seen
            | .open | map(select(.id as $i | $seen | index($i) | not))
            | sort_by(.discovered) | .[] | "\(.id)\t\(.discovered)\t\(.lines)行\t\(.title)"' "$SCAN"
     ```
- repo 根目錄 `ROADMAP.md` `## Next Moves`
- 任何已收尾但留下 follow-up 註記的工作

每條 outstanding 抓三件資料：
- 標題（一句話）
- 涉及檔案 / module / consumer
- 依賴關係（依賴誰、誰依賴它）

### 2B.2.5 external-action / exception / ruling 卡主動 triage（hard rule）

**等人的只是那一題，不是整件工作**。§2B.1.7 讀到 `external-action` / `exception` / `ruling` 卡時，**MUST** 對**每一張**主動 triage，**NEVER** 只寫進 `## Review-gui Readiness` 就 silently drop。

對每張卡 **MUST** 做三件事：

1. **抽 blocker 原因**：讀卡片的 `question` / `why_now`，再讀 `work_id` 對應 carrier（`tasks/<date>-<slug>.md` 或 `specs/plans/<id>/tasks.md`）的未勾項。逐條列出每一個原因，**NEVER** 從 family 名或 HANDOFF 既有 narrative 推測。
2. **辨識 startable 子集**（最關鍵）：一件工作有卡只代表它**含**至少一個等人的點，**不代表整件無事可做**。**MUST** 由 carrier 內容判斷是否有**不依賴那一題、可現在開工的 work**。有 startable 子集 → **提供 dispatch 選項**（`/wt <slug>` 只做不受阻的部分），**NEVER** 因整件有卡就當 user-bound 擱置。
3. **端出具體 user 決策**：`ruling` 卡的判斷題原樣端出（逐字、帶選項）；`external-action` 卡寫明**要人到場做什麼**；`exception` 卡寫明核准恢復／改派／abort 各會怎樣。**NEVER** 只寫「等 owner 拍板」這種無法行動的模糊句。純外部依賴（等 A 端 contract / 等別件工作）才真的擱置，但仍 **MUST** 明列在等什麼 signal。

triage 結果併入 §2B.2 outstanding 清單（與 HANDOFF / plan（未遷移 consumer 為 tech-debt）/ ROADMAP 來源並列），進 §2B.3 serial/parallel 評估、§2B.4 推薦。

**NEVER**：
- ❌ 讀到卡片卻不讀 carrier 抽 blocker 原因
- ❌ 把「有一張卡」等同「整件無 startable 工作」→ 漏掉可現在 dispatch 的子集
- ❌ 只寫「等 owner 拍板 / 卡外部」而不端出**具體**決策題或**具體**等待 signal
- ❌ 因為是卡片就從 outstanding / 詢問操作 選項中省略

### 2B.3 Serial vs Parallel 評估

**MUST Read [dispatch-steps.md](dispatch-steps.md) § 2B.3 before proceeding** — 含 serial / parallel 兩份訊號清單、parallel candidate 的 thin-brief 長駐 subagent 四條。

摘要：serial 訊號任一成立即 serial；parallel 訊號全成立才算 candidate → 判 parallel 時 **MUST** 走 thin brief + 具名長駐 subagent，**NEVER** fresh fan-out。

### 2B.4 推薦 + 詢問操作

**MUST Read [dispatch-steps.md](dispatch-steps.md) § 2B.4 before proceeding** — 含推薦訊息格式、Option 1–4 配置、7 條禁止行為（ptb-unsafe 不得標 Recommended、wt 推薦必附 safety signal、等人狀態推測禁令）。

摘要：先輸出「outstanding 盤點 + serial/parallel 推薦」訊息，再用 詢問操作 讓 user 選；面板驗收相關 next move **MUST** 引用 §2B.1.7 的 `flow gates` 結果，**NEVER** 自行推測有沒有等人的事。

### 2B.4.5 PTB-unsafe wt 的快速分流

Step 3.1 audit **有任一條** wt 判為 `mergeBackSafety: ptb-unsafe` → **MUST Read [dispatch-steps.md](dispatch-steps.md) § 2B.4.5 before proceeding** — 含 3 個 terminal 選項的動作 / 風險對照表、inspect 路徑只能作 Option 4 的規約。零條 ptb-unsafe → 本節不適用，直接進 2B.5。

摘要：commit baseline 全收 → merge-back / abandon wt / defer 三選一，**禁止** inspect 子選項作為主推薦。

### 2B.5 接續 dispatch（user 選定 outstanding 後）

**MUST Read [dispatch-steps.md](dispatch-steps.md) § 2B.5 before proceeding**（user 在 詢問操作 選定下一步的當下就要讀）— 含 5 列 next-skill dispatch 表、判定條件三條、slug 解析、parent cwd 不動 invariant、面板驗收 dispatch 的 family 入口表。

摘要：一律透過 Skill tool 內呼對應入口，**不要**輸出「請執行 cd ... && claude ...」oneliner；會寫 tracked file 的實作入口（`/implement`、`/bdd`）包進 `/wt <slug>: /<next-skill>`，read-only 與規格類（`/specify`、`/clarify-over-specs`、`/system-analysis`）直接內呼。

### 2B.1.8 Tech-debt hygiene scan（hard rule — 防 tech-debt.md 堆積）

**MUST Read [scan-steps.md](scan-steps.md) § 2B.1.8 before proceeding** — 含 staleOpen / aging / closedBloat 三訊號處置表、anti-snooze 規約、SoT 判定。

摘要：從 §2B.1a 同一次 handoff-scan 輸出讀 `techDebtHygiene` 段。`raw.retired: true`（check `tech-debt-hygiene-retired` n/a）= 已遷移 plan/truth repo：本 sub-step **整段跳過**，outstanding 改走 §2B.2 的 plan 來源，**NEVER** 寫 `docs/tech-debt.md` 或 `docs/archives/tech-debt-*`。未遷移 consumer：stale 列 outstanding 最高優先 → aging 列第二優先並追問 blocker → closedBloat warn 時跑 `rotate-closed-bloat.ts`（**NEVER** 詢問操作）。stdout `retired` = clade home／已遷移 repo，**不要**寫 closed archive 或改 `docs/tech-debt.md`。park 不執行。

### 2B.1.9 Consumer-local audit scan（hard rule）

**MUST Read [scan-steps.md](scan-steps.md) § 2B.1.9 before proceeding** — 含宣告檔形狀、exit code 契約、NEVER 清單。

摘要：讀當前 consumer 的 `.claude/rules/local/handoff-audits.md`（**不存在 → 整段跳過，不報錯**）→ 逐條跑表內指令 → exit 1 的 finding 逐條列進 §2B.2 outstanding、exit ≥2 一行 skip（缺憑證不是待辦）。**NEVER** 把這些指令搬進 `pnpm check` / CI，**NEVER** 把 script 原始輸出整段貼進 `HANDOFF.md`。park 不執行。

## Step 3 — Worktree & Stash 稽核（共用 block，park / next 都會 invoke）

目的：把所有 linked worktree + stash 的當前狀態 + 下一步建議寫進 HANDOFF.md `## Worktree & Stash Audit` 段，避免歷史包袱累積。讀取與寫入摘要後，`park` / `next` 進入共用的 lifecycle drain；drain 只會執行已由 deterministic planner 判定安全的 cleanup，landing 仍交給 `/commit`。

### 3.1 Worktree audit

讀 `handoff-scan.ts --json` 輸出的 `worktreeStash` 段（next 在 §2B.1a 已跑過 → 直接共用該輸出；park 沒經過 2B.1 → 在此跑）：

```bash
# next：§2B.1a 已落檔到 $SCAN → 直接 jq，NEVER 重跑（各段子行程都要付費）
jq '.worktreeStash.raw' "$SCAN"
# park：沒經過 2B.1，在此落檔後同樣 jq 取段
# MUST mktemp 唯一路徑 + 驗 consumerId —— 固定路徑是全機器共用，會拿別 repo 的 stash 清單
# 做本 repo 的 3.2a drop 判定。完整規約見 scan-steps.md §2B.1a「$SCAN 路徑與歸屬」
SCAN="$(mktemp -t handoff-scan.XXXXXXXXXX)"
node ~/offline/clade/vendor/scripts/handoff-scan.ts --json > "$SCAN" 2>/dev/null
EXPECT="$(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")"
GOT="$(jq -r '.consumerId // "MISSING"' "$SCAN")"
[ "$GOT" = "$EXPECT" ] && echo "scan ok: $GOT" || echo "SCAN-MISMATCH: got=$GOT expect=$EXPECT"
```

`SCAN-MISMATCH` / `MISSING` → **STOP，整份 `$SCAN` 作廢重跑**，NEVER 據此判 worktree / stash。

`worktreeStash.raw.worktrees[]` 每條已含 wt-helper list 欄位（`slug` / `branch` / `path` / `daysOld` / `mergedToMain`）+ kind 判定（`kind` / `nextStep`）。script 以 `wt-helper list --json --no-landed-state` 取資料，**不含** `landedState` / `landedReason` / `supersededBy` / `dirty`——要逐棵判「清樹會不會丟內容」直接跑 `node vendor/scripts/wt-helper.ts list --json`，可清 = `landedState ∈ {in-history, in-base}` **且** `dirty === 0`（`in-worktree` 的唯一副本是 main 未 commit 的改動，**NEVER** 讀成可清）；script 另掃 `git worktree list --porcelain`，非 `session/*` branch 的 worktree 列進 `raw.unmanagedWorktrees`。

**Gate（可觀察，先判再讀）**：`worktreeStash.raw` 的 `worktrees` / `unmanagedWorktrees` / `stashes` / `orphanSidecars` **四個陣列全空** → 本段無可判之物，**跳過 worktree-stash-audit.md 不讀**，直接照 § 3.3 寫 `No linked worktrees.` + `No stashes.` 的空 audit 段（該指令在本檔 § 3.4 末條，不依賴那份檔）。**任一非空** → 下面這條 MUST Read 生效，**NEVER** 憑 raw 摘要自行判 kind。

```bash
jq '[.worktreeStash.raw | .worktrees, .unmanagedWorktrees, .stashes, .orphanSidecars | length] | add' "$SCAN"   # 0 → 跳過；>0 → MUST Read
```

**MUST Read [worktree-stash-audit.md](worktree-stash-audit.md) before proceeding**（`mergeBackSafety` 推導、kind 判定表、stash audit 欄位）。**NEVER** 憑 `mergedToMain` 單一欄位推斷可
cleanup —— `userWip > 0` 時 kind 要降級，而 `cleanup` 對未 commit 內容無 pinned ref 保護。`ptb-unsafe` 禁止 dispatch 收尾工作，走 § 2B.4.5 分流。

### 3.3 寫入 HANDOFF.md

寫到 `$MAIN_WT_PATH/HANDOFF.md` `## Worktree & Stash Audit` 段（不存在就建）。每跑一次 audit **整段覆寫**（不是 append，避免重複累積）。格式：

```markdown
## Worktree & Stash Audit

_Updated: <YYYY-MM-DD>_

### Worktrees (N)

- `<slug>` (`<branch>`) — **<kind>** — <下一步建議>
  - `<path>` (last activity <Nd> ago)

若 0 條：`No linked worktrees.`

### Stashes (M)

- `stash@{0}` (`<kind>`, slug=`<slug>`) — **<action>** — <reason>

若 0 條：`No stashes.`
```

### 3.5 Worktree lifecycle drain（park / next 共用）

Step 3 寫 audit 前，先把同一份 `$SCAN` 交給 deterministic planner：

```bash
node vendor/scripts/handoff-lifecycle.ts --cwd "$MAIN_WT_PATH" --json > "$LIFECYCLE"
```

Planner 的安全集合只有下列形狀：

| signal | action |
| --- | --- |
| `merged` + `userWip=0` + 無 active claim | 執行 `wt-helper cleanup <slug>` |
| `orphan` + `ahead=0` + `userWip=0` + 無 active claim | 執行 `wt-helper cleanup <slug>` |
| `unlanded-content-landed` + `contentLanded=yes` + clean | 驗 content receipt 後 cleanup |
| `done-work` + work/evidence/patch receipt 全驗證 + clean | 驗 receipt 後 cleanup |
| `landable` + work complete + evidence + landing authorization + writer released | 登記 batch ready，呼叫 `/commit`，trigger=`drained` |
| 已 landed batch | 執行 `wt-helper batch cleanup` |

`--apply` 才執行上表的 cleanup；預設只輸出 plan。Planner 與 helper 都不生成 force flag：dirty、active claim、`partial`、`unknown`、缺 evidence、PR 未合入、submodule teardown 失敗及 unmanaged worktree 一律 `retain`／`report-only`。重跑同一份 landed batch cleanup 必須是 no-op 或逐項 retained，不能重跑品質鏈。

#### 3.5.1 Historical retirement（一次性 maintenance）

歷史 worktree／branch 不因 age、commit 數、未落地或 unknown 自動進 continuation。先用 value-first gate 判斷是否仍有 customer/product demand、current incident/data-security risk，或 direct delivery blocker；三者皆無才進退休流程，預設 continuation candidates 為 0。

退休入口只能是：

```bash
node vendor/scripts/handoff-retire.ts --cwd "$MAIN_WT_PATH" --apply --json \
  --value-first no-demand-no-risk-no-blocker \
  --archive-root "$RETIRE_ARCHIVE" --manifest "$RETIRE_MANIFEST"
```

它逐筆保存 branch bundle、staged／unstaged patch、status／ignored／submodule evidence 與排除 `.git` 的完整 worktree tree，驗證 archive 後重新讀 active claim、process cwd、HEAD、branch 與 status snapshot；任一改變就 retained。worktree 移除前 MUST 先通過既有 environment／submodule destroy lifecycle；teardown 失敗就 retained。批次持有的來源先由正式 batch cleanup／cancel 處理，不能用 retirement 偽造 landing。移除只允許 exact `git worktree remove --force <path>` 與 exact `git update-ref -d <ref> <head>`，remote refs、main 與明確排除項永不碰。

`docs/archives/retired-work.jsonl` 是 durable tombstone；已退休 identity 不得再由任何 handoff mode 推回 continuation 清單。重跑同一 manifest 應是 no-op／retained，並受固定 maintenance budget 限制。

輸出固定包含：

```text
Landed: N
Worktrees removed: N
Branches removed: N
Retained: N
```

成功移除項目不再寫回下一版 audit；retained 項目必須帶具體原因與下一個可觀察 landing signal。

### 3.6 禁止行為

- ❌ 自動跑裸 `git worktree remove` / `git update-ref -d` / `wt-helper merge-back` —— 這些不經 planner 的動作仍禁止；安全集合的 `wt-helper cleanup`、已 landed batch 的 `wt-helper batch cleanup` 與歷史 retirement 只能由 § 3.5／§ 3.5.1 的 canonical entrypoint 執行
- ✅ **`git stash drop` 是例外，且是 MUST 不是 MAY**：通過 [[commit.detail]] § Stash 自動處置 gate **全部**判準的 stash，Step 3.2 **MUST** 主動 drop + 留痕，**NEVER** 留給 user。判準未過、或跑不出明確結論的才寫進 audit 段
- ❌ 把 audit 條目改寫進 `## In Progress` / `## Blocked` 段 —— audit 是「待清紀錄」，不是 in-progress 工作
- ❌ park 跑時在 chat 訊息輸出 audit 全文或摘要 —— 完全靜默寫入 HANDOFF.md（避免雜訊干擾交接收尾）
- ❌ 偵測到無 worktree + 無 stash 就跳過整段 —— **仍要寫**「## Worktree & Stash Audit」段，內含 `No linked worktrees.` + `No stashes.`，讓接手 session 能確認 audit 已跑過、結果為空

## Output contract

- Codex native branch：upstream 保留責任；native subagent receipt 只證明 bounded work 已回報，**NEVER** 宣稱 successor 已接手或「目前這裡收工」。缺 native capability 時回具體 blocker，不啟動外部 launcher——唯一例外是 user 點名的 create-only `--launcher devin` bounded worker，dispatch receipt 只證明 worker 已派出，upstream 以 `--coordinate` 收割
- `relay` / `fanout`：成功 = durable brief 已存在 + helper 回傳 `relay_dispatched` + （fanout）`relayed_dispatch_ids` 已逐筆比對通過 + runtime cleanup 已盤點 + parent worktree lifecycle 已 `removed`／具名 `retained`；完成訊息首行逐字包含「目前這裡收工」，之後不再工作或輪詢。`relay_refused`／`transport_error` 保留 pane 且不得假裝完成（見 [dispatch-common.md](dispatch-common.md) § 5）
- park：成功 = **進入條件已滿足**（user 顯式打 `park`，或裸 `/handoff` 已取得 user 允許）+ HANDOFF.md / plan（未遷移 consumer 為 tech-debt）/ ROADMAP 有對應寫入 + tasks 檔已清 + Step 3 audit 已靜默寫入 HANDOFF.md `## Worktree & Stash Audit` 段；訊息只含升級摘要（不含 audit）。**未取得允許就寫入 = 失敗**，即使檔案內容正確
- next：成功 = 2B.0–2B.5 每一個 sub-step 都照各自段落執行完（含 2B.2.5 的每一張卡主動 triage、2B.1.9 不存在時明講跳過）+ 盤點訊息與詢問操作已發出 + user 選定後 2B.5 dispatch 已完成
- 失敗 / blocked：明確說明卡點，不假裝完成

## 與其他 skill 的銜接

- `/commit` — park 升級 WIP 時，commit 走此 skill 的 selective stage
- `/specify` / `/tasks` / `/implement` — 已授權的需求建立、拆解與實作接續；brief 保留明確 carrier 路徑與剩下的 phase
- `/oops` — next 2B.0 sweep missed lessons 時的 dispatch 目標（pitfall / memory / lessons.md 三層分流；屬 maintenance/full capability，不是每個 consumer 都有）
- `capabilities/core/references/implement-executor/` — next 詢問操作 user 選 parallel 後，subagent fan-out 依此 executor reference 執行


# Runtime adapter: Claude

Claude Code native question handling uses `AskUserQuestion`; session work inventory uses `TaskList`. Background successor execution uses the canonical Herdr helper through `Task`/`Agent` only for bounded execution, with `TaskOutput`/`TaskStop` and the single inert `ScheduleWakeup` keepalive. These Claude tool names are adapter details; they do not authorize mutation or replace durable handoff receipts.
