---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、交付入口前置查詢（先問服務不問 config）、面板引導與 fallback、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Proactive Skills — 人工檢查入口

> 走到 `## 人工檢查` 階段時的操作層；契約摘要在文末 § 人工檢查推進的四條契約。`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

## Auto-triage + `flow gates`

1. 逐條讀 pending leaf item 的 annotation，判斷阻塞原因並自行推進：
   - `（fix-requested）` → dispatch `/wt` 修 code → merge-back → 重拍截圖 → strip annotation
   - evidence missing → 走 [[agent-self-verification]] fallback chain 收 evidence
   - `（issue:）` 未 triage → triage issue 走 (A)-(E) 路由；結論要人接手才 `flow ask`（[[manual-review]] § 要人接手的結論：開卡，不寫 annotation）

2. 推進完畢後要在 consumer repo 根目錄跑（不要帶 `CLADE_HOME`）：

   ```bash
   node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --require-empty
   ```

   - **exit 3** → 有卡；改跑 `--json` 逐張列 family ＋ 判斷題，再引導 user
   - **exit 0** → 沒有等人的事；不要引導 user 到面板
   - **exit 2** → 判不出來；回報原因，不要當成 exit 0
   - 不要自判有沒有等人的事、不要跳過這條指令

3. exit 3 → 走 § 交付入口前置查詢，給 URL 後等使用者在面板判完回報再繼續。

**Fallback**（面板不可用時才用，不要預設在 chat 內逐項彈對話框）：截圖 → 逐項展示 → 使用者回覆 OK / 問題 / skip → agent 用使用者原話跑 `flow receipt` / `flow answer` 落判定。

## 交付入口前置查詢（MUST）

**要交付人工檢查入口時，主動載入本檔**，不要等 path 觸發（交付 URL 的主線可能一個 `tasks/**` 檔都沒開）。

交付前 **要先問「現在有沒有服務在提供入口」**，再問「佇列裡有沒有卡」。指令逐字：

```bash
bash ~/offline/clade/ops/review-gui-service.sh status          # 判 exit code，不要逐行比對字串
node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --json   # cwd = consumer repo
pnpm review:ui --print                                          # 本 repo 專案頁 URL
```

**第 1 條要判 exit code，不要拿單一行字串當結論**（輸出同時含 `active` 與 `inactive`）。

**第 2 條的卡片清單就是要交給人的全部內容**：`gates` 為空 → **不要貼 URL**，那代表沒有等人的事。

| 查詢結果 | 交付什麼 |
| --- | --- |
| service exit 0，`gates` 非空 | 輪到你佇列 `https://review-gui.<maintainer-domain>/` ＋ 第 3 條印出的專案頁 URL，並逐張列 family ＋ 判斷題。不要換成 `127.0.0.1` / Tailscale IPv4 / `*.ts.net`。**這是常態** |
| service exit 0，`gates` 為空 | 不給連結。報告「沒有等你的事」 |
| service exit ≠ 0 | 自己用 `bash ~/offline/clade/ops/review-gui-service.sh install` 把服務帶起來（該子命令自帶 restart 與健康等待），再回到上面幾列 |

**不要因為「主 checkout 的 `tasks.md` 看起來是舊的」就自建一台平行 GUI**——面板讀的是 spine 與 plan package 的 read model。

**不要從 consumer 自己的 config 推論入口不存在**（沒掛 tunnel plugin、`deploy.prodUrl` 為 null 都與共用面板無關）。

**不要交付 `cd <path> && <cmd>`**（那是指令不是位址），也**不要交付 `https://review-gui.<tailnet>.ts.net/`**（會停在配對畫面）。

**給人的驗收入口永遠是 `https://review-gui.<maintainer-domain>` 底下的路徑，且只在 `flow gates` 非空時給。**

正要把 `127.0.0.1:5174`、Tailscale IPv4、`*.ts.net`、或手拼的 `/projects/<name>` 貼進給人看的訊息時，停下來改給上面那條入口。

### 上面那條入口規則也管 item 敘述**內文**的 URL

**`## 人工檢查` item 敘述裡指向被驗 app 的 URL 同樣適用**——`[review:ui]` 寫給人照做，`localhost` 在人的裝置上指向裝置自己。

| item channel | 敘述裡的 URL |
| --- | --- |
| `[review:ui]`（人親自跑） | 要走下面那道階梯的 HTTPS origin，第 1 列優先 |
| `[verify:ui]` / `[verify:e2e]` / `[verify:api]`（agent 跑） | `http://localhost:<devPort>/...` 合法——執行者就在這台機器上 |

`[review:ui]` 的 host 階梯（與 [[manual-review.data-readiness]] § 通則 § 1 同一道，兩份規則不得分岔）：

1. 該 consumer 對應 `.env*` 有 `TUNNEL_HOSTNAME=<host>` → `https://<host>/<path>`。tunnel 本來就是真 HTTPS 公開 origin，優先用它
2. 沒設 `TUNNEL_HOSTNAME` → review-gui preview proxy：`https://review-gui.<maintainer-domain>/__preview/<devPort>/<path>`（`<devPort>` 取自 `registry/consumers.json` 的 `dev_ports.nuxt`）
3. `http://localhost:<port>` **只給 agent 自己探測**，不要出現在給人的 item 敘述裡

不要因為「本 consumer 沒有 tunnel」就退回第 3 列——那正是階梯第 2 列存在的理由。

`verify-url-check.ts` 會剝掉 `/__preview/<port>` 再比對 route tree，canonical HTTPS 不觸發 `VERIFY_URL_ROUTE_MISSING`。

**不要把「沒有公開 origin」寫進 item annotation 當成退回 user 的待辦**，除非已實測過下面三條全落空： <!-- nuance-clause-reviewed: 2026-08-29 — 例外綁「下面三條」，判準逐字寫在緊接的 fenced bash 裡，是可執行的；只是不在同一行 -->

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5  http://127.0.0.1:<devPort>/
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8  https://review-gui.<maintainer-domain>/
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5  http://127.0.0.1:5174/__preview/<devPort>/
```

第 2 條回 302 到 `cloudflareaccess.com` = tunnel 活著，**不是**失敗。consumer 沒有 `TUNNEL_HOSTNAME`、`deploy.prodUrl` 為 null **都不構成證據**。

### 能力真的缺席時怎麼講（照抄）

服務帶不起來，且該 consumer 自己也沒有 HTTPS 入口——才交付這段，不要退回貼指令：

```text
目前給不出可直接開啟的驗收連結：review-gui 服務 <status 逐字輸出>，本 consumer 也無自有 HTTPS 入口
（無 tunnel、無 tailnet cert）。等你的是 <repo> 的 <N> 張卡（<family 逐張列>）。
入口能力補齊方式見 pitfall-review-entry-degraded-to-local-shell-command § Fix Recipe。
```

## `[discuss]` items 不在人眼驗收主流程

`[discuss]` items（production 授權 / 商業判斷 / production 觀察類）要由交付前收尾 walkthrough 接管（[[manual-review]] § `[discuss]` walkthrough），不要在人眼驗收引導流程內處理——trigger 是外部 signal，提前分析只會讓工作永遠卡在 pending。packet 已備妥、現在就能拍板的走 `flow ask`（`ruling` 卡）。

## Inline Review-GUI Deep-Link（hard rule）

引導使用者到面板時，要給出可直接點開的完整 URL 並逐張列 `flow gates` 的卡片，不要只寫「去面板看」。格式見 [[review-gui-surface]] § Inline Review-GUI Deep-Link。

## 人工檢查推進的四條契約

1. 進入人工檢查階段時，**第一動作是 auto-triage**（per [[review-gui-surface]] MUST 8），不是直接引導使用者開面板
2. 推進完畢要跑 `flow gates --repo-only --require-empty`；**exit 3 才可引導 user 到面板**，並逐張列 family
3. 不要自判有沒有等人的事、不要跳過 `flow gates`、不要把 exit 2 讀成 exit 0
4. **給人的 URL 永遠在 `https://review-gui.<maintainer-domain>` 底下**，交付前要走 § 交付入口前置查詢
