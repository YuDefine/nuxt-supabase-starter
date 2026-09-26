# TD-008：validate-starter 維護工具落點計畫

## 決定與現況證據

**推薦移到 repo root `scripts/validate-starter-scaffold.mjs`。** TD-008 的驗收是 scaffold 輸出不含 `scripts/validate-starter.mjs`，也不保留指向它的 `validate:starter` command；本計畫只定實作，不把 TD-008 標為完成。

| 路徑 | 實際改動與收益 | 成本與風險 | 結論 |
| --- | --- | --- | --- |
| 移到 root | 將只服務維護倉的腳本搬出 seed；workflow 從 `template/` 工作目錄直接執行 `node ../scripts/validate-starter-scaffold.mjs`；移除 `template/package.json` 的維護 command。create-clean 與 scaffolder 都不會取得此 root 檔。 | 搬檔時須調整 `SCRIPT_DIR`、`TEMPLATE_ROOT`、`REPO_ROOT`，確保四種 preset 的 fixture 與 audit 路徑仍正確；workflow path filter 須改成 root 檔。 | **採用**。符合 `CLAUDE.md` 與 starter hygiene 對 meta 工具的落點定義，改動集中。 |
| 留在 template、在輸出剝除 | strip manifest 可宣告移除 `scripts/validate-starter.mjs`，同時保留維護倉的 `pnpm validate:starter`。 | `template/package.json` 的 command 仍須對 create-clean 輸出做 rewrite；scaffolder 的 `generatePackageJson()` 由 `templates/base/package.json` 產生 package，與 create-clean 使用不同來源。現有 `applyStripManifest()` 只有 path/glob 刪除，`scripts/create-clean.sh` 又有獨立的 manifest parser，須設計、驗證兩套 package script rewrite 契約及 dry-run。 | 不採用；為一個維護 command 擴大 manifest schema 與兩條輸出管線。 |

原始碼查證：`template/packages/create-nuxt-starter/src/assemble.ts` 的 `copyScripts()` 會複製整棵 `template/scripts/`，最後才呼叫 `applyStripManifest()`；`strip-manifest.ts` 目前只刪路徑；`template/presets/_base/strip-manifest.json` 沒有 validate-starter 條目；`template/package.json` 有 `validate:starter`，scaffolder 的 base package 則沒有。`.github/workflows/validate-starter.yml` 目前以 `template/` 為工作目錄跑 `vp run validate:starter`，其 path filter 也只包含 template 內的舊腳本。`scripts/audit-template-hygiene.sh` 雖已有 `maintenance-script-misplacement`，目前的內容關鍵字沒有穩定辨認這支腳本，fixture test 也未覆蓋它。

## 實作順序與 task → file

先讓 TD-017 的 [draft PR #5](https://github.com/YuDefine/nuxt-supabase-starter/pull/5) 完成自己的審查與落地；它正在改 `template/scripts/validate-starter.mjs` 的 fixture 清理與 `--keep`。TD-008 實作者從包含該 PR 的最新 `origin/main` 開始，**搬移 TD-017 完整版本**，不得用本計畫時點的舊版本蓋回去。若 PR #5 尚未落地，TD-008 的程式實作須等它完成或由 coordinator 安排同一整合序列；本計畫 PR 可先獨立審查。搬移後驗證預設會清掉 fixture，`--keep` 仍保留 fixture。

| Task | 檔案 | 完成判準 |
| --- | --- | --- |
| 搬移並修正相對路徑 | `template/scripts/validate-starter.mjs` → `scripts/validate-starter-scaffold.mjs` | `SCRIPT_DIR` 位於 root `scripts/`，`REPO_ROOT` 是 repo root，`TEMPLATE_ROOT` 是 `root/template`；`CREATE_PACKAGE_DIR`、`FIXTURE_ROOT`、vendored audit 路徑仍有效；保留 TD-017 的清理與 `--keep`。 |
| 改 CI 入口與觸發條件 | `.github/workflows/validate-starter.yml` | `template/` working-directory 下以 `node ../scripts/validate-starter-scaffold.mjs` 跑四種 preset；PR/push path filter 加 root 新檔並移除舊檔，保留 package、preset、scaffolder 與 workflow 的觸發路徑。 |
| 移除公開維護 command | `template/package.json` | 刪除 `validate:starter`；不更動 `verify:starter`。scaffolder 的 `templates/base/package.json` 原本沒有此 command，仍以輸出斷言驗證。 |
| 防止維護腳本回流 | `scripts/audit-template-hygiene.sh`、`scripts/audit-template-hygiene.test.sh` | `maintenance-script-misplacement` 能攔下 `template/scripts/validate-starter.mjs` 的重現 fixture，且一般 consumer runtime script 與 `CLADE:VENDOR-SCRIPT` 仍通過。 |
| 驗證雙輸出路徑 | `template/packages/create-nuxt-starter/test/strip-manifest.test.ts`，及既有 scaffold test 中最窄的 package/script 斷言 | create-clean 依既有 manifest 行為，scaffolder 輸出均不含舊檔與 `validate:starter`；不擴充 manifest schema。若需要加 scaffold 斷言，修改既有 `template/packages/create-nuxt-starter/test/scaffold.test.ts`。 |

### Hygiene audit fixture 設計

在 `scripts/audit-template-hygiene.test.sh` 用 `new_fixture` 建立 `template/scripts/validate-starter.mjs`，內容含 repo 上層 `REPO_ROOT`、`packages/create-nuxt-starter` 或 `temp/validate-starter` 的維護用途特徵，**避免只靠既有 `starter hygiene` 等字眼讓測試碰巧過**。`run_audit` 應回非零、輸出 `[Starter Hygiene] maintenance-script-misplacement 不通過` 及檔案路徑；fixture 不放真 secret。再放一個 scaffold 後仍有用的普通 `template/scripts/` fixture 作陰性例；保留既有 `CLADE:VENDOR-SCRIPT` 例外。掃描規則只辨認具體維護用途，避免把 `verify-starter.mjs` 等 consumer runtime 腳本擋掉。完整樹的 audit 在腳本搬出後應通過。

## 驗收指令（TD-008 程式實作時）

從 repo root 執行：

```bash
bash scripts/audit-template-hygiene.test.sh
bash scripts/audit-template-hygiene.sh
cd template && vp test run packages/create-nuxt-starter/test/strip-manifest.test.ts
cd template && pnpm typecheck
cd template && vp check
cd template && node ../scripts/validate-starter-scaffold.mjs
```

上述 `cd template &&` 是各自獨立指令，不應在單一 shell 連跑後再重複進入 template。若擴充 scaffold test，另跑該測試檔的窄範圍測試。以驗證腳本完成後的 `template/temp/validate-starter/` 不存在、`--keep` 後存在，檢查 TD-017 行為；對 create-clean 與至少一個 preset scaffold 輸出的 `scripts/validate-starter.mjs` 與 `package.json.scripts['validate:starter']` 都斷言不存在。PR CI 的 Validate Starter workflow 再驗四種 preset simulation；本機證據與 CI 證據分列。

本 repo 沒有 `tsconfig.clade.json`；型別閘使用 `template/` 的 `pnpm typecheck`，不把別 repo 的 `npx tsc -p tsconfig.clade.json --noEmit` 當可執行驗收。廣範圍回歸由 PR CI 執行。

## 交接：剩餘實作與本計畫證據

本次 worker 只擁有本 task 與 `docs/tech-debt.md` 的 TD-008 條目；上表的程式碼、workflow、manifest 與 test 檔均未修改。下一位實作者須由 coordinator 另行授權並宣告上表的檔案所有權，先確認 TD-017 PR #5 已落地，再照 task→file 表完成 TD-008；不得把本計畫 PR 當作 TD-008 的程式修復或驗收通過。

計畫階段本機證據（2026-09-26）：`bash scripts/audit-template-hygiene.test.sh` 8/8 PASS；`bash scripts/audit-template-hygiene.sh` PASS（目前 template 無 finding）；`cd template && vp test run packages/create-nuxt-starter/test/strip-manifest.test.ts` 6/6 PASS；`cd template && vp check` PASS（286 格式、253 lint 檔）；`cd template && pnpm typecheck` PASS。這些只驗證目前基線及文件改動，**不**代表上述新 fixture 或搬移後 workflow 已驗證。先前未安裝依賴時 strip-manifest 測試無法啟動；以 `vp install --frozen-lockfile` 安裝後重跑通過。PR CI 結果另記，不與本機結果合併。
