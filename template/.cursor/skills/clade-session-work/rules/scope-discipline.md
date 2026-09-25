---
description: Scope discipline 規則——不擴散、必登記、不擅改他人成果，避免 AI 工作流吞掉 WIP 或把範圍外問題靜默遺失
paths: ['tasks/**', 'specs/**', 'ROADMAP.md', 'docs/tech-debt.md', 'docs/decisions/**', 'HANDOFF.md']
---
<!-- Clade native rule; source: rules/core/scope-discipline.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Scope Discipline

## 正確的 scope discipline

三件事同時成立，少一項都算違反：

| 要素 | 意思 | 反例 |
| --- | --- | --- |
| **不擴散** | 當前 task 範圍外的檔案 / 模組，不順手改 | 改 A 檔順便重構 B 檔 |
| **必登記** | 途中發現的問題、技術債、改進點一律登記 | 「這不在 scope，先不管」然後永遠消失 |
| **不擅改他人成果** | 保留未知 / 未提交 / 跨 session 變更，先查歸屬與授權 | `git reset --hard`、`git checkout --` 直接清場 |

## 意外發現的登記路徑（強制）

發現範圍外問題時，**MUST** 選一條路徑登記：

| 發現類型 | 登記位置 | 做法 |
| --- | --- | --- |
| 技術債 / bug / 邊界情況 | `docs/tech-debt.md` | 建 `TD-NNN` entry，並在當前 change `tasks.md` 加 `@followup[TD-NNN]` |
| session 尚未完成的 WIP / blocker | `HANDOFF.md` | 留下目前狀態、阻擋原因、下一步 |
| 未來要做但尚未開工的工作 | repo 根目錄 `ROADMAP.md` `## Next Moves` | 以 `high/mid/low` + 依賴關係記錄 |
| 當前工作本身的 scope 漏項 | 當前 tasks 檔加一條；動到規格時回交 truth owner skill | **NEVER** 就地改 `specs/truth/**` |
| 架構層級決策 | `docs/decisions/YYYY-MM-DD-<topic>.md` | 用 ADR 格式記錄 |

**登記後才能回到當前 task。**

## 未知變更的處理方式

看到以下任一狀態時，先保留內容並執行下方歸屬探測。判斷依據是實際所有權與本任務授權，不能只因路徑陌生就交由使用者調查：

- `git status` 有你不認得的 modified / untracked 檔案
- 有不屬於當前 scope 的 active change / worktree / stash
- `specs/plans/NNN-<slug>/` 或 `tasks/` 裡出現你不清楚來源的 artifact
- **hook / automation 自動產出的 working tree 變動**：
  - pre-commit / post-commit / sync-vendor 等 hook 自動建立 / 刪除 / 移動的檔案或目錄
  - hook 自動寫入的 annotation（例：`(claude-discussed: ...)`、`(verified-*: ...)`、`@followup[TD-NNN]`）
  - hook 自動觸發的 archive directory（`docs/archives/<YYYY-MM>-*.md`、`screenshots/<env>/_archive/`）
  - hook 自動 propagate 到 spec.md / rule 投影層的內容
  - chmod 設定的 LOCKED projection 改動

正確流程：

1. 逐路徑記錄現況，唯讀查證 session / 使用者 / subagent / hook / automation 的來源
2. 依下方歸屬探測判定本次可操作的精確範圍；需要協調時使用已授權、當前可用的通道
3. 無法查明或缺少處置授權的內容保持不動，向使用者呈現具體待決事項

**自動產出具有 WIP 的所有權保護**：hook / sync-vendor 產生的內容同樣需要查明來源。已驗證為本次 hook 的 index 殘留時，走 [[commit]] 的 `MM` recipe；其他 automation 產物依歸屬與既有授權處理。**禁止**只因「這違反 X rule 應該還原」就處置；無法確認的內容保留，不自行判成可丟棄。

## Rule 衝突解法（preserve > revert）

偵測到「rule A 被 rule B / hook / 其他 session / automation 違反」的當前狀態時（例：`manual-review.md` 規定 `[discuss]` items 應由使用者 walkthrough，但 hook 自動勾 `[x]` + 寫 `(claude-discussed:)` annotation），**MUST** 走以下流程：

1. **保留現狀**（preserve）— **NEVER** 動手「修正」目前狀態以對齊另一條 rule
2. **歸屬探測**（見下方 § 歸屬探測前置）— 先判到底有沒有歧義存在
3. **使用者決策** — 探測後仍有真歧義時，使用當前 runtime 實際提供的提問介面，列出觀察、可能成因與可選處理路徑；沒有專用工具就以對話提問
4. 依本任務已取得或本次回答的明確指示行動，只操作授權範圍

### 歸屬探測前置（MUST，先於使用者決策）

衝突狀態涉及**檔案歸屬**（別 session / worktree / hook / automation 的 staged 或 untracked 變更）時，
**每一次**都 MUST 先跑歸屬探測，才准考慮把問題交給使用者。**每一條**路徑各跑一次，**NEVER** 抽驗
一條代表全部：

| 要判的事 | 可觀察 predicate |
| --- | --- |
| 這條路徑會不會進我的 commit | 比對本次明確 pathspec、HEAD、index 與 working tree；新檔也要檢查是否在預定 commit tree 中 |
| 那批是不是別人的 in-flight | 對應 claim / journal / dispatch receipt 的 work、runtime/session 與路徑，核對可觀察的寫入者或持有者回覆；mtime 只能當線索 |
| gate 紅燈是不是本次改動造成的 | 以本次預定 commit tree 與相同 gate 的基線比對；只有檔案不在 HEAD，不能推論它不會被提交或 CI 看不到 |
| 我的產物有沒有被污染 | 比對本次操作前後快照、來源與內容，確認變更可歸因且沒有未授權內容混入；檔名相同不足以判定 |

命令塊在 `vendor/snippets/git-recovery/` § 並行 staged 的歸屬探測（**NEVER** 在本檔複製一份，會漂）。

四條答案證明預定路徑與內容均屬本次授權、且與其他寫入者可隔離時：**四條全部給得出答案 ⇒ 不算衝突。** 主線依既有 commit ceremony，以 `git commit --only -- <自己的 paths>` 隔離，
並在收尾一句話說明歸屬與隔離方式，**NEVER** 為此重新詢問使用者。本節不授予新的提交權；任一條答不出來、或探測顯示
雙方改到**同一檔的同一段**（`--only` 隔離不掉）才走上面第 3 步。

**逐字反開脫**（想到這幾句就是探測還沒跑）：

| 開脫 | 現實 |
| --- | --- |
| 「這批是別 session 的東西，依 scope-discipline 應該交還 user」 | 本節攔的是**無法用證據判定**該不該動的推理鏈，不是「只要涉及別 session 就交還 user」 |
| 「這是未知變更 / 我不認得這些檔」 | 先查上表四項；HEAD 是否有該路徑只回答存在性，不回答所有權 |
| 「gate 紅了，這次 commit 過不了」 | 先對預定 commit tree 與 gate 基線查因；新檔或 staged-only 不能直接排除 |
| 「問一下比較安全」 | 過度 escalate 與正確 escalate 在 transcript 上長得一模一樣，差別只在當時有沒有可跑而沒跑的探測 |

> 對應 pitfall [[pitfall-mechanically-decidable-conflict-escalated-to-user]]（<consumer-b> 實例）：可探測的衝突要自己探測決策，不交給 user。

「rule A 規定 X，但現況被 hook／別 session 做成 Z，所以該 revert 對齊 rule A」這條推理鏈是非法的：rule 衝突時預設保留現狀，當前 session 沒有 rule 仲裁權。

**授權來源是使用者對具體對象與動作的明確指示**，例如「請還原這個檔的這段修改」（session 在 Herdr pane 內時要點選 structured user-input 選項才算，見 [[session-tasks.operations]] § Herdr session transport）。本任務已有的同範圍授權持續有效；不因換了 runtime、提問工具或出現關鍵詞而重問。沒有具體授權時維持 preserve。

### 具體分支模板：當前 flow 規約要求「必修」撞別 session WIP

最常見情境：`/commit` 跑 review / lint / typecheck / test 發現問題 → `commit.md` 規約「MUST 修，NEVER 以建議性質 / 不在本次範圍為由跳過」→ 但修法會動到別 session in-flight WIP（典型：`HANDOFF.md`、別 session 的 `tasks/<...>.md`、其他 active change 的 artifact）→ 撞上「不擅改他人成果」。

此時 **MUST** 先跑 [[session-tasks]] § 並行爭用 的 Step 0 判出持有者性質，再依下列**三個固定選項**處置。順序是規約的一部分：**A0 排在 A / B 之前**，A / B 只在 A0 判定不適用、或 A0 已送出而爭用未解時才輪到。查不到持有者時保留 WIP；沒有通道或本次訊息授權時，回報這個具體缺口，不假裝已經協調。

- **A0. 先跟持有者對話**（持有者是**前景 agent session**，且已取得協調授權並有可用通道時 MUST 先走）— 以當前通道送達精確 session；Herdr 通道已驗證可用時使用 `herdr agent prompt <對方 pane_id> "<四項>"`，不把它當所有 runtime 都有的 API。四項內容與逐字範本見 [[concurrent-session-probe]] § 探測之後：協商（negotiate）。依對方回覆分流：對方說它正要 land → 等它落地再重跑當前 flow；對方說那批無主 → 進 A；對方說它要接手 → 進 B，且 TD 內文 MUST 寫明接手者是誰。送出後 MUST 指名等到哪一個可觀察事件（對方回覆、或那幾個檔不再 dirty），上限 5 分鐘，逾時升級路徑同該 cookbook。持有者是 **unattended runner**、判不出持有者、缺通道或缺本次協調授權時，A0 不執行，保留具體原因再看 A / B
- **A. 馬上修，回 flow 繼續** — 在當前 session 直接編輯該 WIP 檔，原 flow（`/commit` / `/handoff` / 等）繼續走完。前提：A0 已送出且對方不反對（或 A0 不適用），且 user 確認該編輯不會跟別 session 的修改互踩（或別 session 已結束）
- **B. 登 TD，放棄當前 flow** — 把問題寫進 `docs/tech-debt.md`（編號 `TD-NNN`），當前 flow **立即中止**（commit 不繼續、archive 不繼續），等別 session 結束後由 user 決定何時處理；已成功 commit 的 group 保留不動

**A0 的等待終點是單一布林：對方 land 了沒有。** 回覆或詢問持有者時 **NEVER** 帶 commit 顆粒（拆幾筆、哪一筆先 land、哪一批先解誰的阻塞）——下游 publish 帶全部 commit、`/commit` Step 3 自理分組，對顆粒零依賴。判準：對方拿這句話會做出不同的動作嗎？不會就刪。

**A 與 B 之間的二選一 MUST 交給使用者決定**，透過當前 runtime 的提問介面或對話，已有對該具體處置的答案就沿用。A0 是已授權的協調動作，不能用一個替代問題跳過它。

**選 B 之前 MUST 先跑 [[session-tasks]] § 並行爭用 的 Step 0 確認「別 session」真的會結束。** 對方是 unattended runner 時它不會在可預期時間內停，「等它結束」等於把 flow 無限期掛起——判出是 runner 就直接登 TD 並讓位，**NEVER** 把中止理由寫成「等對方結束」。

**NEVER** 在可執行的 A0 尚未發生時就把 A / B 丟給使用者 — 持有者是前景 agent session，且本次已有協調授權與可用通道時，先聯絡持有者。「我不動別人的檔」**NEVER** 讀成「我什麼都不做」：不動檔與不溝通是兩件事。

**NEVER** 自行在 A 與 B 之間二選一、自行 commit 略過該檔、自行用「不在 scope」當理由跳過 — A0 解鎖的是**對話**，不是**代替 user 拍板**。

少了 A0 的選項清單本身就在把決策往人推（[[pitfall-cross-session-blocker-escalated-to-human-instead-of-peer]]）。

## 破壞性指令的 guardrails

下列工作檔丟棄／覆寫操作 **MUST** 有使用者對具體範圍的明確同意。Subagent 的 brief 未包含該授權時，只回報現況；已授權的例行編輯與 [[commit]] 的 index-only recipe 分別按其副作用及所有權判定，不由命令名稱推導丟棄權。

### Git 命令

- `git reset --hard`
- 會覆寫工作檔的 `git checkout -- <paths>` / `git restore <paths>`（含 `--worktree`）
- `git clean -fd` / `git clean -fdx`
- `git revert <commit>`
- `git stash drop` 依 [[commit.detail]] 的精確 stash ownership／處置 gate；`git stash clear` 不作為逐條處置替代

### 檔案系統等效動作

以下動作功能上等同破壞性 git 命令，同樣受本 rule 限制（含包在 shell / Python script 裡的批次操作）：

- `mv` 反向搬 hook 建立的 archive directory 或其他 tracked 路徑
- `rm -rf` 批次刪除 `specs/**`、`tasks/**`、`screenshots/**` 等 user-authored 或 hook-authored 內容
- `cp -f` / `cp --remove-destination`、`echo >` / `cat >` / `tee` 覆蓋 tracked 檔
- `sed -i` / `awk -i inplace` / `perl -i` 覆寫未授權內容；合法編輯依 [[commit]] 的範圍與可審查 diff 契約

### 總原則

工作檔丟棄／覆寫與 index-only 操作分別依 [[commit]] 的 WIP 與 staged 所有權判準處理；Git、shell、editor 與 subprocess 使用同一個副作用判準。操作會丟棄或覆寫未獲本任務明確授權處置的內容時，**MUST** 保留現況並向使用者確認。Index-only 不代表可任意改他人的 staged 選擇；hook `MM` 的完整處置條件與既有授權的邊界均以 [[commit]] 為準。

判別測試：操作動到哪些 working tree／index／ref／外部狀態，內容所有權能否確認、是否在本任務授權內？不在 Git 中的內容同樣要保護，存在於 history 不等於 WIP 已保存；命令可逆不等於已獲授權。不明就停手。

## 話術關鍵詞 = 立即停手訊號

準備執行或提議現況修改時，依 [[commit]] § 話術關鍵詞的動作表核對副作用、所有權與既有授權；對象或授權不明時 **MUST** 停手。只讀調查、指令引用與已授權文件編寫依同表處理，不把詞彙命中當成修改或丟棄內容的授權。

### 關鍵詞清單

中英全表見 [[commit]] § 話術關鍵詞 = 立即停手訊號——**該表是 SoT，本檔不複製**。

指標方向固定 conditional（本檔）→ always-load（`commit.md`），不可顛倒。

### 停手定義

「停手」意指：

1. **NEVER** 執行未獲授權的丟棄／覆寫；工具所謂的試跑若仍有寫入副作用，**包含 dry run**，同樣保持不執行
2. 不把未知成果包裝成可丟棄的清理工作；可先唯讀查證，真正唯讀的預覽不改變授權狀態
3. 唯讀釐清後仍需要使用者決定時，**MUST** 透過當前 runtime 可用的提問介面呈現當前狀態、具體衝突與選項（含「保留現狀不動」）
4. 取得使用者明確指示後才繼續

把破壞性動作包裝成「**清理**」「**重置**」「**回到乾淨狀態**」「**對齊規約**」「**修正一下**」等委婉說法繞過本節，**同樣違反本 rule**。委婉說法仍是話術關鍵詞，仍觸發停手訊號。

## Subagent brief 最低要求

委派 subagent 時，scope discipline 段落至少要包含：

```markdown
## Scope Discipline

- 範圍外檔案不要順手改
- 意外發現其他問題：不修，但必登記
- 看到不認識的 uncommitted 變更 / hook 自動產出 / archive directory：停下並回報
- 未含具體授權時不丟棄工作檔、不改他人 staged 選擇；index-only 依 commit 的完整判準
- 禁止用 mv / rm -rf / cp -f / sed -i / 覆蓋 redirect 反向 hook 工作或丟棄 working tree 內容
- 看到 rule A 被 rule B / hook 違反：保留現狀，先查歸屬；未解歧義以當前提問介面回報，不自行對齊
- 準備丟棄／覆寫內容且對象或授權不明：依 commit 動作表停手，保留現況並釐清
```

派工參數（runtime、model／effort、獨立上下文）依 [[agent-routing]]；需要 fresh checker 時依 [[checker-subagent]]。

## 已決 scope 不可重開

當專案內存在**明確記錄的 scope 決策**（`docs/decisions/`、discussion artifact、lessons.md、或後續 supersede 紀錄），agent **MUST** 視為已定案。後續 session 只討論「怎麼做」，**NEVER** 把「是否要做」重新當開放問題。

**可觀察 predicate**：agent 正在產出的文字含「是否需要」「要不要做」「可以考慮排除」「scope 可能不包含」等措辭，且對象是已有 decision artifact 的 feature → 停，讀 decision artifact 確認。

## 交付物必須是可追蹤檔案

User 要求報告、分析、比較、盤點等輸出時，交付物 **MUST** 是一個有路徑的檔案（`.md` / `.json` / `.csv`），**NEVER** 是 chat 訊息裡的 inline 文字。

正確 recipe：
1. 以當前可用的檔案編輯工具寫到 `docs/` 或 `tasks/` 或 user 指定位置
2. 在 chat 回報路徑 + 一句話摘要
3. 需要跨 repo 共享時，指定單一 owner repo + 用 diff 或 snapshot 機械比對

## 開放式策略問題不過早路由到 SDD 流程

User 提出**跨產品、商業模式、系統邊界**的大範圍策略題時，**MUST** 先獨立分析再決定是否進 SDD 流程。

**可觀察 predicate**：user 的問題未指名任何具體 module / file / endpoint，而是問「我們能提供什麼」「這兩個產品的關係」「商業模式怎麼切」等探索性問題 → 先做分析（寫成檔案，per § 交付物），分析完 user 明確說「開一個 plan package」時才走 `/specify`。

**NEVER** 對策略題直接跑 `/specify` 或 `/spec-by-example` — aixbdd 是實作工具，不是策略分析框架。

## 禁止事項

- **NEVER** 把「超出 scope」當成忽略發現的理由
- **NEVER** 把未知變更或 hook / automation 產出當作「上次沒清乾淨」直接清掉
- **NEVER** 讓 subagent 把一般實作 brief 當成丟棄工作檔或改他人 staged 選擇的授權
- **NEVER** 寫只有「不擴散」沒有「必登記」的 brief
