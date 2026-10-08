# A 軸共用紀律判準（Outdated／Fleet）

觸發點：SKILL.md「Worktree gate」步（mode 拍板為 Outdated 或 Fleet，跑任何 `pnpm add`／`git add`／`git commit` 之前）。

# Rule 1 - A 軸共用基礎：模板、watch protocol、selective stage、commit msg

- Level: `MUST`

| 基礎 | 出處 |
| --- | --- |
| Worktree gate | [[wt]] 的 `rules/改tracked檔前先隔離判準.md` Rule 1，wt-helper 開 / merge-back。**機械檢查點見本檔 Rule 2** |
| Pi 派工模板 | `vendor/snippets/pi-upgrade-prompts/{first-pass,research}.md`（authoring source），`references/pi-prompt-templates.md` 是 plugin cache 副本 |
| Pi watch protocol | [[agent-routing.pi-watch-protocol]] |
| Selective stage on main | 一律 `git add package.json <lockfile>` + 額外指定檔，**NEVER** `git add -A` |
| Commit msg（commitlint-aware） | subagent / pi 端讀 consumer commitlint config 後生 compliant msg |

## Good Example

- 這個例子是好的，因為main 端只 stage 指定檔。

```text
git add package.json pnpm-lock.yaml
```

## Bad Example

- 這個例子是壞的，因為在 main 用 git add -A 撈走別的 session 的改動。

```text
git add -A && git commit
```

# Rule 2 - Worktree gate fail-closed：exit 0 才可繼續

- Level: `MUST`

**本條只管 A 軸的兩個 mode（Outdated / Fleet）。** Skills mode 與 Machine mode 不動 `package.json` / lockfile，gate 對它們零適用——**NEVER** 為了「保險」對一個不產生檔案改動的操作開 worktree，那沒有隔離作用，只讓你以為有。

Mode 分流拍板後、跑**任何** `pnpm add` / `git add` / `git commit` 之前，**MUST** 先跑：

```bash
node ~/offline/clade/vendor/scripts/wt-gate.ts --for version-upgrade
```

exit 0 才可繼續。exit 2（cwd 在 main working tree）**MUST** 停下開 worktree 再重跑，
**NEVER** 加 `|| true`、**NEVER** 改判成 warning、**NEVER** 因為「這次只改兩個檔」跳過。
gate 沒有 `--allow-main` escape hatch，這是刻意的。

> 這條在 2026-07-29 之前只是文字規約，實測擋不住：某 consumer 的 sweep 在 main 生出 per-package
> 迴圈跑起來，`git add package.json` 撈走另一個 session 未 commit 的 `pnpm version patch`，
> 同時 `.git/index.lock` 讓對方的 `git commit` 直接失敗（TD-277）。commit message 的
> `wt ` 前綴當時**不**保證真的在 worktree——接上 gate 之後才保證。

## Good Example

- 這個例子是好的，因為gate 非 0 就停下開 worktree 再重跑。

```text
node ~/offline/clade/vendor/scripts/wt-gate.ts --for version-upgrade → exit 2 → 開 worktree → 重跑 → exit 0 → 繼續
```

## Bad Example

- 這個例子是壞的，因為加 || true 或因只改兩個檔跳過 gate。

```text
node ~/offline/clade/vendor/scripts/wt-gate.ts --for version-upgrade || true
```

# Rule 3 - Outdated 與 Fleet 共同的禁止事項

- Level: `MUST`

- **NEVER** 在 main working tree 跑 — Outdated 與 Fleet 都受此規約，由 `wt-gate.ts` fail-closed 強制（見本檔 Rule 2）
- **NEVER** 主線自己改 `package.json` 或在升版階段（Step O.2）跑 `pnpm add` / `pnpm install`（升版全程委派給 pi / subagent）。**例外**：Step O.3.2.c post-merge-back `pnpm install` 是 setup chore，不是升版動作；以及 provider／配額不可用、該 package 的執行鏈走完（[outdated-mode.md](outdated-mode.md) § O.2.2）時由主線照同一份 per-package brief 接手升版——品質失敗不適用這條，見下一條
- **NEVER** first-pass 失敗就直接問使用者 — 必須先自動升 research（`version-upgrade-research` 列，見 `outdated-mode.md` § O.2.4；靠研究不靠抬 effort）
- **NEVER** research 也**品質失敗**就主線自己接手 — 必須 runtime-native question interface 讓使用者選（provider／配額不可用走完鏈才是主線接手，那不是品質失敗）
- runtime-native question interface 分成兩個能力判定：沒有 structured question 但普通對話與 exec session 可用時，直接在當前對話詢問使用者，**NEVER** 換 runtime；使用者已選 retry 但沒有可驗證的 background execution/completion surface 時，只阻擋依賴該 dispatch 的步驟、保留 worktree 與 durable task，**NEVER** 宣稱整個互動不可用。
- **NEVER** 把 merge-back 當「下一步」丟給 user 自己跑（per [[wt]] 的 `rules/就緒池交接判準.md` Rule 5）
- pi 派工 prompt 第一行 MUST 含 `[DELEGATED-BY-CLAUDE-CODE]` marker（codex 端 Runtime Gate 驗證此 marker 存在）
- **NEVER** 派 pi 時把 sandbox 換成 `read-only` / `workspace-write`（會擋 MCP）
- **NEVER** 把上列Pi sandbox mode與`workspace_access`混為一談：version-upgrade一律是`mutation`
- **NEVER** `git add -A` / `git add .` 在 main — 一律 selective stage

Mode-specific 禁止事項見 [outdated-mode.md](outdated-mode.md)、[fleet-mode.md](fleet-mode.md)、[skills-mode.md](skills-mode.md) 與 [machine-mode.md](machine-mode.md) 尾段。

## Good Example

- 這個例子是好的，因為first-pass 失敗先自動升 research，品質失敗才交使用者選。

```text
first-pass FAILURE → 自動派 version-upgrade-research 列 → research 也品質失敗 → runtime-native question interface 讓使用者選
```

## Bad Example

- 這個例子是壞的，因為first-pass 失敗就直接問使用者，或主線自己改 package.json。

```text
first-pass FAILURE → 主線自己 pnpm add <pkg>@<to>
```
