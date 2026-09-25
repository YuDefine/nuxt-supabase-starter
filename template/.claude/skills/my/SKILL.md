---
name: my
description: Charles 送出 `\my`（backslash，非 slash）時的完整流程——`\my` 是 `/decisions` 的 chat 互動版本：讀同一份待拍板佇列、把只存在對話裡的待決策點推進佇列、在對話裡渲染成可回覆的 Qn、回答時關 span 並落 carrier。收到 `\my` 這個 token 時 MUST 立刻載入本 skill 再開工。
license: MIT
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: draft
---

<!-- clade-skill-scope: both -->

# `\my` — `/decisions` 的 chat 互動版本

`\my` 等同「列出只有我做得了的待辦」。回到電腦時問「我不在的期間，累積了哪些**球在我手上**的事」。

> **同源鐵律**：`\my` 與 `/decisions`
> 讀**同一份**佇列，兩邊都要提供該有的東西。**NEVER** 自己另外掃一份——同一個待拍板事項在手機上
> 與在對話裡長得不一樣時，人會以為那是兩件事。

## MUST 依序跑四步

### 1. 讀佇列（NEVER 自己掃）

```bash
node ~/offline/clade/vendor/scripts/flow/flow.ts pending
```

Fleet 是預設（consumer repo 的問題照樣是同一個人要回的）。exit 2 = 佇列空，不是壞掉。
它已經做完**五個**來源的收斂——四個檔案來源（work-loop state / HANDOFF / tech-debt / tasks）
**加上 spine 本身**（agent 用 `flow ask` 直接問的題）——以及分桶、Qn 編號、和結尾那行**當下實跑**
的現況量測。

**NEVER** 改用 `rg` / `grep` 自己去翻那四個檔——它們與佇列會漂，而漂掉的那一份看起來一樣真。
spine 更是 grep 不到的：`flow ask` 開的題不在任何檔案裡，只有 `flow pending` 看得見——所以用 `flow ask` 開的題一定會出現在 `\my`。

### 2. 補第 6 個來源：只存在本 session 對話裡的待決策點

前五個來源對它們**完全盲**：agent 列過選項卻沒定案的、明講「這要你判斷」的、工作停在等 Charles
回答的。掃本 session 對話，**每找到一條就推進佇列**：

```bash
node ~/offline/clade/vendor/scripts/flow/flow.ts ask \
  --headline '<一句人話的問句>' \
  --question '<一句話講完，讀者沒有 scrollback>' \
  --option '<短標籤> :: <按了會怎樣>' --option '<短標籤> :: <按了會怎樣>' \
  --recommended '<推薦那條的短標籤>' --why '<一句為什麼>' \
  --carrier '<TD-NNN | HANDOFF.md | tasks/xxx.md>' --actor '<你的 pane id>'
```

推進去才有價值：手機那側同一秒看得到，而且會推播。**NEVER** 只在對話裡列出來就算——
那正是「待拍板事項多數只存在於對話裡」這個缺口本身。

**只有 Charles 做得了的工作**（典型：consumer 端 `disable-model-invocation` 的 skill，如 dep batch 的
`/version-upgrade`；派工 preflight 回 `skill_not_invocable` 的就是這種）：題目是**哪一台、哪個範圍**，
開成拍板題，執行寫成 `--step`——例：`--headline '<consumer-a> 跑 dep batch：範圍？'`、選項是範圍與「這輪不跑」、
`--step 'Charles 在 <consumer-a> 親自打 /version-upgrade → Outdated mode'`。**NEVER** 把「去跑它」本身開成
帶字母的題（QnX：動作不編號）。

缺短標籤（≤16 字）、推薦或理由時 `flow ask` 會 exit 1 並印出改法；要的是一個值就改帶
`--needs-value --field '<欄位名>'`。選項文字**只寫選項**：字母前綴與「（推薦）」都由渲染端加，寫進文字會疊成 `A. A. 改（推薦）（推薦）`。

### 3. 渲染

直接用第 1 步的輸出，順序與分類不要改。需要補上下文時**加在該題底下**，不要重排。

第 2 步剛推進去的那幾條，**MUST 在該題後面標 `[本輪從對話撈出]`**——它們與早就登記在檔案裡的
在 `flow pending` 的輸出裡長得一模一樣（推進去的那一刻就都是「已登記」了），而 Charles 需要
知道哪幾條是他從沒看過的。

`CLADE_DISPATCH_ID` 非空（本 session 是被派出的 worker）時 **NEVER** 出 `Qn`、**NEVER** 把題目寫進 final response 問 principal。要授權就 `--complete blocked --decision-for coordinator`（只有 Charles 答得了才 `charles`）後待命（TD-901）。

**編號依 §QnX 協定**（使用者的全域指令檔；Claude 走 `~/.claude/CLAUDE.md`，其他 runtime 走各自的常駐指令檔）：只有**可回答的兩類**編 `Qn`——`ruling`（要我拍板）
與 `review`（要我驗收），兩者的編號**連續**跑過去，NEVER 在第二組重新從 `Q1` 起算。其餘三個
狀態類（不在本 repo／不可逆等外部條件／loop 推不動）一律 bullet。

`review` 進 `Qn` 是因為它符合 QnX 的准入判準——回一則短訊（`通過` 或 `退回` + 一句理由）就結案。
**NEVER** 因為「它不是選擇題」把它降回 bullet：當成狀態列時，做完的工作會躺著沒人驗收。
`flow pending` 已經照這條渲染——**NEVER** 自己替第 2 / 3 / 4 類加號碼。

QnX 的三條細則（全域指令檔只留綁定條件與准入判準，細則在此）：`Qn` 從 `Q1` 起算；
可回覆條目與不可回覆條目 **NEVER** 混排連號（跨類連號會讓狀態列讀起來也像可回答的題）；
寫了「回 `Q1A Q2A` 即可結案」這句話，就 MUST 保證每個 `Qn` 真的能這樣回。

「要我動手」桶裡帶選項的列，`flow pending` 在 bullet 下印 `可回：X／Y` 與 span（**不加字母**）；
Charles 回了其中一個字，照第 4 步對那個 span 跑 `flow answer`。

四類全空就一句話講完，NEVER 硬湊。

### 4. 回答時關 span、落 carrier

Charles 回 `Q1A` / 給值之後，**MUST** 對那條 span 跑：

```bash
cd ~/offline/clade && node vendor/scripts/flow/flow.ts answer '<span_id>' \
  --answer '<他的答案>' --repo '<那題的 repo 欄位，逐字照抄 flow pending 給的值>'
```

**`--repo` 給的是佇列上那個名字，NEVER 自己換算成目錄路徑。** 名字 → 根目錄由
`resolveRepoRootByName` 解析，與 `/decisions` 頁面答題**同一支**；自己填路徑就是第二份實作，
而它漂掉的後果不是「chat 端壞了」，是**答案寫進別的 repo 的 spine、改到別的 repo 的檔案**。
名字解析不出來時它拒絕寫入並非 0 退出——**NEVER** 改用 `--repo` 以外的方式繞過那個拒絕。

**NEVER 手寫 `node --input-type=module -e "import { answerDecision } ..."`**：那條路徑不經 roster 檢查，`repoRoot` 由人目測填。

它一次做完三件事：關 span（佇列與 `/decisions` 同時消失那題）、把決策紀錄寫進 carrier 的錨定區段
（`## 決策紀錄` 節；`td:` carrier 則是該 TD entry 尾）、
量測 tech-debt hygiene 的差集。**NEVER** 只在對話裡回覆就算結案——那樣答案沒有持久載體，
下一個 session 看到的還是那題還在等。

要先看會寫成什麼就加 `--dry-run`：輸出裡的 `block` 逐字就是等一下會寫進去的那段。

跑完 **MUST 實查**：`git status --porcelain` 只動 carrier 那一個檔、`grep -n '<span_id>' <carrier>` 看 block
真的在。**NEVER** 用 `tail` 查——block 落在區段裡，不在檔尾。

`ok:false`（非 0 退出）時看 `reason`：`no-such-decision`（span 不在這個 repo，換 `--repo`）、
`already-resolved`（已經答過了，要改答案是另一條路徑）。**NEVER** 自己造一個新 carrier 檔繞過。

`ok:true` 但 `landed:false` 是**另一回事，不是失敗**：span 已收、答案已在 spine 上，只有 carrier
那一步沒做到（`reason` 會說是哪一種）。**NEVER** 因此重跑一次——那個寫入已經生效了。

## NEVER

- ❌ 只讀 `HANDOFF.md` 就作答——它與 state 檔會漂，這正是 `flow pending` 存在的理由
- ❌ 把 agent 自己做得掉的事列進來充數（那是 `\nx` 的範圍）
- ❌ 把本 session 已由 agent 自行決定並執行的事回頭列成待拍板——那是既成事實，該給的是回報不是選擇題
- ❌ 因為某條「反正也做不了」就省略推薦選項——沒有推薦 = 這條沒被消化過，等於把決策工作原樣退回
- ❌ 引用 `HANDOFF.md` 裡寫死的量測數字（過期的 dirty 數與新鮮的長得一模一樣）
