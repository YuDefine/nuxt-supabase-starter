---
name: version-upgrade
description: consumer outdated batch、fleet 套件 sweep、skill 上游同步、本機 toolchain 升級。
metadata:
  clade:
    invocation: explicit
    permission_tier: action
disable-model-invocation: true
---


# version-upgrade — 統一版本升級入口

Outdated batch、Fleet sweep、Skills、Machine 四種升級需求一個入口，依輸入與 cwd 分流。每一步只讀該步命中的檔，**NEVER** 一次讀完全部 `rules/`。

- Step 0（Mode dispatcher）. READ 若啟動本 skill，讀取 `rules/mode分流判準.md`，依輸入與 cwd 判 mode（含不收的 C 軸）。cwd 與輸入不符就問，**MUST 等 user 拍板**，**NEVER** 主線自選 mode。
- Step 0.5. READ 若 cwd 是 consumer root，進 mode 之前**每一次**跑 `node ~/offline/clade/scripts/consumer-policy-upgrade-prompt.ts --json`，讀取 `rules/更新政策詢問判準.md`，依 `ask: true`／`ask: false`／exit 1／exit 2 處置。
- Worktree gate. READ 若 mode 是 Outdated 或 Fleet，讀取 `rules/A軸共用紀律判準.md`，跑 `node ~/offline/clade/vendor/scripts/wt-gate.ts --for version-upgrade`，exit 0 才可跑任何 `pnpm add`／`git add`／`git commit`。Skills 與 Machine 不跑這一步。
- 進 mode. **MUST** 先完整讀該 mode 檔再開始它的第一步：
  - Outdated → [outdated-mode.md](outdated-mode.md)，Step O.1
  - Fleet → [fleet-mode.md](fleet-mode.md)，Step F.1。READ 若進 Fleet mode，或要動 consumer `.mcp.json` 的 chrome-devtools-mcp entry，讀取 `rules/fleet准入與釘版判準.md`
  - Skills → [skills-mode.md](skills-mode.md)，Step S.1
  - Machine → [machine-mode.md](machine-mode.md)，Step M.1
- 派工模板. READ 若要生成 Pi／subagent 的升版 prompt（Outdated、Fleet），讀取 `references/pi-prompt-templates.md`。
- 參考. READ 若有人提議改 skill 名，或要追相關規約出處，讀取 `references/命名與相關規約.md`。


## Claude host contract

Resolve `<skills-root>` and `<native-skills>` to `.claude/skills/`. The shared `npx skills` CLI remains the installer and uses the commands in the common workflow. For mutation dispatch, use `Bash(run_in_background=true)` and collect with `TaskOutput`/`TaskStop`; use `ScheduleWakeup` for the single inert keepalive. User questions use the native question surface, with plain conversation as the fallback when structured questions are unavailable.

Runtime bindings: `<runtime-target>` is `claude`; `<runtime-agent>` is `claude-code`.
