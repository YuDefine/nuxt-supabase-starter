<!--
🔒 LOCKED — managed by clade
Source: rules/core/secret-custody.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Secret Custody（secret 值到手時的既定動作）

> **無 frontmatter — unconditional always-load**。觸發事件是「一個 secret 值出現在你手上」，
> 那件事沒有對應的檔案路徑；綁 `paths:` 等於讓本規約永遠不載入。


## 觸發

一個 secret 值以**任何**形式到你手上：user 在對話裡貼給你、你從某個系統讀出來、rotate 動作產生新值、
或你在排查時從 API 回應拿到。不限 secret 種類（webhook secret / API token / DB 密碼 / 私鑰）。

## 你的動作是（不是「你可以考慮」）

1. **寫進保管處。** 找出該 secret 在本 repo 的指定保管處（見下節），把值寫進去。
2. **回讀驗證，只印長度與前綴。** 例：`value_len=64 prefix=8d441dcc…`。**NEVER** 為了驗證把完整值再輸出一次。
3. **回報你寫了哪一列 / 哪一格**，讓 user 能當場推翻落點。

三步做完才回話。**NEVER** 停在第 0 步問「這要我放哪」——保管處寫在 repo 裡，自己去找。

## 保管處 allowlist

指定保管處 = repo 文件明寫的那個位置（典型：Notion secrets 頁的對應列、密碼管理器條目、
`gh secret set` 的 GitHub Secrets）。判定法：搜 `HANDOFF.md` / `docs/` / `.claude/rules/` 裡
「MUST 同步改 X」「完整值在 X」這類句子，X 就是保管處。

**寫入保管處不算洩漏。** 洩漏禁令（「NEVER 把值寫進任何檔案、commit 或對話」）的射程是
**repo 內的檔案、commit message、你的對話輸出** —— 保管處是那條禁令要保護的**目的地**，不在射程內。
把保管處讀進禁令射程，等於用禁令取消它自己要達成的目的。

## Iron Law：NEVER 把 secret 管理退回給 user

你有 CLI / API 路徑做得到的事，**MUST 自己做完**：寫保管處、設 GitHub secret、同步兩邊、更新變更紀錄。

**NEVER** 用下列任一形式把它退回：

- ❌「這個值我不會使用、不會寫進任何地方」
- ❌「secret 寫入是 user-only，我不代填」
- ❌「要我做什麼請直接說」（值已經在手上，動作已由本規約定義，沒有要問的）
- ❌ 只建議 rotate 就結束 —— rotate 是**額外**動作，不取代保管

### 開脫話術對照（出現任一就是正在違反本條）

| 你正想說 | 實際上 |
| --- | --- |
| 「我這是保守、安全的做法」 | 保管沒做 = 該 secret 可能不存在於任何可取回的位置，這比寫進保管處危險 |
| 「規約說 NEVER 把值寫進任何地方」 | 那條的射程不含保管處。你漏讀了同一條的前半句 |
| 「這是對外動作，需要授權」 | 寫進**既有規約已指定**的保管處不是新授權範圍，是履行既有指示 |
| 「user 沒說要我寫哪一條」 | 保管處與列名在 repo 文件裡，自己查；查不到才問，且只問那一格 |
| 「值已經在對話裡了，先請他 rotate 比較乾淨」 | rotate 後的新值同樣要保管，你只是把同一步往後推一輪 |

## 「執行者是 <人名>」「user-only」的前提失效條款

規約裡出現「執行者是 <人名>」「X 為 user-only」時，**MUST** 先判它的**前提**是否還成立。
這類句子絕大多數記錄的是**當時的事實限制**（值只在人手上、agent 取不到），不是永久權責劃分。

**值一旦交到你手上，該前提消失，那條句子隨之失效** —— 改由你執行並回報。

撰寫這類句子時（見 [[rule-authoring]]）**MUST** 把前提寫出來：

```markdown
- 執行者是 <人名> —— **前提**：值只在他手上，agent 取不到。
  **值一旦交給 agent，本條失效**，改由 agent 執行並回報。
```

## 保管紀錄本身要能被取回

保管處若只記**截斷前綴** ＋ 「完整值在 X」的指標，**MUST 實查 X 真的有值**。
指標指向空位置時（實例：Notion 記 `9014d11beb6c…`、註明完整值在 GitHub Secrets，
而 deploy run 的 job env dump 顯示那兩個 GitHub secret 的值都是空字串），
**MUST** 改記完整值，並在保管處補一條帶日期的變更紀錄說明為何改。

踩坑實例與 fleet scan 見 [[pitfall-custody-mandate-read-as-prohibition-only]]。
