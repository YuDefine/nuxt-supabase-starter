<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/agents/references/common-review-rules.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# 共用嚴格自定義 Review 規則

跨 consumer 強制共用的人為自定義 review 條目。由 clade 中央倉統一治理、散播到各 consumer。**Layer 在 review rules 三層中位置：**

| 層 | 路徑 | 治理 | 此檔 |
| --- | --- | --- | --- |
| common | `.claude/agents/references/common-review-rules.md` | clade LOCKED | ✓ |
| project | `.claude/agents/references/project-review-rules.md` | clade LOCKED（stack default） | |
| local | `.claude/agents/references/local-review-rules.md` | consumer 自管 | |

`code-review` agent Step 0 依序 Read 三份；commit-time `vendor/scripts/review-checklist-audit.mjs` 跑三份 grep pattern 做硬 gate。

## 嚴重度約定

本檔列出的條目**全部視為 must-follow**（沒有 severity 分層）。違反任一條 → `code-review` agent 報 🟠 Major + commit-time gate 擋 commit。`git commit --no-verify` 仍是 git 標準逃生口（不被擋，但會留 audit trail）。

## 新增規則的方式

不要直接編輯 consumer 端的投影副本（LOCKED + chmod 444）。新增規則一律走 clade：

1. 在 clade session 說「新增共用 review 項目：X」或「promote rule X to common」→ 觸發 `review-rules` skill 的 promote 模式
2. Skill 引導把規則寫進此檔（強制以下格式）
3. `vp check` → commit → `clade-publish` skill 散播到 5 consumer

也可用 `review-rules` skill 的 survey 模式掃各 consumer 的 `local-review-rules.md`，找出**重複出現的條目**作為 promotion 候選。

---

## 撰寫格式（規則作者必讀）

每條規則 **MUST** 含以下欄位，順序固定：

1. **規則標題**：`## <規則名稱>`（h2）
2. **禁止 pattern**：清楚描述要禁的寫法 / 條件（表格或段落皆可）
3. **應替換為**：提供正確替代方案
4. **說明**：為何禁、不遵守會發生什麼後果
5. **Reviewer 檢查方式**：可機器執行的 grep 指令清單（audit script 跑這部分）
6. **例外條件**：可豁免的明確場景；沒有就寫「無例外」

### Reviewer 檢查方式格式（嚴格 — audit script 直接解析）

`vendor/scripts/review-checklist-audit.mjs` 機器解析此段，**格式必須完全符合**：

- 段落首行：`**Reviewer 檢查方式**：` 或 `**Reviewer 檢查方式（...）**：`（全形或半形冒號都接受）
- 接著是**編號清單**（`1. `、`2. `、...）
- 每個項目**第一個** backtick-wrapped 區塊必須是可直接 shell 跑的 grep 命令（單行）
- 命令後可加 `—` 或 `:` 接說明文字（解析器忽略）
- 段落結束條件：遇到下一個 `## ` 或 `**...**：` 段落 / 連續 2 個以上空行

**範例（正確）**：

```markdown
**Reviewer 檢查方式**：

1. `grep -rEn 'console\.log' src/ 2>/dev/null` — 找殘留 console.log
2. `grep -rEn 'XXX|TODO\b' src/ 2>/dev/null` — 找未處理標記
```

**反例（會被解析器忽略，等於 gate 失效）**：

- 用 ` ```bash ` 三反引號 fenced block 包 grep — 起手版本不解析
- grep 命令以 `\` 折行寫多行 — 起手版本不支援
- 在 grep 後接複雜 pipe 處理（如 `| awk ...`）— 起手版本只跑首段 grep；建議拆成多條獨立指令

### Hot zone 路徑

若規則只對特定 path 適用，把 path glob 寫進 grep 命令的目標參數（如 `grep ... server/api/`），**不要**另設 metadata 宣告 hot zone。staged-files 模式下，audit script 會把 staged file 路徑跟 grep 目標路徑做 prefix 比對，超出 hot zone 的命令自動 skip。

---

## 規則清單

> 目前為 0 條規則。所有共用 review 條目透過 `review-rules` skill 的 promote 模式新增 — 不要直接手動 append（會跳過 vp check + grep pattern 驗證）。
