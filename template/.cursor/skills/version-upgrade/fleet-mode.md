# § Fleet mode — Single pkg, multi-consumer sweep

一個 release → 命中的 consumer 全部升版 + 套用 BC 修正 + 各自 commit。主線負責 fetch / 解析 / 掃描 / 編排 / 聚合；每個命中 consumer 一個長駐 subagent 在自己 worktree 內跑 Outdated mode 的 changelog-aware 子流程。toolchain（pnpm / Node 自身）走本檔末 § Toolchain sweep 分支。

**不適用**：單 consumer 升版（走 Outdated mode）、framework major migration、無公開 changelog 的內部套件、一次升多個套件（SKILL.md § Fleet mode carve-out 准入（SoT））。

## Step F.1 — Preflight clade-only + 解析觸發 input

### F.1.1 確認 cwd 是 clade home

```bash
pwd                                          # MUST end with /offline/clade
test -f registry/consumers.json -a -f consumers.local
```

任一不成立 → STOP：Fleet mode 必須在 clade home 跑（需要 `consumers.local` 的本機 consumer 路徑清單）。

### F.1.2 解析觸發 input

| 觸發形式 | 解析方法 |
| --- | --- |
| GitHub release URL | 記 release_url；從 release notes 的安裝範例驗證 npm pkg name（`nuxt/ui` repo → `@nuxt/ui` pkg） |
| `<pkg>@<ver>` / `<pkg> v<ver>` / `<pkg> <ver>` | 拆出 pkg + version；release_url 用 discovery |
| 純套件名（「升 @nuxt/ui」） | discovery 補 latest + release URL |
| toolchain（「升 pnpm」「Node 版本統一」） | 同上 discovery，**MUST** 先讀 § Toolchain sweep 分支再進 Step F.2 |

### F.1.3 Discovery — 無腦升級自動補欄位

當缺 `target_version` 或缺 `release_url` 時，跑：

```bash
node vendor/scripts/dep-fleet-discover.ts --pkg "<pkg>" [--version <ver>]
```

輸出 `{pkg, latest_version, target_version, release_url, repo_url, homepage, source}`。找不到 changelog（release tag 與 `CHANGELOG.md` 都失敗）→ STOP，請 user 手動貼 release URL。

沒帶版號就是要 latest，直接 discovery，**NEVER** 反問 target 版本。

**MUST** 在進入 Step F.2 之前把以下五個值都拍板：`<pkg>` / `<target_version>` / `<release_url>` / `<pkg-slug>`（檔名安全字串，例：`@nuxt/ui` → `nuxt-ui`） / 觸發語境（user 原話）。

## Step F.2 — Fetch + 解析 changelog

### F.2.1 Fetch release notes

```bash
gh release view v<target_version> --repo <owner>/<repo> --json body,name,tagName,publishedAt > /tmp/dep-fleet-release-<pkg-slug>.json
```

`gh` 不行才依 `web-search` external-web row 抓公開 changelog。只讀 release notes；issues / PRs 是 research 派工（SKILL.md § B）的事。

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

**解析守則**：

- `category` 必填，五選一，不確定用 `signature`；Toolchain sweep 另有 `toolchain-config`（`affected_apis` 填設定 key 名，如 `onlyBuiltDependencies`，交給 Step F.T.3 比對，**NEVER** 送 codebase-memory-mcp）
- `affected_apis` 必須是可搜尋符號；`before` / `after` **MUST** 是可貼上的 code snippet
- 沒有 BC → `breaking_changes: []`，走 Step F.4.5 無 BC fast path

寫到 `/tmp/dep-fleet-changelog-<pkg-slug>.json`。

### F.2.3 Carve-out 條件自查

**MUST** 逐條自查 SKILL.md § Fleet mode carve-out 准入（SoT），另加一條：

- ✅ 若 sweep 會重寫 hit consumer `package.json` 的 `test` / `lint` / `typecheck` script（換工具 / 改命令）：原本有 `.clade/bin/clade-gate run <gate> --` 前綴的，**MUST** 只換 `--` 後面的內層命令、保留前綴（per [[test-scripts]] § MUST：重寫已包 clade-gate 的 script 時保留前綴）。主線在 land 前 `git -C <consumer-path> show <commit_sha> -- package.json` 抽查前綴沒被整行覆蓋

任一條不滿足 → STOP，回 user 解釋哪條沒過。

## Step F.3 — Fleet scan 命中 consumer

```bash
node vendor/scripts/dep-fleet-scan.ts --pkg "<pkg>" --target "<target_version>" > /tmp/dep-fleet-scan-<pkg-slug>.json
```

**Toolchain sweep 改用**（其餘 Step F.3 判定相同）：

```bash
node vendor/scripts/dep-fleet-scan.ts --toolchain "<name>" --target "<target_version>" > /tmp/dep-fleet-scan-<pkg-slug>.json
```

挑出 `found: true` 的當作 hit consumer 名單。

Toolchain mode 的 `version_gap: "absent"`（沒寫 `packageManager`）是要修的 finding，plan table 顯示「unpinned → 補欄位」，**NEVER** 讀成 miss。

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

> Toolchain sweep 跳過本步，改跑 Step F.T.3。

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
  "consumer_id": "<consumer-a>",
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

沒有 BC 時 brief 照寫（`breaking_changes` / `callsites` 為空），subagent 等同跑 Outdated mode Step O.2 minor / patch 流程。

## Step F.5 — 一次性 plan gate（runtime-native question interface）

把 Step F.2-F.4 的結果整理成一張 plan table 給 user 拍板：

```
## version-upgrade · fleet plan

Target: <pkg>@<target_version>
Release: <release_url>
BC clauses: <N> 條
Features: <M> 條
Deprecations: <K> 條

### Hit consumers (將 sweep)

| consumer | from | gap | manifest | callsites |
| --- | --- | --- | --- | --- |

### Skipped consumers

| consumer | reason |
| --- | --- |
```

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

### F.6.1 Subagent brief template

```markdown
# Task: 跑 version-upgrade § Outdated mode changelog-aware 對 <consumer_id> 升級 <pkg>

你是 version-upgrade orchestrator 派的長駐 subagent，負責 **<consumer_id>** 這一個 consumer 的升版。

## Brief

Brief JSON：`/tmp/dep-fleet-brief-<pkg-slug>-<consumer-id>.json`
請 Read 這個檔。

## 工作流程

1. `cd <consumer_path>`
2. 開 worktree：`node scripts/wt-helper.ts add upgrade-<pkg-slug>-<YYYYMMDD> --task-summary "upgrade <pkg> to <version>" --baseline-strategy stash`
3. 跑 version-upgrade § Outdated mode changelog-aware 子流程：
   - 讀 `~/offline/clade/capabilities/modules/ecosystem/node/skills/version-upgrade/outdated-mode.md`（Outdated mode 步驟）+ `~/offline/clade/capabilities/modules/ecosystem/node/skills/version-upgrade/SKILL.md` § Pi prompt templates
   - 跳過 Step O.1（target / version 由 brief 取）
   - 跑 Step O.2.1：用 § A first-pass 模板 + brief 內 BC 渲染 `<changelog-block>` + brief 內 callsites
   - 跑 Step O.2.2：pi dispatch（`version-upgrade-first-pass`，GPT-6 Sol xhigh；model／effort 照 outdated-mode.md O.2.2 與 `TIER_EFFORT`，填其他值 dispatcher exit 1），繼承Outdated mode唯一的workspace mutation contract：首跳帶`--workspace-access mutation`，每一個fallback照dispatcher payload排除所有`*-cursor`
   - Watch pi per [[agent-routing.pi-watch-protocol]]
   - 失敗 → 照 Step O.2.4 升 `version-upgrade-research`（Gemini 3.8 Flash high，用 § B 模板；靠研究不靠抬 effort）
   - research 也失敗 → 不要 runtime-native question interface，直接 STOP + 回報 orchestrator
4. 跑 Step O.3 驗收並保存 scoped checkpoint（`package.json` + lockfile + callsite 改動檔）
5. **NEVER push、NEVER /commit**：來源與 checkpoint 保留，回報 path／work id／HEAD／驗收證據，由 orchestrator 按 F.8 授權結批
6. **產生 commit msg（commitlint-aware）**：
   - 先 read consumer 的 commitlint 設定（`commitlint.config.{js,ts,mjs,cjs}` / `.commitlintrc.*` / `package.json` 內 `commitlint`）
   - 偵測限制：`type-enum` 允許清單、自定 `subject-has-chinese` plugin、`body-max-line-length` / `header-max-length`
   - 生 commit msg 必 **同時通過** worktree branch 跟 consumer main 的 commit-msg hook
   - 範例：<consumer-c> 用 `🧹 chore: 升級 @nuxt/ui ^4.7.0 → 4.8.0`；<consumer-a> 可用 `⬆️ chore: upgrade @nuxt/ui ^4.7.1 → 4.8.0`
7. 回報 stdout 結尾：
   \`\`\`
   FLEET_SUBAGENT_RESULT: SUCCESS | PARTIAL | FAILURE
   CONSUMER_ID: <consumer_id>
   STAGED_FILES: <comma-separated paths>
   COMMIT_PLAN_MSG: <你在 step 6 生的、worktree 已驗證過 hook 的 msg verbatim>
   PI_FINDINGS: <pi research 找到的關鍵 URL / issue，若有>
   FAILURE_DETAIL: <若 FAILURE / PARTIAL，一段 ≤ 10 行的失敗描述>
   \`\`\`
   `COMMIT_PLAN_MSG` 必須是你在 worktree 上**真正用過**的 msg（hook 已驗證），orchestrator 在 Step F.8 結批時以它為建議 message。

## Git Baseline / 禁止

- worktree 內 main fork 過來的 in-flight 變更：**不要動**
- 工作範圍：`package.json` + lockfile + brief.callsites 列到的檔案
- ❌ `git push` / `git commit` on main / `/commit` skill
- ❌ 動 brief.callsites 範圍外的 source code
- ❌ runtime-native question interface（subagent 不直接跟 user 對話）

## Long-running

orchestrator 會用當前 runtime 的 continuation transport 跟你續跑 phase。請保持 session 狀態、不要主動結束。
```

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

---

# § Toolchain sweep 分支（packageManager / runtime）

Sweep 目標是**跑 build 的工具本身**（pnpm / npm / yarn / bun、Node runtime），而不是
`dependencies` 裡的套件。宣告位置是 `packageManager` 欄位、`engines.node`、`.nvmrc`、
CI 的 `node-version`——全都不在 dep map 裡。

Step F.1.2 判定為 toolchain 時，進 Step F.2 之前先讀完本節。

## 與主流程的五處差異（其餘照 Step F.1–F.8）

| # | 主流程 | Toolchain sweep |
| --- | --- | --- |
| 1 | scan dep map，`found:false` = miss | scan top-level scalar；**`packageManager` 缺席是 finding（`gap: absent`），不是 miss** |
| 2 | BC affected surface = code symbol，用 codebase-memory-mcp 掃 callsite | BC affected surface = **設定 key**，用 Step F.T.3 比對 scan 回的 config surface。**NEVER** 送 MCP |
| 3 | 升版動作 = `<PM> add <pkg>@<ver>` | 升版動作 = **改 `packageManager` 欄位 + 重跑 install 重生 lockfile**（見 F.T.4） |
| 4 | 驗證 = typecheck / build / test | **MUST 多一道 `install --frozen-lockfile`**：換 PM 大版可能改 lockfile / store format，只跑 typecheck 抓不到 |
| 5 | 適用 `catalog:` 間接解析 | 不適用——`packageManager` 沒有 catalog 語意 |

其餘照舊，Step F.5 plan gate、Step F.8.2 push gate、每個 consumer 各自 worktree + atomic commit 都不因「只改一個欄位」放寬——它連帶重生 lockfile。

## Step F.T.1 — Target 版本的穩定性自查（進 Step F.2 之前）

```bash
npm view <name> dist-tags --json
```

**MUST** 確認 `--target` 就是 `latest` 指到的版本；pre-release tag（`next-*` / `beta` / `rc`）**NEVER** 進 fleet sweep——toolchain 壞掉是全 consumer 同時無法 build。

User 指名 pre-release 版本時，先回報「該版本只掛在 `<tag>`、`latest` 是 `<X>`」並等拍板，**NEVER** 自行照做或自行改成 latest。

## Step F.T.2 — Runtime 門檻自查

Toolchain 大版常帶 runtime 下限（例：pnpm 11 要 Node 22+）。從 release notes 抽出下限後，
對 scan 回報的三個來源逐一比對，**三個都要看**：

| 來源 | scan 欄位 | 沒過的後果 |
| --- | --- | --- |
| `engines.node` | `toolchain.engines_node` | 本機裝得起來，但 `engines` 宣告變成謊話 |
| `.nvmrc` / `.node-version` | `toolchain.node_version_files` | 開發者本機切到不支援的版本 |
| CI workflow 的 `node-version` | `toolchain.config_surface.ci_node_versions` | **CI 當場紅**，且 matrix job 只有一格紅時很像 flaky |

**NEVER** 只看 `engines.node`：CI matrix 常保留舊版本格。scan 對每個 `node-version` 回報 `file` + `line`，逐格判。

## Step F.T.3 — Config surface 比對（取代 Step F.4 callsite 預掃）

Step F.2.2 解析出的 `toolchain-config` 類 BC，其 `affected_apis` 是設定 key 名。拿它們去比對
scan 回報的 config surface：

| BC 形狀 | 比對什麼 | 命中後 brief 要帶 |
| --- | --- | --- |
| 設定被移除 / 改名 | `workspace_yaml_top_keys` ∩ `affected_apis` | 舊 key → 新 key 的 `before` / `after` YAML 片段 |
| 設定來源搬家（例：不再從 `.npmrc` 讀） | `npmrc_keys.other`（scan 已把 auth/registry 分開） | 要搬的 key 清單 + 目的地檔案 |
| 預設值改變 | 該 key **不在**現場 config（沒寫 = 吃新預設） | 新預設值 + 明說「沒寫等於行為改變」 |

第三列是「現場什麼都沒有」而行為靜默改變，「grep 不到所以不受影響」必漏。`.npmrc` 的 auth/registry 分類是 scan 的啟發式，邊界案例（自訂 scope 設定）要自己開檔確認。

Brief JSON 在主流程 schema 上多這一段：

```json
{
  "sweep_kind": "toolchain",
  "toolchain": {
    "declared": "pnpm@10.33.4",
    "target": "11.24.0",
    "gap": "major",
    "runtime_floor": { "node": ">=22" },
    "config_migrations": [
      { "from_file": ".npmrc", "keys": ["shamefully-hoist"], "to_file": "pnpm-workspace.yaml" },
      { "from_key": "onlyBuiltDependencies", "to_key": "allowBuilds", "before": "...", "after": "..." }
    ],
    "default_changes": [{ "key": "minimumReleaseAge", "new_default": "1440", "impact": "..." }]
  }
}
```

## Step F.T.4 — Subagent brief 的升版步驟（取代 § F.6.1 的第 3 步）

```markdown
## 升版步驟（toolchain）

1. 改 `package.json` 的 `packageManager` 欄位為 `<name>@<target>`
   （欄位原本不存在 → 新增；這是 brief 裡 `gap: "absent"` 的 consumer 要做的事）
2. 套用 brief 的 `config_migrations`：逐條搬 / 改名設定 key，**只動 brief 列到的 key**
3. 對 brief 的 `default_changes` 逐條判：要維持舊行為就顯式寫回舊值，要接受新預設就在
   回報裡明說接受了哪幾條——**NEVER** 靜默略過（那會讓行為改變沒有任何人看過）
4. `corepack use <name>@<target>` 或該 PM 的等價指令，確認 CLI 真的切到目標版本
5. 重跑 install 重生 lockfile
6. **MUST** `<PM> install --frozen-lockfile` 驗一次：紅的代表 lockfile 沒收斂，回報 FAILURE
7. typecheck + build
8. 全綠後 commit
```

工作範圍：`package.json` + lockfile + brief 列到的 config 檔（`.npmrc` /
`pnpm-workspace.yaml` / CI workflow）。**NEVER** 順手動 brief 沒列到的設定。

## Step F.T.5 — clade home 自己不在 `consumers.local` 裡

scan 的 hit 名單不含 clade 自己，但 clade 也有 `packageManager`。Toolchain sweep **MUST** 在摘要單獨列一行 clade 自身的現況與處置；clade 的升版走自己的 worktree + [[clade-publish]]，不混進 per-consumer commit。

---

# 禁止事項（Fleet mode 限定）

- **NEVER** 主線替 subagent 改 worktree 內檔——該 consumer 的改動只由它的 subagent 產生，主線只收回報與結批
