---
description: 決策結構標準（唯一 SoT）——決策點的形狀、固定格式、做到哪一層（D1～D*）、每張決策表必帶第三態／assumption／retire_if／決策紀錄；任何 consumer 被要求建決策樹、決策表或標準判斷流程時讀（說「決策樹」一律做成決策表，不畫樹）
moment: 要在 skill、rule、plan 或文件裡寫分流、判定表、決策樹或標準判斷流程，或要決定一個決策做到哪一層（閘門、CLI、文件決策表）
paths:
  - '.claude/skills/**/*.md'
  - '.agents/skills/**/*.md'
  - '.clade/rules/**/*.md'
  - '.claude/rules/**/*.md'
  - 'rules/**/*.md'
  - 'capabilities/**/skills/**/*.md'
  - 'specs/plans/**/*.md'
---
<!-- Clade native rule; source: rules/core/decision-structure.md; edit canonical source -->

<!-- clade-targets: claude,agents -->

# Rule 1 - 決策點的 predicate 全部可機械取得時，判定交給 CLI，文件只寫代碼對應動作

- Level: `MUST`
- 決策點：step 執行到此，必須在 2 個以上互斥的下一步動作或產出之間選一個。單一條件的 guard（「若 X 則跳過」）不算決策點。本條是「決策點」與「可機械取得」的唯一定義，其他檔只指向這裡。
- 寫決策之前，先逐一檢查每個 predicate 能不能由指令輸出、檔案存在或內容、exit code、env、JSON 欄位取得。
- 全部取得得到 → 由 script（目標 skill 的 `scripts/`，或既有 CLI 加一個輸出欄位）算出分支，stdout 印固定欄位 `route=<代碼>`（或 JSON 的單一欄位）；文件只留一張「代碼 → 動作」表。
- 分支代碼放在 stdout 欄位；exit code 只區分「判定完成」與「工具壞了／用法錯」。工具壞了 **NEVER** 落到任何一個業務分支，一律走 `*` 列。
- 只有部分 predicate 取得得到 → 能機械取得的部分仍交 script 先算成欄位，表格的 predicate 欄直接引用欄位值，只把語意判讀、設計取捨、使用者意圖這類判斷題留給 agent（照 Rule 3 寫決策表）。
- **NEVER** 在文件裡用散文重新推導 script 已算好的判定：兩邊漂移時 agent 會信散文。

## Good Example

- 這個例子是好的，因為 predicate 全由 helper 輸出取得，文件只把代碼對到動作，未知代碼 fail-closed。

```md
1. DELEGATE 執行 `node vendor/scripts/wt-helper.ts detect-main-dirty --json`，讀 `recommended_strategy` 一欄分流：

評估：first-match；以上皆非 → B*
| id | `recommended_strategy` | 動作 |
| --- | --- | --- |
| B1 | `fork-clean` | `wt-helper add`，不帶 baseline flag |
| B2 | `commit-scope` | `--baseline-strategy commit --baseline-scope-paths <helper 印的路徑>` |
| B3 | `stop-unsafe` | STOP，列 helper 印的 unsafe path |
| B* | 其他值、欄位缺、指令非 0 | STOP，回報原始輸出 |
```

## Bad Example

- 這個例子是壞的，因為每個條件都能由指令取得，文件卻用巢狀散文讓 agent 自己推，還和 helper 的判法各說一套。

```md
若 main 有 unmerged 且其中有不安全的檔就停下；沒有的話看有沒有 carrier，有 carrier 且 scope 與 dirty 有交集就 commit-then-fork（理由是這樣 baseline 才不會漏），沒有 carrier 但呼叫端有點名路徑也可以……
```

# Rule 2 - 依決策的形狀選結構，不同形狀不混在同一張表

- Level: `MUST`
- 先判這個決策屬於哪一種形狀，再選對應結構：

評估：first-match；以上皆非 → K*

| id | 決策形狀 | 結構 | 必要欄位 |
| --- | --- | --- | --- |
| K1 | 一次性選擇（選 mode、選落點、選載體） | 決策表，first-match | `id`、predicate、動作，可加「下一步」 |
| K2 | 依序要過的關卡（開場 gate、收工 gate、放行條件） | 編號 gate checklist，逐項過，任一不過即停 | `id`、檢查（附指令）、不過時的出口 |
| K3 | 有生命週期的物件（in-flight 條目、pane、batch 成員） | 狀態轉移表 | 狀態、事件、guard、動作、→ 新狀態 |
| K4 | 排障（症狀已知、真因未知） | 症狀查表，依檢查成本由低到高排 | 症狀原文、區分測試、真因、處置；最後一列「對不上 → 回量測，修完補列」 |
| K5 | 可疊加的附加約束（命中幾條就套幾條） | all-match 清單，與主落點的 first-match 表分開 | `id`、條件、約束 |
| K* | 以上皆非 | 回 Rule 1 確認它是不是決策點；仍判不出形狀就問使用者 | — |

- 同一個決策同時有「選一個主落點」與「附加約束」時，拆成兩個區塊：first-match 只決定主落點，all-match 逐條勾附加約束；**NEVER** 用 first-match 承接可疊加條件（first-match 命中即停，後面的約束不會再被檢查）。
- 任意 bug 的根因調查不是查表題，主體維持假設與量測流程；查表只用在「症狀型態 → 首選量測方式」這類前段分流。

## Good Example

- 這個例子是好的，因為主落點與附加約束分成兩個區塊，同時命中多條約束時不會遺漏。

```md
評估：first-match；以上皆非 → F*
| id | predicate | 主落點 |
| --- | --- | --- |
| F1 | 呼叫第三方 API 且寫入 DB | Edge Function 協調 → RPC 寫入 |
| F2 | 只呼叫第三方 API | Edge Function |
| F* | 以上皆非 | Server API |

評估：all-match（逐條檢查，命中就套用）
| id | 條件 | 附加約束 |
| --- | --- | --- |
| C1 | 用到 API key／secret | 只放環境變數 |
| C2 | 需要定期執行 | 加 cron 觸發 |
```

## Bad Example

- 這個例子是壞的，因為可疊加的約束寫成 first-match 的節，需求同時命中三節時停在第一節，後兩節的約束遺失。

```md
依照由上而下順序檢查，符合即採用。
## 1. 外部整合 → Edge Function
## 4. 敏感資料 → 環境變數
## 12. 排程任務 → Edge Function + Cron
```

# Rule 3 - 決策區塊使用固定格式

- Level: `MUST`
- 區塊第一行宣告評估方式，三選一：`評估：first-match；以上皆非 → <id>*`、`評估：all-match（逐條檢查，命中就套用）`、`評估：巢狀（先判 <第一層>，再判 <第二層>）`。
- 每列以穩定 `id` 開頭（前綴＋序號，如 `W1`）。新增列給新 `id`，**NEVER** 重新編號；跨段、跨檔一律用 `id` 指涉，**NEVER** 用「第四條」「前三條」「上表第 2 列」這類位置序數（插入一列就全部錯位）。
- first-match 與巢狀的每一層，最後一列都是 `*`（以上皆非），出口 fail-closed：STOP 回報、問使用者，或最保守的動作；**NEVER** 留空或寫「視情況」。
- predicate 欄只放可觀察事實：指令與其輸出字串、欄位值、檔案狀態、使用者原話的關鍵字；**NEVER** 寫「看情況」「比較重要時」「需要時」這類判斷不了的詞。
- 一格只放一個動作，約 40 字以內。要寫「三選一」就代表還沒拆完；程序放到 `→ <檔> § <節>` 或 step，理由與事故實證寫成表下 `[^<id>]` 一行註腳。
- 巢狀最多兩層。第二層另開子表，以 `→ <子表 id>` 跳轉，**NEVER** 在儲存格內再寫一棵子樹。
- 例外寫成表內較前面的列，**NEVER** 補在表後的散文裡。

## Good Example

- 這個例子是好的，因為宣告了評估方式、每列有穩定 id、predicate 可觀察、有 fail-closed 的 `*` 列，理由放在註腳。

```md
評估：first-match；以上皆非 → S*
| id | predicate | 動作 |
| --- | --- | --- |
| S0 | `inFlight` 非空 | 不停；回 Step 4 等收割 |
| S1 | `fingerprintUnchangedRounds` ≥ 3 | stop: no-progress |
| S2 | `consecutiveDispatchFailures` ≥ 2 | stop: systemic-failure [^S2] |
| S* | 以上皆非 | 續跑下一輪 |

[^S2]: 連兩次派工失敗多半是環境壞了，再派只會重複燒額度。
```

## Bad Example

- 這個例子是壞的，因為沒有評估方式、沒有預設出口，例外補在表後，散文還用位置序數指列。

```md
| 情況 | 處置 |
| --- | --- |
| 沒有進展 | 停 |
| 看情況需要時 | 改排長間隔 |

另外，inFlight 不為空時第一條不算停；第二條要先清 ledger。
```

# Rule 4 - 一個決策只有一份 SoT

- Level: `MUST`
- 同一個決策只在一個檔裡有決策區塊；其他檔只寫 `判定見 <檔> § <節>`，**NEVER** 重抄任何一列，也 **NEVER** 用散文「摘要」一次。
- 寫或改一個決策之前，先用 `grep` 搜同一個決策的關鍵 predicate 或代碼，找出其他副本；找到副本 → 合併進 SoT，並把其餘副本列入刪除項。
- SoT 是 script 時，script 的輸出代碼表就是唯一定義，文件的「代碼 → 動作」表不另加判定條件。

## Good Example

- 這個例子是好的，因為三個呼叫點都指向同一張爭用判定表，沒有任何一處重抄列。

```md
<!-- clade-publish SKILL.md Step 3 -->
遇到別 session 的 dirty WIP：判定見 `rules/core/session-tasks.concurrent-writers.md` § 爭用判定。

<!-- commit 的爭用段落 -->
publish 在飛時判持有者：判定見 `rules/core/session-tasks.concurrent-writers.md` § 爭用判定。
```

## Bad Example

- 這個例子是壞的，因為同一個爭用判定在三處各寫一份，分類集合已經不一致。

```md
<!-- clade-publish -->：`flow who` 三值 orphan／runner／foreground
<!-- commit -->：持有者分 runner／foreground
<!-- concurrent-writers -->：四類，沒有 orphan
```

# Rule 5 - predicate 必須在做判定的那一步已經取得

- Level: `SHOULD`
- 判定所需的資料要到後面的 phase 才產生時，把判定移到那個 phase 之後，或拆成兩次判定；**NEVER** 要 agent 在資料出現之前先猜。
- 同一張表裡，成本低、能提前排除的列排在前面（例如先看旗標與 env，再跑要量測的指令）。

## Good Example

- 這個例子是好的，因為「是否小修」要用估算出的工時，判定就放在算出工時之後。

```md
## Phase 2 -- 估算工時
1. THINK 依任務清單算出總工時 E。
2. THINK 依 E 判定路徑：
評估：first-match；以上皆非 → P*
| id | predicate | 路徑 |
| --- | --- | --- |
| P1 | E ≤ 8 且使用者只要報價 | 小修報價 |
| P* | 以上皆非 | 完整報價 |
```

## Bad Example

- 這個例子是壞的，因為 Phase 1 就要用 E 判路徑，但 E 要到 Phase 2 才算得出來。

```md
## Phase 1 -- 判定估算路徑
1. THINK 若 E ≤ 8 走小修報價，否則走完整報價。
## Phase 2 -- 估算工時
1. THINK 算出總工時 E。
```

# Rule 6 - 決策要做到哪一層，依錯誤成本與有沒有人在等

- Level: `MUST`
- 建決策表（被要求「決策樹」時也一律產出決策表，不畫樹）或標準判斷流程之前，先判這個決策做到哪一層，並在產出裡宣告層級（`D1`～`D*`）與評估方式。判準看錯誤成本與有沒有人在等，**NEVER** 只看省多少 token。
- 層級只管「誰執行、做成什麼」；表格格式照 Rule 3，形狀照 Rule 2，predicate 能不能機械取得照 Rule 1。

評估：first-match；以上皆非 → D*

| id | 這個決策的判定條件 | 做成 | 誰執行 |
| --- | --- | --- | --- |
| D1 | predicate 全部可由指令、檔案、欄位取得，零例外，違反就不該繼續 | 閘門：hook 或入口檢查，fail-closed | 機器，放在模型碰不到的位置 |
| D2 | predicate 全部可機械取得，結果是分流或建議 | CLI 印 `route=<代碼>`，文件只留代碼表（Rule 1） | 機器算，agent 照表做 |
| D3 | predicate 部分可機械取得，其餘要語意判讀 | CLI 先算欄位，文件決策表引用欄位再判語意 | 機器算欄位，agent 判語意 |
| D4 | 主要是語意或設計取捨，一年只發生幾次 | 文件決策表加決策紀錄，不寫程式 | agent 或 Charles |
| D* | 分支說不出來或一直變（選工具、拆任務、重試策略） | 不做成決策表，交給模型判，閘門只管結果 | agent |

- 腳本值不值得寫，看錯誤成本與有沒有人在等：一次判斷省下的 token 很少（Sonnet 5.5 約 $0.008，參數是假設），只看 token 回不了本。
- 新建與改到的決策表才適用，**NEVER** 為了套本條追溯改存量。

## Good Example

- 這個例子是好的，因為宣告了層級與評估方式，並說明為什麼停在 D2：predicate 全可機械取得，錯了只是分流錯、有 audit 擋順序。

```md
層級：D2（predicate 全由 `wt-helper detect-main-dirty --json` 取得，結果是分流）
評估：first-match；以上皆非 → B*
| id | `recommended_strategy` | 動作 |
| --- | --- | --- |
| B1 | `fork-clean` | `wt-helper add` |
| B* | 其他值、欄位缺、指令非 0 | STOP，回報原始輸出 |
```

## Bad Example

- 這個例子是壞的，因為沒有宣告層級：predicate 全可機械取得卻寫成散文樹交給 agent 推，且只有「省 token」一個理由，沒說錯了會怎樣、有沒有人在等。

```md
決策樹：先看 main 乾不乾淨，乾淨就 fork；不乾淨時視情況 commit 或停下……（沒有層級、沒有評估方式、沒有 id）
```

# Rule 7 - 每張決策表必帶第三態、假設、退場條件與決策紀錄

- Level: `MUST`
- 每張新建或改到的決策表（現有的決策樹要改成決策表），除了 Rule 3 的格式，MUST 帶四樣東西：
  - **第三態**：「資料還沒齊」「規則說不行」「代理變數命中，要人看」分開成不同列，**NEVER** 併成一個「拒絕」。觸發靠結構性訊號（欄位缺、無規則命中、規則衝突），**NEVER** 靠模型自評信心。
  - **`assumption`**：這張表在補什麼不足、靠什麼前提成立。
  - **`retire_if`**：什麼可觀察事件發生時該改或刪（例如某個版本轉正、推翻率累積滿 N 天、換模型世代要重測）。權限與不可逆的閘門不自動退場，`retire_if` 寫「不自動退場，理由：…」。
  - **決策紀錄**：輸入、規則版本或命中的 `id`、結果、有沒有被人推翻與理由。沒有紀錄就算不出推翻率，也判不出這張表該不該留。
- 寫在表的下方（或同檔的表下註腳）。`assumption` 與 `retire_if` 缺一，視為還沒寫完。
- 新建與改到的決策表才適用，**NEVER** 追溯存量。

## Good Example

- 這個例子是好的，因為三種「不通過」分開（還沒齊、不行、要人看），`*` 列 fail-closed，並帶 `assumption`、`retire_if` 與決策紀錄欄位。

```md
層級：D3
評估：first-match；以上皆非 → M*
| id | predicate | 結果 |
| --- | --- | --- |
| M1 | `checks` 欄位缺 | 等資料：晚點重送，不算拒絕 |
| M2 | 命中硬條件（CI 紅、無 review） | 規則說不行：退回 |
| M3 | 只命中代理變數（路徑含 `auth/`） | 要人看：送主管 |
| M* | 以上皆非 | 放行 |

- `assumption`：代理變數（路徑關鍵字）能抓到多數高風險變更；人工複核成本低於放行錯誤。
- `retire_if`：決策紀錄累積滿 30 天且 M3 推翻率 > 90% 且零壞結果 → 改成放行或刪列；硬條件 M2 不自動退場。
- 決策紀錄：`state/merge-approvals.jsonl`（輸入、命中 id、結果、是否被推翻與理由）。
```

## Bad Example

- 這個例子是壞的，因為「不通過」只有一種結果、靠模型自評信心觸發，沒有 `assumption`／`retire_if`，也沒紀錄，這條規則爛掉時沒有任何訊號。

```md
| id | predicate | 結果 |
| --- | --- | --- |
| M1 | 不太有把握時 | 拒絕 |
| M* | 其他 | 放行 |
```
