# Phase T — Toolchain（packageManager／runtime，`toolchain.<範圍>`）

Sweep 目標是**跑 build 的工具本身**（pnpm / npm / yarn / bun、Node runtime），而不是
`dependencies` 裡的套件。宣告位置是 `packageManager` 欄位、`engines.node`、`.nvmrc`、
CI 的 `node-version`——全都不在 dep map 裡。

route 是 `toolchain.fleet` 時，Phase F 的 F.1–F.8 照跑、差異照下表；`toolchain.clade` 只跑 T.5；`toolchain.consumer` **不跑 Phase F**（F.1.1 要求 cwd 是 clade home、F.6–F.8 是 fleet fan-out），改照 § toolchain.consumer 步序。

## 與主流程的五處差異（其餘照 Step F.1–F.8）

| # | 主流程 | Phase T |
| --- | --- | --- |
| 1 | scan dep map，`found:false` = miss | scan top-level scalar；**`packageManager` 缺席是 finding（`gap: absent`），不是 miss** |
| 2 | BC affected surface = code symbol，用 codebase-memory-mcp 掃 callsite | BC affected surface = **設定 key**，用 Step T.3 比對 scan 回的 config surface。**NEVER** 送 MCP |
| 3 | 升版動作 = `<PM> add <pkg>@<ver>` | 升版動作 = **改 `packageManager` 欄位 + 重跑 install 重生 lockfile**（見 T.4） |
| 4 | 驗證 = typecheck / build / test | **MUST 多一道 `install --frozen-lockfile`**：換 PM 大版可能改 lockfile / store format，只跑 typecheck 抓不到 |
| 5 | 適用 `catalog:` 間接解析 | 不適用——`packageManager` 沒有 catalog 語意 |

其餘照舊，Step F.5 plan gate、Step F.8.2 push gate、每個 consumer 各自 worktree + atomic commit 都不因「只改一個欄位」放寬——它連帶重生 lockfile。

## toolchain.consumer 步序（cwd 是該 consumer；worktree 已由 SKILL.md Step 0.4 開好）

| # | 做什麼 |
| --- | --- |
| 1 | Step T.1：target 取 `~/offline/clade/registry/toolchain.json`（Step 0.2 刷新後的值） |
| 2 | 只掃本 consumer：`node ~/offline/clade/vendor/scripts/dep-fleet-scan.ts --toolchain "<name>" --target "<target>" \| jq --arg p "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" '.consumers[] \| select(.consumer_path == $p)'`（script 由自身位置讀 clade home 的 `consumers.local`，cwd 不影響；以 main checkout 路徑比對，所以在 worktree 內也對得上）。輸出空 → STOP，回報 clade 主線「本 consumer 不在 `consumers.local`」 |
| 3 | Step T.2 四來源比對 |
| 4 | Step F.2 解析 changelog（不依賴 cwd）＋Step T.3 config surface 比對 |
| 5 | 計畫檔照 SKILL.md Step 0.3 開在本 consumer 的 plan package，一列；**MUST** 經 user 拍板才動手（取代 Step F.5 的 fleet plan gate） |
| 6 | 讀取 `templates/fleet-subagent-brief.md` 代入本 consumer 一份（工作流程第 3 步換成 Step T.4），派一個 subagent 在該 worktree 升版；主線不自己改 `package.json`（`rules/A軸共用紀律判準.md` Rule 3） |
| 7 | 回報後照 Step F.7 判定；落地走本 consumer 的 commit skill，push 前停（取代 Step F.8 的 fleet push gate） |

## Step T.1 — Target 版本的穩定性自查（進 Step F.2 之前）

```bash
npm view <name> dist-tags --json
```

**MUST** 確認 `--target` 就是 SoT（`registry/toolchain.json`）在本輪「目標刷新」後的 target——也就是共同可達最新版（`--refresh-targets` 的定義：穩定版、engines 接受 fleet node、發佈滿 minimumReleaseAge，所以可能比 `latest` 低一版）；pre-release tag（`next-*` / `beta` / `rc`）**NEVER** 進 fleet sweep——toolchain 壞掉是全 consumer 同時無法 build。

User 指名 pre-release 版本時，先回報「該版本只掛在 `<tag>`、`latest` 是 `<X>`」並等拍板，**NEVER** 自行照做或自行改成 latest。

## Step T.2 — Runtime 門檻自查

toolchain 大版常帶 runtime 下限（例：pnpm 11 要 Node 22+）。從 release notes 抽出下限後，
對 scan 回報的四個來源逐一比對，**四個都要看**：

| 來源 | scan 欄位 | 沒過的後果 |
| --- | --- | --- |
| `engines.node` | `toolchain.engines_node` | 本機裝得起來，但 `engines` 宣告變成謊話 |
| `.nvmrc` / `.node-version` | `toolchain.node_version_files` | 開發者本機切到不支援的版本 |
| CI workflow 的 `node-version` | `toolchain.config_surface.ci_node_versions` | **CI 當場紅**，且 matrix job 只有一格紅時很像 flaky |
| Dockerfile 的 `FROM node:<tag>` | `toolchain.dockerfile_from` | 部署出去的 image 跑在不支援的 node 上：本機與 CI 全綠，**staging／prod 才壞** |

**NEVER** 只看 `engines.node`：CI matrix 常保留舊版本格。scan 對每個 `node-version` 回報 `file` + `line`，逐格判。

## Step T.3 — Config surface 比對（取代 Step F.4 callsite 預掃）

Step F.2.2 解析出的 `toolchain-config` 類 BC，其 `affected_apis` 是設定 key 名。拿它們去比對
scan 回報的 config surface：

| BC 形狀 | 比對什麼 | 命中後 brief 要帶 |
| --- | --- | --- |
| 設定被移除 / 改名 | `workspace_yaml_top_keys` ∩ `affected_apis` | 舊 key → 新 key 的 `before` / `after` YAML 片段 |
| 設定來源搬家（例：不再從 `.npmrc` 讀） | `npmrc_keys.other`（scan 已把 auth/registry 分開） | 要搬的 key 清單 + 目的地檔案 |
| 預設值改變 | 該 key **不在**現場 config（沒寫 = 吃新預設） | 新預設值 + 明說「沒寫等於行為改變」 |

「預設值改變」那一列是「現場什麼都沒有」而行為靜默改變，「grep 不到所以不受影響」必漏。`.npmrc` 的 auth/registry 分類是 scan 的啟發式，邊界案例（自訂 scope 設定）要自己開檔確認。

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

## Step T.4 — Subagent brief 的升版步驟（取代 `templates/fleet-subagent-brief.md` 工作流程的第 3 步）

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

## Step T.5 — clade home 自己不在 `consumers.local` 裡

scan 的 hit 名單不含 clade 自己，但 clade 也有 `packageManager`。Phase T **MUST** 在摘要單獨列一行 clade 自身的現況與處置；clade 的升版走自己的 worktree + [[clade-publish]]，不混進 per-consumer commit。
