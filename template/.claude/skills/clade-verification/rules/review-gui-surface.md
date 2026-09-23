---
description: 所有把人導向控制面板（review-gui）或回報「有沒有等人的事」的 agent surface 統一 SoP——入口 `flow gates`、gate family 逐條回報、compound item 拆解、evidence sidecar 契約、截圖 evidence 分工；觸及 screenshots / plan package / HANDOFF 時 path-scoped 載入
paths:
  - 'screenshots/**'
  - 'specs/plans/**'
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - '.claude/agents/**'
---
<!-- Clade native rule; source: rules/core/review-gui-surface.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Review-GUI Surface SoP

**核心命題**：「現在有什麼等人」只有一個來源——`flow gates`。控制面板（review-gui PWA 的「輪到你」佇列）與 CLI 讀同一份 queue functions，是它的**渲染端**，不是另一份判定。本 rule 規約所有**把人導向面板、或向人陳述人工 gate 狀態**的 surface。

本 rule 是 [[agent-self-verification]] 的特例化（面板是其中一個 evidence 呈現 surface），同時延伸 [[manual-review]] 對人工檢查的規約。

## 為什麼這條 rule 存在

2026-05 起累積的 surface pitfall 共通失敗模式：surface agent 把「等不等人」當成自己可以從散文、checkbox、或對 item 的印象推出來的東西，於是把球還在 agent 手上的工作推給人：

- [[pitfall-handoff-mode-b-skips-review-gui-scan]]
- [[pitfall-verified-ui-compound-item-single-screenshot-evidence-gap]]
- [[pitfall-commit-gate-directs-user-to-non-ready-review-gui]]

舊版用 Spectra 生命週期的 bucket 詞彙回答這一題；該層已退役（control-panel redesign Phase 5），判定改由 spine 上的 gate 卡片承載。

## Gate family（五種，佇列共用一張卡片契約）

| family | 卡片從哪來 | 人的回應 → CLI |
| --- | --- | --- |
| `ruling` | `flow ask` 的 decision span | `flow answer` / `ask-options` / `clarify` / `dismiss` |
| `acceptance` | `work.done` 尚未 `accept`，且 landing 未全綠 | `flow accept` / `drop` |
| `ui-judgement` | plan 的 acceptance scenario 標 `@human` 且 evidence 齊 | `flow receipt <scenario_id> --verdict pass\|fail\|skip`；fail 時回交 `flow ask` |
| `external-action` | 需要人到場的 blocker（`--complete blocked`、`flow ask --category human-action`） | 確認完成（附 evidence）／宣告做不到 |
| `exception` | 僅 pane 仍 listed 的 dead-holder 碰撞 | 核准恢復／改派／abort |

**機械待辦（agent 自己該做的）NEVER 是卡片**：過期 lease、pipeline 機械 exhausted、pane 已不在的 dead-holder、缺 evidence、`（fix-requested）`、未 triage 的 `（issue:）` 都是 agent 的工作，不會出現在 `flow gates`，也 **NEVER** 被說成「等你」。合成 `work.done` 驗收若 audience 不是 Charles，同樣不進待我。

## 適用範圍

| Surface | 入口 | 預期 contract |
| --- | --- | --- |
| `/commit` 0-MR gate block | `capabilities/core/skills/commit/SKILL.md` Step 0-MR | block 後 **MUST** 先把 agent 可推進的 pending 推完（MUST 9）；只把 `flow gates` 列出的卡片交給人 |
| `/handoff` Mode B 2B.1.7 | `capabilities/core/skills/handoff/SKILL.md` Step 2B.1.7 | 推薦人開面板**前** MUST 先跑 `flow gates`，依 family 寫入 HANDOFF.md |
| `screenshot-review` verify mode | 主線派 reviewed visual-evidence worker（per [[agent-routing]]） | item 含 compound visual state → 分成 scoped sub-items 或同 item 多次寫 sidecar |
| `verified-ui` evidence collection | `vendor/snippets/verify-channels/ui-final-state-brief*.template.md` | compound state evidence 必拆 / 必多筆 |
| `screenshot-review` subagent 的 CLI 呼叫 | agent body 內的 runtime-approved browser CLI | invoke 前 verify CLI contract（per [[agent-self-verification]] § MUST 4） |

## Hard rule

### MUST

1. **入口 SoP：先跑 `flow gates`**。**任何**要回答「有沒有等人的事」或把人導向面板的場景，**MUST** 先跑：

   ```bash
   # consumer 端（cwd = consumer repo；NEVER 帶 CLADE_HOME，否則讀到的是 clade 的 spine）
   node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --json
   # 只要判定、不要內容時
   node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --require-empty
   # clade home 對 fleet 某一台
   node vendor/scripts/flow/flow.ts gates --require-empty --repo <name>
   ```

   `--require-empty` 的 exit：**0** = 讀到且沒有卡、**3** = 有卡、**2** = 判不出來（repo 讀不到、`--repo` 不在 roster）。**exit 2 NEVER 讀成「沒有等人的事」**——那是工具沒作答，不是答案是否定的。
2. **Compound item evidence**：一個 `[verify:ui]` / `[review:ui]` item 含多 visual state（hover / focus / before-after / step1→step2）→ **MUST** 採以下之一：
   - **拆 scoped sub-items**：`#N.M` 各帶獨立 `[verify:ui]` + 獨立 evidence
   - **同 `(itemId, kind)` 多次 `evidence-store.ts --write`**（sidecar append-only）。**NEVER** 寫複數 key `screenshots=`——parser 不認，見 § Annotation Format Contract

   單 screenshot 對應多 state 是**反模式**：evidence「在不在」的判定只看有沒有記錄，一張圖會讓其餘 state 靜默漏驗。
3. **gate 輸出是唯一 truth source**：對 `flow gates` 回傳的卡片清單視為 truth。**NEVER** 自己判斷有沒有等人的事——不從 HANDOFF.md 散文、tasks.md checkbox leaf count、或自己對 item 的印象重推。兩者對不上時更新 HANDOFF.md 去對齊輸出，**NEVER** 反過來。
4. **Performance 實測自動檢測**：review / verify **每一個** web UI change 時，**MUST** 先對該 change 的改動檔機械 grep perf keyword：
   ```bash
   git diff --name-only <base>..<head> -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' '*.html' \
     | xargs -r grep -lE 'fetchpriority|content-visibility|scheduler\.(yield|postTask)|requestIdleCallback|speculationrules|web-vitals|onLCP|onINP|onCLS'
   ```
   - **命中** → **MUST** 跑 approved performance inspection adapter 實測，把 LCP / INP / CLS + 關鍵 insight **inline 寫進 review report**；改善前後**各**跑一次寫前後對比。adapter 不可用時明確標待測，不假裝已有數字。
   - **沒命中** → silent skip；但若改動觸及 hero image / above-the-fold layout / 字體載入，即使 keyword 未命中也 **SHOULD** 實測（keyword 偵測是下界）。

   approved performance inspection adapter entry 已散播至所有 consumer runtime MCP configuration 並全 fleet 啟用（enabledMcpjsonServers）；perf-trace review 建議仍在 clade home 集中跑（profile/量測環境一致）。
5. **Ball-ownership 依卡片判讀**：回答「等你還是等我」「ready 了沒」時，`flow gates` **非空** → 逐張列出 `family` ＋ 判斷題 ＋ 為什麼現在輪到人 ＋ 該跑的指令；**空**（且 exit 0）→ 才可以說「沒有等你的事」。卡片以外的 pending 一律是 agent 的球。
6. **triage 結論要人接手時，MUST 落成卡片，NEVER 留散文**：triage 一個 `（issue:）` 得出「out-of-scope / false-positive / 修法已落地，等人重評」時，**MUST 在同一動作** `flow ask --question '<一句判斷題>' --option '<短標籤> :: <後果>' ... --recommended '<短標籤>' --why '<理由>' --work-id <W> --carrier <tasks 檔>` 開卡。只寫散文分析或只開 `@followup[TD-NNN]` 都不會出現在 `flow gates`，人永遠看不到。**NEVER** 為這件事新寫 `(claude-analyzed:)` / `(awaiting-user-decision:)` 行內 annotation——那是已退役的 Spectra 讀法，現在沒有任何讀取者會把它變成卡片。
7. **Post-work 回報 MUST 逐張標 family**：完成 evidence collection / issue triage 等批次工作後回報時，**MUST** 對每張卡個別寫 family 與判斷題。只有 `ui-judgement` / `acceptance` 卡才能寫「可以在面板驗收」並附連結。其餘 family 照實寫（例：「`ruling` — 要你決定 X 走 A 還是 B」），**NEVER** 混進「可以驗收」的清單。
8. **引導人到面板前 MUST 先把 agent 的球推完（hard rule）**：**任何**要把人導向面板的場景（`/commit` 0-MR block、handoff、實作後驗收、session 結尾回報），session owner **MUST** 先把自己能推進的 pending 推完，再跑 MUST 1 的 `--require-empty`，依 exit 分流：

   - **exit 3** → 讀 `--json` 逐張卡回報（MUST 5／7），附面板連結
   - **exit 0** → 沒有等人的事；**NEVER** 導向面板
   - **exit 2** → **STOP**，回報判不出來的原因（repo／roster），**NEVER** 猜

   **NEVER** 從 tasks.md checkbox 推論「只剩人要驗」、NEVER 用「看起來只剩 user 驗收」當導向理由。

   **時間線**（同根因家族：active runtime 自判「只剩人」推人去 GUI 但實際仍是 agent 的球）：
   2026-05-23 self-rationalize / 05-26 evidence handoff / 06-24 skip Step 8a / 06-25 copy prompt no verify / 06-28 dispatch unready + env assumption / 07-02 checkbox without evidence / 07-04 fix-requested misclassification / 07-05 commit gate non-ready（建規約後同 session 再犯）。

   **推進分流**：

   | Pending 狀態 | 誰處理 | active runtime 動作 |
   | --- | --- | --- |
   | `（fix-requested）` | session owner | dispatch `/wt` 修 code → merge-back → 重收 evidence |
   | evidence 缺 | session owner | 走 [[agent-self-verification]] fallback chain 收 evidence |
   | `（issue:）` 未 triage | session owner | triage → 要人接手才 `flow ask`（MUST 6） |
   | `flow gates` 列出的卡片 | 人 | **只有這類**才導向面板 |
   | `[discuss]` | active runtime 對話 | packet 已備妥 → `flow ask`；其餘 → 交付前收尾 walkthrough。見 [[manual-review]] § `[discuss]` walkthrough |

   **實證（2026-07-05）**：<consumer-b> `/commit` 0-MR 擋下 `sop-case-ux-phase-a1`（2 個 pending leaf），Claude 直接叫 user 去 GUI，但兩個 item 都帶 `（fix-requested）` — user 去了也做不了任何事。正確做法是 Claude 先 dispatch fix → merge-back → 更新 evidence → 重跑 0-MR，全部自己推完。

### 狀態時效（MUST 9–10）

人在面板上的回應經 CLI 包裝寫進 spine／receipts，而 agent 同時也在寫。任何「上一次看到的樣子」都只是快照。

9. **陳述狀態前，本 turn 內 MUST 有一次 `flow gates`**：回答任何「還剩幾張」「ready 了沒」「這條過了嗎」「現在輪到誰」之前，若**本 turn 尚未**跑過，**MUST** 先跑再答。**上一則訊息跑過不算**——人在兩則訊息之間按下按鈕正是最常見的情形。**NEVER** 引用本 turn 之前取得的輸出陳述現況。

10. **人說「我按了 X」→ MUST 立刻重跑驗證，沒反映就自己處理**：人陳述自己在面板做過回應（通過／有問題／選了某個選項）時，**MUST** 立即重跑 `flow gates`（ui-judgement 另讀該 plan 的 `evidence/receipts.jsonl`）驗證，再回應。

    - 已反映 → 照新狀態繼續
    - **未**反映 → **MUST** 回報「你的回應沒寫進去，我直接補」，並**當場**用人陳述的判定跑對應指令（`flow receipt … --actor <人>` / `flow answer … --via '<人在對話裡的原話>'`）。**NEVER** 要求人重按一次

    **NEVER** 回「你還沒按」「我這邊看到還是沒有」「請你再按一次確認」。**「沒寫進檔案」是系統的失敗，不是 user 的疏漏**——把它講成人沒做，是拿自己的 stale 讀取去反駁人的第一手事實。

### NEVER

- ❌ 把非 `ui-judgement` / `acceptance` 的卡寫進「可以在面板驗收」的清單或引導訊息（per MUST 7）
- ❌ `flow gates --require-empty` 回 exit 0 或 exit 2 時仍導向面板（per MUST 8）
- ❌ 推面板 URL 給人自看（除非已耗盡 [[agent-self-verification]] § fallback chain）— 「補 evidence prompt」是 **fallback**，**不是 default**（per [[manual-review]] § review-gui 補 evidence prompt 路徑分類）
- ❌ 對 compound item 只收一張截圖代表多 state；evidence 描述含 paired-state marker（`before/after` / `A→B` / `hover` / `focus` 等）卻只有一筆記錄
- ❌ `/handoff` Mode B 把人導向面板前，**不**先跑 `flow gates` 寫進 HANDOFF.md
- ❌ review web UI change 時 skip perf keyword 偵測、或偵測命中後不實測就讓 review pass（per MUST 4）
- ❌ 回答「卡在誰 / ready 了沒」時從 tasks.md 散文或 checkbox leaf count 推測，而非讀 `flow gates`（per MUST 3／5）
- ❌ 要人接手的 triage 結論只寫散文或只開 `@followup[TD]`、卻沒 `flow ask`（per MUST 6）
- ❌ 寫 `(verified-*:)` 短 marker 卻沒先跑 `evidence-store.ts --write` 把 payload 進 sidecar（per § Evidence 寫入路徑）
- ❌ 為了套用新契約去改寫**既有**行內 payload annotation — 那是當時的 evidence，本契約只管新寫入（per 同上）
- ❌ annotation 寫在 `- [ ] #N` 下一行（即使 indent 正確）而非 inline 同行末尾（per § MUST（annotation 寫入時）第 4 條）
- ❌ 人說「我按了 X」時，拿自己本 turn 之前的讀取回「你還沒按」（per MUST 9 / 10）

## Inline Review-GUI Deep-Link（hard rule）

依 MUST 8 取得 exit 3、要把人導向面板時，訊息 **MUST** 含一條可直接點開的完整 URL。**NEVER** 只寫「去面板看」或只描述位置。

### 第一動作：判 service 是不是常駐

```bash
bash ~/offline/clade/ops/review-gui-service.sh status   # 判 exit code，不要逐行比對字串
```

| 結果 | 動作 |
| --- | --- |
| exit 0 | 服務健全。**NEVER** 叫人跑任何啟動指令，直接給下面的 deep-link |
| exit ≠ 0 | **agent 自己**跑 `bash ~/offline/clade/ops/review-gui-service.sh install` 把服務帶起來（該子命令自帶 restart 與健康等待迴圈，末尾自呼 `status`），再回到上一列。**NEVER** 把啟動指令交給人 |

**MUST 判 exit code，NEVER 拿單一行輸出當結論**：`status` 印多行，其中部分行描述的是附屬 unit，與 GUI unit 健康無關——逐行字串比對會把健全的服務判成掛了。`status` 是 `systemctl is-active review-gui` 的**超集**（另驗 listener 與 `/api/health`），**NEVER** 退回單跑 `is-active` 的單值判讀。

**NEVER 加 `--user`**：`review-gui.service` 與 `review-gui-tunnel.service` 都是 **system** unit。`systemctl --user is-active review-gui` 對一個活著的 system unit 回 `inactive`，照著它去叫人啟動，正是本節要擋的那次誤導。

### URL 格式

| 要人看什麼 | URL |
| --- | --- |
| 輪到你佇列（所有 family 的卡片） | `https://review-gui.<maintainer-domain>/` |
| 這個 repo 的專案頁 | `pnpm review:ui --print` 印出的那一條（`vendor/scripts/control-panel/open.ts`，形如 `https://review-gui.<maintainer-domain>/projects/<repo>`） |

- **`<repo>` MUST 由 `open.ts` 算，NEVER 手寫**：它與面板路由用同一個 `repoName`（worktree 解析回 main、`<repo>/template` 這類較深 root 取最深），靠印象拼的名字對不上就是 404
- **遠端網域不帶任何 token**：由 Cloudflare Access（policy `Only Charles Mail`）把關，見 `docs/decisions/2026-08-22-review-gui-no-pairing-token.md`
- `http://127.0.0.1:5174` 只准 agent 探測。人開的入口永遠是上表，**NEVER** 因「人在本機」改 host

### NEVER

- ❌ 給根路徑以外的本機 / Tailscale / `*.ts.net` 位址當人開的入口
- ❌ 叫人跑 `pnpm review` 或任何啟動指令——服務不健全時由 agent 自己 `review-gui-service.sh install`
- ❌ 用 `systemctl --user` 判常駐狀態，或用 `systemctl is-active review-gui` 的單值回傳取代 `review-gui-service.sh status` 的 exit code
- ❌ 手寫 `<repo>` 靠印象——`open.ts` 是唯一算法

## 判定後的游標落點（hard rule）

人在輪到你佇列判完一張卡後，面板 **MUST** 把游標落在**同一個 work／plan 的下一張**；同一件判完才退到同 repo 的其他卡；整個 repo 判完才輪到佇列第一張。

這條之所以要寫成 rule：佇列是**跨 consumer 串接**的單一陣列，第 0 張屬於哪個 repo 純粹由排序決定。判完的那張會從佇列消失，所以「保住原本的游標 id」必然失敗——舊實作在那個時刻直接落到 index 0，於是判完 <consumer-b> 一項就跳去 <consumer-a> 的第一條，而畫面上完全看不出換了專案（2026-08-29 回報）。人以為自己還在同一件事裡，對著別家的卡按下一個通過。

### MUST

1. 落點候選 **MUST 在送出寫入之前**、以當下的佇列算好。寫入是 await 的，那段期間的事件推送或 visibilitychange 都可能把佇列換掉；換掉之後再算候選只會拿到空陣列，游標又落回 index 0。
2. 判定成功後 **MUST 先用本地清單前進**，佇列 reconcile 丟背景——await 全量重讀等於把那段時間整個掛在按鈕的 loading 上，人看到的是「寫入很慢」，而寫入其實早就回來了。
3. 判定成功 **MUST 給 toast**，且 toast 標題 **NEVER 與常駐「上一張已…／改回來」列同字**：同字時 `getByText` 會一次命中 inline 段落、toast 標題與 aria-live 鏡像三個節點，Playwright strict mode 直接判違規。文案上兩者也該分工——toast 說「剛才發生了什麼」，常駐列說「哪一張還可以改回來」。

### NEVER

- ❌ 判定後把游標交給「重載完佇列再看看落在哪」——那不是落點策略，是把落點交給排序決定

## Annotation Format Contract

evidence 的 parser 對 annotation key 和 status tag **嚴格字面匹配**。寫錯 = silent malformed（item 被當成缺 evidence）。

### Evidence 寫入路徑（行內只到時間戳，payload 走 sidecar）

**寫新 evidence 時，payload MUST 進 sidecar（`.spectra/evidence/<change>.jsonl`），行內 MUST 只留短 marker。** 對 **每一個** kind、**每一條** 新寫的 evidence 都適用，不是只有 `verified-ui`。

一條命令做完兩件事——寫 sidecar，並印出要貼進 `tasks.md` 的行內 marker：

```bash
node ~/offline/clade/vendor/scripts/lib/evidence-store.ts \
  --repo <consumer-path> --change <change-name> --write \
  --item '#3' --kind verified-ui \
  --screenshot 'screenshots/local/<change-name>/#3-final.png' \
  --dom '<one-liner-observation>'
# stdout: (verified-ui: 2026-07-30T09:12:33.421Z)
```

把 stdout **原樣**貼到該 item 行末（inline 位置照 § MUST（annotation 寫入時）第 4 條）。**NEVER** 自己另外編一個時間戳——sidecar 記的與行內貼的必須是同一個，CLI 印出來的就是它剛寫進去的那一個。

| kind | 必填 flag | 選填 flag |
| --- | --- | --- |
| `verified-ui` | `--screenshot` | `--dom` |
| `verified-e2e` | `--spec --trace` | — |
| `verified-api` | `--method --url --status` | `--body` |
| `claude-discussed` | — | — |

`claude-analyzed` 仍可被讀（既有記錄照舊解析），**NEVER** 新寫——要人接手的結論走 MUST 6 的 `flow ask`。`awaiting-user-decision` 已退役，舊 sidecar 殘留會被讀取端略過。

**MUST 保留短 marker，NEVER 整條拿掉**：consumer 端仍有 legacy 讀取者用 `grep '\(verified-ui:[^)]*\)'` 做粗判斷，行內完全沒有 marker 會讓它們全部誤判成缺 evidence。

**Parser 對短 marker 的接受條件**：無 payload 的 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)` 只在 **sidecar 已有對應 `(itemId, kind)` 記錄**時合法；sidecar 也沒有 → 仍計 `malformed`。所以「先跑 `--write`、再貼 marker」的順序不可顛倒。

**既有行內 payload annotation 一律不動**：`(verified-ui: <ISO> screenshot=...)` 這種舊格式**仍然合法**、仍照舊解析。**NEVER** 為了套用本契約去改寫既有 annotation 把 payload 搬進 sidecar——本契約只管**新寫入**。

### Canonical annotation keys

| Key | 格式 | Parser 行為 |
| --- | --- | --- |
| `screenshot=<path>` | **單數**，value 是單一 relative path | strict match。**僅 legacy 行內格式**；新寫入走 `--screenshot` 進 sidecar |
| `screenshots=<p1>,<p2>` | **複數** | parser **不認**——**禁用**。多 screenshot 走 sidecar：同 `(itemId, kind)` 跑多次 `--write`（append-only），或拆 sub-items |
| `(verified-ui: <ISO>)` | 括號內、冒號後空格 | **canonical 形式**。evidence 已收集；screenshot 路徑從 sidecar 取 |
| `(verified-api: <ISO> <METHOD> <URL> <STATUS>)` | 括號內、四段 space-separated | **legacy 行內格式**，仍合法。新寫入用 `(verified-api: <ISO>)` + `--method --url --status` 進 sidecar |
| `(issue: <description>)` | 括號內、冒號後空格 | 該 item 視為 handled（不計缺 evidence）；要人接手時另走 MUST 6 |
| `（fix-requested）` | 全形括號、無 payload | 人拒絕結論、要求 code fix——球回 session owner |

### Status tags parser 不認的常見錯誤

| 錯誤寫法 | 為什麼不認 | 正確寫法 |
| --- | --- | --- |
| `(deferred: ...)` | `deferred` 不在辭典 → item 被當成缺 evidence | `(issue: self-collect failed — <reason>)` |
| `screenshots=a,b` | 只配 singular key | 對同一 `(itemId, kind)` 跑多次 `--write`，或拆成 sub-items 各自 `--write` |
| `screenshot = <path>`（等號前後空格） | KV parser 不 trim 等號兩側 | `screenshot=<path>`（無空格） |
| `#4-xxx.png` 配 item `#4.1` | filename prefix match `#4-` 只配 `#4`，不配 `#4.1` | sub-item `#4.1` 用 `#4.1-xxx.png` |

### MUST（annotation 寫入時）

1. evidence collection 完成時，**MUST** 先跑 `evidence-store.ts --write` 寫 sidecar，再把它印出的短 marker 原樣貼進行內（per § Evidence 寫入路徑）。讀既有 legacy 行內 payload 時照上表 canonical key（singular `screenshot=`）
2. self-collect fallback chain 全失敗 → **MUST** 寫 `(issue: self-collect failed after (a)(b)(c)(d): <reason>)`，**NEVER** `(deferred: ...)`
3. sub-item `#N.M` 的 screenshot 檔名 **MUST** 用 `#N.M-` prefix，**NEVER** 複用 parent `#N-` prefix
4. **annotation MUST inline（同一行）**：`(verified-*:)` / `(issue:)` / `(claude-discussed:)` 等 annotation **MUST** 寫在 `- [ ] #N ...` marker 的**同一行末尾**，**NEVER** 寫在下一行（即使 indent 正確）。Parser 只解析 item marker 行內的 annotation token；獨立行 annotation = silent miss。（per [[pitfall-scan-non-ready-passive-report-instead-of-self-fix]]）
5. **寫完 evidence 後的收斂迴圈（hard rule）**：寫完 **MUST** 重跑 MUST 1 的 `flow gates`。缺 evidence／格式錯是 agent 的球，**MUST** 自行 root-cause 修正再重跑，直到剩下的只有卡片。**NEVER** 把「evidence 還缺」「格式不對」回報給人讓人問為什麼——那是把 session owner 該做的工作轉嫁給人。（per [[pitfall-scan-non-ready-passive-report-instead-of-self-fix]]）

### Cross-ref

- [[pitfall-verified-ui-annotation-format-drift]] — plural key + sub-item ID mismatch
- [[pitfall-deferred-vs-issue-annotation-contract-conflict-review-gui]] — `(deferred:)` vs `(issue:)` 辭典衝突

## 截圖 evidence 與符合性判定（MUST）

**Iron Law：`[verify:ui]` / `[review:ui]` 的 evidence 一律由 〔`screenshot-review-verify`〕 worker
收（Pi `--model gemini --effort high`），主線只消費它回的 JSON 摘要。主線 `Read` 截圖是例外路徑，只在下表命中時開放。**

**這個 channel NEVER 走 unreviewed / 未具名 carrier。** 逐字包含：**NEVER** 用 Cursor Task `model=claude-*` 假裝本列、**NEVER** 恢復「subagent 再轉派」、**NEVER** 因為「配額比較省」「這次只是 ad-hoc 不是 gate」而改派 grok 或主線自己拍。Charles 2026-09-08 拍板改回 Pi `--model gemini --effort high`（推翻 2026-08-22 Claude-only）。

本節適用**每一張**截圖、**所有** consumer、**所有四個模式**（`[verify:ui]` channel / archive
前視覺 QA / commit 0-B / ad-hoc）——不是只有批次審視那次。

這條的依據是**收集與判定分離 ＋ 主線 context 隔離**。判定（Design Review／視覺）留在該 runtime 的合格視覺 executor；本列只負責機械取證。各 runtime 的瀏覽器載體寫在對應 adapter，不寫進本共同檔。

| 可觀察 predicate | MUST |
| --- | --- |
| 收集 `[verify:ui]`／`[review:ui]` evidence | `screenshot-review-verify`，Gemini 3.8 Flash high，依 evidence contract 收集與回報 |
| 判定截圖是否符合 item | `screenshot-match-analysis`，Opus 5.5（effort: medium）；逐張讀指定圖片，不能只憑收集摘要給 PASS |
| 主持者收回符合性判定結果 | 消費結構化結果；FAIL／UNCERTAIN 時可讀該張圖診斷，不代簽 gate |
| 確認截圖是否空白 | worker emptiness preflight；結果不代替符合性 gate |

**NEVER** 讓收集 worker 再轉派或代簽判定；Opus 5.5 無法執行時沿 `screenshot-match-analysis` 原列交 GPT-5.6 Sol（effort: high）；圖片／browser 或其餘指定模型不可用時保留未完成項。Pi Cursor pool 的 mutation 與 egress 邊界維持，不為截圖擴權。完整派工方法見 `review-screenshot` skill。

### 實測（2026-08-06 更正：截圖成本遠小於本節初版所稱）

2026-08-04 的初版寫「截圖佔 `tool_result` 的 56%、平均 163k 字元/張」。**那是用 base64
字元數量的，而圖片按尺寸計費**——同一窗口（2026-07-28 ~ 08-04）用成本口徑複跑：

| 成分 | 佔 `tool_result` tokens | 細節 |
| --- | --- | --- |
| `Bash` | **60.6%** | 40,929 次，平均僅 255 tok |
| `Read` | 32.5% | 3,965 次，平均 1,409 tok |
| └ 其中截圖 | **5.8% of `Read`** | 281 張，**平均 1,148 tok/張** |
| **截圖佔全部 `tool_result`** | **1.9%** | 初版稱 56%，高估約 30 倍 |

**一張截圖比一次全檔 `Read` 還便宜**（1,148 vs 1,409 tok）。成本口徑的最大項是 `Bash`，
而它大是因為次數多、不是單次肥。截圖仍是「往後每一 turn 都重付」，但那對**所有** context
內容都成立，不是截圖獨有。

複跑指令（任何窗口都可原樣重跑）：

```bash
node scripts/context-cost-report.ts --since <ISO> --until <ISO> --json out.json
jq '.image.shareOfToolResultTokens, .image.shareOfToolResultChars' out.json
```

> 初版數字據以寫成本節 Iron Law 並散播到全 fleet，成因是量測用了
> `scripts/context-cost-report.ts` 檔頭第一條明令禁止的單位。該腳本現在**兩種口徑並列印**，
> 讓差幾倍在輸出裡就看得見。追蹤見 clade `docs/tech-debt.md` § TD-375。

### 自我開脫（看到自己這樣說就停下）

| 開脫 | 實際 |
| --- | --- |
| 「截圖成本其實只有 1.9%，那我直接看沒差」 | 本節的准入條件是上表 predicate，不是成本門檻。成本從來不是這條的依據，數字降下來也不解鎖任何一格 |
| 「我自己看比較快，dispatcher 要跑好幾分鐘」 | 快的是 wall-clock，跳過的是跨模型驗證——那正是 [[agent-routing]] 記的「147 條 `(verified-ui:)` 0 次走 codex」的形狀 |
| 「只看一張確認一下」 | 281 張的實測就是這樣累出來的，沒有任何一次是打算讀 281 張 |
| 「dispatcher 回的 JSON 看不出細節」 | 那是 items-json 的 `ready_signal` / 判準沒寫夠，補那裡。**NEVER** 用目視補契約的洞 |

## 待拍板佇列（pointer）

`/decisions`、`flow pending` 與 `flow gates` 讀的是**同一組** queue functions；`ruling` family 就是待拍板佇列本身，四個檔案來源由 `vendor/scripts/flow/decision-sources.ts` 掃進 spine。
佇列的實作契約（seen 集合、訂閱移除、推播 REQUIRED 三欄）住在 clade 端 runtime rules/local/decision-queue-contract.md`，不散播——consumer 端 agent 只需知道各端同源，**NEVER** 自己另掃一份。

## 界線（不在本 rule 範圍）

- **面板本體 bug**（endpoint、PWA、read model 投影）→ 由 [[review-gui-change-discipline]] 管
- **gate 判定本身**（哪些東西成卡）→ `vendor/scripts/flow/gates.ts` 是 source-of-truth，本 rule 只規約 surface 該遵守的 contract
- **跨 consumer 觀感 bug**（CSS / 字級 / 字色）→ audit-ux-drift 管

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Agent self-verification meta rule（fallback chain / 不踢 user） | [[agent-self-verification]] |
| 面板本體 change SLA | [[review-gui-change-discipline]]（clade 自治區） |
| Verify channel evidence 格式 | [[manual-review.backend]] § 標準流程 § `[verify:ui]` channel |
| Compound item 拆分 / multi-screenshot | [[manual-review.evidence]] § Item Kind Marker `verify:ui` |
| Handoff Mode B Step 2B.1.7 gate 段 | `capabilities/core/skills/handoff/scan-steps.md` |
| gate family 判定 | `vendor/scripts/flow/gates.ts` |

## Audit signal

| Signal | TD | 狀態 | SoT |
| --- | --- | --- | --- |
| `stale_screenshot_after_ui_change` | TD-178 | done | `vendor/scripts/audit-screenshot-staleness.ts` |
| 控制面板 CLI／GUI 同數（work／exec／projects parity） | — | done | `node ~/offline/clade/scripts/audit-control-panel-parity.ts`（`registry/audits.json` 條目；exit 2 = 沒跑成，NEVER 讀成 0 筆不等） |

舊 Spectra annotation 層的三支稽核（`compound_verify_ui_single_screenshot`、`claude-analyzed-drift`、evidence completeness）隨該層退役，無後繼。

**Performance 實測（MUST 4）升級路徑**：目前 advisory；若漏驗頻繁 → archive 前 hard gate（動面板本體須走 [[review-gui-change-discipline]]）。

## 違反時的回報方式

```text
[review-gui-surface] Hard rule violation
修正方式：
  - 沒跑 flow gates 就導向面板 → 跑 `flow gates --repo-only --require-empty`，exit 3 才導向
  - exit 2 當成沒事 → 判不出來，回報原因
  - compound 單截圖 → 拆 sub-items 或同 item 多次 --write
  - 推 URL 給人 → 先跑 [[agent-self-verification]] fallback chain
  - 引用舊快照答狀態 → 本 turn 先重跑 `flow gates` 再答
  - 回「你還沒按」→ 重跑驗證；沒反映就當場用人的原話補寫
繞過：無 escape hatch — flow gates 是真相層
```
