# TD-020 顧問報告：選了 codex 的 scaffold 輸出靜默少掉 `.codex/` 與 `.agents/`

唯讀。未改任何 repo 檔。

## 建議

**第四條（收窄後的 option 1）**：`assemble` 從已追蹤的 `targetDir/.claude/` 做薄投影，產出 `.agents/skills/` 與 `.codex/config.toml`；**不要**把 clade 的 `sync-to-codex` 搬進 starter seed，**不要**把 `template/.codex/` / `template/.agents/` 收進版控。選了 `codex` 而真正的源（`.claude/skills`）不存在才 throw。

## 理由

現況不是「沒有生成路徑」，而是 **assemble 抄了一份 gitignore 掉的快照，post-scaffold 才是真正的生成點，但那條路綁本機 clade shim，失敗還只 warn**。三條原文都沒對準這個結構。

### assemble 在抄不存在的快照

`copyTemplateCodexAssets()`（`template/packages/create-nuxt-starter/src/assemble.ts:251-263`）對 `STARTER_ROOT/.codex` 與 `STARTER_ROOT/.agents` 各用 `existsSync` 守門再 `copyDirectory`。`STARTER_ROOT` 是 `template/`（同檔第 24 行）。`assembleProject` 在選了 `codex` 時才呼叫它（第 82-84 行）。

對照：`copyTemplateClaudeAssets()`（第 207-209 行）**沒有** `existsSync`，直接拷 `.claude/`。那才是「這個源是契約」的寫法。Codex / Cursor / GitHub / SECURITY 走的是「有就拷、沒有就當選配」的 optional 模式。使用者顯式 `--agents codex` 時，optional 模式是錯的。

### 那兩個源確實不進版控

`template/.gitignore:81` 是 `.codex/`，`template/.gitignore:86-87` 是註解「Codex 投影層（sync-to-codex.ts 從 .claude/ 產生，可重生 → 不進版控）」加 `.agents/`。`git check-ignore -v` 對得上這兩行。`git ls-files` 對 `template/.agents/*`、`template/.codex/*` 為空；`template/AGENTS.md` 與 `template/.cursor/hooks.json` 是 tracked。所以使用者拿到 `AGENTS.md`、拿不到另外兩個目錄，完全是版控狀態的直接後果，不是測試寫錯。

本機（跑過 `sync-to-codex` 的開發樹）`template/.codex` 167 檔 / 2.1M、`template/.agents` 1111 檔 / 12M，所以本機 `existsSync` 為 true、測試綠。CI 乾淨 clone 沒有這兩棵樹，第 255 行掛掉。機制成立。

### 測試斷的是 assemble 契約，不是 CLI 全路徑

`template/packages/create-nuxt-starter/test/scaffold.test.ts:247-256` 只呼叫 `assembleProject(..., ['codex', 'cursor'])`，然後斷言：

- `.codex/config.toml`
- `.agents/skills/commit/SKILL.md`
- `.cursor/hooks.json`（`.cursor/` 是 tracked，所以這行在 CI 不會先掛）

它不跑 `postScaffold`。所以「只修 post-scaffold」無法讓這條單測轉綠。TD 寫的「NEVER 刪 255-256 讓 CI 轉綠」仍然成立。

`assemble.ts:1178-1195` 的 `pruneRetiredSpectraAssets` 裡 `.agents/commands/spectra` 是 `rmSync(..., { force: true })`，不是 copy。同一成因的防禦性清理，不是同一段 bug。源不存在時它本來就是 no-op。

### 真正的生成器在 post-scaffold，而且綁錯機器

`postScaffold`（`template/packages/create-nuxt-starter/src/post-scaffold.ts:882-885、958-963`）故意把投影延到 `rewriteFirstGlance` / settings MCP strip **之後**，理由寫在檔裡：prune 後立刻投影會把還沒剝掉的 `local-supabase` 寫進 `.codex/config.toml`。然後「一律重投影，不看 `agentTargets`」。

`runSyncToAgents()`（同檔 1585-1604）找的是 `join(homedir(), '.claude', 'scripts')` 的 user shim，找不到就 `consola.warn` 然後 return。警告文案是「這代表專案不會有 Codex / Cursor 的投影檔。**只用 Claude Code 的話可以忽略。**」——使用者剛選了 `codex` 時這句是錯的。

那個 shim（`~/.claude/scripts/sync-to-codex.ts`，45 行）自己說：實作在 clade（51 KB），shim 只負責定位 clade repo 再轉呼叫，**「避免 user-level 放一份會漂移、且無版控的副本」**。clade 本尊 `scripts/sync-to-codex.ts` 是 2506 行，還 import `project-runtime.ts` / `project-runtime-rules.ts` / `project-runtime-mcp.ts` / `project-runtime-capabilities.ts` 等一串內部模組。原文 option 1「把轉換邏輯搬進 starter seed」不是搬一支檔，是搬一個 clade 內部星座；clade 自己已經禁止這種副本。

選了 Codex、機器上沒有 `~/clade` 也沒有 `~/.claude/scripts` 的人，是這個 agent 選項的目標使用者。現有生成路徑預設他們有 Claude Code + clade。這條路過不去。

### 薄投影做得到測試點名的那兩個檔，而且源是 tracked

本機比對：

- `template/.claude/skills/` 83 個目錄，全部都在 `template/.agents/skills/` 裡（`only_claude = []`）
- `.agents/skills` 多出來的 11 個（`canary`、`db-migration`、`freeze`、`guard`、`ship`…）檔名對得上 `template/.claude/commands/*.md`，是 sync-to-codex 的 command→skill 投影，不是另一份源
- `template/.claude/skills/commit/SKILL.md` 存在且 tracked → 測試第 256 行要的檔，從 `.claude/` 拷就有
- `template/.claude/settings.json` 的 `includeGitInstructions` / `enabledMcpjsonServers` / `enabledPlugins` 與本機 `template/.codex/config.toml` 是同一組欄位；config.toml 是 settings.json 的 TOML 視圖，不是獨立源

所以 assemble **不必**讀 gitignore 掉的目錄。它已經把 `.claude/` 拷進 target（第 81、207-209 行），`copyClaudeCodeAssets` 還會 `pruneWrongStackSkillDirs`（第 226 行，含 `.agents/skills`）。正確順序是：在 prune + `generateSettings` **之後**，從 **target** 的 `.claude/` 投影，而不是在 step 7 抄 starter 快照。現在的 step 7 就算本機有 `.codex/`，抄到的也是 starter 的 `local-supabase` MCP（本機 `config.toml` 第 3 行），正是 post-scaffold 882-885 行要避開的那件事。

### hygiene 前提仍然對，只是那句「不會被帶走」會過期

`.claude/rules/starter-hygiene.md:118-126` 與 `scripts/audit-public-hygiene.mjs:32-40` 原文一致：不掃 `template/.agents/`、`template/.codex/`，因為不進版控；`.cursor/` 相反，tracked、會被帶走、要掃。本機 `.cursor/` 13M / 1267 檔已在版控裡——那是付過代價的例外，不是該複製到 Codex 的樣板。

薄投影落地後：template git 樹仍然沒有這兩目錄，L3 掃描範圍**不必**擴大。要改的只是「不進版控 = 不會被 scaffold 帶走」這句事實陳述——輸出裡會有，但是 scaffolder 生成的，不是 template 樹帶走的。

## 你推翻了什麼

五點事實**沒有一點不成立**。有三處不精準，不影響根因：

1. `copyTemplateCodexAssets` 是 251-263，不是 251-262；最後一行是 `copyAgentsInstructionFile`（`AGENTS.md` 是 tracked，這行在 CI 是成功的，不是 bug 本體）。
2. `.codex/` 在 gitignore 第 81 行，夾在 `.clade/runtime/` 旁邊、**沒有**「可重生投影」註解；那個註解只寫在第 86-87 行的 `.agents/`。兩邊都被 ignore，但 `.codex/` 當初比較像 runtime ignore，不是同一段註解推導出來的。
3. `assemble.ts:1195` 是 prune 不是 copy。同一棵消失的樹，方向相反。

未獨立重跑 `50f001cd` 的 Template CI；單測原文與第 255 行斷言對得上所述。

## 實作形狀

不要寫完整 diff。建議動這些檔、這些行為：

1. **`template/packages/create-nuxt-starter/src/assemble.ts`**
   - `copyTemplateCodexAssets`：刪掉對 `STARTER_ROOT/.codex`、`STARTER_ROOT/.agents` 的 `existsSync` + copy。
   - 新增 `projectCodexFromClaude(targetDir)`（名隨意）：
     - 從 `targetDir/.claude/skills` `copyDirectory` 到 `targetDir/.agents/skills`。
     - 從 `targetDir/.claude/settings.json` 寫出最小 `.codex/config.toml`（至少 `includeGitInstructions`、`enabledMcpjsonServers`、`enabledPlugins`；`features.hooks` 若 settings 有 hooks 就 true）。
     - 源 `.claude/skills` 不存在 → throw（選了 codex 時這是契約，對齊 `copyTemplateClaudeAssets` 的「源必在」）。
   - 呼叫點移出 step 7，放到 `copyClaudeCodeAssets` / `generateSettings` / `pruneRetiredSpectraAssets` **之後**，讓投影吃的是這個專案 prune 過、settings 寫好的 `.claude/`。
   - `copyAgentsInstructionFile` 維持（tracked `AGENTS.md`）。
   - 可選、仍屬薄投影：把 `.claude/commands/*.md` 投成 `.agents/skills/<name>/`（本機多出的那 11 個就是這層）。不要把 `.claude/rules` 原樣拷進 `.codex/rules`——clade 那邊是語義轉換，不是 copy。

2. **`template/packages/create-nuxt-starter/src/post-scaffold.ts`**
   - `runSyncToAgents`：有 clade shim 時維持覆寫（完整轉換仍是升級路徑）。
   - 找不到 shim：若這次 `agentTargets` 含 `codex`，**不要**再說「只用 Claude Code 可以忽略」。改成：assemble 薄投影已落地；完整 `.codex/rules` 等要本機有 clade 再跑。不含 `codex` 才維持現在的略過語氣。
   - 不要把「沒有 shim」升級成 throw——否則又變成 Codex 開箱綁 clade，打回原文 option 1 的障礙。

3. **`template/packages/create-nuxt-starter/test/scaffold.test.ts:247-256`**
   - 斷言保留。乾淨 clone 上 assemble 必須自己生出那兩個路徑。
   - 加一條：assemble 後的 `.codex/config.toml` **不含** starter 快照裡的 `local-supabase`，除非這次 features 含 `database`（對齊 `generateSettings` 第 1017-1018 行與 post-scaffold 882-885 的理由）。

4. **不要動** `template/.gitignore:81,87`、不要 `git add` 那兩棵樹、不要把它們加進 `scripts/audit-public-hygiene.mjs` 的 `SCAN_TARGETS`。

5. **`.claude/rules/starter-hygiene.md` §掃描範圍（約 123-126 行）**：掃描名單維持不掃。只改那句前提的意思（見下方拍板）。`scripts/audit-public-hygiene.mjs:32-34` 的註解同步改意思。

## 代價

- 兩條投影路徑會分叉：assemble 薄投影 ≠ 本機 `sync-to-codex` 的 167 個 `.codex` 檔（本機還有 `rules/` 122、`hooks/` 6、`agents/`）。Codex CLI 若硬依賴 `.codex/rules` 才能做事，薄投影仍「不完整」，只是從「靜默零檔」變成「有 skills + config.toml + AGENTS.md」。
- 要長期維護一份很小的 `settings.json` → `config.toml` mapper；clade 若改 TOML schema，這份會滯後。緩解：post-scaffold 有 shim 時覆寫。
- 維護者機器上的 `template/.codex/`、`template/.agents/` 繼續是可重生垃圾，gitignore 繼續擋。不要因為「本機有」就再寫回 copy 快照。

## 被否決的那幾條為什麼輸

- **原文 option 1（把 sync-to-codex 搬進 starter seed）**：要搬的是 2506 行加一串 `project-runtime-*`，且 user shim 第 11-12 行已經禁止這種會漂移的副本。完整轉換還依賴 post-scaffold 的 MCP strip 時序（post-scaffold.ts:882-885），塞進 assemble 會把 `local-supabase` 烤進沒選 database 的專案。
- **原文 option 2（收進版控）**：本機 12M+2.1M、1111+167 檔，是 `.claude/` 的第三份副本（`.cursor/` 13M 已經是付過代價的例外）。直接打臉 hygiene.md:123-126 與 audit-public-hygiene.mjs:32-34 的前提；不擴大 L3 掃描就是開洞。抄出去的還是 starter 快照，正是 882-885 行在防的錯 MCP。每次 clade propagate 會髒兩棵生成樹。
- **原文 option 3（靜默改大聲、不修功能）**：post-scaffold 1588-1604 已經在 warn，只是文案對選了 codex 的人是錯的。單測 255-256 斷言的是檔在，不是 throw；要讓 CI 綠就得改契約，TD 禁止用刪斷言混過去。選了 codex 的 degit 使用者仍然拿不到專案。這是診斷，不是修法。

## 需要 Charles 拍板的部分

**唯一的產品格，不是技術格：** Codex 開箱契約要到哪裡。

| 選項 | 意思 | 後果 |
| --- | --- | --- |
| A（本報告預設、對應 acceptance 點名的兩個檔） | assemble 保證 `.codex/config.toml` + `.agents/skills/**`（含 `commit/SKILL.md`）+ tracked `AGENTS.md`。`.codex/rules` 等完整語義轉換，有 clade 才升級。 | 不改 hygiene 掃描範圍；不搬 converter；CI 單測可綠。 |
| B | 選了 `codex` 就必須跟開發機跑過 `sync-to-codex` 一樣（`.codex/rules` 122 檔都要有）。 | **不要走 option 2。** 改成：`runSyncToAgents` 在 `agentTargets` 含 `codex` 且 shim/clade 缺失時 **throw**。單測不能只跑 assemble，要嘛 fixture 出投影、要嘛這條改測 throw。這等於宣告「Codex scaffold 需要本機 clade」。 |

預設 A，因為 TD-020 Acceptance 原文只點名那兩個路徑，且 `.agents/skills/commit` 從 tracked `.claude/skills` 拷是忠實映射。若你要 B，那是治理決定：Codex 這個 agent 選項是否允許沒有 clade 的使用者存在。

**文件追實況（不是分叉）：** `.claude/rules/starter-hygiene.md` §掃描範圍 123-126 行「兩者都在 `template/.gitignore` 內…不進版控 = **不會被 scaffold 帶走**」。落地 A 之後「不進版控」仍真，「不會被帶走」為假——輸出裡會有，但是生成的。意思改成：template git 樹仍不掃；scaffold 輸出由 assemble 從 `.claude/` 生成，不屬 L3 掃 template 的範圍。不要寫具體措辭，不要擴大 `SCAN_TARGETS`。`scripts/audit-public-hygiene.mjs:32-34` 註解同一句。

---

## 順帶：`scan_placeholders()` 的 `.claude/**` vs `vendor/**` / `scripts/**`

**vendor/scripts 不排除是有意的；`.claude/**` 排除在檔裡沒寫理由，是另一個 gate 的累加，推不出「clade 投影面都該排除」。**

`scripts/smoke-scaffold.sh:53-56` 註解寫明：`demo` 沒詞界會誤判 `scripts/claim-helper.ts:500` 與 `vendor/oxc-shared/preset.ts:107`，誤判混進真訊號會讓人整條略過；真訊號是 clade 投影未去識別化（TD-019）。他們用 `\bdemo\b` 修誤判，**刻意留下**對 `vendor/**`、`scripts/**` 的掃描。同函式只額外排除一支檔 `scripts/audit-clade-leak.mjs`（第 70 行），不是排除整棵 `scripts/`。TD-019 自己也寫了「NEVER 把 vendor/scripts 加進 exclude 來讓 CI 轉綠」。`.claude/**` 的 exclude（第 65、78 行）旁邊沒有對等理由；它比較像「agent 設定面已由 `audit-public-hygiene` / template hygiene 在管」的逐案累加。不能把這不對稱讀成原則，更不能用它當 TD-019 轉綠手段。

## Concerns

- 未獨立重跑 Template CI `50f001cd`；單測原文與第 255 行斷言對得上所述，但沒看 GH log。
- 未在乾淨 worktree（沒有 `template/.codex/` / `template/.agents/`）實跑 `assembleProject`；靜默 no-op 是從原始碼與 gitignore / `git ls-files` 推的。
- 未驗證 Codex CLI 在只有 `AGENTS.md` + `.codex/config.toml` + `.agents/skills`、沒有 `.codex/rules` 時能否當成可用專案。這格已放到拍板 A/B，不是另開結論。

DONE_WITH_CONCERNS
