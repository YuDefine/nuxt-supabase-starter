<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# Commit

所有 commit **MUST** 透過 `/commit` command 執行。**NEVER** 直接 `git commit`（例外見下）。

## 理由

`/commit` 封裝了品質閘門，繞過等於讓壞 code / 壞版本號 / 壞 tag 進 repo：

- **0-A** `simplify` skill + `code-review` agent — 重用性、品質、邏輯、安全
- **0-B** `pnpm check` — format / lint / typecheck / test 全綠
- **Step 1** Schema 同步檢查 — `database.types.ts` 與 migration 對齊
- **Step 6** 版本號升級 + tag push — `feat` → minor、其他 → patch

這些檢查**無法事後補跑**：漏跑的 commit 已經在 history 裡，壞版本號已經 push 出去。

## Single Session Lock

**同時只能有一個 session 跑 `/commit`**。由 `.claude/scripts/commit-lock.mjs` 實作，鎖檔 `.claude/.commit.lock`（已 gitignored）：

- Command 流程 **Step 0-Lock** 必跑 `node .claude/scripts/commit-lock.mjs acquire`；若失敗（另一 session 佔用）→ **停下**回報使用者，不自行 `rm` 清鎖
- **Final Step** 必跑 `release`；即便中間失敗、使用者中止，也要釋放，**NEVER** 讓鎖長期遺留
- Stale 閾值預設 30 分鐘（`COMMIT_LOCK_STALE_MINUTES` 可調），超過即自動清除

**理由**：commit 流程同時跑兩次會撞 staging、品質檢查互踩、版本號升級競態、tag push 衝突；一次抓牢節省整體 token。

## WIP 預設範圍

**預設所有 `git status` 顯示的 uncommitted 變更都納入本次 `/commit`**，在分組階段依功能拆成獨立 commit。

- 看到不認得的變更 → 先 `git diff` 確認內容合理 → 納入讓分組階段處理，**NEVER** `git restore --staged` / `git checkout --` 清場
- **排除條件（唯一）**：使用者在 `$ARGUMENTS` 中明確指名排除（例如「排除 .env.local」「只 commit app/」）
- **NEVER** 以「這個不在我 scope」「看起來是別的 session 做的」自行排除 — 先假設是使用者並行工作 + 一律保留

**理由**：品質閘門成本高，把 WIP 分次 commit 等於多跑一次閘門，浪費時間與 token。`/commit` 的分組階段就是設計來把「主線工作 + 並行 WIP」自然分類到不同 commit group。

## 禁止事項

- **NEVER** `git commit` / `git commit -m` — 繞過 0-A / 0-B 品質閘門
- **NEVER** `git commit --amend` 修改已 push 的 commit — 會破壞遠端 history
- **NEVER** `git commit --no-verify` — 繞過 pre-commit hook
- **NEVER** 以「變更很小」「只是 typo」「趕時間」為由跳過 `/commit`
- **NEVER** 讓 agent / subagent 自主執行 `git commit` — commit 必須在主線經過使用者確認分組
- **NEVER** 在 lock 被佔用時自行 `rm .claude/.commit.lock` — 必須回報使用者由其判斷對方是否真的卡住
- **NEVER** 漏跑 Final Step `release` — 即使前面失敗也要釋放，避免下次 session 卡在 stale lock

## 例外（極少）

以下情境允許直接 `git commit`，**MUST** 在 commit message 註明理由：

1. **`/commit` 本身壞掉** — command 檔被改壞、依賴的 agent 不可用時的救火
2. **Merge commit / rebase resolution** — `git merge` / `git rebase --continue` 的自動 commit
3. **`git revert`** — 還原既有 commit，無需重跑品質檢查

例外情境外，一律走 `/commit`。

## Commit 分組與訊息規範

- **每個 commit 獨立且完整** — 不相關的變更**MUST**分到不同 commit
- **Commit message 使用繁體中文**描述
- **所有 uncommitted 變更都必須入庫**，**NEVER** 以「不在本次範圍」「影響不大」為由跳過任何檔案
- **`.gitignore` 變更**：只允許保留 Clade 管理的 installation artifact / runtime state ignore 條目（例如 `.claude/.commit.lock`、`codex/`）；其他變更先 `git checkout .gitignore` 還原，**NEVER** commit
- **`.env` / 敏感檔案**：警告使用者但仍由使用者決定是否 commit，**NEVER** 自行跳過
- **修正所有發現的問題**：review / lint / typecheck / test 發現的問題都**MUST**修正，**NEVER** 以「建議性質」「不在本次範圍」為由跳過

## Commit 類型（commitlint.config.js）

| Emoji | Type     | 用途     |
| ----- | -------- | -------- |
| ✨    | feat     | 新功能   |
| 🐛    | fix      | Bug 修復 |
| 🧹    | chore    | 維護     |
| 🔨    | refactor | 重構     |
| 🧪    | test     | 測試     |
| 🎨    | style    | 樣式     |
| 📝    | docs     | 文件     |
| 📦    | build    | 建置     |
| 👷    | ci       | CI/CD    |
| ⏪    | revert   | 還原     |
| 🚀    | deploy   | 部署     |
| 🎉    | init     | 初始化   |

## 搭配

- Command 本體：`.claude/commands/commit.md` — 定義「怎麼做」（procedure）
- 本規則：定義「要不要做」— 政策、閘門、強制入口

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。
