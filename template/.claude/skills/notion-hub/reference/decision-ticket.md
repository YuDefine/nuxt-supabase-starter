# 決策題 ticket（notion-hub § 4 問客戶）

> 由 `notion-hub` SKILL.md § 4 指過來。建票的欄位值與 runtime 在 SKILL.md；本檔只收**內容怎麼寫**。
> 接手 prompt 裡的 `notion-sync` 步驟只寫到綁 work item 為止——之後的生命週期由 flow 事件自動推進。

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
- 客戶都回了 → flow open {slug} --origin notion:{page-id}，接著 node ~/offline/clade/vendor/scripts/notion-sync.ts open --work <id> --ticket {page-id}，把 N 題答案 inline 進 plan，交給 work-route
- 客戶還沒回 → 別重發提醒，直接告訴我「Notion 還沒打勾」並結束
【{對應 workflow 階段}必填區塊】
- {例如 ## Affected Entity Matrix / ## User Journeys / ## Design Review}
【既有 code pointer，不必再 grep】
- 頁面 / API / migration / Types / Source table / Spec / 下游影響檔：{repo-relative 絕對路徑}
【plan 完】交給 work-route 推進。
```

Prompt 規約：self-contained（新 session 只看它就能接手）；code pointer 用 repo-relative 完整路徑；每題對應的架構決策一定寫；含「客戶沒回 → 不重發」guard。

## 流程

1. **萃取輸入**：需求標題（口語化，使用者確認）、N 個拍板題（決策維度／選項／影響）、code pointer（`search_graph`／`trace_path`）。不確定的一次問齊，**NEVER** 邊寫邊問。
2. **resolve hub ＋ 經 〔`notion-ops`〕 重撈 schema 與 Notion markdown spec**（並行）。
3. **組內容**：4 段結構 checklist（標題層級、`## N.` 編號、`- [ ]`、fence 含 6 段、開發者備忘含 HANDOFF cross-link）。
4. **建 page**（cookbook § 3）；拿到 page id 後 **MUST** 回填進接手 Prompt 的【第一步】。
5. **HANDOFF.md**：先讀當前 repo 格式 → append entry（ticket URL + page_id、N 題、接手方式）。
6. **回報**：ticket URL、N 題、HANDOFF entry 位置、接手方式。**NEVER** 主動建議「N 天後 ping 客戶」。

## 常見坑

1. **checkbox 渲染不出來** → `- [ ] ` 而不是 `-`。
2. **選項沒給情境** → 每個 option 前先 `- **{詞}**：{解釋 + 範例}`。
3. **接手 Prompt 漏「客戶沒回」分流** → 新 session 會自作主張 ping 客戶。
4. **內文頁面給相對路徑或 GitHub 連結** → 只准 consumer prod 網域的完整 URL（D2）。
