## 1. Validate-starter Relocation (跨層)

- [x] 1.1 (root) 新建 `../.claude/commands/validate-starter.md` — 內容改寫為從 root cwd 驗證 `template/` seed（原 template 版本假設 cwd 就是 starter，clone `.` 會 clone 到 meta repo）；無 `LOCKED — managed by clade` marker
- [x] 1.2 (root) 驗證 `../scripts/validate-starter.sh` 從 root cwd 可直接執行 — 見下方 verify #1
- [x] 1.3 (template) 刪除 `.claude/commands/validate-starter.md`
- [x] 1.4 (template) 刪除 `.agents/skills/validate-starter/`（整個目錄）
- [x] 1.5 (template) **偏離**：`sync-to-agents.mjs` 在本機與 clade 都不存在，`.agents/` 的 LOCKED marker 指向的是 `sync-to-codex`。改為手動刪除投影並實測殘留：`.codex/agents/` 內本來就沒有 validate-starter；`AGENTS.md` 內 0 個引用；另外找到 design 未列出的 `.cursor/commands/validate-starter.md`（tracked，會被 scaffold 帶走）一併刪除
- [x] 1.6 (root) **偏離**：root repo 沒有 `package.json`（meta 層刻意不建 npm surface，與 `scripts/audit-template-hygiene.sh` 一致靠直接叫 script）。`validate-starter` 的呼叫方式維持 `bash scripts/validate-starter.sh`，已寫進 root command 與 README

## 2. Audit Script + Allowlist (root)

- [x] 2.1 (root) 建 `scripts/lib/public-hygiene-allowlist.json`：8 條 `starter-owned-keep`、`validate-starter` 列 `starter-owned-relocate`、`starter-owned-deny` 空；skills 段為空 placeholder + comment 註記由 `starter-public-hygiene-skills` 填
- [x] 2.2 (root) 建 `scripts/audit-public-hygiene.mjs`：
  - 解析 `template/.claude/.hub-state.json` 的 `checksums` 取 clade-managed 名單（commands / skills 兩類）
  - **偏離掃描範圍**：掃 `template/.claude/commands`、`.claude/skills`、`.cursor/commands`、`.cursor/skills`。design 原列的 `.agents/` 與 `.codex/` **不掃** — 兩者都在 `template/.gitignore`（line 87 / 81），是 `sync-to-codex` 的可重生投影，不進版控 = 不會被 scaffold 帶走；`.cursor/` 相反是 tracked 投影，會被帶走，必須掃
  - `.cursor/` 把 clade-managed skill 投影成 `cursor-<name>.md` 形式的 command，比對時要同時查 commands 與 skills 兩份名單（否則 12 個 spectra / commit 投影會誤報成未審查）
  - 支援 `--json` / `--strict` / `--report-only` / `--root` flag
  - default exit 1 if violation；`--report-only` exit 0
- [x] 2.3 (root) **偏離**：root 無 `package.json`，改為 CI 與文件直接叫 `node scripts/audit-public-hygiene.mjs`（與 `audit-template-hygiene.sh` 的既有慣例一致，不為單一 script 新建 npm surface）
- [x] 2.4 (root) 驗證跑 audit → 0 violation — 見下方 verify #2

## 3. CI Integration (root)

- [x] 3.1 (root) 既有 4 支 workflow（`template-ci` / `template-e2e` / `scaffold-smoke` / `validate-starter`）的 path filter 都不涵蓋 `template/.claude/**`，改新建 `audit` 專用 workflow
- [x] 3.2 (root) 新建 `../.github/workflows/public-hygiene.yml`：PR / push main / workflow_dispatch 觸發，path filter 限 `template/.claude/**`、`template/.cursor/**`、audit script 與 allowlist 本身
- [x] 3.3 (root) 驗證 push 後 GitHub Actions 該 workflow 跑過且 pass — 見下方 verify #4

## 4. starter-hygiene.md 規則擴充 (root)

- [x] 4.1 (root) `../.claude/rules/starter-hygiene.md` 新增 `## L3 Commands Hygiene`：三層治理表（L1 hub:sync / L2 plugin marketplace / L3 starter-owned）、三種 disposition 的 audit 行為、新增 command 的三步 ceremony、掃描範圍為何排除 `.agents/` 與 `.codex/`、bypass 不允許
- [x] 4.2 (root) Reporting Format 表格補三個 check name：`public-hygiene-unaudited-command`、`public-hygiene-relocated-artifact`、`public-hygiene-denied-artifact`
- [x] 4.3 (root) 驗證 rule 檔在 root cwd 可被 Read，路徑無誤

## 5. Documentation Sync (root + template)

- [x] 5.1 (root) `README.md` 新增 `## Public hygiene policy`：三層治理表 + L3 審查原則 + 三條可跑的命令 + 連到 `starter-hygiene.md`
- [x] 5.2 (root) `CLAUDE.md` 「Meta vs Template 邊界」表格補「要新增 / 移除 starter-owned slash command」一列
- [x] 5.3 (template) 不動 — 確認 `template/CLAUDE.md` 講的是 consumer 怎麼用 starter，與 maintainer hygiene 邊界無關

## 6. Test Fixtures (root)

- [x] 6.1 (root) `../scripts/audit-public-hygiene.test.sh`（對標既有 `audit-template-hygiene.test.sh`），6 個 case：
  - allowlist 內的 command → pass、`starter_owned_keep_count` 正確
  - 未在 allowlist 的新 command → warning + default exit 0；`--strict` exit 1
  - `validate-starter` 殘留 → violation + exit 1，報告含四段格式；`--report-only` exit 0
  - hub-state 列出的 clade-managed 檔（含 `.cursor/` 的 `cursor-` 前綴投影）被跳過
  - `--json` 輸出含全部 6 個文件化欄位、`violations` / `warnings` 為陣列
  - 缺 `.hub-state.json` → 不 crash，`hub_state_found` 為 false
- [x] 6.2 (root) test script header 寫明用途與 usage；README `## Public hygiene policy` 一併列出測試命令

## 7. 人工檢查

- [x] #1 [verify:api] (root) `bash scripts/validate-starter.sh` 從 root cwd 執行 → 正常跑完並輸出報告（40 PASS / 4 FAIL，exit 1）。4 個 FAIL 全是**開發中 repo 的既有狀態**、與本 change 無關：`docs/templates/.github/workflows/ci.yml` 缺檔、`openspec/changes/archive/` 26 檔、2 個 active change dir、`.spectra/` 6 檔 — 後三者是 clean baseline 檢查，只對 scaffold 輸出或 release 前的乾淨樹有意義。Phase 1 的 `.claude/commands` 結構檢查仍 PASS，證明刪掉 `validate-starter.md` 沒破壞 seed 結構
- [x] #2 [verify:api] (root) `node scripts/audit-public-hygiene.mjs` → exit 0、`PASS (0 violations, 30 warnings)`；clade-managed 41、starter-owned allowed 16（8 條 keep × `.claude` + `.cursor` 兩個 surface）、unaudited 30（全部落在 `.claude/skills/`，commands 層 0 條未審查）
- [x] #3 [verify:api] (root) `node scripts/audit-public-hygiene.mjs --json` → 合法 JSON，含 `clade_managed_count` / `starter_owned_keep_count` / `starter_owned_unaudited_count` / `hub_state_found` / `violations` / `warnings`
- [x] #4 [verify:ui] (root) GitHub Actions run [32184934412](https://github.com/YuDefine/nuxt-supabase-starter/actions/runs/32184934412) → `✓ L3 Commands / Skills Allowlist Gate in 10s`，log 內 `Public hygiene audit result: PASS (0 violations, 24 warnings)`。CI 的 unaudited 是 24 而本機是 30，差額是 `template/.gitignore` 內那幾個 `.claude/skills/` 目錄（`create-evlog-*` / `document-writer` / `nuxt-content` / `nuxt-modules` / `nuxthub` / `review-logging-patterns` / `ts-library`）不在 CI checkout 內 — CI 的數字才是「實際會被 scaffold 帶走」的量
- [x] #5 [discuss] (root) 已確認：8 條全部 keep as-is（canary / freeze / unfreeze / guard / retro / second-opinion / ship / sprint-status），allowlist 維持現狀
- [x] #6 [discuss] (root) 已確認：unaudited 預設 warning、`--strict` 才 fail；只有 relocated / denied 讓 default 走 exit 1。等 `starter-public-hygiene-skills` 把 skills 段填完，再把 CI 那行改成 `--strict`，L3 gate 才成為完整 ratchet — 已寫進 `.claude/rules/starter-hygiene.md` § L3 Commands Hygiene
- [x] #7 [review:ui] (root) 實跑 scaffolder：`node template/packages/create-nuxt-starter/dist/cli.js test-app -y --no-install --no-register-consumer --no-clone-clade --agents claude-code,cursor` → 輸出的 `test-app/.claude/commands/` 共 10 檔，**不含** `validate-starter`；`.claude` / `.cursor` 內 `validate-starter` 引用 0 筆；8 條 keep commands 全部存在

## 8. 後續（不在本 change scope）

- `template/scripts/validate-starter.mjs` 是 starter 維護者的 scaffold simulation tool（引用 `REPO_ROOT`、`packages/create-nuxt-starter`），卻放在會被 scaffold 帶走的 `template/scripts/`，屬 `maintenance-script-misplacement`。本 change scope 鎖在 L3 commands 層，未處理；已登記為 tech debt
- `template/.claude/skills/` 30 個 starter-owned skills 尚未逐條審查，audit 目前只出 warning；歸 `starter-public-hygiene-skills`
