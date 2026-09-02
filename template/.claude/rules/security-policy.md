---
description: SECURITY.md 安全憲法的形狀契約（五段固定、不變量標執行層）
paths: ['SECURITY.md', 'packages/*/SECURITY.md', 'server/middleware/**', 'packages/*/server/middleware/**', 'supabase/migrations/**/*.sql', 'server/database/migrations/**/*.sql', 'packages/*/supabase/migrations/**/*.sql', 'packages/*/server/database/migrations/**/*.sql']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/security-policy.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Security policy（SECURITY.md 安全憲法）

`SECURITY.md` 是這個 repo 安全不變量的 SoT。Codex Security 掃描（`$CLADE_HOME/scripts/security-scan.ts`）在 target 有它時自動當 `--knowledge-base` 餵入；沒有它，掃描只看語法——程式碼裡的「刪除專案」是漏了授權還是正常功能，只有憲法答得出來。

## 五段固定結構（REQUIRED，順序固定）

| 段 | 寫什麼 | 從哪裡盤點 |
| --- | --- | --- |
| `## 攻擊入口` | 對外可達的 API / route 分群，**含每一個未認證入口**（token 連結、webhook、公開表單、kiosk / 裝置端點）逐條列 | `server/api/**`、`server/routes/**` |
| `## 信任邊界` | 請求在哪一層從「外部」變「可信」：middleware 名稱、session 型態、service-role client 准用的範圍 | `server/middleware/**` |
| `## 身分與授權模型` | 第一行明寫 `user-owned` 或 `tenant-scoped`；每層 enforcer（RLS / middleware / handler）各負責什麼 | schema 的擁有者欄位 + RLS policy |
| `## 核心資產與 secret` | 最值錢的資料表，加上所有 secret 的 **key 名**（NEVER 寫值） | `.env.example` |
| `## 安全不變量` | 每條格式 `- INV-n: <NEVER 句> — enforced by: rls\|middleware\|handler\|storage\|queue` | 前四段推出 |

不變量 **MUST ≥ 5 條，每一條都要有 `enforced by`**——沒有執行層的不變量，掃描器找不到反面證據，只能報候選、報不了 finding。

## 條件句

- 這個 repo 沒有 `SECURITY.md` → 先從 `$CLADE_HOME/vendor/snippets/security-policy/` 的範本（`user-owned` 或 `tenant-scoped`）建一份，再動 Tier 3 路徑
- `SECURITY.md` 的任一條不變量改了 → 上一次 `security-scan.ts baseline` 即過期（audit 以 ledger 的 `security_md_sha` 判），下一次 Tier 3 commit 前重跑
- 掃描報告的每一條 finding → 先走 `security-evidence finding`（Severity / Confidence / Coverage / Proof Gap）判讀，再登 TD；wrapper 只掃不修

## 精簡

每段只寫掃描器判斷需要的事實：範例、教學、逐 endpoint 的 handler 描述都不放——它是 `--knowledge-base`，每個字都進 prompt。

機械稽核：`node $CLADE_HOME/scripts/audit-security-policy.ts --consumers <path>`。成因與文章論證：`docs/rule-rationale/security-policy.md`。
