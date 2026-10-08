# worktree 隔離與 work id

觸發點：SKILL.md 第 0 步（接下來會寫任何檔之前）。文中「第 N 節」指 SKILL.md 的第 N 步與它讀取的判準檔：第 0 節 `rules/worktree隔離與work-id.md`、第 1 節 `rules/定位既有工作與鑄id.md`、第 2 節 `rules/owner載入與代打.md`、第 3 節 `rules/前提修復與gate失敗.md`、第 4 節 `rules/依產物推進.md`、第 5 節 `rules/驗收交付與回報.md`；「上表」「判定表」未另指明時指 `rules/需求分流與免package.md` Rule 2。

# Rule 1 - 任何寫入之前先過 worktree isolation gate

- Level: `MUST`

先唯讀確認 cwd、`git rev-parse --git-dir`、工作項目既有 checkout／owner、`work_id` 與 `git status --porcelain`；dirty paths 依 repo 的 clade-managed 判準計數，包含 tracked 與 untracked。本 gate 也管 constitution 修補、免 package、調查證據與 package 骨架；下列第 1–3 節可先讀取與分類，但不能先寫檔再補隔離。

| 情境 | 隔離路由 |
| --- | --- |
| read-only：只讀取／分類／檢查，不改檔且不需隔離或結構化證據蒐集 | 留在目前環境，不呼叫 `wt`；仍查驗本步前提 |
| multi-file／write：會寫檔的實作或調查、預期兩個以上檔案（spec+checklist、source+test/docs），或需要隔離／結構化證據蒐集 | 先確認 `work_id`，再交 `wt` 建立／選定隔離環境，重驗後才交原下游 |
| dirty-main：共享 main 已有 >=2 個 clade-managed dirty files | 不可繼續在 main 寫入；交 `wt`／既有 worktree owner，先釐清本次 WIP 所有權；純唯讀檢查仍可繼續 |
| already-worktree：git-dir 含 `/worktrees/`，或本工作已有 implementation checkout | 確認該 checkout 的 work_id、範圍與 writer ownership 後沿用；**同一個切片**不巢狀呼叫 `wt`、不另開第二棵；owner 不明則交既有 worktree owner |
| parallel-slices：同一個 work_id 的 `tasks.md` 有 2 個以上**當下已解鎖、彼此無依賴**的 task，且 repo 的 github-flow 規約有 § Integration branch | 本工作的 checkout 升為 integration（branch `integration/<work-id>`），本 agent 是 coordinator；**每一個**平行切片各交 `wt` 開一棵，沿用同一個 work_id、不另鑄識別，開工前宣告路徑且與每一個其他活切片不相交。路徑相交的 task 併成同一個切片或序列化。切片併入、同步與紅燈處置依該規約，不在此複述 |
| publish-preparation：本次變更最後需 publish／propagate | 修改與驗證先走 worktree，交付後由發布 owner 承接 main-bound 階段 |
| main-bound：僅執行設計上綁定 main 的 publish／propagate | 交 `clade-publish` 的 main-bound owner，不呼叫 `wt`；仍須通過發布的 clean／ownership gate，不能豁免 dirty-main 禁寫條件 |

**判定優先序**（不是 first-match）：先分唯讀與寫入，再看是否已有本工作擁有的 worktree（有就沿用）。parallel-slices 的「不另開第二棵」只約束單一切片，**NEVER** 讀成同一個 work_id 只能有一棵 worktree。dirty-main 門檻只限制共享 main 的寫入，不阻止唯讀檢查。dirty paths 歸屬或 writer ownership 不明時先交既有 owner 釐清，未確認前不寫。main-bound 例外只適用發布操作本身，要改 source／test／文件仍先走隔離。

## Good Example

- 這個例子是好的，因為先唯讀判定情境，multi-file 寫入交 wt 建樹後才動手。

```text
git status 乾淨、要改 spec＋checklist（兩個檔）→ 先確認 work_id → 交 wt 建立隔離環境 → 重驗 → 交原下游
```

## Bad Example

- 這個例子是壞的，因為先在共享 main 寫檔再補隔離，或把 parallel-slices 的限制讀成一個 work_id 只能一棵樹。

```text
main 已有 3 個 clade-managed dirty files → 「只是補 package 骨架」直接在 main 寫入
```

# Rule 2 - work_id-before-worktree：先有 work id 才建立或進入工作樹

- Level: `MUST`

**work_id-before-worktree**：先沿用本工作的 `work_id`；沒有就交 work identity owner 依 repo 契約取得／鑄造後才建立或進入工作樹（`wt-helper add` 可在同一流程鑄造並綁定）。不把 slug 當 work_id，不為取得識別在 dirty main 先寫 package，沒有可用流程就列阻塞；同一工作不另鑄第二個識別。身分歸屬依序判定：

| 情境 | 做法 |
| --- | --- |
| 被主持者派出（`CLADE_DISPATCH_ID` 非空） | 沿用 dispatch 帶來的 `CLADE_WORK_ID`；本 pane 範圍外的**新** work 不自己鑄，回報主持者由它開 plan 並派 |
| 已有本工作的 work id，要拆子工作 | 子工作 `flow open <slug>`：ambient `CLADE_WORK_ID` 有 dispatch record 或本 worktree claim 佐證時自動 `work.link` 到 ambient；確定不是子工作才加 `--no-parent` |
| `flow open` 印「未自動掛到 ambient」 | ambient 沒佐證（多半是別張卡殘留的 shell）。確認真是子工作才照它印的 `flow link … --parent …` 手動掛；**NEVER** 為了掛上去改 export 別的 id |

## Good Example

- 這個例子是好的，因為被派出的 session 沿用 dispatch 帶來的 work id，範圍外的新 work 回報主持者。

```text
CLADE_DISPATCH_ID 非空 → 沿用 CLADE_WORK_ID；發現範圍外新工作 → 回報主持者由它開 plan 並派
```

## Bad Example

- 這個例子是壞的，因為為了把子工作掛上去改 export 別張卡的 id，或把 slug 當 work_id。

```text
flow open 印「未自動掛到 ambient」→ export CLADE_WORK_ID=<別張卡的 id> 再重跑
```

# Rule 3 - 隔離交 wt 建立並攜帶續跑資訊；NEVER 藏掉未知 WIP

- Level: `MUST`

transport 交 `wt` 建立隔離環境，並在樹內續跑原下游候選；交棒攜帶 work_id、package、允許路徑、writer owner 與續跑位置。**NEVER** 用 stash、reset 或 commit 藏掉未知 WIP；帶入既有 WIP 要先確認所有權與授權，交 `wt` owner 依 baseline guard 處理。

## Good Example

- 這個例子是好的，因為交棒帶齊 work_id、package、允許路徑、writer owner 與續跑位置。

```text
交 wt：work_id W-…、package specs/plans/W-…/、允許路徑、writer owner、續跑位置＝第 4 步 tasks 列
```

## Bad Example

- 這個例子是壞的，因為用 stash 把不認得的 WIP 收起來再開工，所有權沒有確認。

```text
git stash（藏掉別的 session 未 commit 的改動）→ 開始寫入
```
