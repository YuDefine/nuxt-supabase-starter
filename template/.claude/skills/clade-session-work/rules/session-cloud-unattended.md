---
description: cloud session（claude.ai／routine／cloud-dispatch 開的 Claude Code on the web）一律無人值守：要決定的事寫成 GitHub 上的 BLOCKED 回報，不停下來等人；registry repo 的 issue 只准兩種用途，BLOCKED issue 解掉就關、逾期 3 天升級
paths:
  [
    'capabilities/core/hooks/pre-tool-cloud-question-gate.sh',
    'vendor/scripts/lib/cloud-orphan-blocked.ts',
    'vendor/scripts/lib/issue-usage.ts',
    'vendor/scripts/issue-usage.ts',
    '.github/workflows/issue-gate.yml',
  ]
---
<!-- Clade native rule; source: rules/core/session-cloud-unattended.md; edit canonical source -->
<!-- clade-targets: claude -->

# Cloud session 無人值守

**範圍**：**每一個** cloud session（環境變數 `CLAUDE_CODE_REMOTE` 非空且不是 `0`／`false`），不論是 `cloud-dispatch.ts` 派的、Charles 在 claude.ai 開的、還是 routine 開的。

## 為什麼

cloud session 旁邊沒有人。主持者 `SendMessage` 給它是單向的（不回訊、不確認已讀），ListAgents 只看得到 `waiting on a human`、看不到題目。cloud session 說的話唯一讀得回來的地方是 GitHub。

## 卡住時的動作

1. **NEVER** 用 `AskUserQuestion`、`EnterPlanMode` 或任何會停下來等人回答的互動方式。fleet hook `pre-tool-cloud-question-gate.sh` 在 cloud 會直接擋下（本機 session 不受影響）。
2. 在 GitHub 回報（cloud VM 沒有 `gh`，用 session 的 GitHub 工具）：在該 repo 開 issue，標題＝第一行。**已有 PR 也開 issue**——watch 只對 cloud-dispatch record 擁有的 branch 讀 PR comment，claude.ai／routine 開的 session 留在 PR 的回報沒有人讀得到。內文：

   ```
   BLOCKED: <needs-coordinator|needs-charles|environment> <一句原因>
   Session: <這個 session 的標題>
   Branch: <目前 branch>
   Work: <work id，沒有就省略>
   ## 題目
   <題目原文>
   ## 選項
   - <選項>（推薦）：<這樣做會怎樣>
   - <選項>：<這樣做會怎樣>
   ```

   類別：`needs-coordinator`（主持者能決定或補資源）、`needs-charles`（只有 Charles 能答）、`environment`（權限、hook、工具、secret）。與 `cloud-dispatch.ts` 的 `parseBlockedLine` 同一套，**NEVER** 自創類別。
3. 回報後繼續做不依賴該決策的部分；必須先決定才能動的，照最保守的選項做或停在那一步，在最後回覆寫明。
4. 同一件事再卡時更新同一張 issue，**NEVER** 另開；同一個根因（例如同一支 hook 擋 commit）已有 open issue 就在那張留言。
5. 後來自己解掉了（權限其實放行、PR 已開出）：留言寫明怎麼解的，**同一個動作**把 issue 關掉。**NEVER** 只寫「可關閉」留給別人關。

## 主持者那一端

watch（`coordinator-snapshot.ts`）每輪用一次 `gh search issues --repo <registry repo>…` 讀 registry repo 的全部 open issue（同 owner 但不在 `registry/consumers.json` 的 repo 不讀：cloud session 只派進 registry repo），標題或內文第一行是合法 `BLOCKED:` 行、`Branch:` 對不上 cloud-dispatch record 的就是「無 record 回報」，題目原文與選項直接印進 `主持者必做`。ListAgents 的 `waiting on a human` 列讀不到回報時，印的處置是先 `SendMessage` 要它照本規約回報；**NEVER** 把沉默當已處理，**NEVER** 鑄只寫「開 claude.ai 看」的題給 Charles。處理完把 issue 關掉。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | cloud 環境呼叫 `AskUserQuestion`／`EnterPlanMode` → hook exit 2；watch 讀到無 record 的 open `BLOCKED:` issue 或 `waiting on a human` 列 → 印 `主持者必做` |
| 消費端 | cloud session 本身（改寫回報）；主持者 watch 摘要（代答或鑄題） |
| 觸發點 | 工具事件 hook：`pre-tool-cloud-question-gate.sh` 在擋下那一刻印格式與本檔位置；失敗輸出：watch 的 `主持者必做` 行帶本檔路徑 |

## Issue 用途（封閉清單，全 registry repo）

registry repo（`registry/consumers.json` 的 `repo_id`）的 GitHub issue 只有兩種合法用途，判準唯一來源 `vendor/scripts/lib/issue-usage.ts`：

| 用途 | 誰開、誰關 |
| --- | --- |
| `BLOCKED: <類別> <原因>` 回報 | cloud session 照上方格式開；解掉的人關（回報者自解見上方第 5 步，其餘由主持者處置後關） |
| `🌙 nightly validate 紅燈`（只限 clade） | `validate.yml` nightly-alert 以 github-actions bot 身分自動開、轉綠自動關 |

其餘一律不開 issue，各有落點：TD、待辦 → plan § Open work（lifecycle repo）；未遷移 consumer 的 TD 才登記到既有 `docs/tech-debt.md`、待辦走 HANDOFF；要 Charles 答 → `flow ask`；討論與修補 → PR。上游套件的 bug 開在上游 repo，不受本節限制；registry 裡 `visibility: public` 的 repo 本身就是外部使用者的上游，只判 BLOCKED 回報（格式與逾期），外部開的 issue 不判用途。

- **機械層**：clade 的 `.github/workflows/issue-gate.yml` 在開立、重開、改標題時判定，不合規就留言指路並以 `not_planned` 關閉；格式壞掉的 BLOCKED 只留言、保持 open（見下一條）。標題與內文第一行任一是合法 `BLOCKED:` 行都算回報，與 watch 的孤兒判定同一套。consumer repo 沒有這支 workflow；watch 每輪用同一次 `gh search issues`（只搜 registry repo）跨 registry 判同一套，列進 `主持者必做`（帶處置指令）。手動盤點：`node vendor/scripts/issue-usage.ts check`。
- **格式壞掉的 BLOCKED**（以 `BLOCKED` 開頭卻缺合法類別，例如 `BLOCKED: TD-1004 …`）：watch 讀不到題目，等於沒回報。主持者讀內文，仍卡就把標題改成合法格式，過時就留言後關。
- **逾期**：合法 `BLOCKED:` issue 開立滿 **3 天**仍 open，watch 每輪置頂到關掉為止。逾期以開立時間計，留言不會重置。處置：已解或過時 → 留言處置結果後關；仍卡 → 照類別處置，同根因的多張併成一張（其餘留言指向保留的那張後關）。
- **needs-charles 類**：主持者鑄給 Charles 的題 MUST 把題號（`flow ask` 回傳的 span id）留言在該 issue；Charles 答了，主持者照答案處置並關 issue。**NEVER** 讓 issue 與 Charles 佇列各自懸著。
- 日後某個 repo 確有其他合法用途，改 `issue-usage.ts` 的判準並在本表加列，**NEVER** 在個別 repo 繞過。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | clade：issue `opened`／`reopened`／改標題 → `issue-gate.yml`；全 registry：watch 每輪讀到不合規、格式壞掉、或開滿 3 天的 BLOCKED issue |
| 消費端 | 開 issue 的 session（clade 端被自動關閉並留言指路）；主持者 watch 摘要 |
| 觸發點 | 失敗輸出：issue-gate 的關閉留言、watch `主持者必做` 行，兩者都帶本節位置 |

## 判別與唯一逃生口

- 判別條件只有「是不是 cloud 環境」。**NEVER** 改成看「是不是主持者派的」「有沒有 cloud-dispatch record」——卡住的 cloud session 多半沒有派工紀錄。
- 不為任何人自開的 cloud session 留預設例外。唯一逃生口：該 session 的環境明確設 `CLADE_ALLOW_CLOUD_QUESTION=1` 才恢復互動提問，預設關閉。cloud-worker brief、routine、`cloud-dispatch.ts` 等派工路徑 **NEVER** 自動帶上它（`test/pre-tool-cloud-question-gate.test.ts` 釘住）。
