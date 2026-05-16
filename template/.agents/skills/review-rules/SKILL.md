---
name: review-rules
description: 管理三層 review 規則清單（common / project / local）— 新增、修改、刪除、列出、跨 consumer survey、promote 到共用層。此 skill 只負責規則檔內容管理，不執行 code review。
---

# Review Rules — 三層規則管理 + survey + promote

此 skill **不執行 code review**，只負責規則檔的內容管理。執行 code review 請用 `/code-review:code-review`。

## 三層 review rules model

| 層 | 路徑 | 治理 | 觸發場景 |
| --- | --- | --- | --- |
| common | `.codex/agents/references/common-review-rules.md` | clade LOCKED | 跨 consumer 嚴格共用條目 |
| project | `.codex/agents/references/project-review-rules.md` | clade LOCKED | stack default（Nuxt + Supabase 等） |
| local | `.codex/agents/references/local-review-rules.md` | consumer 自管 | 該 consumer 在地化條目 |

`code-review` agent Step 0 依序 Read 三份；`vendor/scripts/review-checklist-audit.mjs` 在 commit-time 跑三份的 grep pattern 做硬 gate。**common 層必須走 clade 中央倉維護**，不能在 consumer 端編輯（chmod 444 + sync 還原）。

## 觸發時機

- 使用者說「加一條 review 規則」「新增審查規則」/「列出規則」/「刪除規則」
- 使用者說「掃各 consumer review rules」/「gap analysis」/「哪些值得 promote」→ Survey 模式
- 使用者說「新增共用 review 項目 X」/「promote this rule to common」→ Promote 模式
- **不觸發**：使用者要求「review 這個 PR」→ 那是 `/code-review:code-review`

## 操作流程

### 1. CRUD 規則（local 層）

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

### 2. Survey 模式（跨 consumer gap analysis）

**觸發**：使用者說「掃 consumer review rules」/「gap analysis」/「哪些 rule 值得 promote」

**步驟**：

1. Read `~/offline/clade/registry/consumers.json` 列舉 consumer
2. 對每個 consumer，read `.codex/agents/references/local-review-rules.md`（不存在則 skip）
3. 比對策略：
   - **相同 grep pattern**：去掉路徑差異後 pattern 字串完全相同
   - **相同 hot zone**：規則 target path 重複（如 `server/api/` 出現在 ≥2 consumer 規則）
   - **標題 fuzzy match**：規則 h2 標題相似度高
4. 輸出 **promotion 候選表**：

   | 規則標題 | 出現於 consumer | 重複次數 | 建議 promote 層級 | 備註 |
   | --- | --- | --- | --- | --- |
   | ... | perno, TDMS, sroi | 3 | common（重複 ≥ 3） | 規則內容一致 |

5. **不寫任何檔**；交給 user 決策後手動觸發 Promote 模式

### 3. Promote 模式（新增共用條目 / 把 local promote 到 common）

**觸發**：使用者說「新增共用 review 項目 X」/「promote rule X to common」

**步驟**：

1. 確認當前工作目錄是 `~/offline/clade`（promote 只能在中央倉做）
   - 若不在 clade，提示使用者 `cd ~/offline/clade` 後再試
2. Read `plugins/hub-core/agents/references/common-review-rules.md`（找最後一條規則的位置）
3. 引導使用者把規則內容寫到 `## 規則清單` section 下方，必含五個欄位（同 CRUD 新增規則）
4. **強制驗證 grep pattern**：
   - 每條 grep 命令必須以 `grep ` 開頭
   - 用 `bash -c '<grep command>'` 在 clade root 跑一次，確認沒語法錯誤（exit 0/1/2 都可，只要不是 shell parse error）
5. 跑 `vp check` 確認 lint + fmt 過
6. **提示散播 SOP**（不自動執行，交給使用者用 `/clade-publish` 或手動）：
   ```
   git add plugins/hub-core/agents/references/common-review-rules.md
   git commit -m "feat(review-rules): add common rule '<title>'"
   node scripts/publish.mjs patch
   git push && git push --tags
   node scripts/propagate.mjs
   ```

### 4. CRUD project 層（特殊情況）

`project-review-rules.md` 是 clade LOCKED stack default。要改它必須在 `~/offline/clade/plugins/hub-core/agents/references/project-review-rules.md` 改、走 publish + propagate。**不要**在 consumer 端改（chmod 444 + 下次 sync 還原）。

通常情境下 project 層應該維持為穩定 stack default，個別 consumer 的差異走 local 層。

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

- 三層規則檔位置固定：`.codex/agents/references/{common,project,local}-review-rules.md`
- `code-review` agent Step 0 會載入三份；違反任一層都標註來源層
- 違反規則預設為 🟠 Major（人為定義 must-follow），commit-time gate 直接擋
- 新規則的 grep pattern **MUST** 可機器執行 — audit script 跑這部分做硬 gate
- common 層只能在 clade 改 → propagate；consumer 端是 LOCKED 投影
