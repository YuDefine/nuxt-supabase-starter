---
name: track
description: Charles 送 `/track`：查交代的事（進度結論、切過去）或標追蹤。NOT for keep-panes／hold。
metadata:
  author: clade
  version: '1.1'
  clade:
    invocation: explicit
    permission_tier: draft
disable-model-invocation: true
---


# `/track` — 委託帳：查交代過的事、標追蹤

Charles 交代完任務會離開一陣子；這件工作中途可能換好幾個 session（relay 繼任、冷續接、主持者重派、停放後續接），每個都可能被巡檢收掉。追蹤 **NEVER** 擋收割，但每一棒收掉時 watch 都落接續檔（結論＋接續 prompt）、更新委託帳；只有兩種時刻發 Discord：**完成**（附結論）與**等你回答**（停放、題目進 /my）。換棒、停放等事件只記帳不推播。

委託帳有兩種來源：Charles 在自開的 Herdr pane 交代第一件事時，hook `user-prompt-errand-register.sh` 自動登記（origin=auto，只追那個 session 與它的接班）；`/track` 手動標記（預設追整件工作 work id，沒有 work id 才只追單一 session，`--session-only` 可強制）。主持者派出去的照派工追蹤，不自動登記。機械部分全在 `node ~/offline/clade/vendor/scripts/tracked-session.ts` 與主持 watch；本 skill 只決定「查還是標、標誰」。

# SOP

## Phase 0 -- 判定查詢還是標記

1. THINK 讀取 `rules/委託帳查詢判準.md`，依 `/track` 後面的參數判定走查詢（Phase 3）還是標記（Phase 1）。

## Phase 1 -- 決定標誰

1. THINK 讀取 `rules/追蹤標記判準.md`，依本 session 的身分（一般工作 session、被派出的 worker、主持者）與這件工作會不會派出去，決定登記形狀（標自己、標下一個派工、補綁既有 dispatch）。

## Phase 2 -- 登記

1. DELEGATE 依 Phase 1 的形狀執行 `node ~/offline/clade/vendor/scripts/tracked-session.ts mark --title '<任務一句話>' --session '${CLAUDE_SESSION_ID}' [--follow-next-dispatch | --dispatch <id> | --work <W-id>] [--brief <原 brief 絕對路徑>]`；`--title` 用 Charles 的原話濃縮成一句；work id 由 script 自動取（`--work` > `--dispatch` 的 record；`CLADE_WORK_ID` 只在兩者都沒給時採用，給了 `--dispatch` 卻查不到它的 work 就只追那個 dispatch），`${CLAUDE_SESSION_ID}` 展不開（非 Claude runtime）就省略 `--session`，改靠 `HERDR_PANE_ID`／`CLADE_DISPATCH_ID`。
2. READ 確認輸出以 `📌 已登記追蹤` 開頭（找不到 script 或沒有這行＝沒標上，照 `rules/追蹤標記判準.md` Rule 1 最後一條回報，**NEVER** 說已標記）並記下追蹤 id；回覆 Charles 一行：追蹤 id、標到的是誰（自己／待派出的 worker／哪個 dispatch）。
3. THINK 若 Phase 1 判定為「標下一個派工」，派出 worker 後讀取 `rules/追蹤標記判準.md` Rule 2，確認 `tracked-session.ts list --all` 該列已綁上 dispatch；沒綁上就以 `--dispatch <id>` 補綁。

## Phase 3 -- 查詢

1. DELEGATE 依 Phase 0 的判定執行 `node ~/offline/clade/vendor/scripts/tracked-session.ts list`、`show <id|關鍵字>` 或 `open <id|關鍵字>`（非主持權威機會自動經 ssh 讀權威機的登記檔）。
2. WRITE 把輸出原樣轉給 Charles：列表每件一行（狀態｜標題｜一句結論｜在哪｜id）；`show` 的結論與接續 prompt **NEVER** 改寫或摘要；`open` 切過去了就回一行「已切到哪個 pane」。

# 各事件在委託帳上的樣子

- 換棒（冷續接、harvest-relay、停放後續接派出新 dispatch、停放的自開 pane 以同一個 session 在新 tab 續接）→ 記一棒、落 `<追蹤id>.hopN.md`、改綁到接班（自開 pane 冷續接新鑄的 work id 也接上），不推播。
- 停放等 Charles 回答（park-ask，或停放理由提到 Charles）→ 記一棒、標「等你」並推播；接班活過來就自動解除。停放等事件（park-wait 等）只記一棒。停放列被答案直接結案（沒開接班）→ 關列，不推播。
- 收工（收割、close 類）→ session 追蹤關列並推播「完成」；work 追蹤只記一棒，整件完成由 flow spine 判（終態且沒有 session 在跑），完成時推播結論。結論來源依序：completion summary → session digest 的最後一則 assistant 文字 → 前幾棒留下的結論。
- 不經自動處置的關閉（手動關 pane、cloud 自動收割、撞額度後 pane 被收、session 自行結束）→ 消失兜底：上一輪點名看得到、本輪該載體來源完整卻看不到時判 `vanished`。有完成證據（completion summary 或收割）才結案推「完成」；沒有就標**失聯**：列不關、推播 ⚠️、狀態列與看板計入「失聯」，**NEVER** 當成 Charles 自己關掉而靜默結案（2026-10-25：23 件做到一半的委託因此斷追）。同一個 session 再被點名看到（接回）就解除；Charles 看過結論要結案跑 `tracked-session.ts done <id|關鍵字>`，誤結案要接回跑 `reopen <id> [--pane] [--machine]`。cloud 來源平常常是 partial，兜底可能很晚或不發；Remote Control 載體沒有消失兜底。
- 已知缺口：自開 pane 自己跑 `/handoff relay` 交棒時，接班 session 不經 watch，委託帳跟不到接班（舊 session 消失後照上一條標失聯）；要繼續追就在接班 session 送 `/track`。
- 推播沒進佇列時，該推播的那一刻不動帳，下一輪兜底重判。

# Additional Resources

- `rules/委託帳查詢判準.md`：參數怎麼判查詢還是標記、查到一件時 show 或 open（Phase 0）
- `rules/追蹤標記判準.md`：標誰、何時補綁、追蹤與 keep／hold 的分工（Phase 1 第 1 步、Phase 2 第 3 步）
- 接續檔與通知格式：`~/offline/clade/vendor/scripts/lib/tracked-sessions.ts` 的 `notifyTrackedClosures`；接續檔在權威機的 `~/.cache/clade/coordinator/tracked-sessions/`；看板同一份資料在 `/fleet` 的「我交代的事」，狀態列可用 `tracked-session.ts count`
