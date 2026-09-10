# § Outdated mode — Single consumer, multi-item batch

把「升 deps」這個機械活全程委派給 pi 跑：主線只負責 plan / dispatch / watch / 摘要，**不**自己改 `package.json`、不自己跑 `pnpm install`。每個 item 一個 pi 派工、一個 commit，失敗自動升 reasoning effort + 加上 web search / GitHub Issues 研究。

**兩種 item 共用同一條 pipeline**：

| Item kind | 來源 | 動的檔 | 真驗證 |
| --- | --- | --- | --- |
| `npm` | `pnpm outdated` | `package.json` + lockfile（+ callsite） | typecheck / build / test（本機） |
| `npm` (catalog) | `pnpm outdated`（catalog-pinned 套件） | `pnpm-workspace.yaml`（`catalog:` + `overrides:`）+ lockfile | 同上 |
| `action` | `.github/workflows/**` + `.github/actions/**` 的 `uses:` | workflow / composite action YAML | **push 後 CI 綠燈**（Step O.4） |

`action` item 併進本 mode 而非獨立 skill，是因為它跟 npm 升級共用同一套 worktree gate、per-item commit boundary、changelog pre-scan 與 merge-back 收尾——差別只在「改哪個檔」與「怎麼驗」。

**catalog-pinned 套件的兩條硬規則**（fleet 14 consumer 中 9 個用 `pnpm-workspace.yaml` 的 `catalog:`）：

- `catalog:` 條目與 `overrides:` 條目 **MUST 同步改**——兩者共同釘選同一個版本，改一邊忘一邊 = lockfile 不動
- `npm:` alias 條目（如 `vite: npm:@voidzero-dev/vite-plus-core@^0.3.0`）的版號追的是 **alias 目標 package**，不是 alias 名——`pnpm outdated` 報的也是目標 package 版本

**移除依賴時的 `allowBuilds` 硬規則**（批次中順手清掉未使用套件時會撞到）：

被移除的套件若仍是某個已安裝套件的 **optional peer**，它**不會**離開依賴樹。此時把
`pnpm-workspace.yaml` 的 `allowBuilds` 對應條目一起刪掉，pnpm 會以 `ERR_PNPM_IGNORED_BUILDS`
**exit 1**（不是 warning），而 `typecheck` / `lint` / `format` 都先跑 deps-status check
（內部呼叫 `pnpm install`），於是三個 script 在跑到本體前就一起紅——症狀與成因完全脫鉤。

判準：**`pnpm why <pkg>` 有輸出 → `allowBuilds` 條目改 `false`（明說不建置）；完全無輸出 → 才可以刪。**
`false` 是決定，缺條目是沒決定，pnpm 只接受前者。改用 `ignoredBuiltDependencies:` 無效
（pnpm 11.24 實測會忽略它，並往 `allowBuilds` 寫回 `set this to true or false` 佔位）。

細節見 [[pitfall-pnpm-allowbuilds-entry-removal-reddens-unrelated-scripts]]。

## 何時用 / 不適用（Outdated mode）

**適用**：
- `pnpm outdated` / `npm outdated` 跑出一堆 patch + minor + major，想逐套件穩穩升
- 不確定哪些套件會 break，想要明確的 per-item commit boundary 方便 bisect
- 大版號跳躍想讓 pi 自己去查 release notes / migration guide
- consumer 的 GitHub Actions 版本沒人管（**取代 Dependabot 的位置**——見 § Actions 升級為什麼在這裡）

**不適用**：
- 單一套件、單行升版（`pnpm add foo@latest` 自己跑更快）
- 整個 framework migration（Nuxt / Next / React major bump 需要專屬的 migration plan，不是逐套件 loop 能處理）

### Actions 升級為什麼在這裡（而不是 Dependabot）

Dependabot 唯一的更新途徑是**開 PR**。不走 PR 流程的 consumer（本 fleet 絕大多數）會讓那些 PR 無限累積：沒人 review、沒人合、還把 major 版跳號（`upload-artifact` v4→v7 這種）混在裡面當成例行 bump。

改由本 mode 接手後：升級走既有的 worktree + per-item commit + changelog 分類，major 跳號會被 O.1.5.3 標成 `adaptation` 並在計畫表攤開給 user 拍板，而不是靜靜躺在一個沒人看的 PR 裡。

**Consumer 端配套**：接手的 consumer **MUST** 刪掉 `.github/dependabot.yml`（留著會繼續開 PR）並關掉既有的 dependabot PR。`.github/dependabot.yml` 存在 = 本 mode 的 actions 段沒被採用。

**Changelog-aware sub-mode**：兩種觸發路徑：
- **Outdated pre-scan**（Step O.1.5）：主線用 `dep-fleet-discover.ts` + `gh release view` 拿 changelog → 分類為 `bugfix` / `adaptation` / `feature` → 依分類決定 pi prompt 是否帶 `<changelog-block>`。
- **Fleet brief**：被 § Fleet mode subagent 呼叫時，跳過 Step O.1（target / version 由 fleet brief 指定）、Step O.2.1 的 prompt 內嵌 BC clauses + callsites。詳見 § Pi prompt templates · Changelog-block 填充。

## Step O.0 — Worktree gate（[[worktree-default]] §1）

升 deps 會改 tracked code（`package.json` / lockfile / 必要時 source code），**MUST** 在 session worktree 內跑，不在 main working tree 直接動。

**進入 worktree 的兩條路**：

1. 主線目前已在 worktree（cwd 名含 `-wt/`）→ 跳過 Step O.0、繼續 Step O.1
2. 主線在 main → 跑 `/wt upgrade-deps-<YYYYMMDD>` ad-hoc Form-1（不對應 spectra change）。`wt-helper add` 會走 `--baseline-strategy stash` 把 main dirty 保留，fork 出 worktree 後主線 `cd` 進去

**禁止**直接在 main working tree 跑這個 mode — 升爆掉一條 package 整個 main 都會卡，bisect / rollback 成本爆增。

## Step O.1 — Detect PM + 收 outdated + 收 actions outdated + 讀分類

### O.1-npm — npm 套件盤點

1. **偵測 package manager**（看 lockfile）：

   ```bash
   ls -1 pnpm-lock.yaml package-lock.json yarn.lock bun.lockb 2>/dev/null | head -1
   ```

   找到的對應 `pnpm` / `npm` / `yarn` / `bun`。**沒有 lockfile** → npm 段 skip（不 STOP——可能是純 actions 升級）。

2. **拉 outdated**：

   ```bash
   pnpm outdated           # 或 npm outdated / yarn outdated
   ```

   > pnpm `--format=json` 在 monorepo workspace 會回多行 NDJSON 不是純 JSON，直接讀人類格式 + 主線自己 parse 比較穩。

3. **讀 package.json 把每個 outdated 套件分類為 deps / devDeps**（**P0，下 prompt 必用**）：

   ```bash
   python3 -c "
   import json
   p = json.load(open('package.json'))
   for pkg in <outdated_pkg_list>:
       if pkg in p.get('dependencies', {}): print(f'{pkg}  dep')
       elif pkg in p.get('devDependencies', {}): print(f'{pkg}  devDep')
   "
   ```

   後續 prompt builder 依此結果決定 `pnpm add <pkg>` 還是 `pnpm add -D <pkg>` — **NEVER** 預設 `-D`，否則會把 dependencies 套件靜默搬到 devDependencies（實證踩坑：<consumer-b> 第一次 run wrangler 被誤搬，commit 後才發現）。

4. **分類版號差距**（從低風險到高風險升）：
   - **patch**（`1.2.3 → 1.2.4`）：通常安全
   - **minor**（`1.2.3 → 1.3.0`）：should be safe 但偶爾有 regression
   - **major**（`1.x → 2.x`）：高機率 breaking change

### O.1-actions — GitHub Actions 盤點

**觸發條件**：consumer 含 `.github/workflows/` 目錄且至少一個 `*.yml` 或 `*.yaml` 檔。不含 → skip（純 npm consumer）。

1. **收集所有 `uses:` 引用**：

   ```bash
   grep -rhoE 'uses:\s+[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*@[a-f0-9]{40}\s*#\s*v[0-9]+' \
     .github/workflows/ .github/actions/ 2>/dev/null \
     | sort -u
   ```

   解析結果為 `{owner, repo, subpath, current_sha, pinned_tag}` 清單。

   **`(/[a-zA-Z0-9._-]+)*` 這段是必要的，NEVER 收窄成 `owner/repo@sha`**：`github/codeql-action/init@<sha>`、`owner/repo/.github/workflows/x.yml@<sha>`（reusable workflow）都是合法引用，少了 subpath 分支會**靜默漏掉**它們的安全更新——輸出看起來一樣正常，只是少了幾條。tag 解析用 `owner/repo`（subpath 不參與 tag 查詢），sed 替換用完整字串。

   **僅掃 SHA-pinned 引用**（`@<40-hex-sha> # vN`）。`@v4` 式 tag-ref 引用暫不列入（floating tag 自動跟最新，已是「最新」）。

   **排除 local composite actions**（`uses: ./` 前綴）和 **排除 org-internal actions**（`uses: <consumer-org>/` — 這些由各自 repo 管）。

2. **對每個 action 解析 latest major tag → SHA**：

   ```bash
   # (a) 先發現「最高的 major」——MUST 列全部 tag，NEVER 只查目前已釘的 v<major>
   latest_major_tag=$(gh api "repos/<owner>/<repo>/tags" --paginate -q '.[].name' \
     | grep -E '^v[0-9]+$' | sort -V | tail -1)

   # (b) 該 tag → commit SHA（lightweight tag 直接是 commit；annotated tag 要追一層）
   ref=$(gh api "repos/<owner>/<repo>/git/ref/tags/${latest_major_tag}" -q '.object.type + " " + .object.sha')
   case "$ref" in
     "tag "*)    latest_sha=$(gh api "repos/<owner>/<repo>/git/tags/${ref#tag }" -q '.object.sha') ;;
     "commit "*) latest_sha="${ref#commit }" ;;
   esac
   ```

   **(a) 不可省略**：`git/ref/tags/v<major>` 用目前已釘的 major 去查，回的永遠是同一個 major 的最新 patch——**結構上不可能**發現 v4 → v5，而本節聲稱會處理 major 跳號（見下方第 4 點）。少了 (a)，那個功能從來沒有生效過。

   - annotated tag 需追一層：先拿 tag object SHA → `gh api repos/<owner>/<repo>/git/tags/<tag-sha>` 取 `.object.sha`（commit）
   - 比對 `current_sha` vs `latest_sha`：相同 → 已是最新，不列入 outdated

3. **同一個 action 出現在多個檔/多行**：合併為單一 action item。`files` 欄記錄所有出現位置（`workflow.yml:73`, `workflow.yml:202`, ...），pi prompt 用這個列表做 sed 替換。

4. **分類版號差距**（major tag 跳號）：

   - `pinned_tag` vs `latest_major_tag` 相同 major → **patch/minor**（SHA 換新但大版號不動）
   - major 跳號（如 v4→v7）→ **major**（需看 changelog 確認 BC）

5. **`@types/*` 特殊封頂（MUST 在分類後立刻套用）**：

   `@types/<lib>` 的 major 版號**跟著對應 runtime / lib 版本走**，不是越新越好。**MUST** 把每個 `@types/*` 套件的 target version 上限封頂為 project 當前對應版本的 major：
   - `@types/node` → ≤ project Node major（讀 `.nvmrc` / `.tool-versions` / `package.json` `engines.node` / `Dockerfile` 任一可靠來源；都查不到才問 user）
   - `@types/react` → ≤ `dependencies.react` 的 major
   - 其餘 `@types/<lib>` 同理跟 `<lib>` 自身 major

   若 `outdated` 給的 Latest 超過上限，target 改成「上限 major 內最新」（例：Node 20 環境 + `@types/node` Latest 是 22.x → target 鎖 `^20.x` 最新 minor/patch，**不**升 22）。Step O.1.5.5 回報給 user 的計畫表 **MUST** 在這些 `@types/*` 條目後標註「(capped to Node N / react N)」讓 user 看到封頂邏輯有作用。

   **NEVER** 為了「升到最新」把 `@types/*` 推超過對應 runtime / lib — 型別會漂移：typecheck 用的是 newer types，但 runtime 跑的是舊版 API，bug 表現是「TS 說沒問題、prod 卻炸」這種最難 debug 的型別。

6. **合併兩段清單**：npm items（O.1-npm）和 action items（O.1-actions）合成統一的 upgrade item 清單。每個 item 帶 `kind: "npm" | "action"` 標記，後續 O.1.5 / O.2 依 kind 分流。

7. **進入 Step O.1.5 Changelog pre-scan**（見下方）。pre-scan 完成後才回報增強版計畫給使用者。

## Step O.1.5 — Changelog pre-scan（主線直接做）

在 O.1 收完 outdated 清單 + deps 分類 + 版號差距 + `@types/*` 封頂後，**升版前**先理解每個 item 的 release 性質，依此決定升版策略。主線直接完成（不派 pi），零額外 overhead。

### O.1.5.1 — Batch discover release URLs

**npm items**：對每個 outdated package，跑 `dep-fleet-discover.ts` 拿 release URL：

```bash
node ~/offline/clade/vendor/scripts/dep-fleet-discover.ts --pkg "<pkg>" --version "<to>"
```

- 可並行跑（獨立、唯讀）— 多個 Bash tool call 同一 message
- 記錄每個 package 的 `release_url` + `source` + `repo_url`
- `source: "none"` 的 package 標記分類為 `unknown`，skip O.1.5.2–O.1.5.4
- **Skip `@types/*`**：型別定義的 changelog 對分類無意義 → 直接標 `bugfix`

**action items**：用 `gh` 直接拿 release URL（repo 已在 O.1-actions 解析過）：

```bash
gh release view "v<latest_major_tag>" --repo <owner>/<repo> --json url -q .url
```

- 若 action 是 same-major SHA bump（patch/minor），release URL 是 latest patch tag（如 `v5.1.0`）
- 若 action 是 major 跳號（如 v2→v4），release URL 用新 major 的第一個 release（`v4.0.0` 或 `v4.1.0`）

### O.1.5.2 — Batch fetch release bodies

**npm items**：對 `source != "none"` 的 package，fetch release body：

```bash
gh release view v<to> --repo <owner>/<repo> --json body -q .body > /tmp/dep-prescan-<pkg-slug>.md
```

- `gh` 失敗（private repo / rate limit / 無 release）→ 若 `source: "changelog_md"`，依 `web-search` external-web row 取 changelog URL → 否則標 `unknown`
- 寫出的檔可在 O.2.1 pi prompt builder 復用

**action items**：同上 `gh release view`，寫到 `/tmp/dep-prescan-action-<owner>-<repo>.md`。Actions 通常有良好的 release notes（GitHub 官方 + 大社群維護者），fetch 失敗率低。

### O.1.5.3 — 主線分類（三類 + 混合）

主線讀所有 fetch 到的 release body，對每個 package 判定分類標籤：

| 訊號 | 標籤 |
| --- | --- |
| release body 全是 bug fix / patch notes / perf / internal refactor，無 user-facing API 變更 | `bugfix` |
| 有 breaking changes / deprecations / renamed APIs / 移除的 API / signature 變更 / config schema 變更 | `adaptation` |
| 有重大新 feature（新 component / 新 API / 新 capability），consumer 可能受益 | `feature` |
| changelog 不可得（O.1.5.1 `source: "none"` 或 O.1.5.2 fetch 失敗） | `unknown` |

**混合判定**（一個 release 可有多個標籤）：
- BC + feature → 同時標 `adaptation` + `feature`（升版時修 BC，完成後 HANDOFF 記 feature）
- 只有 deprecation（尚未 remove）→ `adaptation`（趁這次改掉，不等到 remove 才爆）
- 小 feature（如新增一個 option、default off、不影響現有行為）→ 仍歸 `bugfix`（不值得 HANDOFF entry）
- 重大 feature 但無 BC → 純 `feature`（升版走 bugfix 路徑，HANDOFF 記 feature）

**`adaptation` 時提取 BC 結構化資料**（復用 Fleet mode F.2.2 schema）：

```jsonc
{
  "breaking_changes": [
    {
      "category": "rename | removal | signature | config-schema | peer-bump",
      "description": "<一句話人話>",
      "affected_apis": ["<symbol>"],
      "before": "<code snippet>",
      "after": "<code snippet>"
    }
  ],
  "deprecations": [{ "api": "<name>", "replacement": "<name>" }]
}
```

- `affected_apis` 必須是**可搜尋符號**（函式名 / component 名 / config key），不要寫人話
- `before` / `after` 是可貼上的 code snippet，給 pi 看

**`feature` 時提取 feature 摘要**：

```jsonc
{
  "notable_features": [
    { "description": "<feature 描述>", "opt_in": true }
  ]
}
```

### O.1.5.4 — Callsite quick-scan（`adaptation` only，npm items）

對標記 `adaptation` 的 **npm** package，用 `rg` 快掃每個 BC 的 `affected_apis`：

```bash
rg -n "<symbol>" --type-add 'vue:*.vue' --type vue --type ts .
```

- 記錄 `file:line` 組合，後續 O.2.1 填入 `<changelog-block>` 的 callsites 段
- 過濾 docs-only 命中（`.md` / `README` / `docs/`）— 不是 runtime callsite
- 比 Fleet mode 的 codebase-memory-mcp 輕量（單 consumer、不需 index）
- **callsite = 0**：不刪該 BC（仍可能 transitive 影響），prompt 內提示 `callsites: 0（pi 自行 grep 確認）`

**action items 不需 callsite scan** — action 的「callsite」就是 workflow YAML 裡的 `uses:` 行，O.1-actions.3 已收集完整。`adaptation` 標記的 action 的 BC 影響範圍是 workflow YAML 裡的 `with:` 參數或 `outputs`，O.2-actions prompt 會包含完整 workflow 段落。

### O.1.5.5 — 增強版計畫回報

```
偵測到 <PM>，outdated 共 <N> 個（npm <Nn> + actions <Na>）（changelog pre-scan 完成）：

## 📦 npm 套件

### 🟢 Bug fix only — <a> 個（順升）

| Package | from → to | 摘要 |
| --- | --- | --- |

### 🟡 需要適配 — <b> 個（有 BC / deprecation）

| Package | from → to | BC 摘要 | callsite 數 |
| --- | --- | --- | --- |

### 🔵 有新 Feature — <c> 個（升版 + HANDOFF 記 feature 適配計畫）

| Package | from → to | Feature 摘要 |
| --- | --- | --- |

### ⚪ Changelog 不可得 — <d> 個（走現有 first-pass → research fallback）

| Package | from → to |
| --- | --- |

## ⚙️ GitHub Actions

### 🟢 Same-major SHA bump — <e> 個（安全，只換 SHA + 更新 # 註解）

| Action | pinned tag | current SHA (short) → latest SHA (short) | 出現位置數 |
| --- | --- | --- | --- |

### 🟡 Major 跳號 — <f> 個（需看 changelog）

| Action | from tag → to tag | BC 摘要 | 出現位置數 |
| --- | --- | --- | --- |

---

建議升級順序：
npm: 🟢 → ⚪ → 🟡 → 🔵
actions: 🟢 → 🟡
（先簡單的、再需要適配的、最後有 feature 的）

要排除任何套件 / action 不升嗎？要調整任何分類嗎？
```

使用者可：
- 指定排除清單（如 `vue` lockstep with `nuxt`，先不動）
- 調整分類（如「bar 不用 adaptation，降成 bugfix」）
- 只跑 npm 不跑 actions（或反過來）
- **MUST 等使用者確認**才進 Step O.2 — 不要自決定

> Smoke test 建議：第一次跑這個 mode on 一個新 consumer 時，先挑 1 個最低風險 🟢 patch 跑 smoke，驗證 worktree fork + pi dispatch + commit boundary 都對，再批次推剩下的。

## Step O.2 — 逐 item 派工 loop（category-aware）

每個 item 走以下子流程，**一個 item 一個 pi 派工（npm）或主線直改（action）**、**一個 commit**。Step O.1.5 的分類決定 prompt 填充策略。

**dispatch 順序**：先所有 npm items（逐個串行），再所有 action items。這是因為 npm 升版完後 lockfile 才穩定，action 升版不影響 lockfile。

### O.2-npm — npm 套件子流程（既有行為，unchanged）

npm items 的

| 分類 | `<changelog-block>` | `<plan-first-block>` | 工作範圍 | 驗證 |
| --- | --- | --- | --- | --- |
| `bugfix` | 空（現有行為） | patch 空 / minor 填 | `package.json` + lockfile only | typecheck（patch）/ +build（minor） |
| `adaptation` | **填入** BC + callsites（復用 Fleet 的 changelog-block 格式） | 必填 | `package.json` + lockfile + callsite 檔 | typecheck + build + 相關 test |
| `feature`（無 BC） | 填入 feature 摘要（informational） | 依版號差距 | `package.json` + lockfile only | 同 bugfix |
| `feature` + `adaptation` | **填入** BC + callsites + feature 摘要 | 必填 | 同 adaptation | 同 adaptation |
| `unknown` | 空（現有行為） | 依版號差距 | `package.json` + lockfile | 同 bugfix |

### O.2.1 寫 prompt 到 `/tmp/pi-upgrade-<pkg>-prompt.md`

用 § Pi prompt templates · § A first-pass 模板（O.2.2 派 `--effort low`）。**MUST** 內含：
- `[DELEGATED-BY-CLAUDE-CODE]` marker（第一行，per [[agent-routing.pi-watch-protocol]] § Runtime Gate）
- 目標 package 名 + current version → target version + **正確的 install flag**
- Git Baseline 段（per pi-watch-protocol § Git Baseline；列當前 worktree 內所有 main fork 過來的 in-flight 變更 path，**不要列死**——每個 consumer / 每次 fork 都不同，主線跑 `git status --porcelain` 動態抓）
- Commit Authorization 段（per pi-watch-protocol § Commit Authorization；message format `🧹 chore: wt upgrade-<pkg>-<from>→<to>`，subagent 端需讀 commitlint config 調整）
- 失敗時的回報格式

**`<changelog-block>` 填充**（`adaptation` / `feature+adaptation` 才填，其他留空）：完全復用 § Pi prompt templates · Changelog-block 填充格式，callsites 來源為 O.1.5.4 的 `rg` 結果（而非 Fleet mode 的 codebase-memory-mcp）。`adaptation` 的 pi 工作範圍擴大到 callsite 檔：Commit Authorization 加 `git add <callsite-files>`。

**`feature`（無 BC）的 `<changelog-block>` 填充**：只含 feature 摘要段（informational），**不**含 callsites 或「動手範圍」段 — 告知 pi 這個版本有新功能但升版只需 bump，不必改 source code。

**Plan-first 條件化**（DRY + 降 token）：
- `bugfix` + patch：**MAY 省略** Plan-first 硬指令，prompt 直接列「install → typecheck → commit」固定三步
- `bugfix` + minor / `unknown` + minor：**MUST** 加 Plan-first
- `adaptation` / `feature+adaptation` / major（任何分類）：**MUST** 加 Plan-first

**驗證步驟**（依分類 + 升版類型，取嚴格者）：
- `bugfix` + patch：`pnpm install`（隱式跑） + `pnpm typecheck` 0 errors
- `bugfix` + minor / `unknown`：typecheck + 如有 build script 跑一次 + 相關 test
- `adaptation`（任何版號差距）：typecheck + build + 相關 test
- major（任何分類）：typecheck + build + 全 test + pi 自己決定要不要 smoke test

### O.2.2 Dispatch background bash（first-pass，`--effort low`）

```bash
node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
  --brief /tmp/pi-upgrade-<pkg>-prompt.md \
  --cwd <worktree-path> \
  --label version-upgrade-<pkg>-low \
  --model grok-xai --effort low \
  --workspace-access mutation \
  --route routing-table --tier-basis table-row \
  --table-row version-upgrade-first-pass
```

配額／provider 不可用時，本流程的路徑是 **Grok → Gemini 3.8 Flash（bare `--model gemini`，同 effort）→ 停止並回報 blocker**。Gemini 不可用時不再換模型；不接 Sonnet。此路徑由 `version-upgrade-first-pass`／`version-upgrade-research` row 識別，適用 Outdated 與 Fleet 的每一個 package dispatch。

這是workspace mutation dispatch。Runtime quota／provider failure後，**每一個**retry都MUST逐字採用dispatcher payload的`next_step`（含`--retry-of`與`--workspace-access mutation`）；NEVER自行改派`grok-cursor`、`luna-cursor`或`sol-cursor`。Linked worktree visibility與writable sandbox是兩個predicate，擴大cwd不會讓Cursor carrier合法。


派出 mutation executor 後，立刻記錄 owner / deadline（deadline 取值依 [[agent-routing]] § deadline 怎麼取），並依 [[agent-routing.pi-watch-protocol]] 的 keepalive 規約維持單一控制生命週期。控制 turn 只准使用當前 runtime adapter 提供的 bounded completion transport 讀取狀態、重排同一 inert control 或排 lifecycle intervention；**NEVER** 放 upgrade prompt、讀 output tail或做 package mutation。收到 terminal completion 後先 claim task id，再讀結果並停止 wakeup。

### O.2.3 收到 `<task-notification status=completed>` 後判定

| 訊號 | 判定 | 下一步 |
| --- | --- | --- |
| `PHASE_RESULT: SUCCESS` + worktree 多了一個 `🧹 chore: wt upgrade-<pkg>-...` commit | 成功 | **主線在該 worktree 自己重跑一次 typecheck**（O.2.2 派的是 grok-xai，前置契約未滿足時 grok 會自報 `pass`——commit 存在不等於內容正確，per [[agent-routing]] 〔`spectra-phase-implementation`〕列的取證）。綠了才記錄到摘要、進下一 package |
| `PHASE_RESULT: FAILURE` + pi 自報原因 | 失敗 → 進 O.2.4 升 research | 不馬上問使用者；先讓 pi `--effort high` 自己研究 |
| Plan section 缺 / commit message format 不符 / scope drift | pi 漏跑硬指令 | 不升 research；直接 runtime-native question interface [重派 first-pass（同 `--effort low`）/ 升 research / 跳過 / 中止] |
| `fetch failed` / sandbox 拒絕 / 互動 prompt 卡住 | 環境問題 | per watch protocol 「介入觸發」，runtime-native question interface |

**絕不**在 O.2.3 替 pi 修檔（會破壞 per-package commit boundary）。要修就 reset worktree commit 後重派。

### O.2.4 升 research（first-pass 失敗自動觸發）

寫 prompt 到 `/tmp/pi-upgrade-<pkg>-research-prompt.md`，用 § Pi prompt templates · § B research 模板（`--effort high`）。**MUST** 內含：

- `[DELEGATED-BY-CLAUDE-CODE]` marker
- First-pass 派工的失敗 tail（≤ 50 行）+ pi 自報的失敗原因
- 明確指示走研究模式：先 **github** plugin 查 `<pkg>` repo 的 issues / releases / changelog，再 **agent-browser** / web search 查官方 migration guide
- 研究完才動手改檔
- 一樣的 Git Baseline / Commit Authorization 硬指令
- Commit message format `🧹 chore: wt upgrade-<pkg>-<from>→<to> (researched <issue-url-slug>)`

Dispatch（同 O.2.2，保留 `--workspace-access mutation`，把 `--effort` 改成 `high`、`--table-row` 改成 `version-upgrade-research`）+ watch（high 跑得更久，但節奏不變：notification-only + 單一安全網 fallback，節奏以 [[agent-routing.pi-watch-protocol]] 的既定節奏為準）。

### O.2.5 research 仍失敗 → runtime-native question interface

```
<pkg> first-pass + research 都失敗。

First-pass 失敗原因：<一句話>
Research 失敗原因 + 已查到的線索：<一句話>
完整 pi 輸出在 /tmp/pi-upgrade-<pkg>-research-prompt.md

要怎麼處理？
[1] 跳過 <pkg>（記錄到摘要的 SKIPPED 區，繼續下個 package）
[2] 中止整個 upgrade loop（保留 worktree 供手動處理）
[3] 主線接手手動升（會破壞 per-package commit boundary，僅在套件很小時建議）
```

**禁止**主線自己決定跳過或中止 — 必須使用者選。

### O.2-actions — GitHub Actions 升級子流程

Action items **由主線直接改**（不派 pi）——改動是純機械 sed 替換，不值得一個 pi session 的冷啟動開銷。

#### O.2-actions.1 — 逐 action 替換 SHA + 更新 tag 註解

對每個 action item，用 `sed -i` 在 worktree 內批次替換：

```bash
# 把所有出現位置的 old SHA → new SHA，同時更新 # 註解裡的 tag
for file in <action.files>; do
  sed -i "s|<owner>/<repo>@<old_sha>\s*#\s*v[0-9][0-9.]*|<owner>/<repo>@<new_sha> # v<latest_tag>|g" "$file"
done
```

**驗證替換正確性**（每個 action 替換完立即做）：

```bash
grep -rn "<owner>/<repo>@" .github/workflows/ .github/actions/ 2>/dev/null
```

- 確認所有命中行都指向 `<new_sha>`，無殘留 `<old_sha>`
- 確認 `# v<tag>` 註解與 `<new_sha>` 對應（不要出現新 SHA 配舊 tag）

#### O.2-actions.2 — Major 跳號的 `adaptation` 處理

major 跳號的 action item（O.1.5.3 標為 `adaptation`）**不能**只換 SHA — 可能需要改 `with:` 參數、`outputs` 引用、整個 step 結構。

**MUST** 在替換前：

1. 讀該 action 在 O.1.5.2 fetch 到的 release body
2. 對照 consumer workflow 裡該 action 的 `with:` / `env` / `outputs` 用法
3. 如果 release notes 列了 breaking change 且影響本 consumer 的用法 → 一併改 workflow YAML
4. 如果改動涉及多 step 聯動（如 `upload-artifact` 的 output 被後續 step 引用）→ **STOP + runtime-native question interface** 讓 user 拍板

#### O.2-actions.3 — Commit

每個 action item 一個 commit（per-item commit boundary 同 npm 段）：

```bash
git commit --only -m "🧹 chore: wt bump <owner>/<repo> <old_tag>→<new_tag>" \
  -- <affected workflow files>
```

**commit message 格式**：
- Same-major：`🧹 chore: wt bump <owner>/<repo> v<major> SHA update`
- Major 跳號：`🧹 chore: wt bump <owner>/<repo> v<old_major>→v<new_major>`

**NEVER** 把多個 action 的變更混進同一個 commit。

#### O.2-actions.4 — 驗證方式差異

Action 升版不能本機驗（沒有 `typecheck` / `build` 可跑）。本機驗證僅限：

- YAML 語法正確（`python3 -c "import yaml; yaml.safe_load(open('<file>'))"` 或等效）
- `grep` 確認無殘留舊 SHA

**真驗證推遲到 O.4**（push 後 CI 驗綠）——這是 action items 跟 npm items 的關鍵差異。

## Step O.3 — 驗收來源與批次收尾

所有 package 派工結束後，主線在來源確認必要檢查與各項結果，保存 scoped checkpoint。失敗或驗收未完者不進 ready 池；原始工作、baseline 與證據保留，不藉清 WIP 讓 readiness 過關。

1. 對成功項驗 scope、受測 HEAD 與 evidence，確認原執行者交出寫入權。
2. `feature` 分類的適配待辦寫入來源既有 `HANDOFF.md`，附 package／版本／release URL／新增能力，與 checkpoint 一起保存；該檔不存在則沿用 skip。
3. 依 commit skill `batch.md` 登記該 repo 就緒來源。Fleet worker 到此回報 checkpoint SHA、path、work id、驗收證據與建議 commit message；由 orchestrator 依 F.8 授權協調正式提交。
4. 單 repo 本輪開發已完成時用 `drained`，仍有可做開發時用 `auto`。達批次條件即由 coordinator 在隔離 integration 跑一次完整 `/commit`，正式落地後依既有發布 gates push、安全 cleanup。使用者明示「不要 land／保留 worktree」時保留並報 owner／下一事件，不登記落地授權。
5. 正式落地改了 dependency manifests／lockfile 時，在 main 跑對應 package manager install 對齊依賴；action 升級已 push 時走 O.4。

摘要依實際 package／action 結果分成功、adaptation、feature、skipped、failed；附來源與 batch 的 ready／blocked／landed／cleaned 狀態。Main 既有 index／WIP 保留，不能先把來源 staged 到 main 等人提交。完成報告前逐來源列 lifecycle 五欄，見 `batch.md`。

## Step O.4 — CI 驗綠（action 升級限定）

**觸發條件**：本次 upgrade 含至少一個 `action` item **且** `/commit` 已完成 push。若純 npm 升級（無 action items），skip 本步。

Action 升版的「真驗證」**只能**在 CI 跑——本機沒有 GitHub Actions runner。push 後 **MUST** 派 CI watcher（per the active runtime policy § Post-Push CI Watcher）監看 consumer 的主要 CI workflow：

```bash
bash <native-skills>/gh-ci-watch/scripts/gh-ci-watch.sh workflow <primary-ci-workflow>.yml \
  --commit "$(git rev-parse HEAD)"
```

- `<primary-ci-workflow>.yml` 是 `.github/workflows/` 底下的**檔名**（通常 `ci.yml`，或 `_ci-reusable.yml` 被 caller 觸發的那條）。**NEVER 傳 workflow 的 display name 或自己想的簡稱** —— display name 與檔名無關且隨時可被編輯，傳錯時 script 會 exit 2 並列出可用清單（見 `/gh-ci-watch` § 場景 B）
- 用 runtime adapter 提供的 background execution surface 派出
- Watcher 完成後走 active runtime policy 既定分流（success → 一行報完、failure → runtime-native question interface 二選一）

**若 CI 紅燈且根因是 action 升級**（error log 指向 action step / 新 input 不認識 / permission 問題）：

1. runtime-native question interface 讓 user 選：立刻回 worktree 修 / revert 該 action 的 commit / 登記 HANDOFF
2. 修完後再 push → 再派 watcher 驗綠
3. **NEVER** 對 CI 紅燈視而不見宣稱 version-upgrade 完成

---

# 禁止事項（Outdated mode 限定）

- **NEVER** 一次派多 package / action 並行（破壞 per-item commit boundary，bisect 失效）
- 正式提交依 O.3 的批次觸發與既有授權；worker 本身不啟動完整品質鏈
- **NEVER** 在含 action 升級的 session 跳過 O.4 CI 驗綠（action 升版沒有本機驗證手段，CI 是唯一真驗證）
- **NEVER** 用 `actionlint` / `zizmor` 替代 CI 驗綠 — 靜態 lint 抓不到 action runtime breaking change（如新版移除 input、改 output 結構）
