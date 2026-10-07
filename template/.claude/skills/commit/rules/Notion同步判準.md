# Rule 1 - tag 推出後同步 Notion hub（Step 6b，條件觸發）

- Level: `MUST`

per [[notion-work-coupling]] § 生命週期。consumer 的 `.claude/consumer-meta.json` 若有 `notion.hub`，Step 6-A（或 6-B 選 `[1]` 後）的 tag 已推出後 **MUST** 對本次發版含的每個 work item 執行：

```bash
node ~/offline/clade/vendor/scripts/notion-sync.ts release \
  --consumer-path . --work <work-id> --tag "$(git describe --tags --abbrev=0)" \
  [--prod-url <prod 上看得到修正的頁面>] [--screenshot <驗收畫面.png>]… --json
```

本步驟把連結的 ticket 推到 acceptance（`驗收中`）並填版本、`上線日期`、`PR` 欄（script 從 work item 的 commit／url artifact 查），`備註` 寫 `--prod-url`、內文附「驗收畫面（<tag>）」截圖，把客戶時程頁的 `交付項目` 進度% 寫 100。

- **客戶面證據（D2）**：`--prod-url` 只收 consumer prod 網域（`.claude/consumer-meta.json` `deploy.prodUrl`）；GitHub PR／CI／tag 連結 **NEVER** 當證據給客戶——script 會拒寫。有 UI 變更且本次有拍驗收截圖（`[verify:ui]`／screenshot review）就帶 `--screenshot`。
- **綁不到要點名**：本次發版含的 commit 若有對不到任何 work item 的、或 work item 沒有連結 ticket 的，**MUST** 在 Step 7 報告逐條點名（commit／work id ＋「無 ticket」或「無 work item」），**NEVER** 靜默跳過。客戶提的問題卻沒有 ticket → 回 `notion-hub` 的工程師建票意圖補建。
- `needsDecision` 非空（客戶側狀態、status regression、hub 對映不到現況）→ 尚未取得該動作授權時，**MUST** 透過本入口的使用者詢問介面確認，帶答案重跑；**NEVER** 自動執行任一條。
- ticket `驗收中 → 完成` 是客戶側轉移，script 一律拒絕不自動寫。
- `pending` 非空 → 寫入未確認落地，**MUST** 列進 Step 7 完成報告。
- consumer 未宣告 `notion.hub` → script 自行 exit 0，不需另外判斷。

## Good Example

- 這個例子是好的，因為證據用 prod 網域，綁不到的 commit 逐條點名。

```md
tag `v1.8.0` 已推 → 對 work `W-2026-10-01-auth` 跑 `notion-sync.ts release … --prod-url https://app.example.com/login`
→ 另一個 commit 對不到 work item → Step 7 報告點名「abc1234：無 work item」。
```

## Bad Example

- 這個例子是壞的，因為拿 GitHub 連結當客戶面證據，並自動執行 `needsDecision`。

```md
`--prod-url https://github.com/org/repo/pull/12`；`needsDecision` 非空 → 自行選一條重跑。
```
