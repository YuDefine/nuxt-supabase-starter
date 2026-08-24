<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 自主判定 predicate 與 Decision Packaging

> 主檔 pointer：Step 3.2 判自主、Step 4b 做 packaging，兩處都 MUST 先完整讀本檔。

## 核心命題

Loop 的價值不在「做完可自主的事」——那部分合併前的 `/change-loop` 已經證明可行。價值在**非自主的那些條目怎麼處理**。

`log + skip` 是最直覺也最沒用的做法：Charles 的 HANDOFF / tech-debt 裡需要他拍板的比例本來就高，skip 掉之後 loop 每輪都在重掃同一批跳過的東西，fingerprint 不變、三輪後自己停掉，而 Charles 回來看到的還是原封不動的清單。**等於沒跑。**

正確做法是把「等人」從**阻塞**改成**準備**：loop 不能替 Charles 決定，但能把決策從「要花 20 分鐘讀 code 才答得出來」壓成「看兩行選項就能答」。他答完的每一條，下一輪就變成可自主輸入。

---

## Iron Law：能給出推薦就去做，NEVER 寫成選項退回去

**判定順序是「先問我能不能決定」，不是「先問要不要問人」。**

如果你能對一個 item 寫出「推薦 A，理由是 X」而且理由站得住 —— **那個決策已經做完了**，把它寫成三個選項送到 `## ⏳ Awaiting Charles` 只是把已完成的工作退回給人，然後停下來等他覆述你的結論。這是**拖慢**開發，不是謹慎。

**Packaging 是 fallback，不是 default。** 只有在你**真的選不出來**時才 packaging：兩個以上方案各有真實 trade-off、用專案內可得證據判不出優劣、而且選錯不是當場可逆。三條要**同時**成立。

判斷自己是不是在假裝選不出來，用這條檢查：**寫得出 `(推薦)` 標記嗎？** 寫得出就是選得出來，去做。

2026-08-05 round 1–3 的實際違反：四條 packaged item（`telemetry-產地盲區` / `handoff-baseline-rotate` / `TD-360-分母` / `TD-330-session-tasks`）**全部**寫了推薦 A 且理由建立在當輪實測的事實上，卻一條都沒執行。Charles 的回應逐字：「等我拍板的那些問題 其實你都能決策的話 也是在拖累開發速度」。

**NEVER** 用以下理由把可決定的事 packaging：

- ❌「這動到標準層，要 publish」— publish 現在 agent 可自行 invoke（見 § predicate 4 的 carve-out）
- ❌「讓 Charles 確認一下比較保險」— 可逆的事不需要保險，不可逆的才需要
- ❌「他可能有我不知道的偏好」— 有就會推翻，推翻的成本遠低於停下來等
- ❌「選項寫得很清楚了，讓他挑就好」— 寫得出清楚選項＝你已經有答案

### Iron Law 的唯一例外：predicate 7

本 Iron Law **不適用於**命中 § 第一部分 predicate 7（放寬約束自身的門檻）的 item。那類 item
**MUST** packaging，即使你寫得出推薦、理由也站得住 —— 「我有好理由」在那一格恰好**不是**
可自主的證據。判定順序是：**先走完七條 predicate，再回頭套 Iron Law**，**NEVER** 因為
「我寫得出推薦」就跳過 predicate 7 不查。

---

## 第一部分：七條 AND predicate

**全部成立才算可自主。任一不成立 → 先回上面的 Iron Law 再判一次；確定選不出來才走 § 第二部分 packaging，NEVER skip。**

**每一個** candidate 都 MUST 逐條走完七條，不是只查前幾條、也不是只查「看起來有風險的那幾條」。predicate 7 的失敗型態正是**其餘六條全過**（見該條說明）。

| # | Predicate | 怎麼機械判定 |
| --- | --- | --- |
| 1 | **單 repo scope** | 條目文字不含其他 consumer 名（對照 `~/offline/clade/registry/consumers.json` 的 `id` 清單）、不含「全 fleet」「所有 consumer」「散播」 |
| 2 | **動標準層要走完整散播** | 落在 `rules/`、`plugins/hub-core/`、`AGENTS.md`、`vendor/`（clade 端）或帶 `🔒 LOCKED` banner 的檔**可以改**，但 **MUST** 改完走 `/clade-publish` Step 1–9 散播完畢，**NEVER** 改完擱著。做不到就 packaging |
| 3 | **不需開新 change** | 條目不含「需 propose」「要開 change」；且預估涉及檔案 ≤5、不動 schema / API / 行為契約 |
| 4 | **可逆** | 產出落在 worktree branch、本 repo commit、或**可 revert + 重新 publish 的散播**。**不含**：prod 部署、刪除 branch / tag / 遠端資料、任何花錢的 API 呼叫、`--force` 類操作 |
| 5 | **Actionability 足夠** | 通過 `rules/core/handoff.md` § Outstanding actionability hygiene——有 audit 來源 + 檔案 list + target 形狀 + scope boundary。**或**：缺的部分能靠一次唯讀調查補齊 |
| 6 | **無決策標記** | 不落 `awaitingUserDecision` bucket；文字不含指向 user 的問句、不含「拍板 / 決策 / confirm / 二選一 / A 或 B / 待 user」、未標 `@charles` |
| 7 | **不放寬約束自身的門檻** | 這個改動**放寬**下列任一者 → 判定不成立，MUST packaging：(a) 判定 agent 行為合不合格的數值門檻 / 常數；(b) gate / hook / audit script 的觸發條件；(c) 規約裡約束 agent 自身行為的 NEVER / MUST 行；(d) 本檔這七條 predicate 自身。**方向就是判準**：收緊、或不動判定基準 → 成立 |

**Predicate 4 是 human gate 的機械化，沒有例外旗標。** 「這次很安全」「反正可以 revert」都不是判斷空間——判定看的是動作類型，不是你對風險的估計。

### Predicate 7 —— 其餘六條全過正是它的形狀

`/handoff-loop` 是無人值守的。放寬自身門檻的改動落地時沒有人在看，而它**合規到不會觸發任何
warn**：單 repo、落在 `vendor/` 可 revert、涉及檔案 ≤5、無決策標記、actionability 足夠 ——
predicate 1–6 逐條都過。**所以「六條全過」對本條零訊號，NEVER 拿它當本條也過的理由。**

predicate 4 問的是「可不可逆」，而放寬自己的上限**完全可逆**；predicate 6 問的是「有沒有決策
標記」，而條目沒被寫成問句**不代表**它是授權。這兩條在此處都不是弱一點，是**零覆蓋**。

**方向是唯一判準，不是「影響大不大」**：收緊門檻（加一條 gate、把閾值調嚴、補一條 NEVER）
**不**命中本條，照常自主執行。命中的只有放寬——把數字調鬆、把 gate 的觸發條件縮小、把某類
情況從 NEVER 裡挖掉、把 predicate 拿掉一條。

**逐字反制**（來源：`docs/tech-debt.md` TD-391 記載的 baseline rep 4、與 TD-386 entry 本文）：

| 讀到自己在想 | 現實 |
| --- | --- |
| 「這個門檻本來就訂錯了，我只是校正」 | 校正與放寬在**輸出上完全同形**——都是把數字改成對自己更寬鬆的值。訂錯的舉證責任在提案者，而無人值守時沒有人能接受那份舉證 |
| 「機械段的大小不是人在控制的，把它算進門檻不合理」 | 這正是 TD-386 的逐字論證，也正是本條要攔的那一類。論證成不成立與**誰有權批准**是兩件事 |
| 「我對這個做法有明確傾向、也寫得出理由」 | rep 4 的下一句就是答案：「但『我有好理由』不等於『我可以自己批准放寬管我的上限』」 |
| 「它可 revert，出事再改回來就好」 | 可逆性對本失敗型態零訊號（見上）。會被 revert 的前提是有人發現，而放寬門檻的直接效果就是讓它更不容易被發現 |

**累積形狀**才是代價：每一步都有好理由、每一步都可 revert、沒有任何一步會被 audit 抓到，
而 agent 逐步鬆綁管自己的門檻。單看一步永遠划算，這是本條不交給個案判斷的原因。

本證據決定：命中本條時走 packaging。
本證據不決定：要不要動門檻本身——**NEVER** 拿本節論證「門檻不該改」。門檻常常真的該改，本條
只管**誰批准**。

### 判不出來時的三步

**NEVER** 把「判不出來」直接當成「必須等人」。依序做：

1. **唯讀補事實**：Read 條目引用的檔 / 跑 `git log --oneline -5 -- <path>` / grep 相關符號。多數「判不出來」是因為條目寫得含糊，不是因為真的需要決策。必讀來源 ≥4 檔 → **MUST** 先派 pre-scan（[dispatch-topology.md](dispatch-topology.md) § 主線即時組的 pre-scan 前置判定），拿 report 再重判
2. **重判七條**：拿補到的事實再走一次上表
3. **仍判不出來** → 當作非自主，走 packaging。**但 packaging 的內容 MUST 包含步驟 1 補到的事實**——那正是讓 Charles 快速決策的材料

---

## 第二部分：Decision Packaging SOP

非自主 item **MUST** 做完以下三件，缺一不算 packaging。

### (a) 唯讀蒐證

把 blocker 的**具體事實**查清楚，不是複述條目原文。至少要有：

- 這條實際卡在什麼（缺決策 / 缺外部依賴 / 缺權限 / 規模需開 change）
- 涉及的具體檔案路徑與行號
- 已知的約束（既有 rule / spec / 上游 changelog 講了什麼）

**NEVER** 從條目標題推測 blocker 原因——per `/handoff` § 2B.2.5，MUST 到實際位置抽。必讀來源 ≥4 檔 → **MUST** 先派 pre-scan（[dispatch-topology.md](dispatch-topology.md) § 主線即時組的 pre-scan 前置判定），拿 report 再成稿。

### (b) 抽 startable 子集先做掉

**這一步最常被跳過，也是 packaging 與 skip 的實質差別。**

一條 item 需要拍板，**不代表整條無事可做**。典型：五個步驟裡只有第三步需要 Charles 選 A 或 B，前兩步早就能做。

**MUST** 判斷有沒有未 blocked、現在可開工的子集；有 → 依 Step 4a dispatch 做掉（它自己要通過七條 predicate）。做完在 packaging 內容裡註明「子集已完成，剩餘部分需拍板」。

### (c) 寫成 2–3 個排序過的選項

格式硬性要求，**每一項都要有**：

- **選項標籤**（≤10 字）+ 一句「這樣做會怎樣」
- **推薦哪一個**（第一項標 `(推薦)`）+ 一句理由
- **選了之後的 dispatch 指令**——Charles 答完，下一輪 loop 或下一個 session 能直接照著跑

**NEVER** 寫「等 owner 拍板」「卡外部依賴」這種無法行動的模糊句。外部依賴要明列**在等什麼 signal**。

**item 是「某個門檻超標」時，選項組另受 [[threshold-remediation]] 的幅度紀律管**：每個選項 MUST
標出**預期降幅**，而 **降幅 < 超標量的選項 NEVER 進選項組、更 NEVER 標成推薦**。整組都不夠時
**MUST 回 (a) 補事實把範圍擴大**，NEVER 端出一組「最接近的那個」——2026-08-12 clade HANDOFF 超標
packaging 的三個選項沒有一個清得掉超標量（42.8 KB vs 門檻 35 KB，推薦的 A 只降約 4 KB），Charles
答完照著執行仍然超標，等於整輪 packaging 白做。

### (d) 兩處落檔（缺一這條決策永遠問不出去）

| 位置 | 內容 |
| --- | --- |
| state `awaiting[]` | 完整條目：`id` / `title` / `packagedAt` / `round` / `blocker` / `startableDone` / `options[]`（`key` / `label` / `effect` / `recommended`）/ `rationale` / `nextStep` / `requiresSpecificConsent` / `state`。欄位與下方 § 第三部分段模板一一對應。**permission classifier 要求具名 shared-action consent 的題目 MUST 設 `requiresSpecificConsent: true`**——漏設會讓 [decision-drain.md](decision-drain.md) (a) 的 `requiresSpecificConsent !== true` 護欄恆為真，該題被當自主 item prune 掉 |
| state `packaged` | `{"<item-id>": "<ISO>"}` 投影，供 Step 2 排除用 |

`awaiting[]` 是 [decision-drain.md](decision-drain.md)（Step 2.7 開場清算）的**唯一輸入**——只寫 HANDOFF 段不寫 `awaiting[]`，這條決策就永遠不會被端到 Charles 面前，退回清算閘存在之前的單向累積狀態。**NEVER** 只寫其中一邊。

---

## 第三部分：`## ⏳ Awaiting Charles` 段模板

寫進 `$MAIN_WT_PATH/HANDOFF.md`。**Append 不覆寫**——Charles 尚未回答的舊決策不能被本輪沖掉。已回答的由 Step 2.7 (c) 當場刪除對應 `###` 子段。

**本段是人讀渲染，NEVER 是狀態來源**——清算讀的是 state `awaiting[]`（見 (d)）。兩邊不一致時修的是渲染。

```markdown
## ⏳ Awaiting Charles

### `<item-id>` — <一句話標題>

_Packaged <ISO> · round <N>_

**卡在哪**：<具體 blocker，含檔案路徑 + 行號>

**已做掉的部分**：<startable 子集完成了什麼；沒有就寫「無可先行子集」>

**選項**：

| # | 做法 | 會怎樣 |
| --- | --- | --- |
| A **(推薦)** | <≤10 字> | <一句話後果> |
| B | <≤10 字> | <一句話後果> |
| C | <≤10 字> | <一句話後果> |

**推薦 A 的理由**：<一句話，建立在「卡在哪」列出的事實上>

**答完怎麼接**：`<具體指令 / 下一輪 loop 會自動做什麼>`
```

### 寫作禁令

- ❌ 只給選項不給推薦——把分類負擔丟回 Charles，違反 packaging 的目的
- ❌ 選項超過 3 個——超過就是還沒收斂，回 (a) 補事實
- ❌ 「詳見 `docs/xxx.md`」當作唯一指引——per `rules/core/handoff.md` § Outstanding actionability hygiene，by-reference handoff 讓讀者重跑 investigation
- ❌ 把 loop 自己能查到的事實寫成問題問 Charles——那不是決策，是偷懶
- ❌ 排程型選項（「N 週後再看」）——per user AGENTS.md § 不要把工作往後放

---

## 對照表：skip vs packaging

| 情境 | ❌ skip 的樣子 | ✅ packaging 的樣子 |
| --- | --- | --- |
| TD 需要選型 | 「TD-402 — skipped（需 user 決策）」 | 「TD-402 packaged：卡在 `src/db/schema.ts:88` 的 grain 二選一；已完成前置的 index 補齊；A(推薦)/B 兩案 + 各自後果 + 答完直接跑 `/wt td402`」 |
| 條目太模糊 | 「ambiguous item，skipped」 | 先唯讀調查補齊 → 多數變成可自主直接做；真的還模糊 → packaging 內含調查結果 + 「這條原始描述缺 X，補上 X 後就能做」 |
| 要動標準層 | 「動 rules/，skipped」 | packaging：說明要改哪條 rule 的哪一段、為什麼、改完要 propagate 到幾個 consumer、答完跑 `/bp` 還是直接改 |
