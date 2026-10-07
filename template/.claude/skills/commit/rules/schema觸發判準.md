# Rule 1 - 每一次 `/commit` 都跑 schema 觸發判定（Step 1）

- Level: `MUST`

**每一次** `/commit` 都 MUST 跑這一步的觸發判定 —— 判定本身無條件，判定**結果**才決定要不要做事：

```bash
# 範圍＝本次落地的變更。普通 /commit：git status（staged／unstaged／untracked 逐檔列），branch 上已 commit 的不算。
# 批次 /commit（helper integration 工作區，branch 固定 codex/batch-<id>）另加 base→candidate tree——member checkpoint
# 已正式 commit、git status 乾淨的 migration 也算。先在該工作區設（clade：vendor/scripts/）：
#   BATCH_SCOPE=$(node scripts/wt-helper.ts batch scope) || BATCH_SCOPE='<batch scope 失敗>'
#   （MUST 與下方判定在同一次 Bash 呼叫裡：每次 tool call 都是新 shell，變數帶不過去，分開跑必落 HAS）
# 批次 branch 上 BATCH_SCOPE 沒設、空、helper 失敗或讀不到，一律寧可判 HAS
PAT='supabase/.*\.sql|supabase/migrations/|\.types\.ts'
case "$(git symbolic-ref --short -q HEAD)" in codex/batch-*) IN_BATCH=1 ;; *) IN_BATCH= ;; esac
{
  git status --porcelain --untracked-files=all
  if [ -n "$IN_BATCH" ] || [ -n "${BATCH_SCOPE:-}" ]; then
    printf '%s' "${BATCH_SCOPE:-}" \
      | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!s.base||!s.tree)process.exit(1);console.log(s.base,s.tree)' \
      | { read -r B T && git diff --name-only "$B" "$T"; } || echo 'supabase/migrations/<batch scope 讀不到>'
  fi
} | grep -Eq "$PAT" && echo HAS || echo NO
```

- `NO` → 本 repo 這次沒動到 migrations 或 types，**直接進 Step 2**，不需要讀任何東西。
- `HAS` → **MUST** 先完整讀 [schema-sync.md](../schema-sync.md) 並照其中 Step 1.1–1.5 **每一步**走完，再進 Step 2。
  Step 1.4（SQL lint）與 1.5（advisors）在 1.3 的 reset 之後跑，**NEVER** 做完 types 比對就當 Step 1 結束。

上面這條判定刻意寬鬆（寧可誤送進 reference 也不漏），精確判定與完整流程都在 reference 檔裡。

## Good Example

- 這個例子是好的，因為 `HAS` 之後把 Step 1.1–1.5 全部走完。

```md
判定印 `HAS` → 讀 `schema-sync.md` → 1.1 → 1.2 → 1.3 reset → 1.4 SQL lint → 1.5 advisors → 進 Step 2。
```

## Bad Example

- 這個例子是壞的，因為做完 types 比對就當 Step 1 結束。

```md
判定印 `HAS` → types 比對一致 →「schema 沒問題」→ 進 Step 2（沒跑 1.4、1.5）。
```

# Rule 2 - 判定範圍只到本次落地，批次不可省略 `BATCH_SCOPE`

- Level: `NEVER`

判定範圍**只到本次落地**，**NEVER** 加回 `merge-base→HEAD` 全 branch 判定：branch 早期一旦含
migration，之後每次 `/commit` 都會判 HAS、進 Step 1.3 跑破壞性 `db:reset`（desk 共用 canonical DB）。
普通 `/commit` 能略過 branch 上已 commit 的 migration，前提是它們在自己那次 `/commit` 已走過 Step 1。
這個前提對 **checkpoint 不成立**：batch／worktree checkpoint（Step 0-Batch：checkpoint 不是 `/commit`）、
version-upgrade fleet-mode worker 的 scoped checkpoint 都沒跑過 Step 1。它們一律經批次 `/commit` 落地，
由上面 `BATCH_SCOPE` 的 base→candidate 分支涵蓋——批次 `/commit` **NEVER** 省略 `BATCH_SCOPE`；漏設或 helper 失敗時批次 branch 判 HAS，不會退回只看 `git status`。
不經 `/commit` 也不經批次入庫的 stale types 由 CI `supabase-check` 擋（某 consumer 的 wr4-002 #34，2026-09-25）。`--untracked-files=all` 不可省：
整個 `supabase/` 目錄都是新檔時，預設只印 `?? supabase/`，pattern 對不到。

## Good Example

- 這個例子是好的，因為批次 `/commit` 在同一次 Bash 呼叫裡設了 `BATCH_SCOPE`。

```md
在 `codex/batch-1a2b`：同一則 Bash 先 `BATCH_SCOPE=$(node scripts/wt-helper.ts batch scope)` 再跑判定
→ member checkpoint 裡的 migration 被選中 → `HAS`。
```

## Bad Example

- 這個例子是壞的，因為加回全 branch 判定，每次都會進破壞性的 `db:reset`。

```md
「保險起見改成 `git diff merge-base..HEAD`」→ branch 早期的 migration 每次 `/commit` 都判 HAS。
```

# Rule 3 - 不憑印象重建重置／比對／lint 流程

- Level: `NEVER`

**NEVER** 憑印象自行重建重置 / 比對 / lint 流程 —— `pnpm db:reset` 與 `supabase db reset` 的分支、
`cp` 備份先於重置的順序、自訂 `config.dbTypesPath` 的解析，寫錯任一條都會靜默放行不一致的 schema。

## Good Example

- 這個例子是好的，因為照 reference 的順序先備份再重置。

```md
讀 `schema-sync.md` Step 1.3 → 依其分支選 `pnpm db:reset` → 先 `cp` 備份 types 再重置。
```

## Bad Example

- 這個例子是壞的，因為自己拼流程，漏了自訂 `config.dbTypesPath`。

```md
「不就是 supabase db reset 再 gen types」→ 輸出到預設路徑 → 與 repo 實際 types 檔無關的比對通過。
```
