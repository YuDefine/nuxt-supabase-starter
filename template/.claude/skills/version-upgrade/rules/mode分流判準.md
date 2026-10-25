# mode 分流判準

觸發點：SKILL.md Step 0（每一次啟動本 skill，判 route 之前）與「進 Phase」步。

# Rule 1 - 依「為什麼要動版本 × 動到哪個範圍」兩軸分流，route 由 script 算；判不出 MUST 等 user 拍板

- Level: `MUST`

同一個理由換範圍時不換流程，只換 Phase。兩軸由 script 算，**NEVER** 自己推：

```bash
uv run <skill 根目錄>/scripts/mode_route.py [--plan <計畫檔>] [--reason <理由>]… [--scope <範圍>] -- <使用者給 /version-upgrade 的參數>
```

依 stdout 的 `route=`（`<理由>.<範圍>`，複選時逗號分隔）與同序的 `phase=` 分流；`cwd_kind`／`input_shape` 的定義只在 script 的 docstring。複選時依 `phase=` 的順序逐一跑完，每一段各自過自己的 gate。

### 入口表：理由 × 範圍 → Phase

script 的 `PHASES` 與本表同義；改一邊 MUST 同改另一邊與 `test/version-upgrade-mode-route.test.ts`。

| 理由 ＼ 範圍 | `consumer` 這個 consumer | `fleet` 全 fleet | `clade` clade 自身（含散出去的範本） | `machine` 本機 | `remote` runner／staging／prod |
| --- | --- | --- | --- | --- | --- |
| `routine` 例行補落後（G1） | Phase B→C→D | Phase F-routine | Phase K | Phase M | Phase P |
| `release` 追某個上游 release（單一套件 × 版本） | Phase B（只收該套件）→C→D | Phase F | Phase K | Phase M | Phase P |
| `toolchain` packageManager／runtime | Phase T（consumer 內） | Phase T | Phase T 的 T.5（clade 自身一行） | Phase M（Node 走 M.2 gate） | Phase P |
| `deprecated` EOL／deprecated／改名（G13） | Phase B（`isDeprecated` 列進同一計畫） | Phase F-routine | Phase K | Phase M | Phase P |
| `security` 依賴安全通報（G6） | Phase B（`inventory.py --audit`，目標＝已修補版） | Phase F-routine（各 consumer 跑 `security.consumer`） | Phase K（`--audit`） | 不收 | 不收 |
| `rollback` 上游壞版釘回（G7） | Phase C（目標＝上一個好版，跳過盤點） | Phase F（准入改用 advisory／issue，見 `rules/fleet准入與釘版判準.md` Rule 1） | Phase K | Phase M（M.3 先記下的現版號就是回退目標） | 不收 |
| `skills` 第三方 skill 上游 | Phase S | Phase S | Phase S＋starter 範本清單（G14） | 不收 | 不收 |
| `major` framework major migration（G12） | 不收：`out.work-route`，交該 consumer 的 `/work-route` 開專屬 plan | 不收：relay 各 consumer 自己開 | 不收：clade 自己 `/work-route` | — | — |
| `non-node` 非 Node 生態（Go 等：某 Go consumer） | 不收：`out.non-node`，relay 該 consumer 自己處理；本 skill 屬 `ecosystem/node`，**NEVER** 假裝涵蓋 | 同左 | — | — | — |

### route → 動作

評估：first-match；以上皆非 → R*

| id | `route` | 動作 | 跳到 |
| --- | --- | --- | --- |
| R1 | `resume` | 從 `resume_item=` 那一列續跑；`resume_route=` 是計畫檔表頭的 route，`phase=` 由它算（Phase B 的計畫續跑從 C；表頭讀不到 route 時印 `phase=C`） | `phase=` 那一個 Phase（B／C → `phases/consumer-batch.md` Step C.1） |
| R2 | `<理由>.<範圍>`（一或多個） | 依 `phase=` 逐段進入 | 入口表那一格的 Phase |
| R3 | `out.work-route`／`out.non-node` | 不升，回報去處並停 | 入口表那一格寫的去處 |
| R4 | `judge` | 依下方語意表判出理由與範圍，帶 `--reason`／`--scope` **重跑** script | 語意表 J |
| R5 | `ask` | STOP，用 `candidates=` 問 § Disambiguation 的 D1 | 等 user 拍板 |
| R* | `mismatch`、其他值、exit 非 0 | STOP，回報 script 原始輸出並問意圖 | 等 user 拍板 |

`route=judge` 時輸入是自然語言，只能語意判讀：

評估：first-match；以上皆非 → J*

| id | 使用者原話提到 | 理由 | 範圍 |
| --- | --- | --- | --- |
| J1 | 「Node 版本」這類同時命中 toolchain／本機／各環境的字眼 | 先照 Rule 2 分辨 | 先照 Rule 2 分辨 |
| J2 | submodule-tracked 上游（「SpecFormula／aixbdd 上游動了」「specformula pin 落後」「audit-upstream-submodules 報落後」「fork 的 patch」「vendor/specformula」） | `skills` | `clade`（Phase S 的 submodule 段 → `docs/dev-guide.md` § 6.5） |
| J3 | **skill** 上游／落後／新增（「supabase skill 上游更新了我們有跟嗎」「掃一下 skill 有沒有落後」「starter 的 install-skills.sh」） | `skills` | 原話有 starter／範本 → `clade`；其餘 `fleet` |
| J4 | **本機裝的東西**落後（「supabase cli 該升了嗎」「codebase-memory-mcp 有新版嗎」「mise 那堆工具掃一下」「全域 npm／claude-code 自己的版本」） | `routine` | `machine` |
| J5 | 同一工具在各環境是否同版（「dev／staging／prod 的 supabase CLI 一樣嗎」「fleet 版本對齊了沒」），或 runner／staging／prod 上的版本落後（「runner 上的 supabase cli 幾版」「prod 跑的 node 幾版」） | `toolchain` | `remote` |
| J6 | package manager／runtime 本身（「升 pnpm」「fleet packageManager 統一」） | `toolchain` | cwd 是 clade home → `fleet`；consumer → `consumer` |
| J7 | CVE／GHSA／`pnpm audit`／「有安全通報」「漏洞」 | `security` | cwd 是 consumer → `consumer`；clade home 且說「全 fleet」→ `fleet`；說「clade 自己」→ `clade` |
| J8 | 「新版壞了要退回」「釘回上一版」「降版」 | `rollback` | 同 J7 |
| J9 | 「deprecated」「EOL」「改名了」「被棄用」 | `deprecated` | 同 J7 |
| J10 | 「掃一輪」「全部更新」「都升一升」「版本都掃一輪」 | `routine`（原話點名多種時複選，G2） | 同 J7；clade home 且沒說範圍 → `ask` |
| J11 | framework major（Nuxt／Next／React／Vue 的 major bump、「migration」） | `major` | 任一 |
| J12 | Go／Rust／Python 依賴（`go.mod`） | `non-node` | 任一 |
| J13 | 純 pkg name（「升 @nuxt/ui」「無腦升 X」） | `release` | cwd 是 clade home → `fleet`（Phase F 的 Discovery）；consumer → `consumer` |
| J* | 以上皆非 | STOP，問 § Disambiguation 的 D2 | 等 user 拍板 |

#### Disambiguation（範圍或理由判不出）

| id | 問句 |
| --- | --- |
| D1 | 「這次要動哪個範圍？列出 `candidates=` 的每一個（例：`routine.fleet` 全 fleet 各補一輪、`routine.clade` clade 自己與散出去的範本）；可複選。」 |
| D2 | 「為什麼要動版本？(A) 例行補落後 (B) 追某個上游 release (C) toolchain／runtime (D) 安全通報 (E) 上游壞版要釘回 (F) 第三方 skill 上游 (G) 各環境版本對齊；可複選。」 |

**MUST 等 user 拍板**，**NEVER** 主線自選理由或範圍。

## Good Example

- 這個例子是好的，因為先讓 script 算 route，judge 才語意判讀，判完帶旗標重跑。

```text
在 clade home 收到「升 @nuxt/ui」→ route=judge → J13 → mode_route.py --reason release --scope fleet → route=release.fleet phase=F
```

## Bad Example

- 這個例子是壞的，因為範圍判不出時主線自選，且把 worktree 當成續跑訊號。

```text
在 consumer worktree 無參數 → 自行決定「那就從 Phase C 續跑」（沒有 --plan）
```

# Rule 2 - 「Node 版本」同時命中 Toolchain（Phase T）、Machine 與 Parity 時先分辨

- Level: `MUST`

**「Toolchain（Phase T）」「Machine」「Parity」都會被「Node 版本」這句話命中，MUST 先分辨再走。**
三者管的是同一個工具名底下的**不同東西**，選錯會去改一個跟症狀無關的地方：

| 使用者其實在講 | 判準 | Mode |
| --- | --- | --- |
| repo 裡**宣告**的版本（`engines.node` / `.nvmrc` / CI `node-version` / `packageManager`）跨 consumer 不一致 | 症狀出現在 **CI** 或 **別台 consumer** 上 | **Toolchain（Phase T）** |
| **這台機器上裝的**那個 node / 那支 CLI 落後 | 症狀出現在**本機指令**上（`node -v` 不對、某支 CLI 沒有新功能） | **Machine（Phase M）** |
| 不知道是哪一層不一致，或症狀出現在 **runner／staging／prod**（部署後行為不同、self-hosted job 紅燈） | 要先看各層現值才知道落後在哪 | **Parity（Phase P）**（P.3 會把找到的落差分派回 Fleet／Machine） |

判不出來就問，**NEVER** 自己挑一邊——Fleet 與 Machine 的動作沒有交集，猜錯等於整趟白跑；只想先知道「哪裡不一致」時就是 Parity。

## Good Example

- 這個例子是好的，因為依症狀出現在 CI／別台 consumer 還是本機指令判定。

```text
「CI 的 node-version 跟 .nvmrc 不一致」→ 症狀在 CI → Toolchain（Phase T）
```

## Bad Example

- 這個例子是壞的，因為判不出來時自己挑一邊。

```text
「Node 版本怪怪的」→ 直接跑 Phase M 升本機 node
```

# Rule 3 - 四個軸決定誰動手：C 軸與 C′ 軸由 Parity 掃描與追蹤，NEVER 由 clade 執行升級

- Level: `MUST`

### 四個軸（決定誰動手）

| 軸 | 版本宣告在哪 | git 載體 | 落點 |
| --- | --- | --- | --- |
| **A. Repo-declared** | `package.json` / lockfile / workflow yaml / `.nvmrc` | ✅ commit | Phase B–D／F／F-routine／K／T／S |
| **B. Machine-installed** | mise config / 全域 npm / `~/.local/bin` / `.mcp.json` | ❌ | **Phase M** |
| **C. Remote-deployed** | LXC / VM 上實際跑的版本 | ❌ | **Phase P**：掃描、rollout plan、收斂追蹤；升級 relay 給該 consumer（優先把版本寫回 repo） |
| **C′. Runner-installed** | self-hosted runner 上被 workflow 裸呼叫的預裝 binary（`supabase` / `gh` / `docker` / `node`…） | ❌ | **Phase P**：同上；優先改 setup action 釘版，只能預裝的交 runner 主機 owner |

C／C′ 軸的**執行**刻意留在外面：升遠端 staging / prod 的 runtime 是 consumer 的 production 動作，clade 主線
替它動手正是 `.claude/skills/clade-home/rules/clade-role-and-todo-discipline.md` § 反模式 逐字禁止的那件事。
clade 擁有的是 fleet 共同版本（`registry/toolchain.json`）、跨環境掃描與收斂追蹤（Phase P）。
**NEVER** 因為「使用者問的是版本、本 skill 就叫 version-upgrade」由 clade 執行遠端升級；也 **NEVER** 因為執行不歸 clade 就只出訊號不追收斂。

## Good Example

- 這個例子是好的，因為遠端環境的版本落後只出訊號並 relay 給該 consumer。

```text
「prod 上的 runtime 幾版」→ Phase P：矩陣 → rollout plan → relay 給該 consumer 的 session → 重跑矩陣確認收斂
```

## Bad Example

- 這個例子是壞的，因為因為使用者問的是版本，就由 clade 主線動手升遠端環境。

```text
「staging 的 supabase 太舊」→ 主線 ssh 進去升版
```

# Rule 4 - 進 Phase 之前 MUST 先完整讀該 Phase 檔；有 git 載體的紀律不外溢到 Machine／Parity

- Level: `MUST`

| Phase | MUST 先完整讀 | 起點 |
| --- | --- | --- |
| B／C／D | [phases/consumer-batch.md](../phases/consumer-batch.md) | B.1（`resume` 從 C.1） |
| F | [phases/fleet.md](../phases/fleet.md) | F.1 |
| T | [phases/toolchain.md](../phases/toolchain.md)；`toolchain.fleet` 再讀 phases/fleet.md 的 F.1–F.8，`toolchain.consumer` 只讀其 F.2、F.7 | T.1（`toolchain.consumer` 從該檔 § toolchain.consumer 步序第 1 步） |
| S | [phases/skills.md](../phases/skills.md) | S.1 |
| M | [phases/machine.md](../phases/machine.md) | M.1 |
| P | [phases/parity.md](../phases/parity.md) | P.1 |
| F-routine、K | SKILL.md 同名段 | 該段第一步 |

**Phase S 不動 `package.json`／lockfile**，`rules/A軸共用紀律判準.md` 的派工模板對它不適用；它的紀律在 phases/skills.md 自帶。

**Phase M 沒有任何 git 載體**——`rules/A軸共用紀律判準.md` 的 Worktree gate、派工模板、selective stage、三層 verify **全部零適用**，**NEVER** 因為它們寫在本 skill 就套過去；它自己的三條紀律（序列執行、先釘現版號、驗證要真實呼叫）在 phases/machine.md。

**Phase P 不動 consumer 的 lockfile**——Worktree gate、派工模板對它不適用；它的判準在 `rules/跨環境版本對齊判準.md`（Step P.3 讀）。

## Good Example

- 這個例子是好的，因為先完整讀 Phase 檔再開始第一步。

```text
route=skills.fleet → 完整讀 phases/skills.md → Step S.1（不跑 wt-gate、不用派工模板）
```

## Bad Example

- 這個例子是壞的，因為把有 git 載體的 Worktree gate 與三層 verify 套到 Phase M。

```text
Phase M 升 mise 工具前先開 worktree
```
