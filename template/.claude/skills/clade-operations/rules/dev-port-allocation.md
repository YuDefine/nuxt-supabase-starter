---
description: Consumer dev server port 中央分配 + audit（避免跨 consumer 撞號）
paths: ['package.json', 'nuxt.config.ts', 'supabase/config.toml', 'registry/consumers.json', 'registry/consumers.schema.json']
---
<!-- Clade native rule; source: rules/core/dev-port-allocation.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Dev Port 中央分配

Dev port 由 clade 集中分配：registry 分配、規約強制宣告、audit 偵測漂移與衝突。dev tunnel 規約的 SoT 是 [[dev-tunnel-convention]]。

> SoT：`registry/consumers.json` 每個 consumer entry 的 `dev_ports` object。
>
> Audit gate：`scripts/dev-port-audit.ts`（DRIFT / MISSING / CONFLICT → exit 1）。
>
> Cookbook 範本：`vendor/snippets/dev-port/`。

## MUST

### 1. 顯式宣告 port

- **MUST** consumer `package.json` 的 `dev` script 必須顯式帶 `--port <registry.dev_ports.nuxt>`
- **NEVER** 裸 `nuxt dev`（吃 Nuxt default 3000）
- **NEVER** 省略 `--port` flag
- **NEVER** 寫 `pnpm dev -- --port <N>` 來補 flag：多出來的 `--` 會讓 Nuxt 把 `--port` 當位置參數丟掉，又落到 default 3000。要覆寫 port 用 `pnpm dev --port <N>`（沒有中間那個 `--`），且 script 本身仍 MUST 帶 `--port`
- `scripts/dev-port-audit.ts` 對 DRIFT / MISSING / CONFLICT **MUST** exit 1。**NEVER** 把它當 diagnostic-only 吞掉 exit code

### 2. Tunnel port 對齊

- **MUST** consumer `nuxt.config.ts` 若使用 `vite-plugin-cloudflare-tunnel`，plugin 的 `port:` 必須等於 registry `dev_ports.nuxt`
- 寫法可為 hard-code number 或 `Number(process.env.NUXT_DEV_PORT ?? <registry-value>)`，audit 兩種都接受

Dev tunnel 的 hostname／token／resilient wrapper／冷熱載入量測規約（原 §2.5–2.7）見 [[dev-tunnel-convention]] § 1–§ 4。

### 3. Registry 唯一性

- **MUST** 新 consumer 進 `registry/consumers.json` 必須認領未用的 +10 號 port（3000, 3010, 3020, …）
  **以及**一段未用的 `worktree_band`（4200–4899 區，50 個一段）
- **NEVER** 兩個 consumer 在 registry 取同 `dev_ports.nuxt` 值
- **MUST** 改 port 必須先在 clade `registry/consumers.json` commit + publish + propagate，再改 consumer 端的 dev script / tunnel config
- **MUST** 新 base 與任一既有 base 相距 **≥10**（`dev-port-audit.ts` 報 `band-spacing` CONFLICT）；base+1..base+9 是 worktree port 池，見 §4

### 4. Worktree 維度

同一 consumer 的 N 個 worktree（[[wt]] 的 `rules/改tracked檔前先隔離判準.md` Rule 1）各跑 dev，會撞 §1 那個唯一的 registry port。

分配規則：**worktree 的 port = 各宣告 port + 一個 worktree 專屬 offset N**。N 依序取自兩個池：

1. **base 池** `[1, 9]` —— registry 把各 base 排成 +10 間距，中間這 9 個號碼天然屬於它
2. **worktree band** —— registry `dev_ports.worktree_band`，4200–4899 區每個 consumer 各 50 個號碼

band 的讀取來源是 **clade home 的 `registry/consumers.json`**（`readRegistryWorktreeBand`），投影到 consumer 的 `.clade/registry/consumers.json` 只在 clade home 不在這台機器時當退路——複本會過期、public repo 也沒有複本，NEVER 為了讓 consumer 讀得到 band 而投影整份名冊（TD-274）。`batch prepare` 預設**不**在 bootstrap 配 dev-port（`wt-helper dev` 首跑才配、格滿 fail-loud）；批次真的要起 dev server 才帶 `--needs-dev-server`，此時配不到就 fail-closed。

band 存在是為了讓「分不到號碼就退回 base port」永遠不必發生——退回的 dev server 起得來、health check 過，服務的卻是別條 worktree 的 code。

- **MUST** worktree 內用 `node vendor/scripts/wt-helper.ts dev [<alias>]` 起 dev server，**NEVER** 在 worktree 內跑 `pnpm dev`（那會吃 `package.json` 寫死的 base port，直接撞 main）
- **MUST** main working tree 維持 §1 的顯式宣告不變 — `package.json` 的 `--port <base 字面數字>` 一個字都不改。offset 只存在於 worktree，由 `wt-helper` 在 `wt-helper add` 時分配
- **MUST** 分配與讀取都走 `vendor/scripts/lib/worktree-dev-port.ts`（唯一 SoT），**NEVER** 在任何消費端自己算一份
- **NEVER** 手動挑 worktree port。`pickDevPortOffset`（base 池）與 `pickBandPortOffset`（band）同時排除：超出 `[base, base+9]`、撞到本 consumer 另一個宣告 port、已被 sibling worktree 佔用。宣告多個 port 的 consumer 帶寬較窄
- Offset 記錄在 `~/.cache/clade/dev-port/<consumer>/<basename>--<sha256(resolve(wtPath))>.json`（equal-basename 姊妹樹各持一筆；舊 `<basename>.json` 共享檔名仍認得、只讀不覆寫——讀不出或屬於別人的內容略過並留 note，本樹的 pre-schema `{wtPath, offset}` claim 在下次分配時升格保留原 offset、兌現不了就隔離），**不**寫進 repo；worktree 目錄消失即釋放，`releaseWorktreeDevPorts` 做明確刪除
- 分配／釋放由同目錄 `.allocation.lock` 序列化：鎖記持有人 pid，holder 已死的殘鎖自動接手，讀不出持有人的 NEVER 搶——busy 錯誤會附移除指引；紀錄寫入走 staging→link 的 atomic publish
- **主機額度（記憶體）**：port 池只管不撞號，不管記憶體。`wt-helper dev` 起 server 一律有 lease：偵測得到 agent runtime → 交給 `dev-session.ts wait`（herdr Tab＋TTL 60m，續租用 `dev-session.ts heartbeat`），人類在自己終端前景起 → 維持前景並登記無界 `human` lease（離開時釋放）。同一 consumer 的 agent resident server 預設最多 2 支（1 開發＋1 review），第 3 支排隊等格子；上限由 consumer-meta 的 `dev.maxResident` 覆寫。**NEVER** 人類前景起 server 時被擋——撞滿額只印警告與可手動停的候選。計數與主機 `hostCap` 看 `node vendor/scripts/dev-session.ts slots`
- 兩池都用盡時 `wt-helper dev` **fail-loud 拒絕啟動**，**NEVER** fallback 到 base port — 那正是本節要防的撞車
- **NEVER** 用 `pnpm <script> -- --port <N>` 起 worktree 的 dev server（多出來的 `--` 會讓 Nuxt
  丟掉 port，落回 script 寫死的 base port，見 §1）；正確寫法是 `pnpm <script> --port <N>`

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `dev_ports.worktree_band` 之間互相重疊、蓋到任一 consumer 的 base、或伸進 dev-router 的 3300–3510 → `scripts/dev-port-audit.ts` 報 `worktree-band` CONFLICT、**exit 1** |
| 消費端 | `scripts/dev-port-audit.ts`（clade 主線改 registry 時跑）＋ `vendor/scripts/lib/worktree-dev-port.ts` 的分配器（band 是它唯一的第二個池） |
| 觸發點 | 本節（`rules/core/dev-port-allocation.md`，paths-gated 於 `registry/consumers.json`——加新 consumer / 改 band 正是在改那個檔） |

#### Tunnel 在 worktree 內

Tunnel hostname 是 per-consumer 單一資源（[[dev-tunnel-convention]] § 1）；N 個 worktree 共用時流量被後啟動的那個靜默劫持。

- **MUST** worktree 要開 tunnel 就走 `dev.perWorktreeTunnel` opt-in（`consumer-meta.json`），由 `vendor/scripts/wt-env-sync.ts` 改寫成 `<slug>.<host>` / `<name>-<slug>`。前提是 consumer 有涵蓋 `*.<host>` 的 DNS record 與憑證，沒有就起不來
- **NEVER** 沒開 opt-in 就在 worktree 內啟 tunnel——`wt-helper add` 複製來的 `.env.local` 含 token，**存在不代表可以用**
- 沒 opt-in 時手動跑 `wt-env-sync` 複製進 worktree 的 `.env*` 會移除 `TUNNEL_HOSTNAME`／`TUNNEL_NAME`，resilient wrapper 在 linked worktree 讀到共用 hostname 也會自關 tunnel（[[dev-tunnel-convention]] § 7）。**尚未涵蓋** `wt-helper add`：它用自己的 `copyEnvSyncFiles()` 逐字複製，新開的樹仍帶共用 `TUNNEL_*`；`wt-helper add` / `dev` 偵測到「有 tunnel key 但沒 opt-in」只 warn——worktree owner 要嘛 opt-in，要嘛刪掉那幾個 key

### 5. 本機 Supabase 埠區塊

Supabase CLI 的預設埠（54321 api、54322 db、54323 studio…）對每個專案都一樣，兩個 consumer 同時 `supabase start` 就撞埠，或更糟：連線設定指到別專案正在跑的資料庫（實例：新專案樣板沿用預設 54322，與好幾個既有 consumer 的本機資料庫相撞，照 `.env.example` 跑 migration 會動到別專案的本機資料；另有 consumer 的 `shadow_port` 54330 與別處已跑著的本機容器相撞）。

> SoT：registry `dev_ports.supabase_base`（本機有 Supabase 的 consumer 才宣告）。Audit：`scripts/dev-port-audit.ts` 對 `supabase-block` CONFLICT exit 1。

每個 consumer 認領一個 10 埠區塊，區間 **54320–54999**、`supabase_base` 必為 10 的倍數。區塊內 offset 沿用 Supabase 預設的相對位置：

| offset | config.toml 欄位 |
| --- | --- |
| +0 | `[db] shadow_port` |
| +1 | `[api] port` |
| +2 | `[db] port` |
| +3 | `[studio] port` |
| +4 | `[inbucket] port` |
| +7 | `[analytics] port` |
| +9 | `[db.pooler] port` |

+5、+6、+8 保留（Supabase 新增服務時取用）。

- **MUST** consumer 的 `supabase/config.toml` 所有埠欄位 = `supabase_base` + 上表 offset；`.env.example`／`.env*` 的 `DATABASE_URL`、`SUPABASE_URL` 等本機位址同步用這組埠
- **MUST** 新 consumer 要有本機 Supabase，先在 clade `registry/consumers.json` 認領下一個未用的 +10 區塊（現算：最大 `supabase_base` +10；SoT 是 registry，本檔不維護快照），commit＋publish＋propagate 後再改 consumer 端 config
- **NEVER** 沿用 Supabase 預設 54321–54329（除非該 consumer 的 `supabase_base` 就是 54320）；**NEVER** 兩個 consumer 取同一 `supabase_base`
- **NEVER** 在 `supabase/config.toml` 之外另挑埠覆寫（`supabase start` 的 flag、容器手動 publish）——要換就改 registry
- 改既有 consumer 的 base：先改 registry → publish → propagate → 該 consumer 改 config／env／文件；已跑著的舊 stack 要 `supabase stop` 後換埠重啟
- 區塊與 §3 的 Nuxt 埠、worktree band（4200–4899）、dev-router（3300–3510）互不重疊；Supabase 是 per-consumer 單一本機資源，**不**跟 worktree 分 offset——linked worktree 共用 main 那一組 stack，或在 worktree 內不啟 `supabase start`

## 自治區（規約不強制）

- `.env.example` 是否寫 `NUXT_DEV_PORT=<value>` 由 consumer 自定 — dev script 的 `--port` flag 是 SoT，env 不需重複
- 子 service port（Storybook / Vitest UI / Vite preview）— schema 預留欄位，尚未分配，consumer 用到時再進 registry

## How to apply

| 情境 | 動作 |
| --- | --- |
| 新 consumer 進 registry | 現算：最大 base +10、最大 band 上界 +1 起算 50 個（SoT 是 registry，本檔不維護快照） |
| 既有 consumer 改 port | 先改 clade registry → publish patch → propagate → 改 consumer 自家 dev script + tunnel port |
| Audit 報 DRIFT | **relay DRIFT 明細給該 consumer 的 session** 改 dev script / tunnel port 對齊 registry（per [[clade-role-and-todo-discipline]] § Consumer 工作命中時 MUST relay）；clade 主線不代改，但 **NEVER** 只出表就結束 |
| Audit 報 CONFLICT（兩 consumer 同 port 或同 `supabase_base`） | clade 主線立即解：選一個 consumer 改用未用 +10 號，registry commit + publish + propagate |

## Anti-pattern

- ❌ 在 `.env.local` 設 `PORT=3050` 取代 dev script 的 `--port`（Nuxt 不一定吃 `PORT`，且 `.env.local` 不進版控）

## 何時不適用

- consumer 不跑 Nuxt（例如純 static site、Workers-only） — `dev_ports.nuxt` 可省略，schema 不強制必填
- consumer `business_activity = paused` 仍受規約約束（avoid silent drift），但 audit DRIFT 不視為 hot follow-up

## dev server runtime 帳本與對帳

- **帳本**：`dev-session.ts` 起好 server 與 `wt-helper dev` 人類前景會寫 `$XDG_CACHE_HOME/clade/dev-runtime/<consumer>/…json`（key＝worktree），記 pid／startTicks／port／owner／restart；停止、釋放與 reaper 刪除。port 號碼的 SoT 仍是上面的配置，帳本記「此刻跑著什麼」。
- **HMR port**：入口指定 `CLADE_DEV_HMR_PORT=<port>+10000`，不共用 vite 預設 24678。consumer 的 `nuxt.config.ts`／`vite.config.ts` 讀這個 env 即可；沒讀的照舊，帳本仍記此值、audit 會對帳。
- **綁定 host**：預設只聽 127.0.0.1；consumer 已宣告 host（env／`.env*`／`--host`／`scripts.dev`）或 `CLADE_DEV_BIND_ALL=1` 時不蓋，見 [[dev-tunnel-convention]] § 6。
- **對帳**：每台 dev node 跑 `node scripts/dev-port-audit.ts --runtime [--json]`，比對 `ss`＋`/proc` 與帳本，報 `unregistered`／`dead-registered`／`orphan`／`leftover-child`／`foreign-band`。exit 1＝有 finding，exit 2＝`ss` 讀不到（非 Linux 或缺 iproute2）。帳本 pid 以 startTicks 防 pid 回收誤判。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `--runtime` 有任一 finding → exit 1；`ss` 失敗 → exit 2。不接 publish gate |
| 消費端 | 主持者與各 dev node 的巡檢（看 finding 決定停孤兒或補登記） |
| 觸發點 | 失敗輸出：`dev-port-audit --runtime` 的 finding 行直接列 kind／port／worktree |
