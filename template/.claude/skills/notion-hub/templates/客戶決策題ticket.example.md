<!-- 虛構範例：客戶、專案、page id 與路徑皆為示意，不是真實資料 -->
<!-- 票名（名稱欄）：出貨單展開時想多看到幾個欄位 -->

# 已提交待驗收參考

-

---

# 開發前想跟您確認 3 件事

為了把功能做得剛好符合需要，麻煩您看一下下面 3 題，每題選一個答案回覆即可。

## 1. 展開出貨單時，想看到哪些資訊？

現在點開出貨單只看得到品名。這次要把明細補齊，想先確認您最常需要核對哪些內容。

- **展開**：在出貨單列表點一下該筆，下方直接出現明細，不用另開頁面

**展開時希望看到：**

- [ ] A. 品名與數量（畫面最清爽，適合只看有沒有出錯貨）
- [ ] B. 品名、數量、單價、小計（方便當場核對金額）
- [ ] C. B 的全部，再加上備註與批號（適合要追查單一批貨的人）

## 2. 展開後要不要能直接改數量？

- **直接改**：在展開的明細上點數量就能修改，不必進編輯頁

**希望：**

- [ ] A. 只能看，要改請進編輯頁（避免誤觸）
- [ ] B. 可以直接改，改完跳出確認視窗

## 3. 修改紀錄要留多久？

- **修改紀錄**：誰在什麼時間把數量從多少改成多少

**希望保留：**

- [ ] A. 不用留
- [ ] B. 留 1 年
- [ ] C. 永久保留

---

# 🤖 Claude 接手 Prompt（給開發者用，客戶可忽略）

> 客戶在上方 3 題打勾後，開發者把下列整段複製貼回 Claude Code 即可繼續。

```plain text
繼續處理 demo-erp／出貨模組 「出貨單展開時想多看到幾個欄位」需求（HANDOFF.md 2026-10-04 entry）。

【第一步 — 先檢查客戶有沒有回 Notion】
用 `timeout 60 ntn api "/v1/blocks/00000000-0000-0000-0000-000000000000/children?page_size=100" < /dev/null` 撈 page（URL: <該票的 Notion 頁面網址>），回應 `has_more: true` 時帶 `&start_cursor=<next_cursor>` 翻到底，再看 3 題 `to_do` block 的 `checked` 哪幾個是 true（漏頁會把客戶已勾誤判成沒勾）。

【3 題對應的架構決策】
1. 展開顯示哪些欄位 → 影響明細查詢回傳欄位與展開列版面
2. 能否在展開處直接改數量 → 影響是否新增明細數量更新端點與權限檢查
3. 修改紀錄保留多久 → 影響是否新增修改紀錄資料表與清理排程

【分流】
- 客戶都回了 → flow open shipment-expand-fields --origin notion:00000000-0000-0000-0000-000000000000，接著 node ~/offline/clade/vendor/scripts/notion-sync.ts open --work <id> --ticket 00000000-0000-0000-0000-000000000000，把 3 題答案 inline 進 plan，交給 work-route
- 客戶還沒回 → 別重發提醒，直接告訴我「Notion 還沒打勾」並結束

【spec 必填區塊】
- ## Affected Entity Matrix
- ## User Journeys

【既有 code pointer，不必再 grep】
- 頁面：app/pages/shipments/index.vue
- API：server/api/shipments/[id]/items.get.ts
- Types：shared/types/shipment.ts

【plan 完】交給 work-route 推進。
```

## 開發者備忘

- 本地 HANDOFF.md 已登記同步條目（2026-10-04 shipment-expand-fields）
- 3 題答案會直接決定明細查詢欄位、是否新增更新端點與修改紀錄資料表
