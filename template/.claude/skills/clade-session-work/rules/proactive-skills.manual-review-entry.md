---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、`[review:ui]` item 敘述的 URL 階梯、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Proactive Skills — 人工檢查入口

> 走到 `## 人工檢查` 階段時的操作層；契約摘要在文末 § 人工檢查推進的三條契約。`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

## Auto-triage + `flow gates`

1. 逐條讀 pending leaf item 的 annotation，判斷阻塞原因並自行推進：
   - `（fix-requested）` → dispatch `/wt` 修 code → merge-back → 重拍截圖 → strip annotation
   - evidence missing → 走 [[agent-self-verification]] fallback chain 收 evidence
   - `（issue:）` 未 triage → triage issue 走 (A)-(E) 路由；結論要人接手才 `flow ask`（[[manual-review]] § 要人接手的結論：開卡，不寫 annotation）

2. 推進完畢後要在 consumer repo 根目錄跑（不要帶 `CLADE_HOME`）：

   ```bash
   node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --require-empty
   ```

   - **exit 3** → 有卡；改跑 `--json` 逐張列 family ＋ 判斷題，再交給 user
   - **exit 0** → 沒有卡片；不要把任何卡片交給 user（tasks.md 的 `[review:ui]` 或已有 `(verified-ui:)` 的 `[verify:ui]` leaf 不是卡片，見第 4 步）
   - **exit 2** → 判不出來；回報原因，不要當成 exit 0
   - 不要自判有沒有等人的事、不要跳過這條指令

3. exit 3 → 在 chat 逐張列 family ＋ 判斷題，依使用者原話落判定：`ui-judgement` 卡（plan package 的 `@human` 場景）跑 `flow receipt`；`ruling` 卡跑 `flow answer`；`acceptance` 卡同樣跑 `flow answer <span> --answer '<原話>'`（驗收合成題，`\my` 同一條路徑，判決記成人的回答）。`external-action`／`exception` 卡：`flow ask --category human-action` 發出、帶選項的題同樣 `flow answer`；其餘依使用者選的那一項跑 `--json` 卡上該選項的 `options[].command`（例：blocked 工作的 `flow dismiss <span> --reason '<原話>'`、持有者不見的「改派／放棄」交回 coordinator）。**NEVER** 由 agent 自己跑 `flow accept`／`flow drop`——那是代按（[[flow-work-tracking]]）。
4. **tasks.md 的 `[review:ui]` 或已有 `(verified-ui:)` 的 `[verify:ui]` leaf 不會變成卡片**（`flow gates` 的 `ui-judgement` 只收 plan package 的 `@human` scenario），所以不受第 2 步 exit code 約束：第 1 步推完後仍 pending、且 evidence 已齊的 leaf，在 chat 逐項展示截圖／證據交給 user，再依原話照 [[manual-review]] § 核心規則第 3–6 步寫回 tasks.md（OK → `[x]`；有問題 → `[ ]` ＋ `（issue: <原話>）`；skip → `[x]` ＋ `（skip）`）。evidence 未齊的 leaf 仍是 agent 的球，**NEVER** 交給 user。

## `[review:ui]` item 敘述內文的 URL

`[review:ui]` 寫給人照做，`localhost` 在人的裝置上指向裝置自己。

| item channel | 敘述裡的 URL |
| --- | --- |
| `[review:ui]`（人親自跑） | 要走下面那道階梯的 HTTPS origin |
| `[verify:ui]` / `[verify:e2e]` / `[verify:api]`（agent 跑） | `http://localhost:<devPort>/...` 合法——執行者就在這台機器上 |

`[review:ui]` 的 host 階梯（與 [[manual-review.data-readiness]] § 通則 § 1 同一道，兩份規則不得分岔）：

1. 該 consumer 對應 `.env*` 有 `TUNNEL_HOSTNAME=<host>` → `https://<host>/<path>`。tunnel 本來就是真 HTTPS 公開 origin，優先用它
2. `http://localhost:<port>` **只給 agent 自己探測**，不要出現在給人的 item 敘述裡

沒有 tunnel（`.env*` 無 `TUNNEL_HOSTNAME`）時 `[review:ui]` **沒有可給人的 host**：propose 階段就向使用者提出「先替此 consumer 設 tunnel」；該驗收若不需要人的判斷（主觀視覺、真機、收信這類只能人做的不算），也可以改成 `[verify:*]` 由 agent 跑。**NEVER** 退回 localhost，**NEVER** 加 `@no-manual-review-check[no-tunnel-configured]` 繞過。

## `[discuss]` items 不在人眼驗收主流程

`[discuss]` items（production 授權 / 商業判斷 / production 觀察類）要由交付前收尾 walkthrough 接管（[[manual-review]] § `[discuss]` walkthrough），不要在人眼驗收引導流程內處理——trigger 是外部 signal，提前分析只會讓工作永遠卡在 pending。packet 已備妥、現在就能拍板的走 `flow ask`（`ruling` 卡）。

## 人工檢查推進的三條契約

1. 進入人工檢查階段時，**第一動作是 auto-triage**，不是直接把卡片交給使用者
2. 推進完畢要跑 `flow gates --repo-only --require-empty`；**exit 3 才可把卡片交給 user**，並逐張列 family
3. 不要自判有沒有等人的事、不要跳過 `flow gates`、不要把 exit 2 讀成 exit 0
