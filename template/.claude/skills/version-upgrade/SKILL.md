---
name: version-upgrade
description: >-
  依「為何升 × 升哪裡」升版：補落後、追上游、toolchain、deprecated、安全通報、壞版回退、第三方
  skill；範圍：consumer／fleet／clade／本機／跨環境。NOT for 升版後行為壞掉找原因（用 diagnose）、NOT for
  記錄升版踩坑（用 oops）、NOT for 把 clade 改動散播給 consumer（用 clade-publish）。
metadata:
  clade:
    invocation: explicit
    permission_tier: action
disable-model-invocation: true
---


# version-upgrade — 統一版本升級入口

Step 0 算出 `route=<理由>.<範圍>` 再跳 Phase。每一步只讀該步命中的檔，**NEVER** 一次讀完 `rules/`、`phases/`。

## Phase 0 — 入口

- Step 0（Route）. READ 若啟動本 skill，讀取 `rules/mode分流判準.md`，執行 `uv run <skill 根目錄>/scripts/mode_route.py [--plan <計畫檔>] -- <參數>`，依 `route=`／`phase=` 分流。判不出 **MUST 等 user 拍板**；有上一輪計畫檔才帶 `--plan`，**NEVER** 因 cwd 是 worktree 就當續跑。
- Step 0.1. READ 若範圍是 `consumer`，或 `cwd_kind=consumer`（含在 consumer 內觸發的 `machine`），進 Phase 之前**每一次**跑 `node ~/offline/clade/scripts/consumer-policy-upgrade-prompt.ts --json`，讀取 `rules/更新政策詢問判準.md`，依 `ask: true`／`ask: false`／exit 1／exit 2 處置。
- Step 0.2（目標刷新）. READ 若 Phase 是 P、M 或 T，進 Phase 前**每一次**跑 `node ~/offline/clade/scripts/audit-ci-toolchain-parity.ts --refresh-targets`，讀取 `rules/跨環境版本對齊判準.md` Rule 7。
- Step 0.3（計畫檔）. 若 Phase 是 B、C、F、F-routine 或 K，讀取 `templates/upgrade-plan.md`：`resume` 續用 `--plan` 那份，否則在 B.4（F 在 F.5）開新檔，落點 clade home 是承載 plan package（`specs/plans/<work-id>`）下的 `upgrade-<YYYY-MM-DD>.md`，consumer 是它自己的 plan package。
- Step 0.4（Worktree gate）. READ 若 Phase 是 B、C、D、F、F-routine、K 或 T（會動 `package.json`／lockfile／workflow 或計畫檔），讀取 `rules/A軸共用紀律判準.md`，跑 `node ~/offline/clade/vendor/scripts/wt-gate.ts --for version-upgrade`，exit 0 才可改檔或 commit。Phase S、M、P 不跑這一步——S 的隔離紀律在 `phases/skills.md` 自帶。
- Step 0.5（進 Phase）. **MUST** 先完整讀 `rules/mode分流判準.md` Rule 4 指向的 Phase 檔。READ 若進 Phase F 或要動 `.mcp.json` 的 chrome-devtools-mcp，讀取 `rules/fleet准入與釘版判準.md`。

## Phase F-routine — 全 fleet 例行補落後（`routine.fleet`、`deprecated.fleet`、`security.fleet`）

clade 不替 consumer 升版，只彙總。

- Step FR.1. 讀 `registry/consumers.json`＋`consumers.local` 列出 consumer；`paused` 標 `skipped`、非 Node 標 `out.non-node`，都不派。
- Step FR.2. 開計畫檔（fleet 段），每個 consumer 一列 `pending`。
- Step FR.3. 逐一 relay 給該 consumer 的 session（[[clade-role-and-todo-discipline]] § Consumer 工作命中時 MUST relay），brief 只寫 `/version-upgrade --reason <理由> --scope consumer`（`mode_route.py` 吃這兩個旗標直接判 route，不落 `judge`）＋「計畫檔路徑回報 clade」。**NEVER** 在 clade 主線改 consumer。
- Step FR.4. 回報到就更新該列；全部結案才算完成。

## Phase K — clade 自身（`<理由>.clade`）

- Step K.1. 在 clade worktree 跑 B.1，加 `--fixture-dir vendor/snippets`（範本走 fixture；skill 文件內嵌的 `uses:` 是 `manual` 列，不自動改）。
- Step K.2. 其餘照 B→C→D，落地走 commit skill，範本改動再走 [[clade-publish]]。

## 參考

- Phase 檔各步自己 READ 的判準、樣板與腳本（索引，不在入口讀）：`rules/依賴變更判準.md`、`rules/changelog分類判準.md`、`rules/批次分組判準.md`、`scripts/inventory.py`、`templates/first-pass.md`、`templates/research.md`、`templates/fleet-subagent-brief.md`、`templates/upgrade-plan.example.md`、`templates/version-parity-plan.md`、`templates/version-parity-plan.example.md`。

- 命名史與相關規約出處：`docs/rule-rationale/version-upgrade.md`（有人提議改名時才讀）。


## Claude host contract

Resolve `<skills-root>` and `<native-skills>` to `.claude/skills/`. The shared `npx skills` CLI remains the installer and uses the commands in the common workflow. For mutation dispatch, use `Bash(run_in_background=true)` and collect with `TaskOutput`/`TaskStop`; use `ScheduleWakeup` for the single inert keepalive. User questions use the native question surface, with plain conversation as the fallback when structured questions are unavailable.

Runtime bindings: `<runtime-target>` is `claude`; `<runtime-agent>` is `claude-code`.
