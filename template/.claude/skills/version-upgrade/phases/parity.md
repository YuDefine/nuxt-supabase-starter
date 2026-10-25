# Phase P — 跨環境工具版本對齊（dev → CI → runner → staging／prod，`<理由>.remote`）

管的是**同一個工具在每一層是不是同一版**：repo 宣告、CI workflow、Dockerfile image、self-hosted runner 預裝、部署目標 runtime，外加本機。共同目標寫在 `~/offline/clade/registry/toolchain.json`（fleet 共同工具版本 SoT）。

本 Phase 擁有 SoT、掃描與收斂追蹤；**不執行**任何遠端升級。它只產生 rollout plan、relay 與 clade 自有宣告面的修補，不動 consumer 的 lockfile，所以 `rules/A軸共用紀律判準.md` 的 Worktree gate 與 Pi 派工模板不適用；改 clade 自己的 SoT／registry 時照 clade-home 先開 worktree。

---

## Step P.1 — 讀 SoT，定本輪範圍

READ `~/offline/clade/registry/toolchain.json`（已經過 SKILL.md「目標刷新」步，target 即本輪共同可達最新版），記下本輪要比的工具（使用者指名的工具；沒指名就是全部 policy ≠ measure-only 的工具）與各自的 policy／target。cwd 是 consumer root 時，範圍收斂成「本 consumer」。

## Step P.2 — 產出跨環境矩陣

```bash
node ~/offline/clade/scripts/audit-ci-toolchain-parity.ts --matrix [--tool <name>] [--consumer <name>]
node ~/offline/clade/scripts/audit-ci-toolchain-parity.ts --matrix --json [...]   # 每格的 observations（檔案:行）
```

預設不連任何遠端。要量 runner 或 self-hosted 主機的實際版本，照 Step P.3 讀到的判準在授權 session 另跑探測。

## Step P.3 — 判讀並寫出 rollout plan

READ 讀取 `rules/跨環境版本對齊判準.md`，逐格判讀狀態、為每個 `drift`／`unpinned`／`undeclared` 取升級路徑序位。再讀取 `templates/version-parity-plan.md` 與 `templates/version-parity-plan.example.md`，依骨架寫出 rollout plan：

- cwd 是 clade home：寫進承載本輪的 flow plan package（`specs/plans/<work-id>/rollout-<YYYY-MM-DD>.md`；沒有承載 plan 就先 `node vendor/scripts/flow/flow.ts plan open version-parity-<tool> --title '…'`）
- cwd 是 consumer root：這是該 consumer 自己的工作，依它的 work-route 開或續它自己的 package，不 relay

## Step P.4 — 分派並送達

依 rollout plan 的升級路徑分派：Phase F／T／M 在本 skill 內接手；relay 列照 `.claude/skills/clade-home/rules/clade-role-and-todo-discipline.md` § Consumer 工作命中時 MUST relay 當下送達，brief 只帶訊號＋SoT pointer＋該列驗收；`flow ask` 列進待拍板佇列。送達後把該列狀態改成 `relayed` 並附 pane／label。

## Step P.5 — 重跑收斂，必要時調整 SoT

- consumer 回報完成、或再次進入 Phase P 時，重跑 Step P.2，依結果更新 rollout plan 的狀態與「收斂紀錄」；狀態規則在已載入的判準。
- SoT target 的取值規則已定（每次取共同可達最新版，Rule 7）：`--refresh-targets --write` 在 clade worktree 寫回（supabase CI 範本副本一起改，`test/toolchain-registry.test.ts` 釘住），走 [[clade-publish]]，再回 Step P.2。只有 `manual`／`error` 列、或要偏離規則（釘在舊版、跳過某版）才問 user。

---

# 禁止事項（Phase P 限定）

- **NEVER** 從 clade session ssh 進 runner／staging／prod 升版或改設定
- **NEVER** 只登記 rollout plan 就當已處置——登記是紀錄，relay 才是送達
- **NEVER** 在 consumer 端改 `.clade/registry/toolchain.json` 投影副本；SoT 只在 clade 改
