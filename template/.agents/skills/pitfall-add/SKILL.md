---
name: pitfall-add
description: "新增一筆 clade pitfall 條目（跨 consumer 共享踩坑經驗集）。強制 dedupe / frontmatter schema / cross-consumer scan / audit quality gate。"
effort: medium
license: MIT
metadata:
  author: clade
  version: "1.0"
---

# /pitfall-add — 新增 clade pitfall 條目

新增一筆 `~/offline/clade/docs/pitfalls/` 踩坑經驗。本 skill 的目的是**把入口做硬** — 確保條目品質、自動 scan 跨 consumer 影響、強制 prevention 決策落地（不留口頭 follow-up）。

**Input**：argument 之後是條目簡述（一句話），或 user 已描述完踩坑情境。

---

## 何時用這個 skill

走 `/pitfall-add` 當：

- 升某個依賴後出現非預期 runtime error，根因屬於 contract 變更（required / signature / behavior shift）
- 同一個 bug pattern 已在 ≥ 2 個檔案被修，且來自共同根因
- 一個非直覺設定（CSP / RLS / cookie scope / migration timestamp）導致 production 行為偏離預期
- 一個工具的「靜默失敗」模式（無錯誤、無警告、回 0）

**NEVER** 用本 skill 寫：one-off typo、純業務邏輯 bug、純設計問題、TD / follow-up、設計討論、歷史 wave。那些走 `docs/tech-debt.md` / `docs/discussions/` / `docs/archives/`。

---

## Step 1 — 判斷是否符合 pitfall hard rule

四條件**MUST**齊備（缺一個就還不算 pitfall）：

1. **Root cause** — 一句話 + 鏈式分析，引用具體版本 / API contract
2. **Detection** — 可執行的 grep regex 或 mcp `search_code` pattern（不是描述「該怎麼找」而是給命令）
3. **Fix recipe** — 最小可重現修法（能 copy-paste）
4. **Prevention decision** — 至少一條 prevention candidate 有明確 status

若四條件不齊備：**STOP**，回報使用者「目前資訊不足以寫成 pitfall」，建議改走 `docs/tech-debt.md` TD entry 或 `docs/discussions/` discussion，等資訊收斂後再回來寫 pitfall。

---

## Step 2 — Dedupe（強制 ≥ 2 組關鍵字查詢）

**MUST** 在寫條目前用 mcp 查 clade 至少 2 組關鍵字，確認沒重複：

```text
mcp__codebase-memory-mcp__search_code(
  pattern     = "<關鍵字1：套件名 + 版本>",
  project     = "Users-charles-offline-clade",
  path_filter = "^docs/pitfalls/"
)

mcp__codebase-memory-mcp__search_code(
  pattern     = "<關鍵字2：錯誤訊息 token 或 API 名>",
  project     = "Users-charles-offline-clade",
  path_filter = "^docs/pitfalls/"
)
```

若命中既有條目：
- 完全重複 → **STOP**，回報該條目 id，由使用者決定是要更新既有條目（加 cross_consumer scan 結果 / 新 prevention）還是放棄
- 相關但不重複 → 記下 id，後續寫進新條目的 `related: []` frontmatter 欄位

**MCP 缺失時 fallback**：

```bash
rg --type md "<關鍵字>" ~/offline/clade/docs/pitfalls/
```

並提示使用者補 `.mcp.json` + 重啟 AI Agent session。

---

## Step 3 — 收集 frontmatter

從 `~/offline/clade/vendor/snippets/pitfalls/TEMPLATE.md` copy frontmatter skeleton。13 個必填欄位 + 規約：

| 欄位 | 來源 | 規約 |
| --- | --- | --- |
| `schema_version` | 固定 `1` | — |
| `id` | 推導自檔名 slug | `pitfall-<kebab-slug>`，與檔名一致 |
| `status` | 預設 `open` | 新建一律 `open` |
| `severity` | 從 user 對話推 | `critical` / `high` / `mid` / `low` |
| `discovered` | 當天 ISO date | — |
| `discovered_at` | 觸發 consumer 名 | `perno` / `TDMS` / `nuxt-edge-agentic-rag` / `yuntech-usr-sroi` / `nuxt-supabase-starter` / `clade` |
| `last_verified` | 當天 ISO date | 同 `discovered` |
| `affects.packages` | 從 stack trace 推 | format: `<pkg>@^<ver>` |
| `affects.features` | feature tag | 從 tags.yml controlled vocabulary |
| `tags` | controlled vocabulary | **MUST** 在 `docs/pitfalls/tags.yml` 註冊；1-6 個 |
| `detection.mcp_patterns` | 可執行 search_code pattern | **MUST** 用 `path_filter` regex，**NEVER** `path_glob` |
| `detection.grep_patterns` | 可執行 grep 命令 | command_ref 指向 markdown body 段落 |
| `cross_consumer_impact` | 5 個 consumer 都列 | 走 Step 4 自動填 |
| `prevention` | candidate list | 至少 1 條，**MUST** 有 status |
| `references` | session + commits + upstream | sessions 必填 |

**Agent 自填，不問 user**：`schema_version`、`status`、`discovered`、`last_verified`、`id`（從檔名推）、`affects`（從 user 描述的 stack trace 推）

**問 user 才能決定**：`severity`（business impact 判斷）、`wontfix_reason`（若 status = wontfix）、`prevention.status = rejected` 的理由

`tags` 一律從 `~/offline/clade/docs/pitfalls/tags.yml` 挑；若需新 tag → 先 Edit tags.yml 註冊 + 短描述，再用。

---

## Step 4 — Cross-consumer scan 自動回填 impact

對 5 個 consumer 跑 detection grep，自動填 `cross_consumer_impact`：

```bash
for d in ~/offline/perno ~/offline/TDMS ~/offline/nuxt-edge-agentic-rag \
         ~/offline/yuntech-usr-sroi ~/offline/nuxt-supabase-starter; do
  consumer=$(basename "$d")
  echo "=== $consumer ==="
  # 跑 detection.grep_patterns 的 command（從 Step 3 寫好的 regex）
  hits=$(<跑 grep, 數匹配檔案數>)
  if [ "$hits" -gt 0 ]; then
    echo "$consumer: affected (hits=$hits)"
  else
    echo "$consumer: unaffected"
  fi
done
```

依結果回填 frontmatter 每個 consumer key：

- `affected: affected` / `unaffected` / `unknown`
- `fixed: fixed` / `partial` / `not-applicable` / `unknown`
- `commit: <SHA>` 或 null
- `scanned_at: <today ISO>`
- `reason: <掃描阻擋原因>`（`affected: unknown` 時 **MUST** 填）

**規約**：
- 觸發 consumer（`discovered_at`）通常 `affected=affected, fixed=fixed`，commit 由使用者提供或留 null
- 其他 4 consumer 若 grep 0 命中 → `affected=unaffected`（除非有理由懷疑掃不到）
- 若 grep 跑不通（例如該 consumer 不在 ~/offline/）→ `affected=unknown, reason: <why>`

**NEVER** 留全部 `unknown` 而不寫 reason — audit script 會 block。

---

## Step 5 — 寫 markdown body

從 TEMPLATE.md copy body section 結構：

```markdown
# <人類可讀標題>

## Symptom
## Root Cause
## Why it slipped past tests / CI
## Detection
### grep pattern
### mcp pattern
## Fix Recipe
## Cross-Consumer Impact
## Prevention
## References
```

每段都要實質內容：

- **Symptom**：實際 log / 錯誤訊息原文（盡量複製不改寫），含 stack trace 關鍵 frame，讓未來 grep 能命中
- **Root Cause**：一句話 + 引用具體 source code 路徑 / 版本 / contract
- **Why slipped past tests / CI**：為什麼 typecheck / unit test / CI 沒抓到（防止下次同類 bug）
- **Detection**：grep + mcp 各一塊 code block，可 copy-paste 直接跑
- **Fix Recipe**：寫「在 X 補 Y」「把 A 改 B」，不是 diff dump
- **Cross-Consumer Impact**：人類可讀 markdown table（frontmatter 已是 canonical SoT；table 只是 view）
- **Prevention**：5 種 type 列表（audit-signal / pre-commit-hook / upstream-pr / rule-section / catalog-adoption）+ status + ref + note
- **References**：session、相關 ADR、upstream issue URL、修正 commit SHA

---

## Step 6 — 寫進 clade（Bash workaround）

從 consumer session 用 Write tool 寫 `~/offline/clade/...` 會**靜默無視**（回報 success 但檔案不存在 — Write tool 受 primary working directory 限制）。

**MUST** 走以下 workaround：

```bash
# 1. 用 Write tool 寫到 /tmp
Write(file_path = "/tmp/clade-pitfall-<slug>.md", content = "<完整檔案>")

# 2. Bash mv 到 clade
/bin/mv /tmp/clade-pitfall-<slug>.md \
  /Users/charles/offline/clade/docs/pitfalls/<YYYY-MM-DD>-<slug>.md

# 3. 驗證落地
/bin/ls -la /Users/charles/offline/clade/docs/pitfalls/<YYYY-MM-DD>-<slug>.md
```

從 clade session 跑時 Write tool 直接 work；無需 workaround（但 Edit tool 也 OK）。

---

## Step 7 — Reindex mcp graph

新檔需要 reindex 才能透過 `search_code` 命中：

```bash
/Users/charles/.local/bin/codebase-memory-mcp cli index_repository \
  '{"repo_path":"/Users/charles/offline/clade"}'
```

驗證：

```bash
/Users/charles/.local/bin/codebase-memory-mcp cli search_code \
  '{"pattern":"<剛建立的 id 中 unique token>","project":"Users-charles-offline-clade"}'
```

預期回傳含剛建立的檔案路徑。若 0 命中 → 等幾秒重試 reindex（auto_index 偶爾 lazy）。

---

## Step 8 — 跑 audit quality gate

```bash
cd /Users/charles/offline/clade && node scripts/pitfalls-audit.mjs
```

預期 exit 0 + 「all signals green for <new pitfall id>」。

若有 block signal（例：`schema.requiredMissing` / `tags.unknown` / `impact.unknownWithoutReason` / `prevention.acceptedWithoutRef`）：

- 修對應問題（補 frontmatter 欄位 / 註冊 tag / 補 scan reason / 建 TD entry）
- 重跑 audit 確認綠燈
- audit 沒綠**MUST NOT** 結束 skill

---

## Step 9 — Prevention accepted 但未實作 → 建 TD-NNN

對每條 `prevention[]` status = `accepted` 的條目：

1. Edit `~/offline/clade/docs/tech-debt.md` 加 TD entry：
   - 下一個未用的 `TD-NNN`
   - 描述：本 pitfall id + prevention type + 預期落地動作
   - Status: `open`
   - Priority: 從 pitfall severity 推（critical→high / high→mid / mid→low / low→low）
   - Discovered: 同 pitfall discovered date
2. 把 `TD-NNN` 填回 pitfall frontmatter `prevention[<idx>].ref`
3. 重跑 audit 確認 `prevention.acceptedWithoutRef` 不再觸發

**NEVER** 跳過此步 — `accepted` 但無 TD-NNN 等於口頭 follow-up，最終會遺失。

---

## Step 10 — Final report

回報使用者：

- ✅ 新 pitfall id + 路徑
- ✅ Cross-consumer scan 結果（5 consumer 哪幾個受影響）
- ✅ Prevention candidates list + 對應 TD-NNN（若 accepted）
- ✅ audit script all signals green
- 待 user 決定：要不要立即 propagate clade（依 memory rule「Propagate 需授權」）

---

## 必禁事項

- **NEVER** 跳過 Step 2 dedupe — 直接寫條目會產生重複
- **NEVER** 跳過 Step 4 cross-consumer scan — 留全部 `unknown` 會被 audit block
- **NEVER** 跳過 Step 7 reindex — 其他 session 立刻就需要透過 mcp 查到新條目
- **NEVER** 跳過 Step 8 audit gate — 條目品質會漂
- **NEVER** 跳過 Step 9 TD entry — `accepted` prevention 等於要做的事，必須登記
- **NEVER** 在 consumer 自家 docs/ 寫 pitfall — 一律寫進 clade
- **NEVER** 用 `path_glob` 在 mcp 查詢 — 用 `path_filter` regex
- **NEVER** 用 `consumer 端 Write tool` 寫 clade — 走 Step 6 Bash workaround
