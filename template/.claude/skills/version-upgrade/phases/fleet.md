# Phase F — 單一套件 × 全 fleet（`release.fleet`、`rollback.fleet`）

一個 release → 命中的 consumer 全部升版 + 套用 BC 修正 + 各自 commit。主線負責 fetch / 解析 / 掃描 / 編排 / 聚合；每個命中 consumer 一個長駐 subagent 在自己 worktree 內跑 Phase C–D 的 changelog-aware 子流程。toolchain（pnpm / Node 自身）走 `phases/toolchain.md`（Phase T，沿用本檔 F.1–F.8）。fleet 每個 consumer 各補一輪落後不是本 Phase，是 SKILL.md 的 Phase F-routine。

**不適用**：單 consumer 升版（`release.consumer`，走 Phase B）、framework major migration（`out.work-route`）、無公開 changelog 的內部套件、一次升多個套件（`rules/fleet准入與釘版判準.md` Rule 1（Fleet carve-out 准入 SoT））。

**`rollback.fleet`**：target＝上一個好版（使用者指定），跳過 F.1.3 discovery 與 F.2 的 BC 解析，准入依據改用上游 issue／advisory（`rules/fleet准入與釘版判準.md` Rule 1 的回退條款）；F.3 起照常。

## Step F.1 — Preflight clade-only + 解析觸發 input

### F.1.1 確認 cwd 是 clade home

```bash
pwd                                          # MUST end with /offline/clade
test -f registry/consumers.json -a -f consumers.local
```

任一不成立 → STOP：Phase F 必須在 clade home 跑（需要 `consumers.local` 的本機 consumer 路徑清單）。

### F.1.2 解析觸發 input

`mode_route.py` 已判出 `release.fleet`。release URL：記 release_url，從 release notes 的安裝範例驗證 npm pkg name（`nuxt/ui` repo → `@nuxt/ui` pkg）；`<pkg>@<ver>`／`<pkg> v<ver>`／`<pkg> <ver>`：拆出 pkg + version，release_url 用 discovery；純套件名：discovery 補 target + release URL。toolchain（`toolchain.fleet`）**MUST** 先讀 `phases/toolchain.md` 再進 Step F.2。

### F.1.3 Discovery — 無腦升級自動補欄位

當缺 `target_version` 或缺 `release_url` 時，跑：

```bash
node vendor/scripts/dep-fleet-discover.ts --pkg "<pkg>" [--version <ver>]
```

輸出 `{pkg, latest_version, target_version, release_url, repo_url, homepage, source, held_back_by_release_age, release_age_cutoff_minutes, release_age_checked}`。沒帶 `--version` 時 `target_version` 是「發佈已滿 `minimumReleaseAge`（`pnpm config get minimumReleaseAge`，缺省 1440 分鐘）的最高穩定版」，不是 `dist-tags.latest`——否則 consumer 端 `pnpm add` 會被 release-age 擋下（G8）。沒有任何版本滿 cutoff → `target_version: null`＋`note`、exit 3：STOP，回報 user 等版本滿齡或明確帶 `--version`。找不到 changelog（release tag 與 `CHANGELOG.md` 都失敗）→ STOP，請 user 手動貼 release URL。

沒帶版號就是要 latest，直接 discovery，**NEVER** 反問 target 版本。

**MUST** 在進入 Step F.2 之前把以下五個值都拍板：`<pkg>` / `<target_version>` / `<release_url>` / `<pkg-slug>`（檔名安全字串，例：`@nuxt/ui` → `nuxt-ui`） / 觸發語境（user 原話）。

## Step F.2 — Fetch + 解析 changelog

### F.2.1 Fetch release notes

```bash
gh release view v<target_version> --repo <owner>/<repo> --json body,name,tagName,publishedAt > /tmp/dep-fleet-release-<pkg-slug>.json
```

`gh` 不行才依 `web-search` external-web row 抓公開 changelog。只讀 release notes；issues / PRs 是 research 派工（`templates/research.md`）的事。

### F.2.2 LLM 解析 release notes → 結構化

直接讀 release body 解析，輸出**統一格式**：

```jsonc
{
  "pkg": "@nuxt/ui",
  "to_version": "4.8.0",
  "release_url": "https://github.com/nuxt/ui/releases/tag/v4.8.0",
  "breaking_changes": [
    {
      "category": "rename | removal | signature | config-schema | peer-bump",
      "description": "<一句話人話>",
      "affected_apis": ["<symbol1>"],
      "before": "<code snippet>",
      "after": "<code snippet>"
    }
  ],
  "features": [{ "description": "...", "opt_in": true }],
  "deprecations": [{ "api": "<name>", "replacement": "<name>" }]
}
```

READ 若要寫解析守則以外的欄位或判 BC category，讀取 `rules/changelog分類判準.md` Rule 1（category 五選一、`toolchain-config`、`affected_apis` 可搜尋、沒有 BC → fast path）。

寫到 `/tmp/dep-fleet-changelog-<pkg-slug>.json`。

### F.2.3 Carve-out 條件自查

**MUST** 逐條自查 `rules/fleet准入與釘版判準.md` Rule 1（Fleet carve-out 准入 SoT），另加一條：

- ✅ 若 sweep 會重寫 hit consumer `package.json` 的 `test` / `lint` / `typecheck` script（換工具 / 改命令）：原本有 `.clade/bin/clade-gate run <gate> --` 前綴的，**MUST** 只換 `--` 後面的內層命令、保留前綴（per [[test-scripts]] § MUST：重寫已包 clade-gate 的 script 時保留前綴）。主線在 land 前 `git -C <consumer-path> show <commit_sha> -- package.json` 抽查前綴沒被整行覆蓋

任一條不滿足 → STOP，回 user 解釋哪條沒過。

## Step F.3 — Fleet scan 命中 consumer

```bash
node vendor/scripts/dep-fleet-scan.ts --pkg "<pkg>" --target "<target_version>" > /tmp/dep-fleet-scan-<pkg-slug>.json
```

**Phase T 改用**（其餘 Step F.3 判定相同）：

```bash
node vendor/scripts/dep-fleet-scan.ts --toolchain "<name>" --target "<target_version>" > /tmp/dep-fleet-scan-<pkg-slug>.json
```

挑出 `found: true` 的當作 hit consumer 名單。

Phase T 的 `version_gap: "absent"`（沒寫 `packageManager`）是要修的 finding，plan table 顯示「unpinned → 補欄位」，**NEVER** 讀成 miss。

**Skip 條件**：

- `business_activity: "paused"` → skip + 列入 plan 顯示為「skipped: paused」
- `version_gap: "same"` → skip + 列入 plan 顯示為「already at target」
- `version_gap: "unknown"` 且 manifest 是 `catalog:` 但 catalog 解析不到 → runtime-native question interface 問是否 skip

### F.3.x — 0-sweep fast path（無事可做就早早結束）

算完 `hit_consumers - skipped`：

- **= 0** → 跳過 Step F.4–F.8，只輸出 No-op summary 並結束：

  ```
  ## version-upgrade · fleet no-op（<YYYY-MM-DD HH:MM>）

  Target: <pkg>@<target_version>
  Release: <release_url>
  Sweep 命中：0 個 consumer 需要動

  | consumer | manifest | skip reason |
  | --- | --- | --- |
  | <id> | <spec> | already at target | paused | catalog unresolved |

  無事可做。
  ```

- **≥ 1** → Step F.4。

## Step F.4 — Callsite 預掃（codebase-memory-mcp）

> Phase T 跳過本步，改跑 Step T.3。

### F.4.1 確認 consumer 已 indexed

`<project>` 是 codebase-memory-mcp 的 project name（絕對路徑去開頭 `/`、其餘 `/` 換 `-`，前綴隨平台而異）。**MUST** 用 `list_projects()` 依 `root_path` 實查，**NEVER** 憑前綴猜。`index_status(project="<project>")` 未 index 就 `index_repository(repo_path=<consumer_path>, mode="fast")`。

### F.4.2 搜 callsite

對每個 `<symbol>` 跑（**project 用 normalize 後形式**）：

```
mcp__codebase-memory-mcp__search_graph(name_pattern=<symbol>, project="<project>", path_filter="^(app|server|components|composables|utils|pages|layouts)/")
mcp__codebase-memory-mcp__search_code(pattern=<symbol>, project="<project>", path_filter="\\.(vue|ts|tsx|js)$")
```

docs-only 命中（`.agents/skills/**`、`docs/`、`README.md`）不進 code mod 範圍。MCP 沒找到就 `rg -n "<symbol>" --type vue --type ts <consumer_path>` 一次。callsite 0 的 BC 不刪，prompt 標「callsites: 0（請 pi 自行 grep 確認）」。

### F.4.3 寫 per-consumer brief 到 `/tmp/dep-fleet-brief-<pkg-slug>-<consumer-id>.json`

每個 hit consumer 一份 brief，schema：

```json
{
  "pkg": "@nuxt/ui",
  "from_version": "^4.7.1",
  "to_version": "4.8.0",
  "consumer_path": "<consumer 絕對路徑，取自 clade 的 consumers.local>",
  "consumer_id": "<consumer-id>",
  "workflow_model": "trunk-based",
  "release_url": "https://github.com/nuxt/ui/releases/tag/v4.8.0",
  "field": "dependencies",
  "dep_or_devdep": "dep",
  "version_gap": "minor",
  "breaking_changes": [...],
  "features": [...],
  "deprecations": [...],
  "callsites": [{ "file": "app/components/Foo.vue", "line": 42, "symbol": "UInputMenu" }]
}
```

### F.4.5 無 BC fast path

沒有 BC 時 brief 照寫（`breaking_changes` / `callsites` 為空），subagent 等同跑 Phase C 的 minor / patch 流程。

## Step F.5 — 一次性 plan gate（runtime-native question interface）

把 Step F.2–F.4 的結果寫進計畫檔（讀取 `templates/upgrade-plan.md` 的 fleet 段，落點照 SKILL.md Step 0.3）：每個 hit consumer 一列、skipped 也列；`dep-fleet-discover.ts` 的 `held_back_by_release_age: true` 時在表頭寫出被擋下的 `latest_version`。計畫檔就是給 user 拍板的 plan table。

runtime-native question interface 提供四個選項：

```
[1] 全部 sweep（並行 fan-out N 個 subagent）
[2] 先挑一個試（指定 consumer_id 跑 smoke，回報後再決定剩下）
[3] 改 BC 解析（user 想增刪某條 BC clause）→ 回 Step F.2.2
[4] 中止
```

**MUST 等 user 選**，**NEVER** 主線自決定全部 sweep。

## Step F.6 — 並行 fan-out 長駐 subagent

每個 hit consumer 一個**長駐** runtime session（具名 owner，回報契約見 [[agent-routing.dispatch-execution]] § Subagent 回報契約），thin brief 如下。

### F.6.1 Subagent brief

讀取 `templates/fleet-subagent-brief.md`，每個 hit consumer 代入一份；brief JSON 多帶 `plan_path`（本輪計畫檔，見 Step F.5）。

### F.6.2 同時派出多個 named runtime session

**MUST** 在同一個 dispatch turn 派出所有 hit consumer 的 session（owner 建議 `fleet-<consumer-id>`），後續沿用當前 runtime 的 continuation transport。

## Step F.7 — 主線 watch + 聚合

### F.7.1 收到 subagent 完成通知

依 `FLEET_SUBAGENT_RESULT` 分流：

| 結果 | 處理 |
| --- | --- |
| SUCCESS | 記錄到 summary；來源 worktree 與 checkpoint 保留，等 Step F.8 結批 |
| PARTIAL | 升版成功但有部分 callsite 沒套用 BC → 列入「需 user 確認」區 |
| FAILURE | 升版失敗 → 列入「未 land」區，worktree 保留供 user 手動處理 |

**MUST** 等全部 subagent 回報才進 Step F.8，中途不 push 任何 consumer。

## Step F.8 — Fleet push gate + 摘要

### F.8.1 顯示聚合 plan

```
## version-upgrade · fleet 聚合結果

| consumer | 狀態 | staged files | commit msg | wt path |
```

### F.8.2 runtime-native question interface fleet push gate

```
[1] 全部 OK 的 consumer 一起 commit + push
[2] 我要先 review 一兩個 consumer 的 diff
[3] 只 push 某幾個 consumer（指定 consumer_id）
[4] 都先停下，我手動 review 後再決定（保留來源 checkpoint）
```

**MUST 等 user 選**。**NEVER** 主線自決定全部 push。

### F.8.3 按 user 選擇執行

每個 consumer 是獨立 repo，不能跨 repo 混一批。依上一步 user 的既有選擇執行，不重問已回答的授權：

- **[1]／[3]**：只對獲授權 consumer 驗 worker checkpoint 與寫入權交接，依 commit skill `batch.md` 登記 ready、以 `manual` 結批，在隔離 integration 跑一次完整 `/commit`，依該 consumer trunk／PR 與發布 gates 落地、push、cleanup。建議 message 仍需 commitlint 通過。
- **[2]／[4]**：保留來源並展示 source diff，不提前 staged 到 main；待既有 review 決策後續跑。
- 來源 HEAD／驗收證據改變或仍有未保存工作時，保留且回報該 consumer blocker，不宣稱 pushed。只有實際確認遠端包含正式 commits 才列 Pushed。

### F.8.4 摘要彙報

```markdown
## version-upgrade · fleet 摘要（<YYYY-MM-DD HH:MM>）

**Sweep**：`<pkg>` `<from>` → `<target_version>`
**Release**：<release_url>
**BC clauses**：<N> 條套用、<M> 條無 callsite

### ✅ Pushed (P) / ⏸️ Checkpoint retained (S) / ❌ Failed (F) / ⏭️ Skipped (K)

[tables...]
```

# 禁止事項（Phase F／T 限定）

- **NEVER** 主線替 subagent 改 worktree 內檔——該 consumer 的改動只由它的 subagent 產生，主線只收回報與結批
