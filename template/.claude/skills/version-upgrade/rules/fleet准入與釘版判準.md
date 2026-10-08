# Fleet 准入與釘版判準

觸發點：SKILL.md「進 mode」步（進 Fleet mode；fleet-mode.md Step F.2.3 逐條自查）與動到 consumer `.mcp.json` 的 chrome-devtools-mcp entry 時。

# Rule 1 - Fleet mode carve-out 准入（SoT）

- Level: `MUST`

> 本條是 [[clade-role-and-todo-discipline]] § upstream-driven dep migration 的准入條件 SoT（2026-08-02 自該 rule 移入）；rule 端只留觸發判定 stub。Fleet 流程 Step F.2.3 對本條逐條自查。

每次 Fleet sweep **必須**全部滿足：

- ✅ 變動一對一對應上游 release 列出的 BC（rename / removal / signature change / config schema 變更）— 找不到對應 clause 的改動，不准帶進來
- ✅ 每個 consumer 各自開 worktree（per [[wt]] 的 `rules/改tracked檔前先隔離判準.md` Rule 1），不在 main 直接動
- ✅ 每個 consumer 一個 atomic commit，依該 consumer `registry/consumers.json` 的 `workflow_model` 走（trunk-based 直接 push、pr-merge-based 開 PR）
- ✅ 一次 sweep 只處理「**一個套件 × 一個 target version**」，不跨多套件 / 多 release 混在同一 sweep
- ✅ Toolchain sweep（pnpm / Node 自身）額外一條：target **MUST 是 `latest` dist-tag 指到的版本**，pre-release tag 一律不進 fleet（toolchain 壞掉是全 consumer 同時無法 build，不像單一套件只影響用到它的地方）
- ✅ 命中該套件的 consumer 才動；沒命中的 consumer **NEVER** 順便動其他東西

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

clade 沒有 fleet MCP entry 的共同來源：`chrome-devtools-mcp` entry 是各 consumer 手放在自家 tracked 的 `.mcp.json`（不在 `.clade/runtime/mcp.json`，投影器不產它）。所以釘版由 clade 在這裡定**唯一版本**，各 consumer 各自落地，不各 repo 各自選版。

- **目前 fleet 版本：`chrome-devtools-mcp@1.10.1`**。entry 形狀一律 `"command": "npx", "args": ["-y", "chrome-devtools-mcp@1.10.1"]`，`.mcp.json` 同值
- **NEVER** `@latest`、range（`@^1`、`@1.x`）或不帶版本：npx 每次啟動都可能拉到不同版本，fleet 內同一工具行為不一致、壞版上游一發就全 fleet 同時中
- **允許的差異只有一條**：其中一個 consumer 帶 `--headless`（`["-y", "chrome-devtools-mcp@1.10.1", "--headless"]`）。其他 consumer 要加旗標 → 先改本節再落地，**NEVER** 在 consumer 端自行分岔
- **升版一律 fleet 一次升**：先改本條的「目前 fleet 版本」，同一個 target 版本 sweep 所有帶 entry 的 consumer（仍受 Rule 1 准入條件約束：一個套件 × 一個 target version、每 consumer 一個 atomic commit、依 `workflow_model` 落地，`update_policy: pinned` 的 consumer 也照改——它 pin 的是 clade release，不是這個 entry）。**NEVER** 單一 consumer 先升
- **每次升版記錄**：在下表追加一列（日期、版本、理由／上游 changelog 連結、rollout 清單路徑）
- 沒有 entry 的 consumer 不因本節新增 entry；要不要裝 chrome-devtools-mcp 是該 consumer 自己的事，裝了就照本節形狀

| 日期 | 版本 | 理由 | rollout |
| --- | --- | --- | --- |
| 2026-09-30 | 1.10.1 | 由 `@latest` 改為釘版（某 consumer 的 TD-021；當日 npm `latest` dist-tag） | `tasks/2026-09-30-mcp-pin/rollout.md` |

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
