---
name: blog-scout
description: "Use for blog topic scouting from internal knowledge. Not for drafting or publishing articles."
license: MIT
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: draft
---


# blog-scout — 內部知識資產 → 部落格選題建議

把「哪些坑夠通用、哪些已寫過、哪些湊在一起才成一篇、哪些敏感度太高不能寫」這四個人腦判斷標準化成可重跑的掃描流程。輸入是 clade 的知識資產現況，輸出是**一份排序過的選題建議報告**——到此為止。

## 兩條硬邊界（先讀）

1. **只選題，NEVER 寫成稿**。文章成稿一律主線 Opus 自己寫（`rules/core/agent-routing.md` § 派不派：對外文件的定稿措辭外包不了）。本 skill 的輸出止於「建議題目 + 素材清單 + 敏感度標記」。
2. **NEVER 寫入 <consumer-k>**。本 skill 對 `~/offline/<consumer-k>/` 只讀不寫；建議被採納後的落地（開稿、frontmatter、category）由使用者與主線另行處理。

## 判準來源（Step 1 必讀，NEVER 信本檔的轉述）

| 判準 | SoT | 用在哪 |
| --- | --- | --- |
| 寫什麼 / 不寫什麼、藏招準則、禁詞清單 | `~/offline/<consumer-k>/CLAUDE.md` § 部落格內容主軸 | 敏感度分級、候選准入 |
| 讀者輪廓與品牌定位 | `~/offline/<consumer-k>/PRODUCT.md` | 每題「讀者是誰 / 為什麼值得讀」 |
| pitfall frontmatter 契約與合格標準 | `~/offline/clade/docs/pitfalls/README.md` | 素材解析 |
| tag controlled vocabulary | `~/offline/clade/docs/pitfalls/tags.yml` | 聚類與內部 tag 判定 |

禁詞清單與內部 tag 清單在 `scripts/scan-pitfalls.py` 有內建副本，**會漂移**：Step 1 讀完 SoT 後發現新禁詞，用 `--banned-extra` 補進掃描，NEVER 直接信 script 內建清單。

## Workflow

### Step 1 — 載入判準

讀上表四個 SoT（各只讀相關節）。輸出：本輪生效的禁詞清單、藏招準則三欄表、現行 category 清單。

### Step 2 — 素材盤點與聚類（維度 1）

```bash
python3 "$SKILL_DIR/scripts/scan-pitfalls.py" --min-cluster 5
```

（`$SKILL_DIR` = 本 skill 的 base directory，skill 載入時 harness 會告知；archive 也要納入時加 `--include-archive`。）

輸出三段：inventory（條目數 / severity / status / 年月分佈）、clusters（public-tag pair 聚類，每群列成員 + severity + 敏感度初判）、sensitivity 統計。實跑形狀（2026-08-25，236 條）：

```
severity: critical=8  high=140  mid=83  low=5
### cli-tooling + silent-failure — 24 條（低=0 中=8 高=16）
- [critical/中] 2026-05-14-publish-flow-cleans-parallel-untracked.md — 並行 …
低=2  中=82  高=152
```

**聚類是按「可寫成員數」（低+中）排，不是按原始條數。** 這兩者在本資料集上幾乎反相關——
最大的幾群（`cli-tooling` / `git` / `cross-session`）全是內部工具坑，可寫成員為 0。
所以**排在前面的不一定是最大的群**，這是刻意的；不要以為輸出壞了。

另外注意 `低` 這一級實質上是空的（236 條裡只有 2 條）：機械初判把 body 含任何禁詞的都打成
`中`，而幾乎每條 pitfall 都會提到某個內部專案名。**`中` 才是素材的主體**，不要把它當成次級品。

**聚類是選題單位，不是逐條列出**：一篇文章的理想素材是同群 3–5 條「低/中」敏感度成員（既有文章型態的實證：已發表的多坑文都是 4–5 坑一篇）。群內「高」敏感成員直接剔除，不因它們放棄整群。

### Step 3 — 第二素材源：跨 consumer 最佳實踐比較（維度 4）

```bash
jq -r '.conventions[] | select((.variants|length)>=2) |
  "\(.convention_id) [\(.layer)] " + ([.variants[] | .variant_id + "(" + .maturity +
  (if .migration_to then "→"+.migration_to else "" end) + ")"] | join(" / "))' \
  ~/offline/clade/registry/conventions.json
```

有 `legacy→stable` migration 的 convention = 「我們為什麼從 A 換到 B、B 的代價是什麼」的現成選型文素材（正中「選型的取捨與代價」欄）。實跑命中例：`audit-trail`（trigger-based→d-pattern）、`auth-data-path`（mixed-unresolved→server-mediated）、`env-identity-source`（build-mode-derived→deploy-injected）。

補充源（形態掃描即可，不逐檔讀）：`ls ~/offline/clade/docs/golden-paths/ ~/offline/clade/docs/decisions/`——decisions 裡「拍板 + 兩條已實際發生的誤推」型條目是判斷類文章素材。`/bp` 沉澱的資產以 `registry/conventions.json` 為機讀入口（bp SKILL.md Q3：有 variant 分歧的實踐 MUST 進 conventions.json），所以掃它就涵蓋了 bp 素材，不必另掃 rules 全文。

### Step 4 — 去重（維度 2，硬需求）

兩層，都要做：

**(a) 建已發表索引**——列出全部已發表文章的路徑、標題、draft 狀態：

```bash
for f in $(find ~/offline/<consumer-k>/content/blog -name '*.md' | sort); do
  echo "$(sed -n 's/^draft: *//p' "$f" | head -1 || true)|${f#*content/blog/}|$(sed -n 's/^title: *//p' "$f" | head -1)"
done
```

**(b) 逐候選 token 比對**——對每個候選題目，取其素材的 2–3 個決定性 token（錯誤碼、套件 API 名、症狀關鍵詞——不是泛稱），掃已發表內文：

```bash
rg -il '<token1>|<token2>' ~/offline/<consumer-k>/content/blog/
```

實跑驗證例（2026-08-25）：`SIGPIPE|pipefail` → 命中 `devops/fake-green-gates`（該 pitfall 已用過）；`schema cache|PGRST` → 命中 `supabase/postgrest-phantom-failures`；`defineProps` → 命中 2 篇，需人工判是否同一坑。

**判定規則**：token 命中且同一根因 → 該素材標「已用過」，移出候選、列入報告附錄；命中但不同角度（同套件不同坑）→ 標「部分重疊：<哪篇>」，保留但降權；0 命中 → 「未用過」。**NEVER** 只比對標題就下「未寫過」——已發表的多坑文標題不含個別坑名，必須掃內文。

### Step 5 — 敏感度分級（維度 3）

script 已給機械初判（高 = 內部工具 tag 命中；中 = body 含禁詞；低 = 皆無），**MUST** 逐候選人工複核，判準用 Step 1 讀到的藏招準則三欄表：

- `低` → 直接可寫
- `中` → 可寫，但報告中必須指出卡在哪一條（哪個禁詞 / 哪條「留著不出去」項）與去敏感化方向（例：consumer 名抽換成「某內部專案」、內部路徑刪除）
- `高` → 不進候選。故事本體是內部工具或工作方法（藏招準則「內部工具名與系統架構」「防再犯機制的實作」）——去敏感化後故事不成立的，不要硬掰成通用題

機械初判的已知偏差：`高` 判定看 tag，會把「內部工具踩到的通用坑」誤判成高（例：worktree tag 下的 git 通用行為）。人工複核時問一句：**把內部工具名遮掉，這個坑在任何團隊的同類流程還會發生嗎？**會 → 降為中。

### Step 6 — 排序與輸出

依 `references/ranking-rubric.md` 的評分規則排序（素材強度 × 讀者面寬 × 敏感度 × 去重狀態），輸出下方契約格式。排序理由要可追溯到分數，NEVER 憑感覺排。

## 輸出契約

報告固定三段，順序不可換：

````markdown
## 候選選題（排序）

| # | 暫定題目 | 讀者是誰 | 為什麼值得讀 | 素材 | 敏感度 | 去重 |
| - | --- | --- | --- | --- | --- | --- |
| 1 | <一句話題目> | <PRODUCT.md 輪廓對得上的一類> | <一句話，含證據強度> | <pitfall 檔名 / convention_id，逐條> | 低/中（卡：<哪條>） | 未用過 / 部分重疊：<哪篇> |

每題表格下附 2–3 行展開：素材怎麼湊成一篇（敘事骨架一句話）、中敏感度的去敏感化方向。

## 已用過的素材（不在候選內）

- <pitfall 檔名> → 已寫進 <已發表文章路徑>（token 證據：<命中的 token>）

## 掃描現況

一行：本輪掃了幾條 pitfall / 幾條 convention、掃描日期、掃不到或解析失敗的部分（有就照實列，NEVER 略過）。
````

- 候選 5–10 題；不足 5 題就照實出，**NEVER 為湊數編造素材或放寬敏感度**
- 每格內容必須來自實跑掃描結果；掃不到 = 寫「掃不到」

## Eval 與行為規格

| 檔案 | 管什麼 | 怎麼跑 |
| --- | --- | --- |
| `evals/skills/blog-scout/cases.json`（**repo root**） | 觸發邊界：該不該被叫起來 | `node evals/harness/skill-eval.mjs evals/skills/blog-scout/cases.json` |
| `references/behavior-spec.md` | 報告內容與流程紀律（harness 跑不動的那幾條） | 人工驗收 / 改版時對著走 |

**NEVER 在 skill 目錄內再放一份觸發 case 副本。** 兩份 eval 一定會漂，而漂掉的是沒被跑的那份。

## 守則

1. **NEVER 寫成稿**、NEVER 產出文章草稿片段——連「示範開頭」都不要，那是主線的工作。
2. **NEVER 寫入 <consumer-k> / docs/pitfalls / 任何素材源**。本 skill 全程唯讀。
3. **NEVER hard-code pitfall 篇數或檔名清單**——掃目錄，數字每天在變。
4. **NEVER 跳過 Step 4 去重**就出報告。重複選題是本 skill 最該防的失效。
5. 敏感度 `高` 的素材 **NEVER** 因為「內容很精彩」出現在候選表——只能出現在「已用過 / 排除」之外的一行統計裡。
6. 報告裡的每個素材引用都要能 `ls` 得到那個檔——引用前驗證，NEVER 憑聚類輸出的記憶拼檔名。


## Claude host contract

Run the bundled scanner through the current Claude terminal using the skill-provided `$SKILL_DIR`; keep all source reads and the report output within the requested workspace and never write the blog repository.
