---
name: notion-ticket
description: "Outbound 在當前 consumer 所屬 Notion hub 建一張新的決策題 ticket，用客戶看得懂的格式問非技術決策者，並埋可貼回 Claude 的接手 prompt 與 HANDOFF 登記。Use when 使用者要建 ticket 問客戶或老闆拍板。NOT for 處理 board 上既有 ticket（走 notion-board），NOT for 未宣告 notion.hub 的 repo。"
---

<!-- clade-skill-scope: both -->

# notion-ticket

> **方向：outbound（Claude 主動發問、建一張新 ticket）。** 處理客戶**已建在 board 上**的 ticket 走 [`/notion-board`](../notion-board/SKILL.md)。判定：要不要**新建一張 page 主動發問** → 本 skill；**處理 board 上已有的東西** → notion-board。
>
> **Runtime**：Notion 讀寫走 Routing Table 〔`notion-ops`〕——Pi `--model gemini --effort high`；exit 2／3／4 → luna（`--route fallback-chain --tier-basis quota-fallback --retry-of <label>`）；luna 再失敗才回主線。**NEVER** 主線第一手自己跑 `ntn`／MCP。客戶看得到的 ticket 正文是定稿措辭：Pi 起草後主線 MUST 收斂重寫才寫入。

把「等客戶 / 老闆拍板才能繼續寫 code」的決策問題，**一鍵打包成可以放著等回覆、回覆後直接接手**的 Notion ticket。

## 何時用

- ✅ 寫 code 前發現有**至少 1 個 user-facing 決策**只能非技術人員拍板（單號顯示哪種、排序怎麼影響出貨、誰能改、要不要 audit log）
- ✅ 拍板問題會**直接決定 DB schema / API contract / UI 改造幅度**
- ❌ 純技術決策（library 選型、檔案結構）— 自己決或問 user
- ❌ 只有 1–2 句確認的小問題 — chat 問即可
- ❌ 純內部、跨 repo 的待拍板題 — 那是 `flow ask` + `/decisions`（clade 自己的決策佇列），不是客戶 ticket

## 座標與 schema（不寫死）

1. `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .` → `hub.board.dataSourceId`（建 page 的 parent）、`project.rowId`（`所屬專案` relation）、`hub.ticketStatus`（狀態字）、`fields.board`（property key）。`configured:false` → 停止並回報。
2. 寫之前 **MUST** 重撈 data source schema（`ntn api "/v1/data_sources/<id>"` 或 MCP `notion-fetch collection://<id>`）校對 property key 與選項——客戶可能手動改過。

新 ticket 的 property 值：

| 欄位（`FIELDS.board`） | 值 |
| --- | --- |
| `名稱` | 客戶看得懂的口語化問題標題（一句話），**禁止**技術術語 |
| `狀態` | `hub.ticketStatus['needs-customer']`（本 skill 產出的票本質就是等客戶拍板） |
| `類型` | `功能調整`（新功能拍板題）/ `需緊急修`（bug 修正類） |
| `所屬專案` | relation → `project.rowId`（**MUST**，否則不會出現在該專案的 linked view，且 `專案` rollup 為空） |
| `提報日期` | 今日（本 skill 自建才設；既有票 NEVER 動） |
| `Work ID` | 已有 work item 時由 `notion-sync.ts open` 寫（格式 `<consumerId>/<workId>`，NEVER 手填）；沒有留空，拍板後 `flow open --origin notion:<page-id>` 再由 `notion-sync.ts open` 補 |
| 其餘（`優先級` / `截止日期` / `修復版本 >=` / `上線日期` / `驗收日期` / `檔案和媒體`） | 留空 |

## Ticket 內容固定 4 段結構

按範例排版，**順序與標題層級不可改**：

```markdown
# 已提交待驗收參考
-
---
# 開發前想跟您確認 {N} 件事
為了把功能做得剛好符合需要，麻煩您看一下下面 {N} 題，每題選一個答案回覆即可。
## 1. {第一題口語化問題}
{背景 2–3 行}
- **{術語 1}**：{日常語言解釋 + 範例}
- **{術語 2}**：{範例}
**{引導句，例如「展開時希望看到：」}**
- [ ] A. {選項 A，給範例}
- [ ] B. {選項 B}
- [ ] C. {選項 C，可省略}
## 2. {第二題}
...
---
# 🤖 Claude 接手 Prompt（給開發者用，客戶可忽略）
> 客戶在上方 {N} 題打勾後，開發者把下列整段複製貼回 Claude Code 即可繼續。
\`\`\`javascript
{self-contained handoff prompt — 見下方「必含 6 段」}
\`\`\`
## 開發者備忘
- 本地 HANDOFF.md 已登記同步條目（{YYYY-MM-DD} {ticket slug}）
- {N} 題答案會直接決定 {schema / API / UI 範圍}
```

> Notion markdown（fence、checkbox、引言塊）與標準 markdown 不完全相同，寫之前 **MUST** `notion-fetch notion://docs/enhanced-markdown-spec` 確認。

| 段落 | 客戶讀法 | 開發者讀法 |
| --- | --- | --- |
| `# 已提交待驗收參考` | 「之前做完的長這樣」 | 驗收時補截圖的固定 anchor |
| `# 開發前想跟您確認 N 件事` | 「我只要打勾就好」 | 拍板紀錄 |
| `# 🤖 Claude 接手 Prompt` | 「不關我事」 | 唯一接手入口 |
| `## 開發者備忘` | 通常不看 | HANDOFF cross-link、決策影響範圍 |

## 客戶問題撰寫規約

**MUST**：標題 = 客戶用自己話說的需求；每題口語化 + 給範例；每題給選項 + 每個選項給情境；題數 3–6；每題只有一個決策維度；**不用任何技術術語**（RPC / schema / DTO / API / table / foreign key / migration 全部禁）。

**NEVER**：讓客戶選技術路徑（「A. CREATE TABLE / B. ALTER TABLE」）；用 `-` 當 checkbox（必須 `- [ ]`）；多題擠成一段散文。

## Claude 接手 Prompt 必含 6 段（順序固定，標題用全形【】）

```
繼續處理 {repo / 模組} 「{需求一句話}」需求（HANDOFF.md {YYYY-MM-DD} entry）。
【第一步 — 先檢查客戶有沒有回 Notion】
用 notion-fetch 撈 page id {page id}（URL: {url}），看 {N} 題 checkbox 哪幾個被打勾。
【{N} 題對應的架構決策】
1. {第 1 題重述} → 影響 {schema / API / UI 變化點}
...
【分流】
- 客戶都回了 → flow open {slug} --origin notion:{page-id}，接著 node ~/offline/clade/vendor/scripts/notion-sync.ts open --work <id> --ticket {page-id}，把 N 題答案 inline 進 plan
- 客戶還沒回 → 別重發提醒，直接告訴我「Notion 還沒打勾」並結束
【{對應 workflow 階段}必填區塊】
- {例如 ## Affected Entity Matrix / ## User Journeys / ## Design Review}
【既有 code pointer，不必再 grep】
- 頁面 / API / migration / Types / Source table / Spec / 下游影響檔：{repo-relative 絕對路徑}
【plan 完】走 /wt {slug} 進 worktree 開發。
```

Prompt 規約：self-contained（新 session 只看它就能接手）；code pointer 用 repo-relative 完整路徑；每題對應的架構決策一定寫；含「客戶沒回 → 不重發」guard。

## 流程

1. **萃取輸入**：需求標題（口語化，user 確認）、N 個拍板題（決策維度 / 選項 / 影響）、code pointer（`search_graph` / `trace_path`）、後續 workflow。不確定的用 AskUserQuestion **一次**收齊，**NEVER** 邊寫邊問。
2. **resolve hub + 重撈 schema + markdown spec**（並行）。
3. **組內容**：4 段結構 checklist（標題層級、`## N.` 編號、`- [ ]`、```` ```javascript ```` fence 含 6 段、開發者備忘含 HANDOFF cross-link）。
4. **建 page**：MCP `notion-create-pages`，parent `{"type":"data_source_id","data_source_id":"<hub.board.dataSourceId>"}`，properties 依上表（relation 用 `所屬專案: [<project.rowId>]`，date 用 `date:提報日期:start` + `date:提報日期:is_datetime: 0`）。拿到 URL / page id 後 **MUST** 回填進接手 Prompt 的【第一步】（先 placeholder，再 `notion-update-page` 替換）。
5. **HANDOFF.md**：Read 當前 repo 格式 → append entry（ticket URL + page_id、N 題、接手方式）。
6. **回報**：ticket URL、寫了 N 題、HANDOFF entry 位置、接手方式。**NEVER** 主動建議「N 天後 ping 客戶」。

## 常見坑

1. **checkbox 渲染不出來** → `- [ ] ` 而不是 `-`。
2. **property key 憑記憶** → 從 `FIELDS.board` / 重撈的 schema copy-paste。
3. **狀態字憑記憶** → `hub.ticketStatus['needs-customer']`；fc 是 `需使用者確認`，<client-a> 是 `需確認`。
4. **漏 `所屬專案` relation** → 票不會出現在專案的 linked view。
5. **選項沒給情境** → 每個 option 前先 `- **{詞}**：{解釋 + 範例}`。
6. **接手 Prompt 漏「客戶沒回」分流** → 新 session 會自作主張 ping 客戶。
7. **HANDOFF.md 自建格式** → 先 Read 對齊。
8. **內文頁面 URL 給相對路徑** → MUST 完整 prod URL（`.env` `NUXT_PUBLIC_SITE_URL`）。

## 觸發訊號 cheatsheet

「建 Notion ticket」「寫 Notion 給客戶確認」「發 ticket」「問客戶 N 題」「問業務老闆」「拍板才能寫」「等決策」「客戶回了再做」；user 貼一張既有 ticket 當範例通常表示要照那個格式建新的。
