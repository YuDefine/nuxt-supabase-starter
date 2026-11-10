# durable thin brief 紀律（`relay`／`fanout`／`next` 派工共用）

> 自 [派工共用底座判準.md](派工共用底座判準.md) 同批逐字搬出；章節編號 § 2 保留為穩定 ID。
>
> **過渡期（拆分 1/2）**：本檔尚未接線，runtime 仍只讀 [派工共用底座判準.md](派工共用底座判準.md)，它是唯一 SoT。本檔內容由 `test/handoff-dispatch-common-split-sync.test.ts` 釘成與舊檔對應段逐字一致（只容許跨檔連結改寫）；改判準 MUST 先改舊檔再同步本檔。拆分 2/2 切換 SKILL.md／relay／fanout 引用、搬 `registry/rule-invariants.json` 並刪舊檔。

## 2. 建 durable thin brief

1. 從當前對話與已載入 task carrier 盤點**本 session**的未完成工作、證據、失敗 gate 與下一個 bounded action，**先把它們寫回該 work 的 lifecycle 檔（`work.md`；舊 package 是 `plan.md`）§ 進度**（commit；能 push 就 push），再盤點 brief 要帶的指針。盤點結果的落點是 lifecycle 檔，不是 brief。
2. arg 後面帶了一句工作描述時，以該句作 brief 主題；沒帶才自行萃取主題。
3. brief 必須落在接手 pane 讀得到的 tracked repo 路徑。有 plan 的 work，進度只寫 lifecycle 檔 § 進度，brief 只是指針檔；`tasks/<timestamp>-<slug>.md` 只留給沒有 plan 的 session 級工作。**NEVER** 讓 brief 或 `tasks/` 檔與 lifecycle 檔並列成第二份進度 SoT——每棒各寫一份進度，下一棒就要比對哪一份才是現況（W-2026-10-03-work-relay-anti-dilution G1）。已存在足夠完整的 task／HANDOFF 條目時可直接引用，不重複建立。
4. brief 至少包含：repo 與 main checkout cwd、lifecycle 檔指針（沒有 plan 時改指本 session 的 `tasks/` 檔）、本棒差異（lifecycle 檔還沒寫到、只屬於這次交接的事）、適用規約、安全／授權邊界、原 session 保留 runtime 的 ownership。狀態本體只在 lifecycle 檔。
5. prompt 只指向 durable brief，並明寫「先讀 brief 與 repo 規約，再自行續跑；可修復的品質 gate 失敗（格式／lint／型別，`vp check` 只報格式就只對自己擁有的路徑跑 `pnpm exec vp check --fix <owned-paths>`，NEVER 全 repo `--fix`）就地修、重跑續接，不可修復才停，不向原 session 輪詢」（判準見 [[verify-gate-chain]] § 可修復的 gate 失敗不是停手理由）。
6. worker brief（`fanout` 的每一份）**MUST** 寫明：做完自己那段卻留下殘工時，把殘工另寫一份 durable
   brief，並用 `--complete success --followup-brief <absolute-path>` 帶回來——見 [worker殘工回報判準.md](worker殘工回報判準.md) § 6。
   另 **MUST** 寫明切片契約：自己的 branch、非空 committed diff 後開 **draft PR**（clade home 的改動全在登記簿 allowlist 內時改跑 `node scripts/register-land.ts`、不開 PR，[[github-flow]] 的「紀錄型改動不開 PR」段）、盯該 PR 的 CI、紅燈修同一張 PR、**NEVER** merge／**NEVER** 直推 `main`。**Integration 模式**（預設；[[github-flow]] § Integration branch）：同一個 work id 有 2 個以上切片時，worker push **該** branch 並對 `integration/<work-id>` 開 PR（`gh pr create --base integration/<work-id>`，做到一半先開 draft），盯該 PR 的 CI（只有機械檢查、不跑 test-lane）；在來源 worktree 跑完本機門檻（canonical check ＋ repo 在 CI 機械檢查裡跑的 typecheck；clade 是 `pnpm exec vp check` ＋ `node node_modules/tsrs/bin/tsrs -p tsconfig.clade.json --noEmit`，動到 vendor/scripts 再加 `node node_modules/tsrs/bin/tsrs -p tsconfig.vendor.json --noEmit`。兩條 typecheck 以秒計、不必排 heavy gate slot。`test:affected` 仍由 coordinator 在 integration 轉 ready 前跑一次）且該 PR 的 CI 全綠後，自己 `gh pr ready` 該切片 PR，completion 回 coordinator，由 coordinator 以 `integration-merge.ts --pr <n>` 落地。切片 PR 不登記 `batch draft` receipt；**NEVER** 對 `main` 開 PR、**NEVER** 自己 merge。只有一個切片就完工的工作才走上面那條 base 為 `main` 的 draft PR。要 live shared DB 才 desk；隔離雲端 VM 需要 DB 時起該 VM 的 ephemeral 實例（[[db-topology-invariant]]）。Worker `--complete success` **不是** landing；coordinator 收件後才 `batch ready`／完整 `/commit`／條件式 `merge-unattended`。

6b. worker brief **MUST** 同時寫明相反的那一半：**那段工作就是整件 work 的最後一步、沒有殘工**時，
   收尾改帶 `--work-done --verification '<一句可查證的實跑摘要>'`。helper 已經支援這兩個旗標，
   缺的一直是「有人被告知要用它」——2026-08-28 實測整條脊椎的「已收」欄恆為 0，六態的終態從來
   沒有被按過，而每一個 worker 收尾時手上都握著按它所需的憑證。

   三條機械限制由 helper 自己擋，**NEVER** 在 brief 裡改寫它們：只接受 `--complete success`；
   `--verification` 缺或空就拒（[[flow-work-tracking]] § R1 的唯一 fail-closed 點）；與
   `--followup-brief` **互斥**——殘工與完成宣稱不能同時為真，而那份 followup brief 正是還有殘工
   的證據。

   **NEVER 讓 worker 預設帶 `--work-done`。** pane 回 `success` 說的是「這個 pane 做完了被派來做
   的事」，那是比「這件 work 完成了」**嚴格更小**的宣稱——一件 work 常橫跨數個 pane。自動升級等於
   替沒人做過的宣稱簽名。opt-in 明示是刻意的。

7. brief 的**範圍**依 [[agent-routing.dispatch-execution]] § 派多少 判定：與被派工作構成串行鏈的環，預設一起寫進同一份 brief。
   brief 裡出現「X 由主線處理」「不要做 X」這類句子時，**MUST** 能具名說出主線做 X 需要 worker 沒有的什麼；
   說不出來就刪掉那句、把 X 寫進 brief。
8. 「已驗證」主張連同 SoT 指標（檔案路徑＋可重跑指令）寫進 lifecycle 檔 § 進度；brief 只指向那一段，**NEVER** 在 brief 重述結論。
   同一份進度可以一半新一半舊；沒有指標時接手者分不出哪一半還成立，回讀成本等於沒有交接（TD-717）。

**NEVER** 把完整 transcript、token、cookie、credential 或與工作無關的 dirty state 塞進 brief。
