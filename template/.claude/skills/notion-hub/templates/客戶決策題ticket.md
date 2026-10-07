<!-- 版面示意：實際寫入走 ntn api 的 children blocks（references/ntn-cookbook.md § 建決策題票）——`- [ ]` → to_do、fence → code（language "plain text"）、`#`／`##` → heading_1／heading_2 -->
<!-- 票名（名稱欄）：{{CUSTOMER_TITLE}} -->

# 已提交待驗收參考

-

---

# 開發前想跟您確認 {{QUESTION_COUNT}} 件事

為了把功能做得剛好符合需要，麻煩您看一下下面 {{QUESTION_COUNT}} 題，每題選一個答案回覆即可。

## 1. {{QUESTION_1_TITLE}}

{{QUESTION_1_BACKGROUND}}

- **{{QUESTION_1_TERM}}**：{{QUESTION_1_TERM_EXPLANATION}}

**{{QUESTION_1_LEAD_IN}}**

- [ ] A. {{QUESTION_1_OPTION_A}}
- [ ] B. {{QUESTION_1_OPTION_B}}
- [ ] C. {{QUESTION_1_OPTION_C}}

<!-- 第 2 題起照第 1 題結構重複，共 3–6 題；選項 C 可省略 -->

---

# 🤖 Claude 接手 Prompt（給開發者用，客戶可忽略）

> 客戶在上方 {{QUESTION_COUNT}} 題打勾後，開發者把下列整段複製貼回 Claude Code 即可繼續。

```plain text
繼續處理 {{REPO_OR_MODULE}} 「{{REQUIREMENT_SUMMARY}}」需求（HANDOFF.md {{HANDOFF_DATE}} entry）。

【第一步 — 先檢查客戶有沒有回 Notion】
用 `timeout 60 ntn api "/v1/blocks/{{PAGE_ID}}/children?page_size=100" < /dev/null` 撈 page（URL: {{PAGE_URL}}），回應 `has_more: true` 時帶 `&start_cursor=<next_cursor>` 翻到底，再看 {{QUESTION_COUNT}} 題 `to_do` block 的 `checked` 哪幾個是 true（漏頁會把客戶已勾誤判成沒勾）。

【{{QUESTION_COUNT}} 題對應的架構決策】
1. {{QUESTION_1_RESTATED}} → 影響 {{QUESTION_1_IMPACT}}

【分流】
- 客戶都回了 → flow open {{WORK_SLUG}} --origin notion:{{PAGE_ID}}，接著 node ~/offline/clade/vendor/scripts/notion-sync.ts open --work <id> --ticket {{PAGE_ID}}，把 {{QUESTION_COUNT}} 題答案 inline 進 plan，交給 work-route
- 客戶還沒回 → 別重發提醒，直接告訴我「Notion 還沒打勾」並結束

【{{WORKFLOW_STAGE}}必填區塊】
- {{REQUIRED_SECTION_1}}

【既有 code pointer，不必再 grep】
- {{CODE_POINTER_1}}

【plan 完】交給 work-route 推進。
```

## 開發者備忘

- 本地 HANDOFF.md 已登記同步條目（{{HANDOFF_DATE}} {{TICKET_SLUG}}）
- {{QUESTION_COUNT}} 題答案會直接決定 {{DECISION_SCOPE}}
