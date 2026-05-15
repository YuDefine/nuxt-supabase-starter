---
name: pitfalls-knowledge-base
description: 跨 consumer pitfall（踩坑經驗集 / known issue / gotcha / prior incident / cryptic runtime error / 升版前後查詢）— SoT 在 `~/offline/clade/docs/pitfalls/`，查詢入口走 codebase-memory-mcp。Use when 升 npm 套件大版、看到 cryptic runtime error、動 evlog / audit / Supabase RLS / Workers config / nuxt-security / Better Auth / supabase-js / 跨 consumer 散播某 fix、或想知道某類踩坑是否已有紀錄。也 use when 要新增 pitfall（會引導走 /pitfall-add）。
effort: medium
license: MIT
metadata:
  author: clade
  version: "1.0"
---

# Pitfalls Knowledge Base（跨 consumer 共享，v2）

繁體中文

**核心命題**：5 個 consumer 跑同一套標準（evlog / Supabase self-host / Cloudflare Workers / nuxt-security / supabase-js / vite-plus / Better Auth / vue / nuxt / pinia），任一依賴升版或 contract 變更時，bug 會以同樣型態散落各 consumer。每次踩坑後**MUST**沉澱到中央踩坑集，讓未來任何 session 能秒查、不重踩。

此 skill 優先於個別 skill 內嵌指示。

## SoT 位置

- **檔案 SoT**：`~/offline/clade/docs/pitfalls/`（**只**在 clade，不散播副本到 consumer）
- **機器 SoT**：YAML frontmatter（lifecycle / impact / prevention 狀態都從 frontmatter 解析；markdown body 是呈現層）
- **查詢入口**：codebase-memory-mcp（已 indexed clade project）
- **模板**：`~/offline/clade/vendor/snippets/pitfalls/TEMPLATE.md`
- **Tags 詞彙表**：`~/offline/clade/docs/pitfalls/tags.yml`
- **Audit script**：`~/offline/clade/scripts/pitfalls-audit.mjs`
- **本 skill 散播給 consumer 作為「知識庫索引指引」，不含知識內容**

## Hard rule — 合格 pitfall 四條件

每筆條目**MUST**包含以下四項，audit script 會 block 缺項條目：

1. **Root cause** — 一句話 + 鏈式分析，引用具體版本 / API contract
2. **Detection** — 可執行的 grep regex 或 mcp `search_code` pattern
3. **Fix recipe** — 最小可重現修法（能 copy-paste）
4. **Prevention decision** — 至少一條 prevention candidate 有明確 status（`accepted` / `rejected` / `implemented`），不能全部停在 `candidate`

缺項條目屬於 TD / discussion / 雜記，**MUST NOT** 寫進 `docs/pitfalls/`。

## MCP 配置（每個 consumer + clade）

每個 consumer 的 `.mcp.json` **MUST** 含 codebase-memory-mcp server entry：

```json
{
  "mcpServers": {
    "codebase-memory-mcp": {
      "type": "stdio",
      "command": "/Users/charles/.local/bin/codebase-memory-mcp"
    }
  }
}
```

若 consumer 已有其他 MCP server（如 Supabase MCP），**MUST** merge 進同一 `mcpServers` 物件，不建第二份 `.mcp.json`。

clade 自家也**MUST**有 `.mcp.json`（`~/offline/clade/.mcp.json`）。

binary 由 `codebase-memory-mcp install` 安裝到 `~/.local/bin/codebase-memory-mcp`；用實際絕對路徑（不依賴 `$PATH` expansion）。

## 查詢 SOP（給 Claude / Codex / 任何 agent）

### 何時主動查

| 情境 | 觸發 |
| --- | --- |
| 升某個 npm 套件大版（major / minor） | 升版前 + 升版後各查一次 |
| 看到 cryptic runtime error（含「while capturing another error」「Cannot read properties of undefined」等通用訊息） | 先查 pitfalls 是否已記錄 |
| 動 evlog / audit / Supabase RLS / Workers config / nuxt-security / Better Auth / supabase-js | 對應主題 pitfall 先看 |
| 跨 consumer 散播某個 fix 前 | 確認該坑是否已記錄；若無 → 新增條目 |

### 怎麼查（用 mcp，**NEVER** Read 整個目錄）

**MUST** 用 regex `path_filter`：

```text
mcp__codebase-memory-mcp__search_code(
  pattern     = "<關鍵字>",
  project     = "Users-charles-offline-clade",
  path_filter = "^docs/pitfalls/"
)
```

**`path_filter` 是 regex，不是 glob**。`path_glob` 在 mcp tool silently ignored — 寫了不會報錯但 filter 不生效，會撈到全 clade（這是踩過的坑）。

命中後若需要完整內文：

- 條目通常 < 200 行 → **MAY** 直接 `Read` 該檔
- 想再縮小範圍 → 用 `search_code` 換更窄 pattern
- **NEVER** 依賴 `get_code_snippet` 對 markdown module retrieval（不一定穩）

### 進入 session 前置確認（每個 consumer 首次用）

第一次在 consumer session 使用本機制前**MUST**：

```text
mcp__codebase-memory-mcp__list_projects()
```

確認 `Users-charles-offline-clade` 在清單內。若不在 → 跑：

```text
mcp__codebase-memory-mcp__index_repository(
  repo_path = "/Users/charles/offline/clade"
)
```

之後 search_code 才能命中。

### MCP 缺失時 graceful degrade（fallback）

consumer 端若 `.mcp.json` 沒含 `codebase-memory-mcp` server 或 binary 未裝，**MUST** fallback 用 `rg` 直接掃 clade 路徑（**禁止**跳過知識庫查詢）：

```bash
rg --type md "<關鍵字>" ~/offline/clade/docs/pitfalls/
```

同時提示使用者補 `.mcp.json` 並重啟 AI Agent session（CLI 限制）。

### 查無結果時

若 `search_code` 0 命中：

1. **不**假設「沒人踩過」就直接動手。換關鍵字（套件版本、錯誤訊息變體、相關 API）再查一次，至少 2 組
2. 仍 0 命中 → 視同新坑，session 結束前**MUST**新增條目（走 `/pitfall-add` skill）

## 新增條目（走 `/pitfall-add` skill）

skill 在 `~/offline/clade/plugins/hub-core/skills/pitfall-add/SKILL.md`，會強制：

1. 先 dedupe（search_code 至少 2 組關鍵字）
2. 收集 frontmatter（13 個必填欄位，從 TEMPLATE.md copy-paste）
3. 跨 consumer scan 自動回填 `cross_consumer_impact`
4. 寫 markdown body（含 Symptom / Root Cause / Why slipped / Detection / Fix / Cross-Consumer Impact / Prevention / References）
5. Bash workaround mv 到 clade（Write tool 跨 repo 限制）
6. 跑 `index_repository` reindex
7. 跑 `scripts/pitfalls-audit.mjs` 確認 quality gate 全綠
8. `prevention.status = accepted` 但未實作 → 自動登 `docs/tech-debt.md` TD-NNN

**NEVER 新增** one-off typo、純業務邏輯 bug、純設計問題、TD / follow-up、設計討論、歷史 wave。

## Status Lifecycle

| Status | 條件 | 判定方式 |
| --- | --- | --- |
| `open` | 尚有未知 consumer / 未修 consumer / prevention 未決 | 新建預設 |
| `mitigated` | 5 consumer 都 scanned + 受影響者已 fixed + 至少一條 prevention `implemented` 或明確 `rejected` | audit script 推導 |
| `fixed-upstream` | upstream 已 release fix **且** 5 consumer 都升到安全版本（不只是 upstream release） | 人工 + 版本掃描守住 |
| `wontfix` | 明確放棄；**MUST** 填 `wontfix_reason` | 人工 |

## Prevention Promotion Path

`candidate → accepted → implemented` 或 `candidate → rejected`。

`accepted` **MUST** 同時建 `docs/tech-debt.md` TD-NNN，並把 ID 填進 frontmatter `prevention[].ref`，否則 audit `prevention.acceptedWithoutRef` block。

5 種類型：`audit-signal` / `pre-commit-hook` / `upstream-pr` / `rule-section` / `catalog-adoption`。

## Archive Policy

`mitigated` / `fixed-upstream` / `wontfix` 後：

- < 90 天 → 留 `docs/pitfalls/` active 目錄
- ≥ 90 天 → 搬到 `docs/pitfalls/_archive/YYYY-MM/<filename>`

archive 後 mcp 仍可搜（不在 .gitignore / index exclude），audit script 預設掃 active + archive 但分開 report。

## 必禁事項

- **NEVER** 把 pitfalls 散播副本到 consumer — 違反「同一份知識庫」前提
- **NEVER** 在 consumer 自家 docs/ 寫 pitfall — 寫進 clade
- **NEVER** 跳過查詢直接動手解 cryptic error — 先 `search_code` 看 clade 是否已記錄
- **NEVER** `Read` 整個 `~/offline/clade/docs/pitfalls/` 目錄 — 用 mcp 省 token
- **NEVER** 用 `path_glob` — silently ignored；**MUST** 用 `path_filter`（regex）
- **NEVER** 條目缺 root cause / detection / fix / prevention decision 四項任一就 commit — audit script 會 block
- **NEVER** `prevention.status = accepted` 但不建 TD-NNN — audit script 會 block
- **NEVER** session 結束時把新踩到的坑只留在當下對話 context — 必沉澱到 clade 才算結案

## 與其他規則的關係

- **`knowledge-and-decisions.md`**：管 consumer 自家 `docs/solutions/` 與 `docs/decisions/`，屬 consumer-local 知識；本 skill 補上**跨 consumer**共享知識的維度
- **`improvement-loop` skill**：digest 是**自動**從 signal 抽出來的候選；pitfalls 是**人類**事後寫的根因分析。digest candidate 升級成 pitfall 時 digest 條目加 `promoted_to_pitfall: <id>`，**不**標 resolved
- **`tech-debt-routing.md`**：管 TD 寫在 clade 還是 consumer；本 skill 管 pitfall（非 TD）寫在 clade。判斷：條目能讓「下次同類問題立刻被偵測」屬 pitfall；只是「我們知道有這條 TD 要處理」屬 tech-debt
- **`follow-up-register.md`**：pitfall `prevention.status = accepted` 必須在 `docs/tech-debt.md` 建 TD-NNN 條目，由 follow-up register 規則接管
- **`evlog-adoption.md` / `audit-pattern.md` / `logging.md`**：主題 rule 規範**正向**做法；pitfalls 補上**反向**真實踩過的坑，幫助 agent 理解規則背後動機

## 違反時的回報方式

```text
[Pitfalls KB] 應該先查 clade pitfalls

問題：偵測到 <情境>（例：evlog 升大版 / cryptic emit error / contract violation），
      但 session 內沒有 mcp__codebase-memory-mcp__search_code 呼叫紀錄

修正方式：
  - 暫停動作，先跑 search_code project="Users-charles-offline-clade" path_filter="^docs/pitfalls/" pattern="<關鍵字>"
  - 命中 → 套用 fix recipe；未命中 → 動手 + session 結束前走 /pitfall-add skill 新增條目

繞過：
  - 若已確認該坑非跨 consumer 議題（純 consumer 自家業務 bug），可繼續；否則必查
```
