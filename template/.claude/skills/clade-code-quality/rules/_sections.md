<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

code-style.md — 新增腳本選哪個語言（D1 決策表，Python 不再新增）、寫 code 當下的 TypeScript 語法限制（type stripping 擋不掉的三條）、副檔名與 import specifier 規則、命名與註解（SSoT 優先、該刪的註解 C0–C6；機器擋不住的那一半）、用 vp 命令驗證；工具鏈設定治理在 code-style.toolchain
5-16 前導 — Code Style — 寫 code 當下
18-38 新增腳本選語言（D1，MUST）
40-82 新增腳本一律 TypeScript
84-114 失敗要留痕：寫 `catch → 空值` 之前先分類（MUST）
116-130 型別宣告 NEVER 代替驗證：把假設搬家不等於查證（MUST）
132-157 CLI script 的 stdout 收尾：會被 pipe 消費就 MUST 等 flush（MUST）
159-161 用 vp 命令做 lint / format
163-205 命名：機器擋不住的那一半
207-209 註解：預設不寫，寫了就要對
211-224 註解：預設不寫，寫了就要對 › 註解預設不寫
226-230 註解：預設不寫，寫了就要對 › SSoT 優先（MUST）
232-250 註解：預設不寫，寫了就要對 › 該刪的註解（C0–C6）
252-254 註解：預設不寫，寫了就要對 › 寫了就 MUST 100% 對
256-273 註解：預設不寫，寫了就要對 › 值得寫的三種

code-style.toolchain.md — lint / fmt 工具鏈治理——preset 是唯一設定入口、eslint/prettier 全面禁令、vite.config.ts 必備欄位、CI 與 pre-commit 的命令邊界、投影層排除只在 preset（consumer 業務排除寫 `vite.config.ts` override）；format/lint check 紅了 agent 要立刻 write/fix 再驗到綠（不限 /commit）；動任何工具鏈設定檔時載入
21-28 前導 — Code Style — 工具鏈治理
30-41 Agent 義務：check 紅了立刻 fix（全 session）
43-56 Governance — lint / fmt 設定改在哪
60-67 禁止事項（NEVER） › 禁止建立 eslint 設定檔
69-91 禁止事項（NEVER） › 禁止所有 prettier config 檔（含 `.prettierignore`）
93-119 禁止事項（NEVER） › 禁止把 eslint / prettier 加進 dependencies
121-149 禁止事項（NEVER） › 禁止依賴全域 vite-plus（hard rule）
151-195 禁止事項（NEVER） › Node runtime 全 fleet 釘 major 24（hard rule）
197-206 禁止事項（NEVER） › 禁止在 lint-staged / pre-commit / CI 命令中呼叫 eslint / prettier
208-237 禁止事項（NEVER） › CI workflow 禁止跑 `vp check` / `vp run check`（hard rule）
241-263 必須事項（MUST） › 改 `catalog:` / `overrides:` 之後，收尾 MUST 驗 lockfile 本身
265-281 必須事項（MUST） › packageExtensions 條目契約
283-320 必須事項（MUST） › `vite.config.ts` 必備欄位（跨 consumer 統一，避免 propagate drift）
322-355 必須事項（MUST） › staged 配置：一行 re-export，NEVER 手寫排除陣列
357-365 必須事項（MUST） › Nuxt app 不要照抄官方 `vp migrate` 全文
367-381 必須事項（MUST） › Pre-commit hook 走 `runner.sh`
383-395 違反偵測
397-427 Heavy gate 准入控制（機器層並行上限）
429-464 Heavy gate 准入控制（機器層並行上限） › Guard 要寫成 arg-safe 形狀，NEVER 裸 `if … fi`
466-475 Heavy gate 准入控制（機器層並行上限） › 這幾個 exit code 說的是不同層的話
477-515 Heavy gate 准入控制（機器層並行上限） › 機器層調參 NEVER 寫死進 script 預設
517-527 Heavy gate 准入控制（機器層並行上限） › `vp check` 收不到 threads 上限（已知殘餘）
529-533 Heavy gate 准入控制（機器層並行上限） › 長駐 dev server 不是 gate —— 閘門結構上攔不到它
535-543 Heavy gate 准入控制（機器層並行上限） › NEVER 用 slots 數量近似記憶體

coupling-cohesion.md — 耦合與內聚的三層分工——import cycle / barrel 的 gate 判讀、server 碼跨界 import、跨檔重複 discriminant switch、audit 表的 NO-SCAN 語意、Review 層函式契約、第三方 SDK 邊界、以 agent 為前提的設計警訊
5-10 前導 — Coupling & Cohesion
12-20 三層分工
22-69 Review 層 checklist
71-91 Gate 判讀
93-107 Server / Client 邊界
109-116 Shotgun surgery
118-129 Audit signal 判讀
131-136 為什麼 gate 只有兩條規則
138-154 第三方邊界

error-handling.md — 錯誤處理規範（Server 驗證 + Client 顯示）
5-14 前導 — Error Handling
16-52 PostgREST 錯誤碼診斷

runtime/threshold-remediation.md — Claude threshold review transport
1-12 全文 — Claude threshold review transport

shell-script-safety.md — shell script 的身分與清理生命週期——自己呼叫 sudo 且使用 user-level toolchain 的腳本、trap 引用函式區域變數、清理或回滾靜默未執行
5-11 前導 — Shell script safety
13-48 1. 自己會 `sudo` 的腳本 MUST 有 EUID guard
50-86 2. `trap` body 引用的變數 MUST 在 trap 執行當下真的拿得到值
88-119 3. `pkill -f` / `pgrep -f` 的 pattern MUST 不會命中發出它的那個 shell
121-148 3. `pkill -f` / `pgrep -f` 的 pattern MUST 不會命中發出它的那個 shell › 3.1 同根因的另一條路徑：`kill -- -$pgid` 帶走呼叫端

threshold-remediation.md — audit 報門檻超標、要處置超標量之前
4-15 前導 — Threshold Remediation（門檻處置的幅度紀律）
17-29 MUST
31-36 NEVER
38-41 手法紀律在別處
