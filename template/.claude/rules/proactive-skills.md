<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Proactive Skill Orchestra

所有 Spectra sub-skill 與 Design skill 應在適當情境下**主動調用**，不需使用者手動指定。此規則優先於個別 SKILL.md 的指示。

> 本檔是 trigger 主規則（無 frontmatter，每個 session 必載入）。詳細場景規約拆到 path-scoped reference：
>
> - 動 UI 檔（`app/**/*.vue` / `components/**` / `pages/**` / `layouts/**`）或寫 design artifact：[`proactive-skills.design-checkpoint.md`](./proactive-skills.design-checkpoint.md)
> - 寫 / 改 `openspec/changes/**` / `HANDOFF.md` / `docs/tech-debt.md` / `openspec/ROADMAP.md`：[`proactive-skills.ingest-triggers.md`](./proactive-skills.ingest-triggers.md)

## 原則

1. **診斷驅動**——先理解問題再選工具，不盲目跑所有 skill
2. **內建而非附加**——Design 是實作的一部分，不是完成後的美化步驟
3. **來源無關**——不論規格書來自 Notion、文件、對話或 plan file，流程一致
4. **自主但透明**——主動調用 skill 時簡要告知使用者正在做什麼

## Spectra Sub-skill 自主觸發

### Intake 階段

| 情境 | 觸發 | 說明 |
|---|---|---|
| 收到需求，需求模糊或有多種解讀 | `spectra-discuss` | 先討論釐清，再 propose |
| 收到需求，需求明確 | `spectra-propose` | 直接建立 change |
| 需求來源是外部文件（Notion URL、PDF、貼文） | 先讀取內容 → `spectra-propose` | 提取結構化需求後建立 change |
| Proposal 建立完成 | `spectra-analyze` | 自動檢查一致性（不等使用者要求） |
| Analyze 發現 Critical/Warning | 修復 → 再 `spectra-analyze`（max 2 輪） | 迴圈直到通過 |
| Artifacts 有模糊用詞（TBD、矛盾、缺 scenario） | `spectra-clarify` | 逐項澄清 |

### Implementation 階段

| 情境 | 觸發 | 說明 |
|---|---|---|
| 準備開始或繼續實作 | `spectra-apply` | 按 tasks 執行 |
| 實作中遇到非預期錯誤 | `spectra-debug` | 四階段系統性排查 |
| 實作中發現 spec 有誤或過時 | `spectra-ingest` | 更新 artifacts，不停下實作 |
| 架構決策點（多種做法都可行） | `spectra-discuss` | 記錄決策到 artifacts |
| 需要確認現有規格內容 | `spectra-ask` | 查詢而非猜測 |

### Completion 階段

| 情境 | 觸發 | 說明 |
|---|---|---|
| 所有 tasks 完成 + 人工檢查通過 | `spectra-archive` | 最終歸檔 |
| Archive 完成 + change 有 UI（design review findings） | `design-retro` | 分析 findings、識別重複模式、建議改善 |
| Findings 累積達 5 的倍數（5、10、15…） | `design-retro` | 週期性全量分析 |

### Sub-skill 禁用清單（永不觸發）

| Sub-skill | 規則 | 替代方式 |
|---|---|---|
| `spectra-commit` | **NEVER** 主動觸發 | 走 `rules/core/commit.md` 規範的標準 commit 工序（含 hooks / 訊息格式） |

**原因**：spectra-commit 是 spectra CLI 上游帶來的薄殼，本治理範圍下 commit 必須統一走 `rules/core/commit.md`。Claude 偵測到使用者要 commit Spectra change 的相關檔案時，**MUST** 直接走標準 git / `/commit` 流程，**NEVER** 改派 spectra-commit。

## Scope Discipline

所有 spectra / design workflow 都受 [`scope-discipline.md`](./scope-discipline.md) 約束：範圍外檔案不順手改、途中發現其他問題**不修但必登記**、未知變更先回報不自行清場、不得在 subagent 內執行 `git reset --hard` / `git checkout --` / `git clean`。

登記出口：

- 技術債 → `docs/tech-debt.md` + `@followup[TD-NNN]`
- 當前 session 未完 → `HANDOFF.md`
- 未來工作 → `openspec/ROADMAP.md`
- change 漏項 → `spectra-ingest`
- 架構決策 → `docs/decisions/**`

## Handoff Hygiene

符合以下情況，**MUST** 建立或更新 `HANDOFF.md`（內容要求與接手流程見 [`handoff.md`](./handoff.md)）：

- session 結束時仍有 active change
- 有未 commit 的 WIP
- 有 blocker 需要下一個 session 接手
- 工作移交給其他 agent / runtime

## Manual Review

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

**MUST** 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作就是引導使用者跑 `pnpm review:ui`**——本地 GUI、不燒 chat token、自動依 `#N` / `#N.M` 檔名配對截圖、可鍵盤完成 OK / Issue / SKIP，並 conflict-aware 寫回 tasks.md。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框走人工檢查——那是 `pnpm review:ui` 不可用時的 fallback，不是 default path。

正確流程：

1. **首選（DEFAULT）**：tasks.md 仍有 `## 人工檢查` 未勾項 → 主線回「從 **clade home**（`~/offline/clade`）執行 `pnpm review:ui` 開本地 GUI 驗收」（聚合機制與 cwd 規約見下方 § cwd），等使用者跑完 GUI 流程回報後繼續
2. **Fallback**（GUI 不可用時）：截圖 → 逐項展示 → 使用者回覆 OK / 問題 / skip → 依答覆更新 checkbox。GUI 不可用的具體情境見下方 § 例外：fallback 模式

### `[discuss]` items 不在 review:ui 主流程

`[discuss]` items（production 授權 / 商業判斷 / production 觀察類）**MUST** 由 `/spectra-archive` Step 2.5 walkthrough 接管，**NEVER** 在 review:ui 引導流程內處理——trigger 是外部 signal，提前分析只會讓 change 永遠卡在 review:ui pending state。
review-gui 對純 D-only pending 的 change 自動歸「🗓 等 archive walkthrough」群（無接手 prompt）→ 告知 user「跑 `/spectra-archive <change>` 觸發 Step 2.5 walkthrough」；落「🤖 等 Claude 接手」群（仍含 I / V）→ 接手 prompt 對 (D) 只列 walkthrough trigger，不分析、不寫 (claude-discussed:) annotation。
詳細 scope rule 見 [`manual-review.md`](./manual-review.md) § Item Kind Marker `[discuss]` 段。

### Inline Review-GUI Deep-Link（hard rule）

引導使用者跑 `pnpm review:ui` 時，**MUST** 在 chat 訊息中**直接給出 review-gui 本身的 deep-link URL**，讓使用者啟動 GUI 後可以一鍵跳到該 change 頁面，不必再從左側 list 點選。

review-gui SPA 路由規約（依 mode 不同；clade-home flow 為預設）：

```
# cross-consumer mode（預設；從 clade home 跑）
http://127.0.0.1:5174/review/<consumer-id>:<change-name>

# single mode（fallback only；consumer 端已被 preflightCladeOnly guard 擋下）
http://127.0.0.1:5174/review/<change-name>
```

- port `5174` 是 review-gui.mts `DEFAULT_PORT`；找不到 port 時會 fallback 到 5174-5194 之間
- host 預設 bind `127.0.0.1`。**MUST** 用 `127.0.0.1` 不要用 `localhost` — 某些 user 端 `/etc/hosts` / DNS 配置 `localhost` 不解析到 `127.0.0.1`，會出現「無法存取」
- **Cross-consumer mode 必要 `<consumer-id>:` prefix**（hard rule）：沒 prefix 時 review-gui fallback 到 clade mainEntry，clade 自己沒對應 change → API 回 404。`<consumer-id>` 以 `~/offline/clade/registry/consumers.json` 對應 entry 的 `consumer_id` 欄位為準（跟 directory name 通常一致）
- `<change-name>` 一字不差等於 `openspec/changes/<change-name>/` 的目錄名
- 例（cross mode）：`http://127.0.0.1:5174/review/<consumer-a>:ehr-performance-evaluation-m1`

#### 訊息格式（必須照這個 shape）

```
請在 clade home（`~/offline/clade`）執行 `pnpm review:ui` 開本地 GUI 驗收（review-gui 會自動聚合所有 consumer + 各自的 worktree change）：

  cd ~/offline/clade
  pnpm review:ui

GUI 啟動後直接打開：

  http://127.0.0.1:5174/review/<consumer-id>:<change-name>
  # 例 co-purchase 的 mvp-financial-layer-bootstrap：
  # http://127.0.0.1:5174/review/co-purchase:mvp-financial-layer-bootstrap

GUI 會自動：
- 配對 `screenshots/local/<change-name>/#<N>-*.png` 到對應 item
- conflict-aware 寫回 tasks.md
- 對 `[verify:e2e]` / `[verify:api]` automatic-only items 自動勾 `[x]`
- 對 `[verify:ui]` / `[review:ui]` items 顯示 evidence + OK / Issue / Skip 按鈕

完成後回報，我繼續下一步。
```

此 template **純對話 session 也要產出**（不限 spectra flow）。

#### cwd：clade home（review-gui 集中聚合所有 consumer + worktree）

review-gui 從 clade home 啟動進 cross-consumer mode，聚合所有 consumer × main + worktree 的 active change（每條帶 `<consumer>__<wt-slug>` rootId namespace）；consumer 端直接跑被 `preflightCladeOnly` guard 擋下（exit 2）。

- **MUST** 預設使用者從 clade home（`~/offline/clade`）跑 `pnpm review:ui`；訊息**MUST**包含 `cd ~/offline/clade`
- **NEVER** 寫「請在 consumer root 執行」或「請在 worktree root 執行」當預設措辭——兩者都被 clade-only guard 擋下；worktree 的 change 從 clade home 啟動的 GUI 已自動聚合

#### 不該列的東西

- **NEVER** 列 dev server URL（`http://localhost:3040/admin/...`）當「先 sanity check 用」—— review-gui 自帶 evidence，就是真正的驗收入口
- **NEVER** 把 review-gui deep-link 寫成 `/review/<change-name>` 不加 host
- **NEVER** 把 port 寫成 placeholder `<port>` — 直接寫 `5174`（fallback 由 GUI startup banner 告知 user）
- **NEVER** 在訊息末尾加「需要的話可以參考」「也可以打開 dev server 看」這類弱措辭——review-gui 就是入口，不需要替代方案

#### Counter-examples

- ❌ 「請跑 `pnpm review:ui`」結束（沒給 deep-link，user 要從 GUI list 自己找 change）

#### 例外：fallback 模式

只有當 `pnpm review:ui` 不可用（clade home 不存在 / user 明確拒絕 GUI / pure backend 完全無 UI 證據），才轉走 chat-based 逐項展示，那時才會用到 dev server URL。靜態 screenshot review 是證據，不等同於使用者驗收；詳細 marker / flow / kind 分類見 `manual-review.md` 與其 reference 檔。

### Dev Server Auto-Spawn（agent 自起，不要叫 user cd）

當 review-gui 顯示某 item 的 screenshot 不存在 / outdated，或 user 想開瀏覽器親自操作 sanity check 時，**agent 自己起 dev server**，禁止叫使用者「請 cd 到 worktree 跑 `pnpm dev`」。完整 recipe（命令、fallback 步驟、回報訊息 template、env bootstrap）：`~/offline/clade/vendor/snippets/dev-session/README.md`。

**持久層（durability）— ALL agent 自起的長駐 dev server MUST 走 [`vendor/scripts/dev-session.mjs`](../../vendor/scripts/dev-session.mjs)（散播到 consumer `scripts/dev-session.mjs`）。** agent harness 會在 tool-call 結束時回收 Bash 衍生的整個 process tree；dev-session 把 dev 命令掛到獨立常駐 zellij server 下，才能跨 tool-call / 跨 session 存活（root cause 實證見 cookbook）。

- **NEVER** 再用 `Bash(run_in_background=true)` / 裸 `nuxt dev` / `spawn(detached)` / setsid / nohup 起長駐 dev server（會被 reap，user 看到 502 / 530）
- **NEVER** 直接 `nuxt dev` / `pnpm dev` 不經 wrapper（會繞過 lease + cwd 檢查 + durability，且會被 harness reap）
- **反累積**：dev-session 一 consumer(-app) 一個 durable session（名 `dev-<consumer_id>[-<app>]`），起前先 `zellij list-sessions` 查、有就 **reuse 不重起第二台**；`node scripts/dev-session.mjs sweep` 清 EXITED / 死掉的 session；多 worktree 切換仍走 **dev-router**（一個公開 port 切 backend），**禁止**對每個 worktree 各起一個 dev-session
- **前提**：consumer 端需有 zellij（本倉標準多工器）。zellij 不在 PATH → dev-session 報錯停下，回報 user 安裝，**NEVER** 退回 `run_in_background`
- **Lease 衝突**：`dev.leaseMode = strict` 且 cwd-mismatch → dev-session 印衝突訊息 + exit 1，agent **MUST** 把訊息原樣呈給 user，**NEVER** 自行 `--takeover`（參照 [`verification-lease.md`](./verification-lease.md)）
- **掃 free port（non-pinned）**：scan 3001-3050 找第一個 free port；**禁止**用 3000（留給 user 自己的 dev server）
- **Tunnel URL**：回報 user 時，**若 consumer 有 `TUNNEL_HOSTNAME`，MUST 額外列 tunnel URL 並標註「tunnel 未啟動先跑 `pnpm tunnel:<app>`」**——外部裝置 / HTTPS-only 驗收 localhost 不夠用。**Agent NEVER 自起 `pnpm tunnel:*`** —— tunnel process 由 user 控制，agent 只負責列 URL + 提示
- **Worktree env bootstrap**：開新 worktree 後 **MUST** 在啟動前跑 `node vendor/scripts/wt-env-bootstrap.mjs --consumer-meta .claude/consumer-meta.json` 補 gitignored env file
- **Missing manifest**（consumer 無 `.claude/consumer-meta.json`）：**STOP** spawn → 回報 user 無 lease 保護 → 提示 scaffold 採用路徑（5 步見 cookbook）；**NEVER** 替 consumer 直接寫 manifest（consumer-self 決策）
- **多 worktree 反覆切換驗收** → SHOULD 用 `scripts/dev-router.mjs`（常駐 L4 proxy 佔公開 port、`use <slug>` 切 active backend、免 cd 免重啟；只適用 A 型獨立 tunnel consumer）。單次起一個 server 走 dev-session
- consumer local rule（`.claude/rules/local/no-auto-dev-server*.md` / `dev-server-policy*.md`）明確禁止 agent 自起時 → 不自起，fallback 給 user 一條一行指令（template 見 cookbook）；啟動前先讀過

行為依該 consumer 的 OAuth port-pin 屬性分流（讀 [`consumer-meta.md`](./consumer-meta.md) snapshot 的 `auth.portPinned` 欄位；**所有分流的實際啟動一律經 dev-session，下表決定的是 lease 嚴格度與 port 來源，不是繞過 dev-session**）：

| Consumer 屬性 | 啟動方式 | 衝突處理 |
|---|---|---|
| `auth.portPinned = true` + `dev.leaseMode = strict` | **MUST** 走 [`vendor/scripts/dev-session.mjs`](../../vendor/scripts/dev-session.mjs)（durability=zellij），鎖在 manifest 宣告的固定 port | cwd-mismatch → **refuse**（需 user 顯式 `--takeover`），參照 [`verification-lease.md`](./verification-lease.md) |
| `auth.portPinned = true` + `dev.leaseMode = advisory` | 同上，但 advisory | cwd-mismatch → warn + reuse |
| `auth.portPinned = false`（無 OAuth pin） | 走 scan-free-port 邏輯（3001-3050；MUST 細則見 cookbook） | 一 worktree 一 port，不互搶 |
| 無 `.claude/consumer-meta.json`（未採用 manifest） | 沿用既有 scan-free-port 邏輯 | 一 worktree 一 port |

`auth.devSigninEnabled = true`（採用 dev-auth cookbook 的 dev-only signin endpoint）→ port-pin 約束放寬，可改走 scan-free-port 邏輯。

#### In-process tunnel consumer：review 未 merge 的 worktree change（hard rule）

部分 consumer 的 dev tunnel 是 **in-process plugin**（`vite-plugin-cloudflare-tunnel` 寫在 `nuxt.config.ts`，tunnel 跟 nuxt dev process **綁死**；典型：<consumer-b> / co-purchase）。review 未 merge 的 worktree change 正解 = 把唯一的 dev-session 指向**那個 worktree 的 cwd**（`dev-session --cwd <wt>`，一次一 worktree）；完整 SOP：`~/offline/clade/vendor/snippets/inprocess-tunnel-worktree-review/README.md`。

判別「我是哪型」（grep dev script + nuxt.config）：

```bash
# A 型（<consumer-a> 型）：dev script 有獨立 tunnel 子命令（concurrently 包 dev-tunnel.mjs / cloudflared）
node -e "console.log(require('./package.json').scripts.dev)" | grep -E 'dev-tunnel|cloudflared|concurrently.*tunnel'
# B 型（in-process 型）：tunnel 在 nuxt.config，dev script 無獨立 tunnel 子命令
grep -l 'cloudflareTunnel\|vite-plugin-cloudflare-tunnel' nuxt.config.* 2>/dev/null
```

- **NEVER** 從 **main** 起 dev server 想 review worktree change —— route 在 worktree 還沒 merge 進 main → 404
- **NEVER** 對 in-process tunnel 型套 **dev-router**（`scripts/dev-router.mjs`）—— dev-router 假設 tunnel 指向一個固定公開 port、背後可切多 backend；in-process tunnel 跟 nuxt dev process 綁死，沒有「獨立公開 port 後面切 backend」的層可佔，套了不會生效
- **NEVER** 把 worktree nuxt.config 架構級 drift（如 worktree 是舊 framework 時代 fork、main 已遷新架構，vite 回 403「host not allowed」）誤判成 tunnel 問題 —— 那是 change-level 架構 reconcile 問題，review 前先 reconcile，不要在 tunnel / dev-session 層找原因
- **單一 named tunnel 一次一 worktree**：切 worktree 必 `dev-session.mjs stop` 再從另一個 worktree cwd 起，**禁止**對 in-process tunnel 型同時開兩個指向同 hostname 的 dev-session

## Review Tiers

依變更風險決定 review 強度：

- Tier 1：小型低風險變更 → self-review
- Tier 2：中型以上功能變更 → `spectra-audit` + code review
- Tier 3：migration / auth / permission / raw SQL / security-critical → 更嚴格 review

不要因為 diff 短就把高風險變更降級。

## Screenshot Strategy

截圖工具選擇原則：

- 一次性探索、人工檢查、設計驗收 → `agent-browser` 優先（自管 persistent-profile Chromium，繼承登入 cookie、平行 `--session` 隔離）
- 響應式、多 viewport、跨瀏覽器、多分頁、要沉澱回歸 → Playwright

同一組截圖重拍到第 3 次，應考慮沉澱為 Playwright spec。

**NEVER** 用 `chrome-devtools-mcp` 開頁面、截圖、填表單、互動式驗收 — 它是效能量測工具（Lighthouse audit / performance trace / heap snapshot），不是瀏覽器操控工具。互動式頁面操作一律走 `agent-browser`。

### agent-browser Worktree Verify Auth（hard rule）

agent-browser 開 auth-protected URL 前 **MUST** 完成 pre-auth，**NEVER** 截到空白頁後才開始診斷 auth。

#### MUST — Worktree verify 走 port 3000 singleton

驗 worktree UI 改動 **MUST** 把 port 3000 singleton 切到 worktree cwd，**NEVER** 在 alt port（3001+）起第二台 dev server。

```bash
pnpm dev:kill                           # 停 main
cd <consumer>-wt/<slug> && pnpm dev:agent  # 從 worktree 起 singleton（port 3000）
# 驗完：
pnpm dev:kill
cd <consumer> && pnpm dev:agent         # 切回 main
```

理由：OAuth redirect URI 綁 port 3000；agent-browser persistent profile 已有 port 3000 的有效 session cookie；alt port 上 OAuth 不通 + `__test-login` 常缺 `email` + HttpOnly cookie 不可 JS 注入 = 100% 失敗率。

#### MUST — 每次開 auth-protected URL 前跑 pre-auth

即使用 port 3000、persistent profile cookie 也會過期。**每次** `agent_browser_open` 到 auth-protected URL 前 **MUST** 先跑 pre-auth：

```
agent_browser_open({ url: "http://127.0.0.1:3000/auth/__test-login?role=admin&email=admin@example.com&redirect=<target-path>", session: "<consumer>" })
agent_browser_wait_for_load({ state: "networkidle", session: "<consumer>" })
# redirect 會自動導到 target-path；若 __test-login 不支援 redirect，再 navigate 一次
agent_browser_wait_ms({ ms: 2000, session: "<consumer>" })  # Vue hydration buffer
```

`email` 參數 **MUST** 填（`__test-login` 沒帶 email 會 400，拿到空 session cookie → 後續 API 全 401）。各 consumer 的合法 email / role 見 consumer 的 `agent-browser-session.md` § Auth Pre-flight 或 `docs/FIXTURES.md`。

#### NEVER

- ❌ 在 alt port（3001+）起 dev server 驗 worktree UI（OAuth / cookie / session 全部壞）
- ❌ `agent_browser_open` auth-protected URL 不先 pre-auth（persistent cookie 不保證有效）
- ❌ `__test-login?role=admin` 不帶 `email`（400 → 空 session → 後續全白）
- ❌ `eval document.cookie = "nuxt-session=..."` 設 HttpOnly cookie（SecurityError）
- ❌ 截到空白頁後反覆 retry 同一條壞路徑（浪費 token；先確認 dev server port + pre-auth）

完整 cookbook 見 `~/offline/clade/vendor/snippets/agent-browser-auth/README.md`。

Pitfall ref: `docs/pitfalls/2026-06-24-agent-browser-auth-blank-page-on-alt-port.md`

## Knowledge And Decisions

碰到非直覺問題或 workaround，任務結束時應評估沉澱到 `docs/solutions/**`。
做出跨任務的技術取捨時，應評估寫 ADR 到 `docs/decisions/**`。
