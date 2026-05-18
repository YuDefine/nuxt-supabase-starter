## 1. Validate-starter Relocation (跨層)

- [ ] 1.1 (root) 新建 `../.claude/commands/validate-starter.md` — 內容對應 `template/.claude/commands/validate-starter.md`，但**移除** `LOCKED — managed by clade` marker（root 端 command 由 starter 維護者自治，不是 clade-managed）
- [ ] 1.2 (root) 驗證 `../scripts/validate-starter.sh` 從 root cwd 可直接執行：`bash scripts/validate-starter.sh --help` 或同等 dry-run 不報錯
- [ ] 1.3 (template) 刪除 `.claude/commands/validate-starter.md`
- [ ] 1.4 (template) 刪除 `.agents/skills/validate-starter/`（整個目錄）
- [ ] 1.5 (template) 跑 `node ~/.claude/scripts/sync-to-agents.mjs` 重投影，驗證 `.codex/` 與 `AGENTS.md` 內無殘留 validate-starter 引用
- [ ] 1.6 (root) 在 root `package.json` `scripts` 確認 `validate-starter` script 仍指向 `bash scripts/validate-starter.sh`（不該指向 `template/...`）

## 2. Audit Script + Allowlist (root)

- [ ] 2.1 (root) 建 `scripts/lib/public-hygiene-allowlist.json`，含本 change design.md 內 9 條 commands 的 allowlist（8 條 keep + validate-starter 標 relocate）；skills 段為空 placeholder + comment 註記由後續 change 填
- [ ] 2.2 (root) 建 `scripts/audit-public-hygiene.mjs`：
  - 解析 `template/.claude/.hub-state.json` 取 clade-managed checksums 清單
  - 掃 `template/.claude/commands/` + `template/.agents/skills/` + `template/.codex/`，每個檔分類：clade-managed / starter-owned-keep / starter-owned-not-in-allowlist / starter-owned-deny
  - 支援 `--json` / `--strict` / `--report-only` flag
  - default exit 1 if violation；`--report-only` exit 0
- [ ] 2.3 (root) `package.json` 加 `"audit:public-hygiene": "node scripts/audit-public-hygiene.mjs"`
- [ ] 2.4 (root) 驗證跑 `pnpm audit:public-hygiene` 0 violation（前提：task 1 完成、validate-starter 已 relocate）

## 3. CI Integration (root)

- [ ] 3.1 (root) 確認既有 `.github/workflows/` 內 audit / lint workflow 結構，找適合的 job 加 step（或新建 `audit.yml`）
- [ ] 3.2 (root) 加 step：`run: pnpm audit:public-hygiene`，置於 typecheck / lint step 之後
- [ ] 3.3 (root) 驗證 push 後 GitHub Actions 該 step 跑過且 pass

## 4. starter-hygiene.md 規則擴充 (root)

- [ ] 4.1 (root) `../.claude/rules/starter-hygiene.md` 新增 `## L3 Commands Hygiene` section：
  - 邊界定義（clade-managed vs starter-owned，hub-state.json 為 SoT）
  - 新加 starter-owned command 必須走 ceremony（提 PR + 補 allowlist + 更新 audit script test fixture）
  - bypass：不允許，例外要 spec change
- [ ] 4.2 (root) 規則檔末尾加 Reporting Format 對應 entry（`[Starter Hygiene] public-hygiene-unaudited-command`）
- [ ] 4.3 (root) 驗證 rule 檔在 root cwd 可被 Read，路徑無誤

## 5. Documentation Sync (root + template)

- [ ] 5.1 (root) `README.md` 補一節「Public hygiene policy」說明 starter `.claude/` 三層治理（hub:sync / plugin marketplace / starter-owned）邊界，引用 `starter-hygiene.md`
- [ ] 5.2 (root) `CLAUDE.md` 「Meta vs Template 邊界」表格補一列「L3 commands hygiene」對應 `starter-public-hygiene-commands` change 的處理範圍
- [ ] 5.3 (template) **不動** — template/CLAUDE.md 內容跟此 hygiene 邊界無關（template 是 scaffold 出去的內容，講的是 consumer 怎麼用 starter，不是 maintainer 怎麼治理 hygiene）

## 6. Test Fixtures (root)

- [ ] 6.1 (root) `scripts/audit-public-hygiene.test.sh`（對標既有 `scripts/audit-template-hygiene.test.sh`）：
  - 建 fake `template/.claude/commands/foo-unaudited.md`（不在 allowlist）→ 驗證 audit 報 warning
  - 建 fake `template/.claude/commands/validate-starter.md` 殘留 → 驗證 audit 報 error
  - 建 fake `template/.claude/.hub-state.json` 含 entry → 驗證 audit skip
  - 驗證 `--json` output schema 結構
- [ ] 6.2 (root) `test/` 或 `scripts/` 內加 README / inline comment 描述 audit script 測試方式

## 7. 人工檢查

- [ ] #1 [verify:api] (root) `bash scripts/validate-starter.sh --help` 或同等 dry-run 從 root cwd 執行 → exit 0 / 顯示 usage
- [ ] #2 [verify:api] (root) `pnpm audit:public-hygiene` 從 root cwd 執行 → exit 0 + 報告 9 conditions（8 keep allowlist + 1 relocate cleared）
- [ ] #3 [verify:api] (root) `pnpm audit:public-hygiene --json` 從 root cwd 執行 → 輸出合法 JSON 含 `clade_managed_count` / `starter_owned_keep_count` / `violations` 三欄
- [ ] #4 [verify:ui] (root) GitHub Actions PR 跑 `audit:public-hygiene` step → 綠燈 screenshot 證據
- [ ] #5 [discuss] (root) 跟使用者確認 8 個 keep as-is commands 之中是否有任何條 disposition 該改成 sanitize / relocate / remove（review design.md 內表格）
- [ ] #6 [discuss] (root) 跟使用者確認 `audit-public-hygiene.mjs` strict mode 預設行為（default error vs default warning）— 影響 future allowlist 演化速度
- [ ] #7 [review:ui] (root) 在乾淨環境 clone starter repo → 跑 `pnpm create nuxt-supabase-starter test-app --preset baseline` → 確認 test-app/.claude/commands/ 不含 `validate-starter`，且其他 8 條 keep commands 仍存在
