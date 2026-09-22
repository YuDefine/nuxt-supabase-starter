---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、交付入口前置查詢（先問服務不問 config）、面板引導與 fallback、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Proactive Skills — 人工檢查入口

> 從 [[proactive-skills]] § Manual Review 抽出（2026-07-31）。主檔留的是 always-load 的三條契約（第一動作是 auto-triage、推進完 MUST 跑 `flow gates`、NEVER 自判有沒有等人的事）；本檔是**真的走到 `## 人工檢查` 階段時**的操作層。

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

**MUST** 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作是 auto-triage（per [[review-gui-surface]] MUST 8），不是直接把面板連結丟給使用者**。

## Auto-triage + `flow gates`

1. 逐條讀 pending leaf item 的 annotation，判斷阻塞原因並自行推進：
   - `（fix-requested）` → dispatch `/wt` 修 code → merge-back → 重拍截圖 → strip annotation
   - evidence missing → 走 [[agent-self-verification]] fallback chain 收 evidence
   - `（issue:）` 未 triage → triage issue 走 (A)-(E) 路由；結論要人接手才 `flow ask`（[[manual-review]] § 要人接手的結論：開卡，不寫 annotation）

2. 推進完畢後 **MUST** 在 consumer repo 根目錄跑（**NEVER** 帶 `CLADE_HOME`）：

   ```bash
   node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --require-empty
   ```

   - **exit 3** → 有卡；改跑 `--json` 逐張列 family ＋ 判斷題，再引導 user
   - **exit 0** → 沒有等人的事；**NEVER** 引導 user 到面板
   - **exit 2** → 判不出來；回報原因，**NEVER** 當成 exit 0
   - **NEVER** 自判有沒有等人的事、NEVER 跳過這條指令

**NEVER** 預設用 `native structured user-input surface` 在 chat 內逐項彈對話框走人工檢查——那是面板不可用時的 fallback，不是 default path。

正確流程：

1. **Auto-triage first**：推進所有 orchestrator 可處理的 pending items（fix-requested / evidence missing / issue triage）
2. **首選（DEFAULT）**：`flow gates` exit 3 → **先跑 § 交付入口前置查詢的指令**：
   - service exit 0 → **NEVER** 叫 user 跑任何啟動指令，直接給 URL，並逐張寫 family ＋ 判斷題
   - service exit ≠ 0 → **自己**把服務帶起來再給 URL，**NEVER** 把啟動指令交給 user

   給完 URL 後等使用者在面板判完回報再繼續。完整格式與 NEVER 清單見 [[review-gui-surface]] § Inline Review-GUI Deep-Link。
3. **Fallback**（面板不可用時）：截圖 → 逐項展示 → 使用者回覆 OK / 問題 / skip → agent 用使用者原話跑 `flow receipt` / `flow answer` 落判定

## 交付入口前置查詢（MUST）

**誰要讀本節**：交付驗收入口給人的那個角色，**不是**動 carrier 檔的那個角色。本檔 frontmatter 的 `paths` 是 path-scoped 觸發，而在 `/wt` 親子拆分下，開那些檔的是 worktree subagent、交付 URL 的是主線 orchestrator——主線整段 session 可能一個 `tasks/**` 檔都沒開，規約於是對**唯一會犯這個錯的角色**不載入。因此：**要交付人工檢查入口時，MUST 主動載入本檔**，NEVER 等 path 觸發（2026-08-24 <consumer-a> `employee-backpay-request` 實證：主線未載入本檔，跳過查詢直接自建平行 GUI）。

把人工檢查入口交給人之前，**MUST 先問「現在有沒有服務在提供入口」**，再問「佇列裡有沒有這幾張卡」。這是查表不是推理，指令逐字：

```bash
bash ~/offline/clade/ops/review-gui-service.sh status          # 判 exit code，不要逐行比對字串
node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --json   # cwd = consumer repo
pnpm review:ui --print                                          # 本 repo 專案頁 URL
```

**第 1 條 MUST 判 exit code，NEVER 拿單一行字串當結論**：輸出是多行，裡面本來就同時出現 `active` 與 `inactive`。**exit 0 就是服務健全**。

**第 2 條的卡片清單就是要交給人的全部內容**：`gates` 為空 → **NEVER 貼 URL**，那代表沒有等人的事。

| 查詢結果 | 交付什麼 |
| --- | --- |
| service exit 0，`gates` 非空 | 輪到你佇列 `https://review-gui.<maintainer-domain>/` ＋ 第 3 條印出的專案頁 URL，並逐張列 family ＋ 判斷題。**NEVER** 換成 `127.0.0.1` / Tailscale IPv4 / `*.ts.net`。**這是常態** |
| service exit 0，`gates` 為空 | 不給連結。報告「沒有等你的事」 |
| service exit ≠ 0 | 自己用 `bash ~/offline/clade/ops/review-gui-service.sh install` 把服務帶起來（該子命令自帶 restart 與健康等待），再回到上面幾列 |

**NEVER 因為「主 checkout 的 `tasks.md` 看起來是舊的」就自建一台平行 GUI。** 面板讀的是 spine 與 plan package 的 read model，不是某一份 checkout 的 tasks 檔——「主 checkout 資料過時」不成立為「共用服務給不出正確畫面」的理由，那是**推理**，而本節第一句就要求查表。自建的那台只在本機可達（`127.0.0.1:<derived-port>`），等於把已經修好的坑重踩一次。

**NEVER 從 consumer 自己的 config 推論入口不存在。** `nuxt.config.ts` 沒掛 tunnel plugin、`consumer-meta.json` 的 `deploy.prodUrl` 是 null——這兩件事跟面板有沒有在跑**無關**：它是跨 consumer 共用服務，不由任何 consumer 的 config 描述。這類 negative search 不成立為 absence 證據（[[agent-self-verification]] MUST 11）。

**NEVER 交付 `cd <path> && <cmd>`。** 逐字實錄：「`cd ~/offline/<consumer-i>-wt/kiosk-google-allowlist && pnpm review:ui`」——那是指令不是位址（要 user 自己執行才生得出畫面）、`127.0.0.1` 只在跑 dev server 的那台機器上有意義、且綁在會過期的 agent lease 上。同理 **NEVER 交付 `https://review-gui.<tailnet>.ts.net/`**：pairing token 已停用，那條會停在配對畫面。

**Iron Law：給人的驗收入口永遠是 `https://review-gui.<maintainer-domain>` 底下的路徑，且只在 `flow gates` 非空時給。違反字面就是違反精神。**

| 藉口 | 現實 |
| --- | --- |
| 「user 在本機」 | iPad / 外出裝置上的 `127.0.0.1` 是裝置自己，不是桌機 |
| 「dev server 印的是 127.0.0.1 所以照抄」 | loopback 只給 agent 探測 |
| 「專案頁一定有東西，先貼再說」 | `gates` 為空時人點進去看到的是「沒有等你的事」，白跑一趟 |
| 「Tailscale DNS 也是 HTTPS」 | `review-gui.<tailnet>.ts.net` pairing 已停用，會停在配對畫面 |

**Red Flags**：正要把 `127.0.0.1:5174`、Tailscale IPv4、`*.ts.net`、或手拼的 `/projects/<name>` 貼進給人看的訊息。

### 同一條 Iron Law 管 item 敘述**內文**的 URL

上面管的是面板入口本身。**`## 人工檢查` item 敘述裡指向被驗 app 的那條 URL 同樣適用**——
`[review:ui]` item 是寫給**人**照著做的，敘述裡的 `http://localhost:<port>/...` 在他手上那台
iPad／手機上指向裝置自己，跟交付一條 loopback 入口是同一個錯誤，只是換了個載體。

| item channel | 敘述裡的 URL |
| --- | --- |
| `[review:ui]`（人親自跑） | **MUST** 走下面那道階梯的 HTTPS origin，第 1 列優先 |
| `[verify:ui]` / `[verify:e2e]` / `[verify:api]`（agent 跑） | `http://localhost:<devPort>/...` 合法——執行者就在這台機器上 |

`[review:ui]` 的 host 階梯（與 [[manual-review.data-readiness]] § 通則 § 1 同一道，兩份 MUST 不得分岔）：

1. 該 consumer 對應 `.env*` 有 `TUNNEL_HOSTNAME=<host>` → `https://<host>/<path>`。tunnel 本來就是真 HTTPS 公開 origin，優先用它
2. 沒設 `TUNNEL_HOSTNAME` → review-gui preview proxy：`https://review-gui.<maintainer-domain>/__preview/<devPort>/<path>`（`<devPort>` 取自 `registry/consumers.json` 的 `dev_ports.nuxt`）
3. `http://localhost:<port>` **只給 agent 自己探測**，**NEVER** 出現在給人的 item 敘述裡

**NEVER** 因為「本 consumer 沒有 tunnel」就退回第 3 列——那正是階梯第 2 列存在的理由。

preview proxy 路徑 prefix 是 `/__preview`；`verify-url-check.ts` 的 `parseUrl` 會剝掉 `/__preview/<port>` 再比對 route tree，
所以寫 canonical HTTPS **不會**觸發 `VERIFY_URL_ROUTE_MISSING`。

**NEVER 把「沒有公開 origin」寫進 item annotation 當成退回 user 的待辦**，除非已實測過下面三條全落空： <!-- nuance-clause-reviewed: 2026-08-29 — 例外綁「下面三條」，判準逐字寫在緊接的 fenced bash 裡，是可執行的；只是不在同一行 -->

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5  http://127.0.0.1:<devPort>/
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8  https://review-gui.<maintainer-domain>/
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5  http://127.0.0.1:5174/__preview/<devPort>/
```

第 2 條回 302 到 `cloudflareaccess.com` = tunnel 活著，**不是**失敗。consumer 的 `.env` 沒有 `TUNNEL_HOSTNAME`、
`deploy.prodUrl` 為 null **都不構成證據**——那描述的是 consumer 自己的部署，跟 review-gui 的
公開 origin 無關。逐字反開脫：「本 consumer 沒有設 tunnel，所以 iPad 連不到，實機檢查前要先給
那台 iPad 一個連得到的 origin」——那條 origin 早就在了，三條 curl 一跑就知道。


### 能力真的缺席時怎麼講（照抄）

服務帶不起來，且該 consumer 自己也沒有 HTTPS 入口——才交付這段，**NEVER** 退回貼指令：

```text
目前給不出可直接開啟的驗收連結：review-gui 服務 <status 逐字輸出>，本 consumer 也無自有 HTTPS 入口
（無 tunnel、無 tailnet cert）。等你的是 <repo> 的 <N> 張卡（<family 逐張列>）。
入口能力補齊方式見 pitfall-review-entry-degraded-to-local-shell-command § Fix Recipe。
```

## `[discuss]` items 不在人眼驗收主流程

`[discuss]` items（production 授權 / 商業判斷 / production 觀察類）**MUST** 由交付前收尾 walkthrough 接管（[[manual-review]] § `[discuss]` walkthrough），**NEVER** 在人眼驗收引導流程內處理——trigger 是外部 signal，提前分析只會讓工作永遠卡在 pending。packet 已備妥、現在就能拍板的走 `flow ask`（`ruling` 卡）。

詳細 scope rule 見 [`manual-review.md`](./manual-review.md) § Item Kind Marker `[discuss]` 段。

## Inline Review-GUI Deep-Link（hard rule）

核心 one-liner：引導使用者到面板時，**MUST** 在 chat 訊息中給出可直接點開的完整 URL，並逐張列 `flow gates` 的卡片，**NEVER** 只寫「去面板看」。URL 格式與 NEVER 清單見 [[review-gui-surface]] § Inline Review-GUI Deep-Link；service 判定與交付路徑以本檔 § 交付入口前置查詢為準。

## 人工檢查推進的四條契約（自 [[proactive-skills]] § Manual Review 下推）

1. 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作是 auto-triage**（per [[review-gui-surface]] MUST 8），不是直接引導使用者開面板
2. 推進完畢後 **MUST** 在 consumer repo 跑 `node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --require-empty`；**exit 3 才可引導 user 到面板**，並逐張列 family
3. **NEVER** 自判有沒有等人的事、**NEVER** 跳過 `flow gates`、**NEVER** 把 exit 2 讀成 exit 0 —— runtime 自判已多次證明不可靠
4. **給人的 URL 永遠在 `https://review-gui.<maintainer-domain>` 底下**（輪到你佇列 `/`、專案頁由 `pnpm review:ui --print` 印）。違反字面就是違反精神。`127.0.0.1` / Tailscale IPv4 / `*.ts.net` 只准 agent 探測。交付前 MUST 讀 [[proactive-skills.manual-review-entry]] § 交付入口前置查詢
