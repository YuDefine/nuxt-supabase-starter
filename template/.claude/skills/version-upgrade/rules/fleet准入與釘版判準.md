# Fleet 准入與釘版判準

觸發點：SKILL.md Step 0.5（進 Phase F；phases/fleet.md Step F.2.3 逐條自查；Rule 3 另由 Step F.1.3 在 target 要取 beta／rc 時讀）與動到 consumer `.mcp.json` 的 chrome-devtools-mcp entry 時。

# Rule 1 - Fleet carve-out 准入（SoT）

- Level: `MUST`

> 本條是 [[clade-role-and-todo-discipline]] § upstream-driven dep migration 的准入條件 SoT（2026-08-02 自該 rule 移入）；rule 端只留觸發判定 stub。Fleet 流程 Step F.2.3 對本條逐條自查。

每次 Fleet sweep **必須**全部滿足：

- ✅ 變動一對一對應上游 release 列出的 BC（rename / removal / signature change / config schema 變更）— 找不到對應 clause 的改動，不准帶進來
- ✅ 每個 consumer 各自開 worktree（per [[wt]] 的 `rules/改tracked檔前先隔離判準.md` Rule 1），不在 main 直接動
- ✅ 每個 consumer 一個 atomic commit，依該 consumer `registry/consumers.json` 的 `workflow_model` 走（trunk-based 直接 push、pr-merge-based 開 PR）
- ✅ 一次 sweep 只處理「**一個套件 × 一個 target version**」，不跨多套件 / 多 release 混在同一 sweep
- ✅ Phase T（pnpm / Node 自身）額外一條：target **MUST 是 SoT 本輪刷新後的共同可達最新版**（`audit-ci-toolchain-parity.ts --refresh-targets`；`latest` dist-tag 以下的穩定版），pre-release tag 一律不進 fleet（toolchain 壞掉是全 consumer 同時無法 build，不像單一套件只影響用到它的地方）；本條只管 Phase T 的 pnpm／Node，`dependencies` 裡的核心 toolchain 套件照 Rule 3
- ✅ 命中該套件的 consumer 才動；沒命中的 consumer **NEVER** 順便動其他東西
- ✅ 回退（`rollback.fleet`）以上游 issue／advisory 取代 BC clause：改動只限把該套件釘回指定的好版（與 lockfile），准入依據是那份 issue／advisory 的 URL；其餘條件照上

**禁止帶搭**（即使在 Fleet 編排內也禁）：

- ❌ clade 自行發想的 refactor / cleanup（即使「順手很好做」）
- ❌ 把標準層改動（rules / vendor / skills）混進 dep migration commit
- ❌ 把 unrelated 套件升版搭便車進來

**這條 carve-out 不適用於**：

- Framework major migration（Nuxt 3→4 / Next 14→15）— 仍需專屬 plan，不走 fleet skill
- consumer 自家業務 bug fix / feature
- 「我覺得 N 個 consumer 該統一寫法」這種 clade 發想的改動 — 仍是「替 consumer 規劃實作」反模式

**觸發判定**：能不能在 upstream release notes / changelog 找到「導致這個 mod 的具體 BC clause」。找不到，就不在 carve-out 範圍內，照原規則走：**relay 給該 consumer 的 session**（per [[clade-role-and-todo-discipline]] § Consumer 工作命中時 MUST relay），主線不徒手 sweep。

## Good Example

- 這個例子是好的，因為每個改動都對得到上游 release 的 BC clause，一次只處理一個套件 × 一個 target version。

```text
sweep @nuxt/ui v4.2.0：每個 consumer 各開 worktree、各一個 atomic commit，改動逐條對到 release notes 的 rename clause
```

## Bad Example

- 這個例子是壞的，因為把 clade 自行發想的 cleanup 或 unrelated 套件升版搭進同一個 sweep。

```text
sweep @nuxt/ui 時順手把 zod 也升了，並重構兩個 composable
```

# Rule 2 - Fleet MCP server 釘版：chrome-devtools-mcp 只有一個 fleet 版本

- Level: `MUST`

clade 沒有 fleet MCP entry 的共同來源：`chrome-devtools-mcp` entry 是各 consumer 手放在自家 tracked 的 `.mcp.json`（不在 `.clade/runtime/mcp.json`，投影器不產它）。所以 clade 定**唯一版本**，各 consumer 各自落地，不各 repo 各自選版。版本號住在 fleet 共同工具版本 SoT：`registry/toolchain.json` 的 `tools.chrome-devtools-mcp.target`；本條只管 entry 形狀與升版紀律。

- **fleet 版本＝SoT 的 target**。entry 形狀一律 `"command": "npx", "args": ["-y", "chrome-devtools-mcp@<target>"]`，`.mcp.json` 與 `.cursor/mcp.json` 同值
- **NEVER** `@latest`、range（`@^1`、`@1.x`）或不帶版本：npx 每次啟動都可能拉到不同版本，fleet 內同一工具行為不一致、壞版上游一發就全 fleet 同時中
- **允許的差異只有一條**：其中一個 consumer 帶 `--headless`（`["-y", "chrome-devtools-mcp@<target>", "--headless"]`）。其他 consumer 要加旗標 → 先改本節再落地，**NEVER** 在 consumer 端自行分岔
- **升版一律 fleet 一次升**：先經 Phase P Step P.5 改 SoT 的 target，同一個 target 版本 sweep 所有帶 entry 的 consumer（仍受 Rule 1 准入條件約束：一個套件 × 一個 target version、每 consumer 一個 atomic commit、依 `workflow_model` 落地，`update_policy: pinned` 的 consumer 也照改——它 pin 的是 clade release，不是這個 entry）。**NEVER** 單一 consumer 先升
- **每次升版記錄**：寫在該輪 Parity rollout plan（`templates/version-parity-plan.md`），收斂以 `--matrix --tool chrome-devtools-mcp` 為準；首次釘版 rollout 在 `tasks/2026-09-30-mcp-pin/rollout.md`（2026-10-13 首掃：6 台仍 `@latest`，未落地）
- 沒有 entry 的 consumer 不因本節新增 entry；要不要裝 chrome-devtools-mcp 是該 consumer 自己的事，裝了就照本節形狀


## Good Example

- 這個例子是好的，因為entry 一律釘同一個版本，升版先改本條再整批 sweep。

```text
"command": "npx", "args": ["-y", "chrome-devtools-mcp@1.10.1"]
```

## Bad Example

- 這個例子是壞的，因為用 @latest 或 range，或單一 consumer 先升。

```text
"args": ["-y", "chrome-devtools-mcp@latest"]
```

# Rule 3 - 核心 toolchain 套件追隨 beta／rc（D3）

- Level: `MUST`
- Charles 拍板（W-2026-10-24-toolchain-rust-consolidation D3，Q3 A）：範圍內的套件，beta／rc 版本不必等 user 指名，依下表自行評估採用。範圍**以外**的套件照舊：target 取 F.1.3 discovery 的穩定版，user 指名 pre-release 時先回報「該版本只掛在 `<tag>`、`latest` 是 `<X>`」並等拍板。
- 本條只管 Phase F 的 `dependencies`／`devDependencies`；Phase T 的 pnpm／Node 與 `registry/toolchain.json` 的 SoT 工具不在範圍內，仍照 `跨環境版本對齊判準.md` Rule 7 只取穩定版。

| 項目 | 規則 |
| --- | --- |
| 範圍 | VoidZero（vite、vite-plus、vitest、rolldown、oxlint、oxfmt、oxc-\*、tsdown、tsrs）、TypeScript 原生版、Vue（vue、@vitejs/plugin-vue、vue-tsc）、Nuxt（nuxt、@nuxt/kit、nitro） |
| 候選 | `npm view <name> dist-tags --json` 的 `beta`／`rc` tag 且 semver > `latest`（過期 tag 不算），**且**發佈已滿 `minimumReleaseAge`（`npm view <name> time --json` 對 `pnpm config get minimumReleaseAge`，缺省 1440 分鐘）；未滿就等它滿齡，**NEVER** 為了提前採用把它寫進 `minimumReleaseAgeExclude`；`alpha`／`nightly` 不追，除非該套件只有 dev 通道（tsrs）；未發版的 main 不算 |
| 採用 | 對應量測（typecheck／test／build／dev 冷啟動）A/B 變快或記憶體變少，**且**同一組 gate 綠；沒量或量不出差別就留在穩定版 |
| 落地順序 | devDependencies 直接 clade → fleet；runtime 套件（vue／nuxt／nitro）先 staging 再 production |

- 採用 pre-release 時 F.1.3 帶 `--version <beta 版號>`；帶 `--version` 時 `dep-fleet-discover.ts` 不套 cutoff，所以發佈滿齡由上表「候選」列在帶之前自己核對。plan 寫明量測數字與 gate 結果；Rule 1 其餘准入條件照舊（一個套件 × 一個 target version、每 consumer 一個 atomic commit）。

## Good Example

- 這個例子是好的，因為套件在範圍內、量測變快且 gate 綠才採用 beta。

```text
typescript-native 7.1.0-beta：clade typecheck 中位數 9.68 s → 8.14 s、峰值 2.0 GB → 1.5 GB，診斷 0 → 採用，先 clade 再 fleet
```

## Bad Example

- 這個例子是壞的，因為範圍外的套件沒經拍板就追 rc，或範圍內但沒量測、沒滿發佈冷卻期就採用。

```text
「@nuxt/ui 有 rc 了比較新」→ 直接當 target；或 vite 8.1.0-beta 沒跑 A/B 就整批 sweep；或昨天才發的 rc 帶 `--version` 繞過 cutoff、再塞進 `minimumReleaseAgeExclude`
```
