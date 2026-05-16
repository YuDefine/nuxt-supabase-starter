---
name: review-rules
description: 管理兩層 review 規則清單（project / local）— 新增、修改、刪除、列出、跨 consumer survey、promote 到共用層。此 skill 只負責規則檔內容管理，不執行 code review。
---

# Review Rules — 兩層規則管理 + survey + promote

此 skill **不執行 code review**，只負責規則檔的內容管理。執行 code review 請用 `/code-review:code-review`。

## 兩層 review rules model

| 層 | 路徑 | 治理 | 觸發場景 |
| --- | --- | --- | --- |
| project | `.codex/agents/references/project-review-rules.md` | clade LOCKED | 跨 consumer 共用嚴格條目（目前是 Nuxt + Supabase stack baseline） |
| local | `.codex/agents/references/local-review-rules.md` | consumer 自管 | 該 consumer 在地化條目 |

`code-review` agent Step 0 依序 Read 兩份；`vendor/scripts/review-checklist-audit.mjs` 在 commit-time 跑兩份的 grep pattern 做硬 gate。**project 層必須走 clade 中央倉維護**，不能在 consumer 端編輯（chmod 444 + sync 還原）。

> 為什麼是兩層不是三層：clade 所有 consumer 都是 Nuxt-stack，「framework-agnostic 共用」跟「Nuxt-stack 共用」實務上重疊到 99%，沒必要再切。未來若要收非 Nuxt consumer 再考慮拆 3 層。

## 觸發時機

- 使用者說「加一條 review 規則」/「新增審查規則」/「新增自定義 review 項目」/「add review rule」→ **Step 0 必跑 layer-pick 選單**
- 使用者說「列出規則」/「刪除規則」→ CRUD 模式（先問哪一層）
- 使用者說「掃各 consumer review rules」/「gap analysis」/「哪些值得 promote」→ Survey 模式
- 使用者說「promote 這條 / 升到共用」/「promote this rule to project」→ Project 層 flow 的「從 local promote 上來」
- **不觸發**：使用者要求「review 這個 PR」→ 那是 `/code-review:code-review`

## Step 0: Layer-pick 選單（新增 / 編輯 / 刪除 動作必跑）

當使用者要新增 / 編輯 / 刪除規則但**沒明說哪一層**，agent **MUST** 用 `request_user_input` 強制選層，**NEVER** 自行猜測。猜錯會落到錯誤 scope（在 consumer 寫的條目擴散成跨 5 consumer 共用，或反過來），這是飄移最常見的來源。

### 必跑 question shape

```jsonc
{
  "question": "這條 review 規則要放在哪一層？",
  "header": "Review layer",
  "multiSelect": false,
  "options": [
    {
      "label": "local — 只該 consumer 限定",
      "description": "在當前 consumer 自己的 .codex/agents/references/local-review-rules.md 加條目；不影響其他 4 個 consumer；不需 publish/propagate；不需 cd 到 clade。最常用、預設選項。"
    },
    {
      "label": "project — 跨所有 consumer 共用嚴格條目",
      "description": "在 clade 中央倉編輯 plugins/hub-core/agents/references/project-review-rules.md；自動散播到 5 個 consumer；條目必須是「真的所有 Nuxt consumer 都該強制遵守」的規則（典型場景：security baseline / 元件替代 / Nuxt UI 公約 / data leak 防護 / 命名公約）。需要 cd 到 ~/offline/clade + publish + propagate。"
    }
  ]
}
```

### Pre-flight：偵測當前 cwd

開選單前先跑 `pwd`，把結果摺進每個 option 的 description 末尾：

- cwd 是 `~/offline/clade` → local 那個 option 加備註「（目前在 clade，要切到 consumer 才能寫 local）」
- cwd 是 consumer（如 `~/offline/perno`）→ project 那個 option 加備註「（目前在 consumer，要 `cd ~/offline/clade` 才能寫 project）」

不要直接 disable 選項 — user 可能還沒切目錄。**讓 user 看到完整選單 + 切換提示**，自己決定。

### 選完後跳到對應 flow

| 選 | 跳到 | 一句話說明 |
| --- | --- | --- |
| **local** | 下方「Local 層 flow」 | 在當前 consumer 自己的 `local-review-rules.md` 增 / 改 / 刪 — **不需 publish** |
| **project** | 下方「Project 層 flow」 | 在 clade 中央倉 `project-review-rules.md` 增 / 改 / 刪 — 強制 grep pattern + 走 `/clade-publish` 散播到 5 consumer |

## Local 層 flow

對 consumer 在地條目操作 `.codex/agents/references/local-review-rules.md`（不存在則建立）。

**新增規則** — 每條必含五個欄位：

1. `## <規則名稱>`（h2）
2. **禁止 pattern**：具體寫法 / 條件
3. **應替換為**：正確替代方案
4. **說明**：為何禁、後果是什麼
5. **Reviewer 檢查方式**：可機器執行的 grep 指令清單（**audit script 跑這部分**）
6. **例外條件**：可豁免的場景；沒有就寫「無例外」

**Reviewer 檢查方式格式（嚴格）**：

```markdown
**Reviewer 檢查方式**：

1. `grep -rEn 'pattern' target/ 2>/dev/null` — 描述
2. `grep -rEn 'pattern2' target/ 2>/dev/null` — 描述
```

- 段落首行：`**Reviewer 檢查方式**：` 或 `**Reviewer 檢查方式（...）**：`（全形或半形冒號）
- 編號清單；每項第一個 backtick 區塊是可直接跑的 grep 命令
- 起手版本不支援多行 grep / 複雜 pipe

**刪除規則**：找到對應 `## <規則名稱>` h2 + 其下整 section，移除。

**列出規則**：Read 規則檔展示完整內容。

## Project 層 flow

對 clade `~/offline/clade/plugins/hub-core/agents/references/project-review-rules.md` 操作。**MUST 在 clade 工作目錄**，consumer 端是 LOCKED 投影副本（chmod 444），改了會被下次 sync 還原。

> 影響面提醒：改 project 層等於改所有 5 consumer 的共用 baseline，跟業務 / 命名公約 / security 等同等重要。新增條目前 agent 應確認 user 確實意圖讓所有 consumer 都遵守，避免把 single-consumer 偏好寫進 project 害其他 consumer 被擋 commit。

### 新增 / 修改 / 刪除條目

1. **確認 cwd 是 clade**：若不在 `~/offline/clade`，提示 user 切過去後再試
2. Read 既有 `project-review-rules.md`，定位要改的地方（新增 → 找適合分類 section 的末尾；修改 / 刪除 → 對應 `## <規則名稱>` h2）
3. 寫入規則 — 必含五個欄位（同 Local flow 規則格式，**沒有例外**：不能省 grep pattern，audit script 解析這部分做硬 gate）
4. **強制驗證 grep pattern 可執行**：
   - 每條 grep 命令必須以 `grep ` 開頭
   - 用 `bash -c '<grep command>'` 在 clade root 跑一次，確認沒語法錯誤（exit 0/1/2 都可，只要不是 shell parse error）
5. 跑 `vp check` 確認 lint + fmt 過
6. **告知散播 SOP**（不自動執行 — destructive op 需 user 確認）：
   ```
   git add plugins/hub-core/agents/references/project-review-rules.md
   git commit -m "feat(review-rules): add project rule '<title>'"
   # 然後在 clade session 講「走 /clade-publish 散播」
   ```

### 從 local promote 上來（升級用法）

跟「新增條目」步驟相同 — 把 consumer local 條目 copy 過來貼進 project。**不要**自動從 consumer 端 cut 走原條目；讓 user 自己決定要不要從 local 刪除（user 可能想保留 local 覆蓋）。

## Survey 模式（跨 consumer gap analysis — 找 promotion 候選）

**觸發**：使用者說「掃 consumer review rules」/「gap analysis」/「哪些 rule 值得 promote」

**步驟**：

1. Read `~/offline/clade/registry/consumers.json` 列舉 consumer
2. 對每個 consumer 讀 `.codex/agents/references/local-review-rules.md`（不存在則 skip）
3. 比對策略：
   - **相同 grep pattern**：去掉路徑差異後 pattern 字串完全相同
   - **相同 hot zone**：規則 target path 重複（如 `server/api/` 出現在 ≥2 consumer 規則）
   - **標題 fuzzy match**：規則 h2 標題相似度高
4. 輸出 **promotion 候選表**：

   | 規則標題 | 出現於 consumer | 重複次數 | 建議 promote | 備註 |
   | --- | --- | --- | --- | --- |
   | ... | perno, TDMS, sroi | 3 | project（重複 ≥ 3） | 規則內容一致 |

5. **不寫任何檔**；交給 user 決策後再走 Project 層 flow 的「從 local promote 上來」

## 規則格式範本（Reviewer 檢查方式必備）

```markdown
## 禁用 console.log（範例規則）

**禁止 pattern**：在 `src/` 殘留 `console.log` / `console.warn` / `console.debug`

**應替換為**：用結構化 logger（`evlog` / `pino` 等），或在 PR 送出前清掉

**說明**：production code 不應有臨時 debug 輸出；ship 出去會污染 log 流。

**Reviewer 檢查方式**：

1. `grep -rEn 'console\.(log|warn|debug)' src/ 2>/dev/null` — 找殘留 console 呼叫

**例外條件**：

- `src/dev/` 純開發工具腳本可豁免
- 包在 `if (import.meta.dev)` 內的條件化 console 可豁免
```

## 注意事項

- 兩層規則檔位置固定：`.codex/agents/references/{project,local}-review-rules.md`
- `code-review` agent Step 0 會載入兩份；違反任一層都標註來源層
- 違反規則預設為 🟠 Major（人為定義 must-follow），commit-time gate 直接擋
- 新規則的 grep pattern **MUST** 可機器執行 — audit script 跑這部分做硬 gate
- project 層只能在 clade 改 → propagate；consumer 端是 LOCKED 投影
