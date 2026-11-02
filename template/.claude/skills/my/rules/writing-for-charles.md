
# Rule 1 - 寫給 Charles 看的回覆、`Qn`、短報，送出前 MUST 逐條過這份清單

- Level: `MUST`
- 觸發：**要寫給 Charles 看的回覆、`Qn`、`flow ask` 題面、收尾短報之前**讀這份；`flow ask` 與 `--complete blocked --decision-for charles` 被內容把關退回（`content-answerable-by-run`／`content-self-decidable`／`content-jargon`）時，退回訊息也指向本檔。不做 always-load。
- 判準來源：`specs/plans/W-2026-10-28-manager-agent/plan.md` § Open work 的 `ask-admission-classify` 條目與 `flow ask` 內容把關的三類新退回碼；主管研究第 4.8 節末段的原始清單不在本 repo，**逐字對照由主管補**（見該 PR 待決）。

## 送出前逐條問

1. **這題跑一次就有答案嗎？**（行為、花多久、版面長怎樣、效能多少）是 → 先跑，把結果寫進前提；不是問人的題。
2. **這題可逆、而且是技術落點嗎？**（檔案放哪、怎麼命名、用哪個目錄）是 → 自己照現有慣例定案，收尾列「已採用：…」。範圍、優先順序、報價、對外承諾、金錢、密鑰、不可逆的不在此列。
3. **Charles 只看這一段、不開任何檔，讀得懂嗎？**
   - 代號、work id、`Slice N`、`T9`、`k=3` 這類東西，第一次出現就用一句白話說它是什麼；說不出來就不要放。
   - 不用符號體或電報體：箭頭代替句子、縮寫連縮寫、省略主詞。
   - 換到別的案子也成立的句子（「已完成驗證」「風險可控」）刪掉，改寫這個案子才有的事實：哪個檔、幾個、多少錢、哪天。
4. **第一句是結論或問句**；現況與原因在後，選項各自寫出「選了會怎樣」。

## Good Example

- 這個例子是好的，因為把代號換成白話、落點自己定案，剩下的是只有 Charles 能答的額度來源。

> 要用訂閱額度跑這次實驗嗎？實驗要把同一題各跑 3 次、共 36 次，來比較兩種做法。A 訂閱額度：不另外付費（推薦）；B API：按量付費。實驗用的測試頁放在 secret gist，實驗後刪除（已採用）。

## Bad Example

- 這個例子是壞的，因為 `Slice 1`、`36 runs`、`k=3` 沒說明，且把「頁面放哪」這種自己能定案的落點也丟給 Charles。

> Slice 1 的 36 runs 用哪邊？Slice 3 的 injection canary 頁要放哪？
