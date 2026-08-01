---
description: skill 真相層與投影層的版控形態——.claude/skills/ 是 canonical 且內容 MUST 進版控，.agents/ 與 .codex/ 是 sync-to-codex 投影 MUST gitignore，symlink 形態的 skill 其 target 內容也必須 tracked
paths: ['.gitignore', '.claude/skills/**', 'plugins/hub-core/skills/**', 'scripts/install-skills.sh', 'skills-lock.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/skill-management.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Skill 管理

## 三層各自的版控形態

| 層 | 角色 | 版控 |
| --- | --- | --- |
| `.claude/skills/**` | **canonical 真相層** | **MUST 進版控**（含第三方 skill） |
| `.agents/` `.codex/` | `sync-to-codex.ts` 從 `.claude/` 產生的投影 | **MUST gitignore** |
| `skills-lock.json` | 各 skill 的 source 與 computedHash | **MUST 進版控** |

`AGENTS.md` 開頭的「AUTO-GENERATED from `.claude/`」不是註解，是這張表的宣告：投影層可由腳本完整重生，重生得出來的東西不進版控。

## 為什麼第三方 skill 也要進版控

第三方 skill 用 `npx skills add` 裝得回來，看起來像「可重生 → 不必進版控」。但它與投影層有一個決定性差異：**投影層的來源在本 repo 內，第三方 skill 的來源在別人的 GitHub repo**。

`npx skills add` 拉的是 default branch HEAD，上游一次 force-push 或 refactor，你就再也裝不回當初那一版；repo 被刪或改名則是直接消失。而 skill 內容會實質影響 agent 行為——它不是可有可無的開發工具，是這個 repo 的行為契約的一部分。

進版控的代價是升版時幾萬行 diff，那是可接受的：diff 大但可讀（都是 markdown），且一年也不會升幾次。

## 三條 MUST

1. **安裝一律 `--agent claude-code --copy`**。`npx skills add` 不加 `--copy` 的行為不穩定（實測 v4 仍會裝成真實目錄而非 symlink），且 symlink 形態有下面第 3 條的失效模式。
2. **commit 必須帶上 `skills-lock.json`**。`npx skills add` 會重算 lock 內**所有** entry 的 `computedHash`，不只你剛裝的那一支。漏帶會讓 lock 與實際安裝不一致，下次 `npx skills check` 報 drift。
3. **NEVER 讓 `.claude/skills/<name>` 是 symlink 指向未 tracked 的 target。** 這是三種失效裡最隱蔽的一種：symlink 本身進了版控，target 內容沒有——clone 下來 symlink 在、skill 載不到，而且**沒有任何錯誤訊息**。agent 只是安靜地少了那個能力。

> 2026-08-02 實證：<consumer-b> 與 <consumer-d> 各有 22 支第三方 skill 處於此狀態，symlink 指向 `.agents/skills/<name>` 而該路徑從未存在（sync-to-codex 只投影 `.claude/skills/` 的**真實內容**，本身是 symlink 的項目投影不過去）。兩個 repo 因此各少了 22 支 skill，時間長度不明——沒有機制會發現。

## 例外：node_modules-backed symlink

`npx void init --agents` 建的 `void` 與 `migrate-vite-cloudflare-to-void` 指向 `node_modules/`，pnpm virtual store 的 hash 跨機不同，進版控在別台機器必然斷鏈。**這兩支維持 gitignore**，fresh clone 後跑 `void init --agents` 重建。

判準是「target 在不在 repo 內」：指向 `node_modules/` 的是例外，指向 repo 內任何位置的都不是。

## 機械稽核

`scripts/audit-governance-drift.ts` 的 **check13** 對每個 consumer 驗三件事，任一命中即 fail：

- `.agents/` 或 `.codex/` 有 tracked 檔
- `.claude/skills/` tracked 檔數為 0（目錄存在卻整個沒進版控）
- 有 symlink 形態的 skill 其 target 內容未 tracked

新增第三方 skill 後跑一次 `node scripts/audit-governance-drift.ts`，check13 綠了才算裝完。
