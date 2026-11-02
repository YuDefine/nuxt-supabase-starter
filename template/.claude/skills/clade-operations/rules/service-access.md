---
description: 要碰第三方服務（打它的 API、開它的 dashboard、要人登入或給 OTP）之前先讀存取卡，照卡上量過的最省路徑走；沒有卡就探索一次並寫卡
moment: 要打第三方服務 API、開它的 dashboard、或要人登入／給 OTP 之前
---
<!-- Clade native rule; source: rules/core/service-access.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# 第三方服務存取（先讀卡）

存取卡的 SoT 是 clade `registry/services.json`，金鑰歸屬與額度在 `registry/api-keys.json`，以 `service` 指到卡。

```bash
node ~/offline/clade/vendor/scripts/access-card.ts <服務 id 或別名>   # 只印這張卡；第一條路徑就是推薦
node ~/offline/clade/vendor/scripts/access-card.ts --list
```

- 碰第三方服務之前 **MUST** 先讀那張卡。
- 卡上的 key 或 CLI 做得到的事，**NEVER** 改走 web 登入，**NEVER** 跟 Charles 要 OTP。
- 真的要人工 OTP 或人工登入時，**MUST** 在 `flow ask` 題面寫明「卡上已確認 key 與 CLI 都做不到」。題面點名有卡的服務又沒寫這句，`flow ask` 與 `--complete blocked --decision-for charles` 會拒收。
- 卡、PR、log **NEVER** 寫 secret 值，只寫機器與路徑。驗證與量測只打唯讀 route，**NEVER** 改服務設定或額度。
- 卡有 `skill` 時，操作細節以該 skill 為準，卡只指路。

## 沒有卡，或卡已過期（`last_verified` 超過 90 天）

照這個順序探索一次，結果在同一個 turn 寫成卡（clade worktree 改 `registry/services.json`；在 consumer 或沒有寫入權時，回報裡附卡的內容，交 clade 落檔）：

1. 文件索引：`llms.txt`、`*.md` 版文件
2. CLI `--help`
3. OpenAPI
4. 實打一次唯讀 route

拒 key 的 route 要寫進 `key_denied_routes` 並附實測日期。

## 決策樹：同一個操作有多條路徑時

依序比，前一條分出勝負就停：

1. 能不能精準取到要的欄位（`--json`、`--jq`、欄位篩選、分頁參數）
2. 量到的 token 成本（含 MCP 工具 schema）最低
3. 不需要人介入
4. 不需要常駐 MCP 的 schema 成本

做不到的路排最後一段，未量的排在已量之後。卡片的路徑順序就是這棵樹的結果，由 harness 重排，`audit-access-cards` 會擋順序不符的卡。

2026-10-31 首輪量測（token 由 Anthropic `count_tokens` 實算，取不到就記未量）確認了「帶篩選的 CLI／API ＜ MCP」，也推翻了「MCP 一定最貴」：沒帶篩選的 API 可能比 MCP 更貴，所以「能不能精準取到要的欄位」排在 token 比較之前。數字以各卡的 `measured` 為準；SDK 與 web 路徑多數未量，這兩段的排序還沒有證據。

## 量測與稽核

```bash
node scripts/access-card-measure.ts --service <id> --write    # 實跑唯讀指令，回寫 measured 並重排（在 clade 跑）
node scripts/access-card-measure.ts --service <id> --check    # 重跑比對，token 差超過 20% exit 1（`volatile` 操作是活資料，照印不判）
node scripts/audit-access-cards.ts [--strict-expiry]          # 缺卡、不合法、過期
```

`measured` 只由 harness 產生，**NEVER** 手填或估。量不到就維持「未量」並寫原因。常駐 MCP 的 schema 成本與去留建議在 `fleet_mcps`；卸載要改設定，交 Charles 決定。
