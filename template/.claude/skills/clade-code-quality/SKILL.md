---
name: "clade-code-quality"
description: "Code quality, error handling, shell safety, language, and maintainability rules. Use when implementing or refactoring code, scripts, or language-specific components."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/code-style.md`：新增腳本選哪個語言（D1 決策表，Python 不再新增）、寫 code 當下的 TypeScript 語法限制（type stripping 擋不掉的三條）、副檔名與 import specifier 規則、命名與註解（SSoT 優先、該刪的註解 C0–C6；機器擋不住的那一半）、用 vp 命令驗證；工具鏈設定治理在 code-style.toolchain；且碰 `**/*.{js,ts,vue,jsx,tsx,mjs,cjs,mts,cts,py,sh,rs}`
   - `rules/code-style.toolchain.md`：lint / fmt 工具鏈治理——preset 是唯一設定入口、eslint/prettier 全面禁令、vite.config.ts 必備欄位、CI 與 pre-commit 的命令邊界、投影層排除只在 preset（consumer 業務排除寫 `vite.config.ts` override）；format/lint check 紅了 agent 要立刻 write/fix 再驗到綠（不限 /commit）；動任何工具鏈設定檔時載入；且碰 `vite.config.*`、`nuxt.config.*`、`package.json` 等 14 處
   - `rules/coupling-cohesion.md`：耦合與內聚的三層分工——import cycle / barrel 的 gate 判讀、server 碼跨界 import、跨檔重複 discriminant switch、audit 表的 NO-SCAN 語意、Review 層函式契約、第三方 SDK 邊界、以 agent 為前提的設計警訊；且碰 `**/*.{ts,tsx,mts,cts,vue}`
   - `rules/error-handling.md`：錯誤處理規範（Server 驗證 + Client 顯示）；且碰 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts` 等 4 處
   - `rules/runtime/threshold-remediation.md`：Claude threshold review transport
   - `rules/shell-script-safety.md`：shell script 的身分與清理生命週期——自己呼叫 sudo 且使用 user-level toolchain 的腳本、trap 引用函式區域變數、清理或回滾靜默未執行；且碰 `**/*.sh`、`ops/**`、`deploy/**` 等 4 處
   - `rules/threshold-remediation.md`：audit 報門檻超標、要處置超標量之前

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
