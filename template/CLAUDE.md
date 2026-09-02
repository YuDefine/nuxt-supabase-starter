@RTK.md

## Language

- 一律使用繁體中文，不要使用簡體中文。

## Source Of Truth

兩層來源 — 上游進來、下游投影出去，**永遠單向**：

```
clade（~/offline/clade）         ← 跨專案共用中央倉
  └→ .claude/                     ← 本專案 source（Claude Code First）
       └→ .codex/ / .agents/ / AGENTS.md    ← sync-to-agents 投影
```

- 上游：`rules/`、`skills/`、部分 `hooks/`、`scripts/` 由 clade 治理（見 `.claude/.hub-state.json` 的 checksum 清單）。要改這些**先改 clade 中央倉**，跑 `pnpm hub:sync` 投到本專案；直接在 `.claude/rules/` 等改 → SessionStart `_bootstrap-check.sh` 會自動還原 + commit hook 會擋。
- 本層：`.claude/` 是本專案唯一 source（settings.json、hub.json、本地 commands/agents、business-specific hooks）。
- 下游：`.codex/`、`.agents/`、`AGENTS.md` 全是 sync-to-agents 從 `.claude/` 投影出來。**禁止**直接編輯，要改先回 `.claude/` 改、再跑 `node ~/.claude/scripts/sync-to-agents.mjs` 重投影。

常用命令：

| 動作                                | 命令                                        |
| ----------------------------------- | ------------------------------------------- |
| 從 clade 拉新版到本專案             | `pnpm hub:sync`                             |
| 檢查本專案 vs clade drift           | `pnpm hub:check`                            |
| 從 `.claude/` 重投影到 codex/agents | `node ~/.claude/scripts/sync-to-agents.mjs` |
| 完整 bootstrap（首次）              | `pnpm hub:bootstrap`                        |

<!-- SPECTRA:START v1.0.2 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`
- Commit only files related to a specific change → `/spectra-commit`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `/spectra-apply` and `/spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

> Spectra 版號對照：app 版本（如 `2.2.5`，你日常看到的）跟上方 SPECTRA marker（如 `v1.0.2`）是兩條獨立軌道 — marker 只在 Spectra 改 instruction template 時才跳號。

## Project Focus

- 這是可直接執行的 Nuxt + Supabase starter template；入口文件見 `../docs/QUICK_START.md`、`../docs/INTEGRATION_GUIDE.md` 與 `docs/WORKFLOW.md`。

## Rule Entry Points

- API / DB / 開發約定：`.claude/rules/api-patterns.md`、`.claude/rules/database-access.md`、`.claude/rules/development.md`
- UX / Spectra workflow：`.claude/rules/ux-completeness.md`、`.claude/rules/proactive-skills.md`
- 其餘 shared rules：`.claude/rules/`
- workflow / skills：`.claude/skills/`、`.claude/commands/`

## Codex Projection

- 定期執行 `node ~/.claude/scripts/sync-to-agents.mjs`，讓 Codex surface 與 `.claude/` 保持一致。
- 專案特化 promotion 規則放在 `.claude/sync-to-agents.config.json`。
- 若 source 與投影不一致，以 `.claude/` 為準，之後再同步生成。

<!-- CLADE:SNIPPET:post-push-ci-watch:START -->
## Post-Push CI Watcher

當主線執行 `git push --tags`（或推單一 tag、或 push commit 觸發發版 workflow）**成功**後，**若**該 repo 含 `.github/workflows/*.yml` 且 `gh` CLI 可用：

**MUST** 立刻用 **`Bash(run_in_background=true)`** 派出 CI watcher script，每個要監看的 workflow（如 Deploy Staging / Deploy Production）各派一條。指令樣板、flags、exit code 對照表、以及「為什麼不是 Agent watcher」都在 `/gh-ci-watch` skill — **NEVER** 在這裡憑記憶拼指令。

**NEVER** 對沒有 `.github/workflows/` 的 repo 套用這條規則（直接跳過 watcher）。

### Watcher 完成後主線必做

讀該 background bash 輸出尾段的 `RESULT:` 行分流（完整對照表見 `/gh-ci-watch` § Exit codes / RESULT 分流）：

- **`success`** → 一行報 `v<version> CI 綠燈 — <runUrl>`（version 由 `git describe --tags --abbrev=0` 抓；無 tag 填 commit short sha）後結束本話題，**NEVER** 多嘴
- **失敗類**（`failure` / `timed_out` / `cancelled` / `WATCH_TIMEOUT`）→ **MUST** 用 `AskUserQuestion` 給使用者二選一：
  - `[1] 立刻 root-cause + 修` — 讀輸出內的 `--log-failed` 節錄找根因，進除錯流程；修完前 **NEVER** 主動 push
  - `[2] 登記 HANDOFF.md` — 在 repo root 的 `HANDOFF.md` 末尾 append（檔案不存在就先開 `# HANDOFF` + `## CI 紅燈待辦` 骨架）：

    ```
    - [ ] [<YYYY-MM-DD>] v<version> CI <fail|timeout> — <failedJob>
      - Run: <runUrl>
      - 根因猜測: <一行>
    ```

- **`UNAVAILABLE`** → 一行報「watcher 無法啟動（<原因>），略過」結束，**NEVER** 追問使用者

### 禁忌

- **NEVER** 在 watcher 回報前主動結束話題或叫 user 自己看
- **NEVER** 在 user 未選 `[1]` 前替他改 code / push commit 修 CI

（watcher 機制本身的禁忌 — Agent watcher、前景 block、重複派工、輪詢間隔 — 由 `/gh-ci-watch` § NEVER 管，那份是超集，不在此複述。）
<!-- CLADE:SNIPPET:post-push-ci-watch:END -->

<!-- CLADE:SNIPPET:archive-commit-order:START -->
## Spectra Change 收尾：先 archive 再 /commit

當 Spectra change 的 M.1-M.8 + archive gate 全綠、要收尾時，**MUST** 走以下順序：

1. **先**跑 `/spectra-archive`（不要先 /commit fix）
2. **再**跑單一 `/commit` — 一次包掉 manual review fix + archive directory rename + spec snapshot

### 為什麼

`/commit` 是慢路徑（review、message 生成、hooks），分兩段跑時間翻倍；archive 純 bookkeeping（rename + 落 snapshot），不值得獨立 ceremony，跟 fix 一起 commit 反而最省時。commit message 用雙標題 `fix: ...; archive: ...` 表達即可。

### 禁忌

- **NEVER** 先跑 `/commit` 收 fix 再跑 archive — 等於強迫雙倍慢路徑
- **NEVER** 用 `/spectra-commit` 收尾 — 速度優先，selective stage 不值得
- **NEVER** 在 archive 之後分兩個 `/commit`（一個包 fix、一個包 archive）— 同上理由
<!-- CLADE:SNIPPET:archive-commit-order:END -->

<!-- CLADE:SNIPPET:worktree-default:START -->
## Session-level Worktree

要動 code 的工作（implement / fix / refactor / migration）**MUST** 在獨立 git worktree 內執行，**NEVER** 直接在 main 改。操作走 `/wt <task>`（建 worktree → dispatch subagent → squash-merge 回 main → cleanup；主線 cwd 全程不動）。

- **Read-only session**（grep / 看 log / 解釋 code，不寫檔）**MAY** 留在 main worktree。
- **Silent branch 禁令**：**NEVER** 跑 `git checkout -b` / `git branch <name>` 或任何會建新 ref 的指令，**除非**先取得 user 明確同意。`/wt` 用的 `session/<date-slug>` 是唯一例外（`/wt` 呼叫本身就是授權）。
- **階段間 setup chore 主線自己跑**：subagent 兩個階段之間若要在 worktree 跑 local-only setup（`pnpm install` / `db:*` / `lint` / `test`），主線 **MUST** 用 Bash `cd <worktree-path> && <cmd>` 一行式跑掉（獨立子 shell，不動 session cwd），**NEVER** 把指令清單貼給 user 叫他切過去跑。真 destructive 操作仍需 user 拍板。

例外 skill、`/wt` forms、merge-back 的 atomic-landing 約束、squash conflict／cleanup 失敗的 fallback、`--force-discard-uncommitted` 的防遺失前置，全在 `.claude/rules/worktree-default.md`，不複述。

**NEVER 假設那份已載入**：Claude Code always-load 直接用；**Codex / Pi 等只讀 `AGENTS.md` 的 agent 不會自動載入 `.claude/rules/`**，動 worktree（開 / merge-back / cleanup / `--force`）前 **MUST** 先 `cat` 它——未 commit WIP 的防遺失約束只在裡面。
<!-- CLADE:SNIPPET:worktree-default:END -->

<!-- CLADE:SNIPPET:evlog-prod-triage:START -->
## Prod 問題 → 先查 evlog（runtime triage 反射）

當訊息描述的是 **prod / staging 的 runtime 症狀**（壞了、報錯、500/503/5xx、Toast 出現 error、「全部失敗」、特定 user/request 行為異常、變慢、間歇）而**不是**「改 code / 加 feature」時：

**第一個證據動作 MUST 是查 evlog wide event** —— 撈實際發生過的 request（path / status / duration_ms / error_json / request.id / user / 時間窗），**先於** grep code、codebase-memory-mcp、或派 Explore agent 推測 root cause。

> code 告訴你「**可能**發生什麼」（假設）；evlog 告訴你「**實際**發生了什麼」（ground truth）。prod 症狀不要從 code 猜原因 —— 先用 evlog 把症狀釘到具體 request，再回 code 對因。從 code 推出的 root cause 在驗證前一律視為**未證實的推測**。

這條反射**僅對 runtime 症狀**優先於 codebase-memory-mcp 的 code-first 順序；純 code 探索（找 function、理解架構）仍走 codebase-memory-mcp。

**症狀是「環境本身變了」時（容器被重建 / 服務被重啟 / config 內容或 mtime 變了 / port 被佔 / DB 被 reset / branch 被動過），先跑 Step 0 再進主機層鑑識**：(1) `ListAgents` 列並行 session（該 tool 是 per-session provision，不保證存在；沒有就跳下一步）→ (2) 看被改物件的 mtime 與旁邊的 `.bak` / `.orig` 鄰居並 `diff` —— 人手動改設定會留下**檔案**，daemon log 只記「有東西呼叫了 API」→ (3) 問 user。多 session 並行是常態，「另一個自己人剛做的」是這類變動最大的一塊；跳過等於一開始就把最可能的答案排除在假設空間外。三步全沒結果才進 `docker inspect` / `journalctl` 那一層，**NEVER** 因為主機層答不出「誰做的」就繼續加深鑑識。細節見 `.claude/rules/evlog-investigate.md` § Step 0。

怎麼查（per-backend recipe，含可直接貼的 query）：

- 協定與邊界：`.claude/rules/evlog-investigate.md`
- Cookbook：`~/offline/clade/vendor/snippets/evlog-investigate/`（Supabase drain SQL / Sentry·Axiom query / stream replay）

**NEVER** 在沒撈過 evlog 前就向 user 宣稱 prod root cause，**NEVER** 把「查 prod log」當成等 user 開口才做的事 —— runtime 症狀進來時它就是你的第一步。
<!-- CLADE:SNIPPET:evlog-prod-triage:END -->

<!-- CLADE:SNIPPET:response-calibration:START -->
## 輸出校準

### 篇幅與節奏

篇幅由措辭控制；`effort` 只調思考量、不調輸出長度。

- **對話回應**：篇幅花在主結論；caveat 與免責一句帶過。被要求「解釋」時先給高層摘要，追問再展開。
- **工作中的敘事**：第一次 tool call 前一句話說要做什麼；**有發現、要轉向、或連續三次以上 tool call 沒出聲時**要出聲；收尾第一句先答「結果是什麼」，細節放後面。
- **落盤文件**（報告 / 摘要 / markdown）：長度配任務需要，不補填充段落、不重複摘要、不寫樣板。

### 用字：有字面說法就用字面說法

比喻會帶進你沒選、也控制不了的言外之意。**有字面說法可用時就用字面說法**——把比喻留給字面說法確實不存在的地方。

| ❌ 修辭替代直述 | ✅ 字面 |
| --- | --- |
| 「這條規約要能長出牙齒」 | 「這條規約要有 detector 或 gate 才會被執行」 |
| 「把訊號餵回迴圈」 | 「把 audit 輸出寫進 HANDOFF 稽核段」 |
| 「一個值得轉的旋鈕」 | 「一個值得調的參數」 |

判別：那個詞是在**傳達**判準，還是在**表現**寫的人？後者讓讀者多做一次翻譯，而且翻出來的往往不是你的原意。

本節與上一節都是純措辭規約，沒有 detector——「比喻替代直述」沒有有限詞集可 grep，消費端只有正在寫字的自己。

---

本檔管**篇幅與用字**。錯誤與內部過程要不要揭露由 `output-hygiene` 管——縮短篇幅 **NEVER** 是省略已知錯誤、跳過反對意見、或隱藏未完成項的理由。
<!-- CLADE:SNIPPET:response-calibration:END -->

<!-- CLADE:SNIPPET:ui-invariants:START -->
## UI Invariants

UI 不變式的生效檔由 resolver 依序找：consumer `docs/UI-INVARIANTS.md` → `docs/ui-invariants.md` → `.claude/ui-invariants.md` → clade baseline template（`~/offline/clade/claude-md/core-snippets/ui-invariants.template.md`）。查目前生效的是哪一份：`node ~/offline/clade/vendor/scripts/ui-invariants-resolve.ts`。

clade baseline 維護 5 條 universal invariant（整欄塌縮 / lookup 解析率 / page load 4xx-5xx / row count vs seed / 不可逆操作要確認框）。要加業務專屬條目，**MUST** 先把 template 複製成自家 `docs/UI-INVARIANTS.md` 再於 `## Consumer-specific invariants` 追加，**NEVER** 改 universal 那 5 條 —— 它們由 clade 散播時保持對齊。
<!-- CLADE:SNIPPET:ui-invariants:END -->
