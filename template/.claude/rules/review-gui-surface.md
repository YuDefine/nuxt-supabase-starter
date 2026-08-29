---
description: 所有呼叫 review-gui 的外圍 agent surface 統一 SoP——入口 scan、compound item 拆解、multi-screenshot annotation、self-rationalize 禁令、annotation format contract；觸及 screenshots / spectra change / HANDOFF 時 path-scoped 載入
paths:
  - 'screenshots/**'
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - 'vendor/scripts/review-gui*.ts'
  - 'vendor/scripts/flow/decision*.ts'
  - 'vendor/scripts/flow/measure.ts'
  - 'vendor/scripts/lib/evidence-store.ts'
  - 'scripts/spectra-advanced/**'
  - '.claude/agents/**'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/review-gui-surface.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Review-GUI Surface SoP

**核心命題**：`vendor/scripts/review-gui.ts` 本體經 fixtures gate hardened 後，incident 漂移到**外圍 agent surface**。本 rule 對所有**呼叫** review-gui 的 surface 統一規約。

本 rule 是 [[agent-self-verification]] 的特例化（review-gui 是其中一個 evidence collection surface），同時延伸 [[manual-review]] 對 review-gui 互動的規約。

## 為什麼這條 rule 存在

2026-05-{22,23} 累積 3 條 surface pitfall，共通失敗模式：surface agent / wrapper 把 review-gui 當「黑箱」，沒對其 contract 做主線預檢與後驗：

- [[pitfall-handoff-mode-b-skips-review-gui-scan]]
- [[pitfall-verified-ui-compound-item-single-screenshot-evidence-gap]]
- [[pitfall-review-gui-detail-page-no-impl-gate]]

## 適用範圍

任何**呼叫** review-gui flow 的 agent / wrapper / handoff branch：

| Surface | 入口 | 預期 contract |
| --- | --- | --- |
| `/commit` 0-MR gate block | `plugins/hub-core/skills/commit/SKILL.md` Step 0-MR | block 後 **MUST** auto-triage pending items（MUST 9）；Claude 可處理的先自行推進，只有 `bucket=ready` 才引導 user 到 review-gui |
| `/handoff` Mode B 2B.0 | `plugins/hub-core/skills/handoff/SKILL.md` Step 2B.0/2B.1.7 | 推薦 user 跑 review:ui **前** MUST 先跑 `review-gui.ts --scan` 寫入 HANDOFF.md |
| `screenshot-review` verify mode | 主線派 Claude subagent（per [[agent-routing]]） | item 含 compound visual state → 分成 scoped sub-items 或 multi-screenshot annotation |
| `verified-ui` evidence collection（spectra-apply Step 8a） | `vendor/snippets/verify-channels/ui-final-state-brief*.template.md` | compound state evidence 必拆 / 必標多 screenshot |
| `screenshot-review` subagent 的 CLI 呼叫 | agent body 內的 `agent-browser` 等 external CLI | invoke 前 verify CLI contract（per [[agent-self-verification]] § MUST 4） |
| review-gui detail page 互動 | `vendor/scripts/review-gui.ts` server-side handlers | impl 完成率 < threshold → manual review block readonly + amber banner（已 implemented v1.4.30+） |

## Hard rule

### MUST

1. **入口 SoP scan**：`/handoff` Mode B 在把 user 導向 review-gui **前**，主線 **MUST**：
   ```bash
   cd ~/offline/clade && node vendor/scripts/review-gui.ts --scan
   ```
   把 active changes 的 `bucket` / `pending` / `userActionPending` 寫進 HANDOFF.md `## Review-gui Readiness` §。Outstanding steps（2B.2–2B.4）**MUST** 引用 scan result，**禁止**從 HANDOFF.md narrative 或 tasks.md leaf count 推測 review-gui bucket。
2. **Compound item evidence**：一個 `[verify:ui]` / `[review:ui]` item 含多 visual state（hover / focus / before-after / step1→step2）→ **MUST** 採以下之一：
   - **拆 scoped sub-items**：`#N.M` 各帶獨立 `[verify:ui]` + 獨立 `(verified-ui: ...)` annotation
   - **Multi-screenshot annotation**：使用 `screenshots=path1,path2[,path3]` annotation form（待 review-gui parser 支援後）

   單 screenshot 對應多 state 是**反模式**：archive-gate 會把 item 翻 `[x]` 造成 silent miss。
3. **Impl gate（已 enforced）**：review-gui detail page mutation handler 已 gate impl 完成率 < `APPLY_COMPLETE_THRESHOLD` (0.90) 時 422 拒收。Surface agent **MUST** 依賴此 gate，**禁止**在 detail page client-side 繞過或重刻 mutation。
4. **review-gui scan result trust**：對 scan 回傳的 `bucket / pending / userActionPending` 視為 truth source；**不**從 HANDOFF.md 或 tasks.md 重推。兩者對不上 → 跑 `--scan --refresh` 重 build 後更新 HANDOFF.md，**不**手動編輯對齊。
5. **Performance 實測自動檢測**：review / verify **每一個** web UI change 時，**MUST** 先對該 change 的改動檔機械 grep perf keyword：
   ```bash
   git diff --name-only <base>..<head> -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' '*.html' \
     | xargs -r grep -lE 'fetchpriority|content-visibility|scheduler\.(yield|postTask)|requestIdleCallback|speculationrules|web-vitals|onLCP|onINP|onCLS'
   ```
   完整 keyword 清單以 `scripts/audit-modern-web-skill.ts` `TOPIC_KEYWORDS.performance` 為真相源。
   - **命中** → **MUST** 在 clade home 跑 chrome-devtools-mcp 實測，把 LCP / INP / CLS + 關鍵 insight **inline 寫進 review report**；改善前後**各**跑一次寫前後對比。how 見 `~/.claude/rules/modern-web-mcp.md` § Performance 主題：實測閉環 + `~/offline/clade/vendor/snippets/modern-web-guidance/README.md`。
   - **沒命中** → silent skip；但若改動觸及 hero image / above-the-fold layout / 字體載入，即使 keyword 未命中也 **SHOULD** 實測（keyword 偵測是下界）。

   chrome-devtools-mcp entry 已散播至所有 consumer `.mcp.json` 並全 fleet 啟用（enabledMcpjsonServers）；perf-trace review 建議仍在 clade home 集中跑（profile/量測環境一致）。
6. **Ball-ownership 答案依 bucket 判讀（single source）**：回答任何 change 狀態問題（「等你還是等我」/「ready 了沒」）**MUST** 依 `reviewBucketForChange()` 算出的 bucket 判讀 —— GUI 端讀 `change.bucket`、headless 讀 `--scan` 輸出 bucket。`bucket` 是 server canonical single source（review-gui.ts）。**禁止**從 tasks.md 散文、checkbox leaf count、或自己對 item 的印象推測 ball-ownership。bucket 對照：`awaitingUserReEval` = 等 user 重評、`awaitingUserDecision` = 等 user 商業決策（Claude 已標 `(awaiting-user-decision:)` 交還 user，master 排除）、`feedbackGiven` = 等 Claude、`readyForEvidence` = 等 Claude 補 evidence、`applyInProgress` = impl 未完、`applyBlocked` = impl 卡外部 blocker（`@apply-blocked` marker，交還 user，master 排除）、`awaitArchiveWalkthrough` = 等 archive walkthrough、`ready` = 可開始檢查。
7. **route E 結論 MUST 同步寫 annotation（不留散文 orphan）**：triage 一個帶 `（issue:）` 的 item，路由結論為 **(E)**（out-of-scope / false-positive / 修法已落地等 user 重評）時，**MUST 在同一動作**寫 `(claude-analyzed: <ISO> route=E[ note=...])` annotation（per [[manual-review]] § `(claude-analyzed: ...)` annotation）。**禁止**只留散文分析 / 只開 `@followup[TD-NNN]` 卻漏寫 machine annotation —— `analyzedIssuedCount` 只認 annotation，漏寫會讓 bucket 仍判 `feedbackGiven`（等 Claude），與「等 user」結論矛盾。

8. **Post-work scan 回報 MUST 逐條標 bucket（hard rule）**：完成 evidence collection / annotation 修正 / issue triage 等批次工作後向 user 回報 scan 結果時，**MUST** 對每條 change 個別標示實際 `bucket`。只有 `bucket=ready` 的 change 才能寫「可以在 review-gui 驗收」或列 review-gui URL 引導 user 開始檢查。非 `ready` 的 change **MUST** 如實報告實際 bucket + 卡住原因（例：「`readyForEvidence` — evidence 已收齊但有 2 條 `（issue:）` 待 user 重評」），**NEVER** 混入「可以驗收」的清單。反模式：3 條 change 中 1 條 `ready`、2 條 `readyForEvidence`，結尾寫「三條都可以在 review-gui 做最後驗收」— 這直接誤導 user。

9. **引導 user 到 review-gui 前 MUST 跑 mechanical gate + 自行推進到 ready（hard rule）**：**任何**要把 user 導向 review-gui 的場景（`/commit` 0-MR block、handoff、spectra-apply Step 8b、session 結尾回報），Claude **MUST** 先跑 mechanical gate script **取得 exit 0** 才能引導：

   ```bash
   node ~/offline/clade/vendor/scripts/check-review-readiness.ts \
     --repo <consumer-path> --change <change-name>
   ```

   - **exit 0**（`status: "ready"`）→ 可以引導 user 到 review-gui
   - **exit 1**（`status: "NOT_READY"`）→ **MUST** 讀 stdout JSON 的 `bucket` + blocking 數據，auto-triage 推進後**重跑 script**直到 exit 0
   - **exit 2**（change not found / script error）→ **STOP**，回報 user 排查

   **NEVER** 自己判斷 bucket、NEVER 從 tasks.md checkbox 推論 ready、NEVER 用「看起來只剩 user 驗收」當 ready 的理由。Script 是唯一 truth source — Claude 的判斷已被多條同根因 pitfall 證明不可靠。

   **時間線**（同根因家族：Claude 自判 ready 推 user 去 review-gui 但實際 non-ready）：
   2026-05-23 sonnet self-rationalize / 05-26 evidence handoff / 06-24 skip Step 8a / 06-25 copy prompt no verify / 06-28 dispatch unready + env assumption / 07-02 checkbox without evidence / 07-04 fix-requested misclassification / 07-05 commit gate non-ready（本 session 建規約後同 session 再犯）。

   **Auto-triage 分流**：

   | Pending item 狀態 | 誰處理 | Claude 動作 |
   | --- | --- | --- |
   | `（fix-requested）` | Claude | dispatch `/wt` 修 code → merge-back → 重拍截圖 → strip annotation → 重跑 gate |
   | evidence missing（無 `(verified-*:)` annotation） | Claude | 走 [[agent-self-verification]] fallback chain 收 evidence |
   | `（issue:）` 無 `(claude-analyzed:)` | Claude | triage issue → 走 (A)-(E) 路由 |
   | `[review:ui]` 純 user 驗收（無上述阻塞） | User | **只有這類**才引導 user 到 review-gui |
   | `[discuss]` / `(awaiting-user-decision:)` | Claude Code 對話 | **NEVER** 進 PWA inbox。packet 已備妥 → work-loop `awaiting[]`；其餘 → archive Step 2.5 walkthrough。見 [[manual-review.discuss]] |

   **實證（2026-07-05）**：<consumer-b> `/commit` 0-MR 擋下 `sop-case-ux-phase-a1`（2 個 pending leaf），Claude 直接叫 user 去 review-gui，但兩個 item 都帶 `（fix-requested）` — user 去了也做不了任何事。正確做法是 Claude 先 dispatch fix → merge-back → 更新 evidence → 重跑 0-MR，全部自己推完。

### 狀態時效與檔案同步（MUST 10–12）

Review-gui 的狀態全部落在 `tasks.md` 這個**雙寫**檔上——user 在 GUI 點按鈕會寫，Claude 改 annotation 也會寫。兩邊都在寫的檔案，任何「上一次看到的樣子」都只是快照。以下三條各綁一個可觀察 predicate。

10. **陳述狀態前，本 turn 內 MUST 有一次 scan**：回答任何 change / item 的狀態問題（「還剩幾條」「ready 了沒」「這條過了嗎」「現在輪到誰」）之前，若**本 turn 尚未**跑過 `review-gui.ts --scan`，**MUST** 先跑再答。

    Predicate 就是字面的「本 turn 有沒有跑過」：跑過 → 直接引用該次輸出；沒跑過 → 先跑。**上一則訊息跑過不算**——user 在兩則訊息之間點按鈕正是最常見的情形。**NEVER** 引用本 turn 之前取得的 scan 輸出、`/api/changes` 回應、或 `tasks.md` 讀取結果來陳述現況。

11. **user 說「我點了 X」→ MUST 立刻重掃驗證，檔案沒反映就自己處理**：user 陳述自己在 GUI 做過動作（點了 OK / 標了有問題 / 勾了某條）時，**MUST** 立即重跑 `--scan`（或直接讀該 change 的 `tasks.md`）驗證，再回應。

    - 檔案已反映 → 照新狀態繼續
    - 檔案**未**反映 → **MUST** 回報「你的動作沒寫進檔案（可能撞 409），我直接處理」，並**當場**把該動作寫進 `tasks.md`。**NEVER** 要求 user 重點一次

    **NEVER** 回「你還沒點」「我這邊看到還是未勾」「請你再點一次確認」。`persistReviewAction()` 帶樂觀鎖（`version.hash` / `mtimeMs`）：檔案在該分頁載入之後被改過，user 的點擊就回 409 並 silently 失敗。**「沒寫進檔案」是系統的失敗，不是 user 的疏漏**——把它講成 user 沒做，是拿自己的 stale 讀取去反駁 user 的第一手事實。

12. **改寫過 tasks.md MUST 主動說**：Claude 改寫過某 change 的 `tasks.md`（寫 annotation / 改 checkbox / 加 marker）之後，同一次回報 **MUST** 含這句：

    > 我改了 `<change>` 的 tasks.md，你開著的 review-gui 分頁請 reload，否則按鈕會撞 409。

    對**每一張**被改過的 change 都要說，不是只說最後一張。這句話的觸發條件是「**你改了檔**」，不是「你確定 user 開著分頁」——不確定時照樣說。

   **NEVER**：
   - ❌ `/commit` 0-MR block 後直接印「請去 review-gui 完成人工檢查」而不 triage pending items 的阻塞原因
   - ❌ 把帶 `（fix-requested）` 的 item 當「需要 user 驗收」推給 user — 那是 Claude 的工作
   - ❌ 把 evidence missing 的 item 推給 user 補 — Claude 應先跑 self-collect
   - ❌ 在任何 non-ready bucket 狀態引導 user 到 review-gui（與 MUST 8 / NEVER 第一條重疊，此處明確擴展到 `/commit` gate 場景）

### NEVER

- ❌ 把非 `bucket=ready` 的 change 寫進「可以在 review-gui 驗收」的清單或引導訊息 — `readyForEvidence` / `feedbackGiven` / `applyInProgress` 等 bucket 都**不是** ready，**禁止**混報（per MUST 8）
- ❌ 推 review-gui URL 給 user 自看（除非已耗盡 [[agent-self-verification]] § fallback chain）— review-gui「📋 補 evidence prompt」按鈕是 **fallback**，**不是 default**（per [[manual-review]] § review-gui 補 evidence prompt 路徑分類）
- ❌ 對 compound item 只收一張截圖代表多 state；annotation 寫 `screenshot=path` 但 description 含 paired-state marker（`before/after` / `A→B` / `hover` / `focus` 等）
- ❌ 在 detail page 試圖重刻或繞過 impl gate — server-side gate 是 final guard
- ❌ `/handoff` Mode B 把 user 導向 review-gui 後就放手，**不**先跑 `--scan` 預備 HANDOFF.md state
- ❌ review web UI change 時 skip perf keyword 偵測、或偵測命中後不實測就讓 review pass（per MUST 5）
- ❌ 回答 change「卡在誰 / ready 了沒」時從 tasks.md 散文或 checkbox leaf count 推測，而非讀 `change.bucket` / `--scan` bucket（per MUST 6）
- ❌ 對 route E 結論的 issue 只寫散文分析或只開 `@followup[TD]`、卻漏寫 `(claude-analyzed: route=E)` annotation（per MUST 7）
- ❌ 寫 `(verified-*:)` 短 marker 卻沒先跑 `evidence-store.mjs --write` 把 payload 進 sidecar — 兩邊都沒有 payload 時 parser 仍計 `malformed`，item 卡 `evidenceMissing`（per Annotation Format Contract § Evidence 寫入路徑）
- ❌ 為了套用新契約去改寫**既有**行內 payload annotation — 那是 rewrite 當時的 evidence，本契約只管新寫入（per 同上）
- ❌ annotation 寫在 `- [ ] #N` 下一行（即使 indent 正確）而非 inline 同行末尾（per Annotation MUST 5）
- ❌ scan 結果 non-ready 時直接回報 user「bucket=readyForEvidence」/「healthCheckNeeded」而不先自己讀 blocking reason + 修正（per Annotation MUST 6）
- ❌ user 說「我點了 X」時，拿自己本 turn 之前的 scan / tasks.md 讀取回「你還沒點」——那是用 stale 快照反駁 user 的第一手事實（per MUST 10 / 11）

## Inline Review-GUI Deep-Link（hard rule）

已依 MUST 9 取得 exit 0、要把 user 導向 review-gui 時，訊息 **MUST** 含一條可直接點開的
完整 URL。**NEVER** 只寫「去 review-gui 看」或只描述路徑（「在 admin-nuxt-ui-shell 那條」）。

### 第一動作：判 service 是不是常駐

```bash
bash ~/offline/clade/ops/review-gui-service.sh status   # 判 exit code，不要逐行比對字串
```

| 結果 | 動作 |
| --- | --- |
| exit 0 | 服務健全（末行 `{"ok":true,"authRequired":false}`）。**NEVER** 叫 user 跑任何啟動指令，直接給下面的 deep-link |
| exit ≠ 0 | **agent 自己**跑 `bash ~/offline/clade/ops/review-gui-service.sh install` 把服務帶起來（該子命令自帶 `systemctl restart` 與健康等待迴圈，末尾自呼 `status`），再回到上一列。**NEVER** 把啟動指令交給 user |

**MUST 判 exit code，NEVER 拿單一行輸出當結論**：`status` 印多行，其中 `not-found` / `inactive`
兩行是 `review-gui-dispatch-pickup.path` 的狀態，與 GUI unit 健康無關——逐行字串比對會把健全的
服務判成掛了。`status` 是 `systemctl is-active review-gui` 的**超集**（另驗 listener 與
`/api/health`），**NEVER** 退回單跑 `is-active` 的單值判讀。判定與交付路徑的 SoT 是
[[proactive-skills.manual-review-entry]] § 交付入口前置查詢，本節與它一致。

**NEVER 加 `--user`**：`review-gui.service` 與 `review-gui-tunnel.service` 都是 **system** unit。
`systemctl --user is-active review-gui` 對一個活著的 system unit 回 `inactive`，照著它去叫 user
啟動，正是本節要擋的那次誤導。

**`pnpm review` 只能從 clade home 跑，而且那是 agent 自己的事。** consumer 的 `package.json`
裡確實還有 `review:ui`（clade-managed script，指向 clade working tree 的 `review-gui.ts`），
但從 consumer cwd 跑會被 `preflightCladeOnly` 擋下並 `exit 2`（v1.3.161+）——review-gui 是
cross-consumer 集中模式，只從 clade home 起，該 cwd 約束對 agent 一樣成立。**NEVER** 把
`pnpm review` / `pnpm review:ui` 交給 user 跑；服務沒起來就由 agent 自己走上表 exit ≠ 0 那列。

### URL 格式（三層，逐層加細）

| 要 user 看什麼 | URL |
| --- | --- |
| 一條 change | `https://review-gui.<maintainer-domain>/review/<consumer-id>:<change-name>` |
| change 裡的某一條 item | `https://review-gui.<maintainer-domain>/review/<consumer-id>:<change-name>?item=<encoded-itemId>` |

`http://127.0.0.1:5174` 只准 agent 探測（`curl /api/changes`）。人開的入口永遠是上一表，**NEVER** 因「user 在本機」改 host。

- **`<consumer-id>` MUST 帶**：從 `~/offline/clade/registry/consumers.json` 抓。缺 prefix 會 fallback
  到 clade mainEntry → API 404（per [[pitfall-review-gui-cross-consumer-url-missing-prefix]]）
- **`<itemId>` 的 `#` MUST encode 成 `%23`**：itemId 就是 `tasks.md` 裡的 `#N` / `#N.M`，
  寫成 `?item=%231.3`。不 encode 的話 `#` 之後整段被瀏覽器當 fragment 吃掉，query 根本不會送出，
  而畫面照樣渲染 —— 看起來只是「deep-link 沒作用」，不會有任何錯誤
- **遠端網域不帶任何 token**：由 Cloudflare Access（policy `Only Charles Mail`）把關，
  見 `docs/decisions/2026-08-22-review-gui-no-pairing-token.md`
- **itemId 指不到東西時 GUI 會明說**：落回該 change 的第一條待判項並在頁面上告知原因
  （change 不在 inbox / 該 item 已判完）。這是 user 的安全網，**NEVER** 拿它當「itemId 不必查對」的理由

### NEVER

- ❌ 給裸 `/review`——inbox 常態橫跨多個 consumer 的數十條 item，要 user 自己找是哪一條。
  要 user 看 N 條 change 就給 N 條 deep-link
- ❌ 給根路徑 `http://127.0.0.1:5174/`——它 302 到 `/review`，落點仍是裸清單
- ❌ 給 `http://127.0.0.1:5174/review/...`、Tailscale IPv4、或 `https://review-gui.<tailnet>.ts.net/` 當人開的入口
- ❌ 叫 user 跑 `pnpm review` 或任何啟動指令——服務健全時 `--reuse-probe` 會探到既有 instance
  而不報錯（2026-08-23 實測 exit 0），所以這不是會爆的那種錯：它只是要 user 多跑一次沒有作用的指令，
  然後 reuse banner 給的是裸 `/review`，把你原本該給的 deep-link 換成一份要 user 自己找的清單；
  服務不健全時該由 agent 自己 `review-gui-service.sh install` 帶起來
- ❌ 用 `systemctl --user` 判常駐狀態
- ❌ 用 `systemctl is-active review-gui` 的單值回傳取代 `review-gui-service.sh status` 的 exit code
- ❌ 手寫 `<consumer-id>` 靠印象——registry 是唯一真相源


## 判定後的游標落點（hard rule）

判定送出成功後 review-gui **MUST** 把游標落在**同一條 change 的下一項**；同 change 判完才退到
同專案的其他 change；整個專案判完才輪到 inbox 第一項。

這條之所以要寫成 rule：cross mode 的 inbox 是**跨 consumer 串接**的單一陣列，第 0 項屬於哪個
consumer 純粹由排序決定。判定完的那一項會從 inbox 消失，所以「保住原本的游標 id」必然失敗——
舊實作在那個時刻直接落到 index 0，於是判完 <consumer-b> 一項就跳去 <consumer-a> 的第一條，而畫面上完全看不出
換了專案（2026-08-29 回報）。使用者以為自己還在同一條 change 裡，對著別家的 item 按下一個通過。

### MUST

1. 落點候選 **MUST 在送出寫入之前**、以當下的 `items` 算好（`successorCandidates()`）。
   寫入是 await 的，那段期間 SSE domain event 或 visibilitychange 都可能觸發 `loadInbox()`
   把 `items` 換掉；換掉之後再算候選只會拿到空陣列，游標又落回 index 0。
2. 判定成功後 **MUST 先用本地清單前進**，inbox reconcile 丟背景。`/api/inbox` 要掃每張 change
   的 detail（實測 3.5 秒起跳、尖峰 20 秒以上），await 它等於把那段時間整個掛在「通過」按鈕的
   loading 上——使用者看到的是「寫入很慢」，而寫入其實早就回來了。
3. 判定成功 **MUST 給 toast**，且 toast 標題 **NEVER 與常駐「上一項已…／改回來」列同字**：
   同字時 `getByText` 會一次命中 inline 段落、toast 標題與 aria-live 鏡像三個節點，Playwright
   strict mode 直接判違規。文案上兩者也該分工——toast 說「剛才發生了什麼」，常駐列說
   「哪一項還可以改回來」。

### NEVER

- ❌ 判定後把游標交給「重載完 inbox 再看看落在哪」——那不是落點策略，是把落點交給排序決定
- ❌ 在 `advancePast()` 之類的本地前進裡動 `waiting`：它是 `countWaitingChanges()`，數的是
  **bucket 不在 user-ball 的 change 數**（球在 Claude 那邊的條數），跟 inbox 有幾個 item 無關。
  判定一項就減一會報出假數字，而且 issue 判定實際上會讓它往上走、方向相反


## Annotation Format Contract

review-gui parser 對 annotation key 和 status tag **嚴格字面匹配**。寫錯 = silent malformed（item 卡 `evidenceMissing`、bucket 不收斂）。

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

把 stdout **原樣**貼到該 item 行末（inline 位置照 § MUST（annotation 寫入時）第 5 條）。**NEVER** 自己另外編一個時間戳——sidecar 記的與行內貼的必須是同一個，CLI 印出來的就是它剛寫進去的那一個。

| kind | 必填 flag | 選填 flag |
| --- | --- | --- |
| `verified-ui` | `--screenshot` | `--dom` |
| `verified-e2e` | `--spec --trace` | — |
| `verified-api` | `--method --url --status` | `--body` |
| `claude-analyzed` | `--route` | `--note` |
| `awaiting-user-decision` | — | `--packet` |
| `claude-discussed` | — | — |

**MUST 保留短 marker，NEVER 整條拿掉**：consumer 端仍有 legacy 讀取者用 `grep '\(verified-ui:[^)]*\)'` 做粗判斷，行內完全沒有 marker 會讓它們全部誤判成缺 evidence。

**Parser 對短 marker 的接受條件**：無 payload 的 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)` 只在 **sidecar 已有對應 `(itemId, kind)` 記錄**時合法；sidecar 也沒有 → 仍計 `malformed`，行為與本契約之前完全一致。所以「先跑 `--write`、再貼 marker」的順序不可顛倒。

**既有行內 payload annotation 一律不動**：`(verified-ui: <ISO> screenshot=...)` 這種舊格式**仍然合法**、仍照舊解析。**NEVER** 為了套用本契約去改寫既有 annotation 把 payload 搬進 sidecar——那是 rewrite 別人當時記下的 evidence，而且對行長沒有收益：本契約只管**新寫入**。

### Canonical annotation keys

| Key | 格式 | Parser 行為 |
| --- | --- | --- |
| `screenshot=<path>` | **單數**，value 是單一 relative path | `findKeyValue('screenshot')` strict match。**僅 legacy 行內格式**；新寫入走 `--screenshot` 進 sidecar |
| `screenshots=<p1>,<p2>` | **複數**，逗號分隔多 path | review-gui parser **不認**（fallback null）— 待 parser 支援前**禁用**。多 screenshot 走 sidecar：同 `(itemId, kind)` 跑多次 `--write`（append-only），或拆 sub-items |
| `(verified-ui: <ISO>)` | 括號內、冒號後空格 | **新契約 canonical 形式**。`hasEvidenceFor` 認為 evidence 已收集；screenshot 路徑從 sidecar 取 |
| `(verified-api: <ISO> <METHOD> <URL> <STATUS>)` | 括號內、四段 space-separated | **legacy 行內格式**，仍合法。新寫入用 `(verified-api: <ISO>)` + `--method --url --status` 進 sidecar |
| `(issue: <description>)` | 括號內、冒號後空格 | `evidenceMissing` 排除此 item（視為 handled） |
| `(claude-analyzed: <ISO> route=<X>[ note=...])` | 括號內、space-separated KV | `analyzedIssuedCount` 計數；bucket 從 `feedbackGiven` 翻為 `awaitingUserReEval` |
| `（fix-requested）` | 全形括號、無 payload | **invalidates** 同行 `(claude-analyzed:)` — user 拒絕 route=E 結論、要求 code fix。`analyzedIssuedCount` 排除帶此 annotation 的 item → bucket 回 `feedbackGiven`（等 Claude 接手修） |
| `(awaiting-user-decision: <description>)` | 括號內 | bucket 翻為 `awaitingUserDecision`（master 排除） |

### Status tags parser 不認的常見錯誤

| 錯誤寫法 | 為什麼不認 | 正確寫法 |
| --- | --- | --- |
| `(deferred: ...)` | parser 只認 `issue` / `verified-*` / `claude-analyzed` / `awaiting-user-decision`；`deferred` 不在辭典 → item 卡 `evidenceMissing` | `(issue: self-collect failed — <reason>)` |
| `screenshots=a,b` | `findKeyValue('screenshot')` 只配 singular key | 對同一 `(itemId, kind)` 跑多次 `--write`（sidecar append-only），或拆成 sub-items 各自 `--write` |
| `screenshot = <path>`（等號前後空格） | KV parser 不 trim 等號兩側 | `screenshot=<path>`（無空格） |
| `#4-xxx.png` 配 item `#4.1` | filename prefix match `#4-` 只配 `#4`，不配 `#4.1` | sub-item `#4.1` 用 `#4.1-xxx.png` |

### MUST（annotation 寫入時）

1. evidence collection 完成時，**MUST** 先跑 `evidence-store.mjs --write` 寫 sidecar，再把它印出的短 marker 原樣貼進行內（per § Evidence 寫入路徑）。讀既有 legacy 行內 payload 時照上表 canonical key（singular `screenshot=`）
2. self-collect fallback chain 全失敗 → **MUST** 寫 `(issue: self-collect failed after (a)(b)(c)(d): <reason>)`，**NEVER** `(deferred: ...)`
3. sub-item `#N.M` 的 screenshot 檔名 **MUST** 用 `#N.M-` prefix，**NEVER** 複用 parent `#N-` prefix
4. route E 結論 **MUST** 同步寫 `(claude-analyzed: <ISO> route=E)` annotation（per MUST 7）
5. **annotation MUST inline（同一行）**：`(verified-*:)` / `(issue:)` / `(claude-discussed:)` 等 annotation **MUST** 寫在 `- [ ] #N ...` marker 的**同一行末尾**，**NEVER** 寫在下一行（即使 indent 正確）。Parser 只解析 item marker 行內的 annotation token；獨立行 annotation = silent miss → `evidenceMissing` → bucket 不收斂。（per [[pitfall-scan-non-ready-passive-report-instead-of-self-fix]]）
6. **write-scan-fix convergence loop（hard rule）**：annotation 寫完後 **MUST** 立刻跑 `review-gui.ts --scan`，讀 scan output 的 `bucket` + `evidenceMissing` + `hitsByCode` + `malformed` + `readinessHits`。若 bucket ≠ `ready`（且非純 user-dependent items），**MUST** 自行 root-cause（讀 scan 的 blocking 原因）→ 修正 annotation / item 描述 → 重新 scan → **loop 直到 bucket=ready 或確認剩餘全是 user-dependent**。**NEVER** 在 non-ready 時回報 user「bucket=readyForEvidence」或「healthCheckNeeded」讓 user 問為什麼 — 那是把 Claude 該做的 root-cause 工作轉嫁給 user。（per [[pitfall-scan-non-ready-passive-report-instead-of-self-fix]]）

   常見 blocking reason 自修表：

   | hitsByCode | 原因 | 自修方式 |
   | --- | --- | --- |
   | `UI_ITEM_NO_URL` | `[review:ui]` / `[verify:ui]` item 描述缺 URL path | 補具體 `/admin/...` path 到 item 描述 |
   | `ABSTRACT_REFERENCE` | item 描述含 `{any}` / `{id}` 等 placeholder | 改成具體 fixture UUID / employee_no |
   | `malformed > 0` | annotation 格式不符 parser 預期 | 讀 scan stderr 的 `malformed ... expected ...` 訊息，照格式修 |
   | `evidenceMissing` 含某 item | 該 item 缺 `(verified-*:)` 或 annotation 不在同行 | 補 annotation 或移到 inline |
   | `readinessHits > 0` | 有 readiness check 未通過 | 讀 `hitsByCode` 對照上表修 |

### Cross-ref

- [[pitfall-verified-ui-annotation-format-drift]] — plural key + sub-item ID mismatch
- [[pitfall-deferred-vs-issue-annotation-contract-conflict-review-gui]] — `(deferred:)` vs `(issue:)` 辭典衝突

## 截圖 evidence 一律走 Claude subagent（MUST）

**Iron Law：`[verify:ui]` / `[review:ui]` 的 evidence 一律由 `screenshot-review` Claude subagent
收，主線只消費它回的 JSON 摘要。主線 `Read` 截圖是例外路徑，只在下表命中時開放。**

**這個 channel NEVER 外派給 Claude 以外的 carrier。** 逐字包含：**NEVER** 派 Pi 任一 model
（`grok-xai` / `grok-cursor` / `sol` / `gemini` / `luna` 一律不准）、**NEVER** 走
`pi-dispatch-screenshot-verify.ts`（該檔已 fail-closed，見下）、**NEVER** 因為「配額比較省」
「seat 剛好有空」「這次只是 ad-hoc 不是 gate」而改派。Charles 2026-08-22 拍板，理由在
§ 為什麼只准 Claude subagent。

本節適用**每一張**截圖、**所有** consumer、**所有四個模式**（`[verify:ui]` channel / archive
前視覺 QA / commit 0-B / ad-hoc）——不是只有批次審視那次。

這條的依據是**收集與判定分離 ＋ 主線 context 隔離**，不是 context 成本、也不再是跨模型驗證
（2026-08-22 起，見下節）。成本面的實測數字見下方 § 實測——它比一次全檔 `Read` 還小，
**NEVER** 拿成本當本節的理由，也 **NEVER** 反過來拿「成本不高」當主線自己 Read 的藉口：
下表的 predicate 是完整的准入條件。

| 可觀察 predicate | MUST |
| --- | --- |
| 要對 `[verify:ui]` / `[review:ui]` item 收 evidence | 派 `screenshot-review` Claude subagent（唯一入口），主線只消費它回的 JSON 摘要 |
| 已經拿到 subagent 的 JSON 且某 item 判 FAIL / UNCERTAIN | 才准 `Read` **那一張**。**NEVER** 為了「順便看一下其他張」連讀 |
| 想確認一批截圖是否都拍到東西 | 跑 `audit-screenshot-quality.ts` 或 subagent 的 emptiness preflight，**NEVER** 逐張 Read 目視 |

### 為什麼只准 Claude subagent

這一列曾經外派給 Pi 的 `grok-xai` seat，2026-08-22 收回。**收回的理由不是 grok 拍不好**——
兩個 seat 是同一個 `grok-4.6`，能力相同。理由是**兩條交付路徑都要付不該付的代價**：

| 路徑 | 代價 |
| --- | --- |
| `xai` seat（當時的預設） | `toolProfile: 'coding'` 不推任何 `--tools`，等於**完整工具集、裸跑在 host、無沙箱、有完整網路** |
| `cursor` seat（沙箱化的那個） | 沙箱是 bwrap ＋ netns，出口只有兩個 hostname。要讓它拍得到本機 dev server，必須替 dev server 開一條 RFC1918 例外——而 dev server 後面有 DB、dev-login 與對外能力，**清單上每一項都把自己的可達範圍一併帶進來** |

也就是為了一個**純機械取證**的工作（開 URL → 等 ready → 拍 → 記 DOM，明文禁止點擊與判斷），
要嘛容忍一個無沙箱的第三方 runtime，要嘛在 default-deny egress 上鑿一個洞。兩者買到的只是
「誰按快門」這個很薄的跨模型性質——**判定本來就留在主線**，截圖品質另有
`audit-screenshot-quality.ts` 機械稽核。

**NEVER** 把本節讀成「Claude subagent 比較可靠所以選它」：[[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]
量到過 Claude wrapper 自作主張的實例。那次的成因是**它被設計成路由器卻決定當執行體**；
本次改動把路由層整個拿掉、subagent 就是執行體，那個矛盾不存在了。**NEVER** 恢復任何
「subagent 收到 brief 後再轉派給別的 carrier」的形狀——那正是踩坑的形狀。

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

## 待拍板佇列是單一入口——`/decisions` 與 `flow pending` 是它的兩個渲染端

`\my` 的五個來源裡有四個是檔案。在來源掃描存在之前 `/decisions` 只看得到 agent 主動 `flow ask`
的題，所以 HANDOFF 裡的積壓永遠不會出現在網頁上——clade 自己的 `HANDOFF.md` 就登記過這個缺口。
現在四個檔案來源由 `vendor/scripts/flow/decision-sources.ts` 掃進 spine，`decision-sync.ts` 對帳。

### MUST

1. **`source_id` 由 identity 導出，NEVER 由內容。** 掃描每 60 秒跑一次；用內容當去重鍵的話，
   改寫一次說明就多開一題，佇列每分鐘成長而且永不收斂。`identityKey()` 取第一段 `**粗體**`
   或第一個分隔符之前的字，**NEVER** 取整行。
2. **來源消失記 `retracted`，NEVER 記成已回答。** 人手動刪掉 HANDOFF 一條 bullet 時那題是沒了、
   不是被裁決了。兩者一旦混進同一個 `end` 事件，之後沒有任何讀者分得出來。
3. **`docs/tech-debt.md` 只認顯式標記**（`**Awaiting**: charles — <問題>` 或 `### 需要 Charles …`）。
   open TD **預設是債不是待拍板**（同 [[work-loop]] § 開場決策清算 (a2)）。<consumer-b> 有 158 條 open，
   全推進佇列等於把真正的問題埋掉。**NEVER** 加關鍵字啟發式——「拍板」二字在 clade 的登記簿裡
   出現 45 行，幾乎全是在講別的條目。
4. **選項抽取抓不到就留空，但 NEVER 靜默退回自由文字框。** 認得的形狀（兩種粗體寫法、四層守衛、
   每一種收不到的寫法）**SoT 在 [[decision-authoring]]**，本節不複述——那一份 paths-gated 到
   `HANDOFF.md` / `docs/tech-debt.md`，也就是**寫**這種條目的當下；本節 gated 到 review-gui 這一側，
   也就是**讀**的當下。同一份形狀寫兩邊必漂，而漂掉的那一半會靜默生效。
   **NEVER** 從散文猜選項——猜錯的選項被點下去就是一個沒人想要的答案被落檔。但「抓不到」
   之後該做的是把題目**丟回去要選項**，不是給一個看起來可以答的輸入框：`\my` 契約要求每條
   ruling 帶 2–4 個排序過的選項，抓不到代表**寫的人沒照契約寫**，而輸入框把那個缺口變成讀的人
   的成本。2026-08-27 實測 38 題只有 1 題帶選項，整頁不可回答而畫面上看不出來。
   三個落點缺一不可：`needs_options` 旗標（`decisions.ts`）、頁面上一鍵要選項（不必打字）、
   掃描開 span 當下自動要一次（`decision-sync.ts` 的 `options_requested`）。
   **NEVER** 把「沒有選項」渲染成「這題要給值」——`\my` 要的是二擇一（附選項，**或**明說要給值
   並逐項列出要填什麼），兩者皆無是沒寫完，渲染成第二種等於幫違規蓋章。
5. **提問方的背景 MUST 兩個 payload 鍵都讀**（`context` ?? `detail`）。兩條提問路徑各寫各的：
   `herdr-session-handoff.ts` 寫 `context`（blocked pane 的回報），檔案掃描寫 `detail`（HANDOFF
   bullet 的縮排續行）。而掃描出來的 `question` **只有那條 bullet 的第一行**——續行全在 `detail`
   裡，所以少讀一個鍵不是「少了背景」，是問題只剩上半句。2026-08-27 實測：38 條 open span 有
   35 條帶 `detail`、0 條帶 `context`，頁面的詳情區塊從未渲染過一次。**NEVER** 改某一端的寫入鍵
   來統一——兩個鍵都已經在既有的 span 上，改名只是把盲區換到佇列的另一半
6. **兩個渲染端讀同一組函式，NEVER 各掃各的。** `/decisions`（手機、可推播）與 `flow pending`
   （對話端，`\my` 讀的那個）都走 `buildServeSnapshot` → `buildDecisionQueue` → `measureRepo`。
   任何一端自己去翻那四個檔，同一個待拍板事項就會在兩邊長得不一樣，而人會以為那是兩件事
   （2026-08-27 Charles 拍板：「`\my` 應該成為 `/decisions` 的 chat 互動版本，兩邊都應該同時
   提供該有的東西」，決策紀錄在 clade `HANDOFF.md`）。新增第三個渲染端時同樣走這三支。
7. **寫入端同樣共用同一組函式——第 6 條的另一半，而且賠率更高。** 每一條寫入路徑
   （`/decisions` 的 answer / revise / clarify / dismiss / ask-options 端點、`flow answer` 與
   同名的其他 CLI 子命令、Notion projector）**MUST** 走 `answerDecision` / `reviseDecision` /
   `requestClarification` / `dismissGated`，且 repo 名 → checkout 根目錄**MUST** 經
   `flow/fleet.ts` 的 `resolveRepoRootByName`。

   讀取端各掃各的，後果是同一件事在兩邊長得不一樣；**寫入端各寫各的，後果是答案落到別的
   repo 的 spine、改到別的 repo 的檔案**，而那個 repo 上根本沒有這個 span。兩者不同量級。

   - **NEVER 讓任一端自己解析 repo 名**，包括「由人目測填一個 `repoRoot`」——那是第二份實作，
     只是它由猜測構成、而且不帶 roster 檢查。2026-08-27 之前 `\my` 的答題步驟逐字要求手寫
     `node -e "import { answerDecision } ..."` 並自填 `repoRoot`，正是這個形狀
   - **NEVER 在解析不出名字時 fallback 到 clade**。靜默把 consumer 的答案寫進 clade 的 spine
     與 clade 的檔案，比一個看得見的失敗糟得多
   - **NEVER 為新介面另寫一支「比較簡單」的落檔**。落檔語意（先收 span 再落檔、TD register 的
     before/after hygiene 量測與回滾、carrier 的 repo 內含守衛）全部住在那幾支函式裡，重寫一份
     就是把這些守衛悄悄拿掉
   - 新增第 N 個寫入介面時，它該做的事是**呼叫**上面那幾支，不是重現它們
8. **宣告「已開 span」之前 MUST 回讀 spine。** `startSpan` 丟棄 `emitEvent` 的回傳，所以
   `requestDecision` 在事件被 validator 拒收時**照樣回一個 handle**。只信 handle 的結果是每輪
   無聲重試、佇列永遠是空的，而 log 說一切正常。`syncDecisions` 的 `unwritten` 欄位是這條的實作。

6. **問卷模式只收可回答的兩類，且只在球在人這邊時收。** `/decisions` 預設的問卷 view 一題一
   畫面連續作答，收進牌堆的 **MUST** 只有 `category` 是 `ruling` 或 `review`、且
   `awaiting_clarification` 為 false 的題。這是上面 NEVER 第 3 條在新 view 的同一條線：其餘三桶
   回不掉，而球在 agent 手上的題現在作答等於回答一個自己剛說看不懂的問題。

   **判準是「回一則短訊結不結得掉」，NEVER 是「可不可逆」、也 NEVER 是「重不重要」。**
   2026-08-28 之前 `review` 被歸在 `irreversible`（現 `human-action`），於是 7 條做完等驗收的
   工作在每個渲染端都印「這條是狀態不是問題」，躺了 10.8–16.6 小時；同一頁的頁首還同時顯示
   「卡在人類 gate 的 0 件」。名單要加新 category 時**回到那個判準**，NEVER 照桶名的語感歸類。

   **被退回補件的可回答列 MUST 在問卷 view 留下計數。** 它們因 `awaiting_clarification` 離開
   牌堆，又因為「可回答」不算進 `readonlyCount`，兩個既有計數都數不到——沒有 `handedBackCount`
   那一行，自動退回會讓佇列自己清空而不說清空到哪去，那是「我看不懂我要幹嘛」的另一種形狀。

   `review` 另有一條前置：**缺證據時（`missing-evidence` 未清）MUST NOT 渲染可按的「通過」**——
   一顆按得下去的通過配上沒有東西可看，是在請人蓋一個他無法負責的章。

   **措辭綁的是事實，NEVER 綁 flag。** 寫成「`needs_evidence` 為 true 時不渲染」是一句更弱的
   話：它可以靠**讓 flag 變 false** 來滿足。實際發生過——`needsEvidence()` 一度借用
   `needsOptions` 的 clarification guard，於是條目被退回補件的那一刻 flag 就落下，規約字面上
   滿足了，畫面上長出一顆可按的通過配零證據。ruling 側同一個 guard 無害只是因為它的 radio
   蓋在空的 options 陣列上，而 review 的通過／退回是掃描端**永遠**合成的。
7. **鎖是兩種強度，畫面 MUST 說出是哪一種。** 問卷點下選項就寫檔，沒有送出前的預覽——防誤觸
   的東西換成了「按錯了改得回來」（`decision.revise`）。所以答案能不能改就是這個交換的全部：
   - `pickup`：有 agent 跑過 `flow answers --claim` 說它接手了。**硬鎖，NEVER 提供覆寫**
   - `follow-up`：推論——答案之後同一個 `work_id` 又開了非 point、非 `decision.*` 的 span。
     軟鎖，**MUST** 明說是推測並允許使用者推翻

   **NEVER** 把兩者渲染成同一句話。它們的證據強度差一個量級，而使用者要據此決定要不要動一個
   可能已經被執行的答案。
8. **讀答案的 agent MUST 跑 `flow answers --claim`。** 落檔的答案沒有讀者紀錄：在這條之前
   ，「有沒有人看過這個答案」在 spine 上完全不存在，而 `follow-up` 推論對**新 process** 讀答案
   的情形結構性失效（`resolveWorkId` 為每個新 process mint 一個無關的 orphan work id）。
   所以硬鎖只有這一條路徑產得出來——**NEVER** 拿「推論鎖還在」當略過 claim 的理由，那條推論
   看不見的正是最常見的那一種接手。

### NEVER

- ❌ 把 `follow-up`（推測）鎖渲染成 `pickup`（宣告）鎖，或反過來——見 MUST 7
- ❌ 讓問卷模式收第 2/3/4 類或 `awaiting_clarification` 的題（見 MUST 6）
- ❌ 對 `--apply` 以外的路徑寫 spine。`flow sources` 預設 dry —— 寫入是 14 個 repo 的副作用，
  安全的呼叫法必須是短的那個
- ❌ 在 `CLADE_FLOW_EVENTS` 下跑對帳。它把所有 repo 的 spine 指向同一個檔，對帳會把別 repo
  的題判成「來源已消失」而撤回
- ❌ 把唯讀那幾類（不可逆 gate／loop 推不動）做成可回答。它們是狀態不是問題
- ❌ 讓要選項的文字由人自己打。SoT 是 `OPTIONS_REQUEST_TEXT`，頁面按鈕、`flow ask-options`、
  掃描端自動要求三條路徑共用同一句。要人打的話等於把同一段話手抄 N 次——實測 37/38 題需要它，
  沒有人會這樣做，於是整頁停在不可回答的狀態。兩份文字則會漂，而收到的 agent 分不出是哪一份
- ❌ 在 fleet 模式保留 `other-repo` 桶，或對唯讀類寫「要回那個 repo 的 session」。那個桶來自
  `\my`，而 `\my` 跑在**單一** checkout 裡；`/decisions` 掃整個 fleet 且每列都標了 repo，
  在那裡「不在本 repo」指不到任何東西。更糟的是桶裡多半是 A repo 指向 B repo 的 pointer
  （`<consumer-b>[已登記] clade：…`），真正的 owner 是它**指名**的那個 repo 而不是它的 carrier ——
  照著文案回 carrier 的 session 是被送到錯的地方。fleet 下 `bucketOf` 把它折進 `ruling`

### 推播

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `/decisions` 佇列出現**新的**可回答項（`ruling` 或 `review`）。**只推可回答的**——三個狀態類用最吵的管道送唯讀清單，結果是使用者關掉推播。首次啟動（seen 檔不存在）**NEVER 推播**，只種下當前 span id：實測 fleet 首掃 38 件，當成新項會一次送出三十幾則 |
| 消費端 | Charles 的行動裝置（Web Push）。點通知直接落在 `/decisions#<span_id>` 那一題 |
| 載入路徑 | 本節（`rules/core/review-gui-surface.md`，paths-gated 於 `vendor/scripts/flow/decision*.ts`）；實作在 `vendor/review-gui-web/server/plugins/decision-watch.ts` |

seen 集合 **MUST 落磁碟**（`~/.config/clade/review-gui-seen-decisions.json`）：放記憶體的話每次
deploy 重啟都重推一輪全部。訂閱只在 410 / 404 時移除，**NEVER** 因網路或 5xx 移除——把暫時性
失敗當永久失效的結果是裝置靜默地再也收不到，且沒有任何一步會說它被刪了。

## 界線（不在本 rule 範圍）

下列**不**屬本 rule：

- **review-gui.ts 本體 bug**（endpoint、SPA、aggregation logic）→ 由 [[review-gui-change-discipline]] § Hard rule (fixtures gate) 管
- **review-gui server-side gate 實作細節**（impl gate threshold、422 response shape）→ vendor script 本體 source-of-truth，本 rule 只規約 surface 該遵守的 contract
- **跨 consumer 觀感 bug**（review-gui CSS / 字級 / 字色）→ audit-ux-drift 管

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Agent self-verification meta rule（fallback chain / 不踢 user） | [[agent-self-verification]] |
| Review-gui core 本體 change SLA（fixtures gate） | [[review-gui-change-discipline]]（clade 自治區） |
| Verify channel annotation 格式（含 verified-ui screenshot=） | [[manual-review.backend]] § 標準流程 § `[verify:ui]` channel |
| Compound item 拆分 / multi-screenshot annotation 規約 | [[manual-review.evidence]] § Item Kind Marker `verify:ui` |
| Handoff Mode B Step 2B.0 / 2B.1.7 review-gui readiness scan | `plugins/hub-core/skills/handoff/SKILL.md`（pending TD-151 implementation） |
| review-gui detail page impl gate（已 implemented） | `vendor/scripts/review-gui.ts` `countImplementationProgress` / `persistReviewAction` |

## Audit signal

規格細節見各 script 頭註解 + TD entry（`docs/archives/tech-debt-closed-2026-06.md`）：

| Signal | TD | 狀態 | SoT |
| --- | --- | --- | --- |
| `compound_verify_ui_single_screenshot` | TD-142 / TD-143 | done | `vendor/scripts/audit-screenshot-quality.ts` |
| `stale_screenshot_after_ui_change` | TD-178 | done | `vendor/scripts/audit-screenshot-staleness.ts` |
| `claude-analyzed-drift`（MUST 6/7 違反偵測） | TD-179 | done | `vendor/scripts/audit-claude-analyzed-drift.ts` |

**Performance 實測（MUST 5）升級路徑**：目前 advisory；若漏驗頻繁 → archive 前 hard gate 或 review-gui 自動生成 perf-trace sub-item（動本體，須走 [[review-gui-change-discipline]] fixtures gate）。

## 違反時的回報方式

```text
[review-gui-surface] Hard rule violation
修正方式：
  - skip scan → 跑 `--scan` 寫進 HANDOFF.md 再推薦
  - compound 單截圖 → 拆 sub-items 或補 multi-screenshot annotation
  - 繞 impl gate → 等 impl ≥ 90% 再做 manual review
  - 推 URL 給 user → 先跑 [[agent-self-verification]] fallback chain
  - 引用舊快照答狀態 → 本 turn 先重跑 `--scan` 再答
  - 回「你還沒點」→ 重掃驗證；檔案沒反映就當場代寫，並告知可能撞 409
繞過：無 escape hatch — review-gui contract 是真相層
```
