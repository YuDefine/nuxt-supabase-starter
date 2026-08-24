---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、mechanical readiness gate 的 exit code 判讀、交付入口前置查詢（先問服務不問 config）、review-gui 引導與 fallback、`[discuss]` item 的歸屬
paths: ['openspec/changes/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.manual-review-entry.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Proactive Skills — 人工檢查入口

> 從 [[proactive-skills]] § Manual Review 抽出（2026-07-31）。主檔留的是 always-load 的三條契約（第一動作是 auto-triage、推進完 MUST 跑 gate script、NEVER 自判 bucket）；本檔是**真的走到 `## 人工檢查` 階段時**的操作層。

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

**MUST** 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作是 auto-triage（per [[review-gui-surface]] MUST 9），不是直接把 review-gui 連結丟給使用者**。

## Auto-triage + mechanical readiness gate

1. 逐條讀 pending leaf item 的 annotation，判斷阻塞原因並自行推進：
   - `（fix-requested）` → dispatch `/wt` 修 code → merge-back → 重拍截圖 → strip annotation
   - evidence missing → 走 [[agent-self-verification]] fallback chain 收 evidence
   - `（issue:）` 無 `(claude-analyzed:)` → triage issue 走 (A)-(E) 路由

2. 推進完畢後 **MUST** 跑 mechanical gate script 確認 bucket：

   ```bash
   node ~/offline/clade/vendor/scripts/check-review-readiness.ts \
     --repo . --change <change-name>
   ```

   - **exit 0** → 可引導 user 到 review-gui
   - **exit 1** → 繼續 auto-triage 或如實報告卡住原因
   - **NEVER** 自判 bucket、NEVER 跳過 script

**NEVER** 在 script exit ≠ 0 時引導 user 到 review-gui — Claude 自判已多次證明不可靠（同根因 pitfall 見 [[review-gui-surface]]）。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框走人工檢查——那是 review-gui 不可用時的 fallback，不是 default path。

正確流程：

1. **Auto-triage first**：推進所有 Claude 可處理的 pending items（fix-requested / evidence missing / issue triage）
2. **首選（DEFAULT）**：auto-triage 後 `bucket=ready` → **先跑 § 交付入口前置查詢的兩條指令**（`review-gui-service.sh status` ＋ `curl /api/changes`）：
   - **第 1 條 exit 0 且第 2 條印出了自己那條 `changeKey`**（常態）→ **NEVER** 叫 user 跑任何啟動指令，
     直接照 § 交付入口前置查詢表格第 1 列給 URL（host ＋ API 回的 `reviewPath`，要指到某條 item 就加
     `?item=%23N.M`）。**NEVER** 在此另行憑印象拼一次 URL
   - **exit ≠ 0，或清單裡沒有自己那條** → 走 § 交付入口前置查詢的第 2、3 列：**自己**把服務帶起來 /
     重生 `consumers.local` 再給 URL，**NEVER** 把啟動指令交給 user（聚合機制與 cwd 規約見
     [[review-gui-surface]]）

   兩條路都是給完 URL 後等使用者跑完 GUI 流程回報再繼續。完整格式、encode 規則與 NEVER 清單見
   [[review-gui-surface]] § Inline Review-GUI Deep-Link。
3. **Fallback**（GUI 不可用時）：截圖 → 逐項展示 → 使用者回覆 OK / 問題 / skip → 依答覆更新 checkbox

## 交付入口前置查詢（MUST）

把人工檢查入口交給人之前，**MUST 先問「現在有沒有服務在提供入口」**。這是查表不是推理，兩條指令逐字：

```bash
bash ~/offline/clade/ops/review-gui-service.sh status          # 判 exit code，不要逐行比對字串
curl -s --max-time 60 http://127.0.0.1:5174/api/changes \
  | python3 -c "import json,sys;[print(i['changeKey'],i['reviewPath']) for i in json.load(sys.stdin)['changes']]"
```

**第 1 條 MUST 判 exit code，NEVER 拿單一行字串當結論**：它的輸出是多行（`enabled` / GUI unit 的 `active` / dispatch-pickup 的 `not-found` 與 `inactive` / `ss` 表 / 健康 JSON），裡面本來就同時出現 `active` 與 `inactive`。**exit 0 就是服務健全**（末行為 `{"ok":true,"authRequired":false}`）。

**第 2 條印的是 `changeKey` 與 `reviewPath`**（`/api/changes` 的 change object **沒有** `id` 欄位），它同時是 [[agent-self-verification]] MUST 11 要的 known-positive control：回答「服務看不看得到**我這條 change**」，而任何 repo-scoped grep 對這題都答不出來。`reviewPath` 就是要交付的路徑，直接接在 host 後面，**NEVER** 自己憑印象拼。

| 兩條指令的結果 | 交付什麼 |
| --- | --- |
| 第 1 條 exit 0，且第 2 條印出了自己那條 `changeKey` | canonical URL = `https://review-gui.<maintainer-domain>` ＋ 該條的 `reviewPath`（Cloudflare Access 保護；user 在本機時 host 換 `http://127.0.0.1:5174`）。**這是常態，不需要補任何東西** |
| 第 1 條 exit 0，但第 2 條沒印出自己那條 | 改 `registry/consumers.json` → 跑 `node scripts/bootstrap-consumers-local.ts` 重生 `consumers.local`（該檔 gitignored，手改不留存）→ `sudo systemctl restart review-gui` → 重跑第 2 條確認它出現 |
| 第 1 條 exit ≠ 0 | 自己用 `bash ~/offline/clade/ops/review-gui-service.sh install` 把服務帶起來（該子命令自帶 `systemctl restart` 與健康等待），再回到上面兩列 |

**NEVER 從 consumer 自己的 config 推論入口不存在。** `nuxt.config.ts` 沒掛 tunnel plugin、`consumer-meta.json` 的 `deploy.prodUrl` 是 null——這兩件事跟 review-gui 有沒有在跑**無關**：它是跨 consumer 共用服務，consumer 清單來自 clade 的 `consumers.local`，不由任何 consumer 的 config 描述。這類 negative search 不成立為 absence 證據（[[agent-self-verification]] MUST 11）。

**NEVER 交付 `cd <path> && <cmd>`。** 逐字實錄：「`cd ~/offline/<consumer-j>-wt/kiosk-google-allowlist && pnpm review:ui`」——那是指令不是位址（要 user 自己執行才生得出畫面）、`127.0.0.1` 只在跑 dev server 的那台機器上有意義、且綁在會過期的 agent lease 上。同理 **NEVER 交付 `https://review-gui.<tailnet>.ts.net/`**：pairing token 已停用（`ops/review-gui-service.sh` 的 `pairing_retired()`），那條會停在配對畫面。

### 能力真的缺席時怎麼講（照抄）

三列全部落空——服務帶不起來，且該 consumer 自己也沒有 HTTPS 入口——才交付這段，**NEVER** 退回貼指令：

```text
目前給不出可直接開啟的驗收連結：review-gui 服務 <status 逐字輸出>，本 consumer 也無自有 HTTPS 入口
（無 tunnel、無 tailnet cert）。待驗的是 <change-name> 的 <N> 條 [review:ui]，已 bucket=ready。
入口能力補齊方式見 pitfall-review-entry-degraded-to-local-shell-command § Fix Recipe。
```

## `[discuss]` items 不在 review:ui 主流程

`[discuss]` items（production 授權 / 商業判斷 / production 觀察類）**MUST** 由 `/spectra-archive` Step 2.5 walkthrough 接管，**NEVER** 在 review:ui 引導流程內處理——trigger 是外部 signal，提前分析只會讓 change 永遠卡在 review:ui pending state。

review-gui 對純 D-only pending 的 change 自動歸「🗓 等 archive walkthrough」群（無接手 prompt）→ 告知 user「跑 `/spectra-archive <change>` 觸發 Step 2.5 walkthrough」；落「🤖 等 Claude 接手」群（仍含 I / V）→ 接手 prompt 對 (D) 只列 walkthrough trigger，不分析、不寫 (claude-discussed:) annotation。

詳細 scope rule 見 [`manual-review.md`](./manual-review.md) § Item Kind Marker `[discuss]` 段。

## Inline Review-GUI Deep-Link（hard rule）

核心 one-liner：引導使用者到 review-gui 時，**MUST** 在 chat 訊息中給出**指到該條 change 的** deep-link，**NEVER** 給裸 `/review` 或根路徑 `/`。

deep-link 怎麼組（host ＋ `/api/changes` 回的 `reviewPath`）以本檔 § 交付入口前置查詢為準，**NEVER** 憑 `<consumer-id>:<change-name>` 樣式自己拼。URL 三層格式、cross-consumer prefix、itemId encode、NEVER 清單見 [[review-gui-surface]] § Inline Review-GUI Deep-Link；service 判定與交付路徑仍以本檔 § 交付入口前置查詢為準（該檔已於 2026-08-24 對齊）。
