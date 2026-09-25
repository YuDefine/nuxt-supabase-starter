---
description: Dev Server Auto-Spawn 規約——agent 自起 dev server 的持久層、lease、port 分流、tunnel 規範
paths: ['scripts/dev-session*', 'vendor/scripts/dev-session*', '.claude/consumer-meta.json', 'nuxt.config.*']
---
<!-- Clade native rule; source: rules/core/proactive-skills.dev-server-spawn.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Dev Server Auto-Spawn（agent 自起，不要叫 user cd）

## 多工器唯一標準：herdr

本 fleet 的終端多工器唯一標準是 **herdr**。**NEVER** 用 `tmux` 或 `zellij` 起任何 session、window、pane 或長駐 process——這條涵蓋**每一種**用途，不限 dev server：review-gui、ad-hoc 背景 job、跑 migration、看 log、暫存一個 shell，全部在內。

這是 **universal contract**：consumer local rule **不得**重新選擇、覆寫或提供 fallback multiplexer（只能補 entrypoint、lease、port、OAuth pin、tunnel、是否允許自起等 constraints）；local rule 寫了其他持久層則該段無效。

| 你要做的事 | 走哪 |
| --- | --- |
| 起長駐 dev server | `node scripts/dev-session.ts`（durability = herdr Tab） |
| 另開一個 runtime session | `vendor/scripts/herdr-session-handoff.ts`（見 `vendor/snippets/herdr-session-handoff/README.md`） |
| 其他要活過 tool-call 的 process | `herdr tab create --no-focus` + `herdr pane run`，或包成 dev-session 那樣的入口 |

`tmux` / `zellij` 已被 runtime deny policy 擋；**NEVER** 用 `sh -c`、絕對路徑、alias、`env` 包裝等等價寫法繞過——規約管的是意圖，不是字串。

當 review-gui 顯示某 item 的 screenshot 不存在 / outdated，或 user 想開瀏覽器親自操作 sanity check 時，**agent 自己起 dev server**，禁止叫使用者「請 cd 到 worktree 跑 `pnpm dev`」。完整 recipe（命令、fallback 步驟、回報訊息 template、env bootstrap）：`~/offline/clade/vendor/snippets/dev-session/README.md`。

**持久層（durability）— ALL agent 自起的長駐 dev server MUST 走 [`vendor/scripts/dev-session.ts`](../../vendor/scripts/dev-session.ts)（散播到 consumer `scripts/dev-session.ts`）。** harness 會在 tool-call 結束時回收 Bash 衍生的 process tree，dev-session 把 dev 命令掛到常駐 herdr server 的 Tab 下才能存活。

- **NEVER** 用 `Bash(run_in_background=true)` / 裸 `nuxt dev` / `spawn(detached)` / setsid / nohup 起長駐 dev server（會被 reap，user 看到 502 / 530）
- **NEVER** 直接 `nuxt dev` / `pnpm dev` 不經 wrapper（會繞過 lease + cwd 檢查 + durability，且會被 harness reap）
- **反累積**：dev-session 一 consumer(-app) 一個 durable session（名 `dev-<consumer_id>[-<app>]`，就是那個 herdr Tab 的 label），起前先 `node scripts/dev-session.ts list` 查、有就 **reuse 不重起第二台**；`node scripts/dev-session.ts sweep` 清「Tab 還在但 dev 已退出」的殘骸；多 worktree 切換仍走 **dev-router**（一個公開 port 切 backend），**禁止**對每個 worktree 各起一個 dev-session
- **Workspace 歸屬**：dev Tab **MUST** 落在該 consumer 自己的 herdr workspace（dev-session 自己解）。**NEVER** 自己下不帶 `--workspace` 的 `herdr tab create` 起長駐 process（`--cwd` 對 Tab 歸屬零影響）
- **前提**：herdr server 要在跑（`herdr status`），caller 不必在 Herdr 終端內。連不上 → 回報 user，**NEVER** 退回 `run_in_background`
- **Lease 衝突**：依 [`verification-lease.md`](./verification-lease.md) § Agent 行為契約的 predicate 分支表處置——**agent 租約過期 / 心跳斷 → 自動接管**（不問 user）；**agent 租約存活 → `dev-session.ts wait` 排隊**（不問 user）；**人類租約且 HTTP 有回應 → refuse + 把訊息原樣呈給 user**，**NEVER** 自行 `--takeover`
- **卡住（LISTEN 無 HTTP）**：port 在聽、process 還活，但 `http://127.0.0.1:<port>/` 連續兩次短逾時都無狀態碼 → event loop 已死。**MUST** 跑 `dev-session.ts` start（consumer 入口通常是 `pnpm dev:agent`）；script 關該 herdr Tab 再重建。**人類租約也走這條。** **NEVER** 叫 user 到 Tab 裡 Ctrl+C。**NEVER** `lsof + kill`。**NEVER** 把 LISTEN 當成「還活著所以不能動」
- **掃 free port（non-pinned）**：scan 3001-3050 找第一個 free port；**禁止**用 3000（留給 user 自己的 dev server）
- **Tunnel URL**：回報 user 時，**若 consumer 有 `TUNNEL_HOSTNAME`，MUST 額外列 tunnel URL 並標註「tunnel 未啟動先跑 `pnpm tunnel:<app>`」**——外部裝置 / HTTPS-only 驗收 localhost 不夠用。**Agent NEVER 自起 `pnpm tunnel:*`** —— tunnel process 由 user 控制，agent 只負責列 URL + 提示
- **Worktree env bootstrap**：開新 worktree 後 **MUST** 在啟動前跑 `node vendor/scripts/wt-env-sync.ts --consumer-meta .claude/consumer-meta.json` 補 gitignored env file
- **Missing manifest**（consumer 無 `.claude/consumer-meta.json`）：**STOP** spawn → 回報 user 無 lease 保護 → 提示 scaffold 採用路徑（5 步見 cookbook）；**NEVER** 替 consumer 直接寫 manifest（consumer-self 決策）
- **多 worktree 反覆切換驗收** → SHOULD 用 `scripts/dev-router.ts`（常駐 L4 proxy 佔公開 port、`use <slug>` 切 active backend、免 cd 免重啟；只適用 A 型獨立 tunnel consumer）。單次起一個 server 走 dev-session
- consumer local rule（`.claude/rules/local/no-auto-dev-server*.md` / `dev-server-policy*.md`）明確禁止 agent 自起時 → 不自起，fallback 給 user 一條一行指令（template 見 cookbook）；啟動前先讀過

依 [[consumer-meta]] snapshot 的 `auth.portPinned` 分流（一律經 dev-session，下表只決定 lease 嚴格度與 port 來源）：

| Consumer 屬性 | Port | 衝突處理 |
|---|---|---|
| `auth.portPinned = true` + `dev.leaseMode = strict` | manifest 宣告的固定 port | cwd-mismatch → **refuse**（需 user 顯式 `--takeover`，見 [[verification-lease]]） |
| `auth.portPinned = true` + `dev.leaseMode = advisory` | 同上 | cwd-mismatch → warn + reuse |
| `auth.portPinned = false` 或無 manifest | scan-free-port（3001-3050） | 一 worktree 一 port |

`auth.devSigninEnabled = true`（採用 dev-auth cookbook 的 dev-only signin endpoint）→ port-pin 約束放寬，可改走 scan-free-port 邏輯。

## In-process tunnel consumer：review 未 merge 的 worktree change（hard rule）

部分 consumer 的 dev tunnel 是 **in-process plugin**（`vite-plugin-cloudflare-tunnel` 寫在 `nuxt.config.ts`，tunnel 跟 nuxt dev process **綁死**；典型：<consumer-b> / co-purchase）。review 未 merge 的 worktree change 正解 = 把唯一的 dev-session 指向**那個 worktree 的 cwd**（`dev-session --cwd <wt>`，一次一 worktree）；完整 SOP：`~/offline/clade/vendor/snippets/inprocess-tunnel-worktree-review/README.md`。

判別「我是哪型」（grep dev script + nuxt.config）：

```bash
# A 型（<consumer-a> 型）：dev script 有獨立 tunnel 子命令（concurrently 包 dev-tunnel.mjs / cloudflared）
node -e "console.log(require('./package.json').scripts.dev)" | grep -E 'dev-tunnel|cloudflared|concurrently.*tunnel'
# B 型（in-process 型）：tunnel 在 nuxt.config，dev script 無獨立 tunnel 子命令
grep -l 'cloudflareTunnel\|vite-plugin-cloudflare-tunnel' nuxt.config.* 2>/dev/null
```

- **NEVER** 從 **main** 起 dev server 想 review worktree change —— route 在 worktree 還沒 merge 進 main → 404
- **NEVER** 對 in-process tunnel 型套 **dev-router**（tunnel 跟 nuxt dev process 綁死，沒有可切 backend 的公開 port 層）
- **NEVER** 把 worktree nuxt.config 架構級 drift（vite 回 403「host not allowed」）誤判成 tunnel 問題——review 前先 reconcile
- **單一 named tunnel 一次一 worktree**：切 worktree 必 `dev-session.ts stop` 再從另一個 cwd 起。例外：consumer 開了 `dev.perWorktreeTunnel`（排他性移到 `<slug>.<host>`，見 [[dev-port-allocation]] § Tunnel 在 worktree 內）；opt-in 的前提是 consumer 有涵蓋 `*.<host>` 的 DNS record 與憑證，**NEVER** 代 consumer 開這個欄位



## Dev-port 池滿與 backing service 缺席

**Dev-port 池滿時**：先跑 `wt-helper reclaim-stale` 釋放 stale slot（三層判定見 [[worktree-default]] §6），**NEVER** 把池滿當 blocker 退回 user。reclaim 後仍滿才問（attended）或 packaging（unattended）。

**採用 per-worktree backing service（DB clone / PostgREST sidecar）的 consumer**：起 dev server **MUST** 先驗那些服務存在，缺席時 fail-loud 並點名服務與修復指令。全文見 [[db-preview-env]] § 缺席側。
