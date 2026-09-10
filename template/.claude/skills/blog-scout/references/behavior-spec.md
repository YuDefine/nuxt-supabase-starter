# blog-scout 行為規格（Given / When / Then）

觸發邊界的可執行 eval 在 **`evals/skills/blog-scout/cases.json`（repo root）**——那是唯一的 eval SoT，
由 `node evals/harness/skill-eval.mjs` 跑。

本檔是 harness **跑不動**的那幾條：它們斷言的是報告內容與流程紀律，不是 skill 有沒有被觸發。
人工驗收與改版時對著這份走。

**NEVER 把觸發 case 複製進本檔。** 兩份 eval 副本一定會漂，而漂掉的那份不會有人發現
（被維護的永遠是被跑的那一份）。

## F1 — 完整報告的形狀

- **Given** `docs/pitfalls/` 有可解析條目，`<consumer-k>/content/blog/` 有已發表文章
- **When** 使用者要求部落格選題
- **Then**
  - 輸出三段且順序不可換：候選選題（排序表）→ 已用過的素材 → 掃描現況
  - 每個候選的 讀者 / 為什麼值得讀 / 素材檔名 / 敏感度 / 去重 五欄皆非空
  - 排序可追溯到 `references/ranking-rubric.md` 的分數，不是憑感覺
  - **輸出中沒有任何文章草稿片段**——連示範開頭都不該有

## F2 — 去重會擋掉用過的素材

- **Given** 某 pitfall 的決定性 token（例 `SIGPIPE|pipefail`）在已發表文章**內文**命中
- **When** 跑 Step 4 去重
- **Then**
  - 該素材出現在「已用過的素材」段，附命中文章路徑與 token 證據
  - 該素材**不**出現在任何候選題目的素材欄

> 這條是本 skill 最該防的失效。已發表的多坑文標題不含個別坑名
> （〈綠燈是假的：五個坑〉看不出它含 SIGPIPE），**只比標題必漏**。

## F3 — 高敏感素材不進候選，但不拖累同群

- **Given** 聚類成員含內部工具 tag 的條目
- **When** 跑 Step 5 敏感度分級
- **Then**
  - 高敏感成員不進候選表
  - **同群的低／中敏感成員仍可組成候選**（剔除成員，不放棄整群）
  - 人工複核有實際執行：tag 命中但坑本身通用者被降為中，並附一句理由

## F4 — 掃不到就照實說

- **Given** 掃描來源缺失，或候選不足 5 題
- **When** 產出報告
- **Then**
  - 「掃描現況」段照實列出掃不到或解析失敗的部分
  - 不編造素材、不放寬敏感度湊數
  - 候選不足 5 題就出不足 5 題

## F5 — 全程零寫入

- **Given** 任一次完整執行
- **When** skill 跑完
- **Then** `<consumer-k>` 與 clade `docs/` 無任何檔案被建立或修改；唯一產物是對話中的報告文字

> 這一條在 harness 有對應斷言（`readonly-no-write-tools` case 的 `toolsForbidden`），
> 是本檔唯一機械擋得住的一條。其餘四條靠人工驗收。
