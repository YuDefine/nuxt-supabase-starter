# Rule 0 - 先查 consumer 的 project override，有就以它為準

- Level: `MUST`

本檔 Rule 1–4 是 clade 的預設。consumer 可在 `.clade/rules/*.md`（或 legacy 的 `.claude/rules/local/*.md`）用 `rules/core/local-rule-override.md` 的檔頭宣告覆蓋 Step 6-A：前 10 行內的 `> Overrides:` blockquote 點名本檔 `push-main發版判準.md`。進 Rule 1 之前 **MUST** 先跑：

<!-- step-6a-override-probe:start -->
```bash
(
  cd "${COMMIT_REPO:?COMMIT_REPO is not set}" || exit 1
  roots='.clade/rules .claude/rules/local' # legacy 路徑 .claude/rules/local 仍認
  hits="$(find $roots -type f -name '*.md' 2>/dev/null | sort |
    while IFS= read -r f; do
      head -n 10 "$f" | awk '
        /^> *Overrides:/ { block = 1 }
        block && !/^>/ { block = 0 }
        block && /push-main發版判準/ { hit = 1 }
        END { exit hit ? 0 : 1 }' && printf 'step6a=override file=%s\n' "$f"
    done)"
  if [ -n "$hits" ]; then printf '%s\n' "$hits"; else echo 'step6a=default'; fi
)
```
<!-- step-6a-override-probe:end -->

- 印 `step6a=override file=<path>` → **MUST** 讀完該檔，Step 6-A 照它做；它沒規定的部分才回到本檔 Rule 1–4。它禁止的步驟（例：只 push main、不 `pnpm version`、不建 deploy commit、不 `git tag`）**NEVER** 因為本檔樣板寫了就照跑。只剩 push main 時仍走 Rule 1 的 ahead 範圍列舉，推送用帶 `CLADE_PUSH_MAIN_AHEAD` 宣告的 `git push origin main`。
- 印 `step6a=default` → 照 Rule 1–4。
- 印出多個 `file=` → 全部讀完；彼此衝突時停在 Step 6-B 回報，**NEVER** 自己挑一份。

override 只改 6-A 的**做法**，不改授權：要不要推 main 仍由 Step 6-Gate 的 `verdict` 決定。

## Good Example

- 這個例子是好的，因為先查到 override，照它只推 main。

```md
`step6a=override file=.clade/rules/commit-step-6a-push-main-only.md` → 讀檔：僅 push main → `git log --oneline origin/main..HEAD` 逐筆認得 → `CLADE_PUSH_MAIN_AHEAD="$(…)" git push origin main`，不跑 `pnpm version`、不打 tag。
```

## Bad Example

- 這個例子是壞的，因為沒查 override 就照預設樣板 bump，撞上沒有 `version` 欄位的 repo。

```md
`verdict=confirmed-push-main` → 直接 `pnpm version patch --no-git-tag-version` → `ERR_PNPM_NO_PACKAGES_TO_VERSION`。
```

# Rule 1 - 版本號升級與 deploy commit：`--only` 與 `&&` 都不可省（Step 6-A，`push-main` 專用）

- Level: `MUST`

判斷升級類型：

- 包含 `feat` → `pnpm version minor --no-git-tag-version`
- 只有 `fix` 或其他 → `pnpm version patch --no-git-tag-version`

先列舉這次會推上 main 的範圍——pre-push 的 `ahead-ownership` check 會擋下沒有宣告 ahead 範圍的 main push（`rules/core/commit.detail.md` § 推 default branch 前 MUST 列舉並宣告 ahead 範圍）：

```bash
git fetch origin main
git log --oneline origin/main..HEAD     # MUST 逐筆認得：Step 4 的分組 commit、Step 5 的 HANDOFF/ROADMAP commit
```

清單裡有**不是本 session 產生的** commit → 停在這裡照該節查歸屬，**NEVER** 代推。每一筆都認得才建立 deploy commit 並推出去（串裡的宣告值在 deploy commit 建好之後才算，所以涵蓋它）：

```bash
git commit --only -m "$(cat <<'EOF'
🚀 deploy: 發布新版本 v{新版本號}

- 功能描述一
- 功能描述二

Via: /commit
EOF
)" -- package.json &&      # pnpm-lock.yaml 若一起 bump 就一併列進 pathspec
  CLADE_PUSH_MAIN_AHEAD="$(git rev-list origin/main..HEAD | git hash-object --stdin)" git push origin main &&
  git tag "v{新版本號}" &&
  git push origin "v{新版本號}"
```

本檔與 `release-push.md` 其餘各處寫「`git push origin main`」時，指的都是上面帶 `CLADE_PUSH_MAIN_AHEAD` 宣告的這一行。帶了宣告仍被 `ahead-ownership` 擋下 = 列舉之後 remote 前移或 tip 換過：重跑上面的 `git fetch` 與 `git log` 再推，**NEVER** 沿用舊的宣告值。

`--only` 與 `&&` 兩件都不是風格：

- **`git add` ＋ 裸 `git commit` 會把 index 裡別的東西一起收進 deploy commit**——被 gate 刻意擋下不 commit 的檔、別 session 預 stage 的檔都算。那正是 `rules/core/commit.detail.md` § Ad-hoc commit 要求 `--only` 的原因，deploy commit 不是例外。
- **沒有 `&&` 時 commit 失敗照樣往下跑打 tag 那一步，tag 就建在上一個 commit 上**（某 consumer 的 v1.275.1，2026-09-03 實測：deploy commit 被 pre-commit gate 擋下 exit 1，tag 仍建出來，救回要刪 tag、`--only` 重 commit、重建 tag）。後果不對稱——commit 失敗是本機的事，tag 建錯是對外的事。

## Good Example

- 這個例子是好的，因為整條 `&&` 串一次貼，commit 失敗就不會打 tag。

```md
含 `feat` → `pnpm version minor --no-git-tag-version` → `git log --oneline origin/main..HEAD` 逐筆認得 → 照樣板一次貼上
`git commit --only … -- package.json && CLADE_PUSH_MAIN_AHEAD="$(…)" git push origin main && git tag "v1.8.0" && git push origin "v1.8.0"`。
```

## Bad Example

- 這個例子是壞的，因為沒有 `&&`，commit 被擋下後 tag 建在上一個 commit 上。

```md
`git add package.json; git commit -m "🚀 deploy: …"; git tag v1.8.0; git push origin v1.8.0`
```

# Rule 2 - tag 打在 main push 之後，且 tip 必須是這次的 deploy commit

- Level: `MUST`

**tag 打在 main push 之後不是順手排的**：`rules/core/commit.detail.md` § Tag 位置 要求打 tag 當下
`git rev-list --count origin/main..HEAD` 必須是 0。先打再推 main 的話，打 tag 的那一刻這個數字
非 0（Step 4 的分組 commit、Step 5 的 HANDOFF/ROADMAP commit、本步驟的 deploy commit 都還沒推）——順序倒過來就同時滿足了那三步，而且競態時本機根本還沒有 tag 要刪。

**不照上面整條 `&&` 串一次貼、而是分步驟手打時，打 tag 之前 MUST 確認 tip 就是這次的 deploy
commit**（串成一條時由 `&&` 保證，不必另外跑）：

```bash
git log -1 --format=%s     # MUST 是 🚀 deploy: 發布新版本 v{新版本號}
```

`git tag` 在目前 tip（Step 5 的 HANDOFF/ROADMAP commit 與本步驟的 deploy commit 都已在同一條線上）建立 `v{版本號}` **local** tag。

## Good Example

- 這個例子是好的，因為分步手打時先確認了 tip。

```md
`git push origin main` 成功 → `git log -1 --format=%s` 印 `🚀 deploy: 發布新版本 v1.8.0` → 才 `git tag "v1.8.0"`。
```

## Bad Example

- 這個例子是壞的，因為先打 tag 再推 main，打 tag 當下 `origin/main..HEAD` 不是 0。

```md
`git tag v1.8.0` → `git push origin main` → `git push origin v1.8.0`
```

# Rule 3 - 這裡不用 `pnpm tag`

- Level: `NEVER`

**這裡 NEVER 用 `pnpm tag`**，即使該 repo 有這支 script。它在多數 consumer 上**自己就會 push**——2026-09-04 實測 `package.json` 的 `scripts.tag`：三個 consumer 都是 `git tag v… && git push origin --tags`（只有一個 consumer 是純本機 `git tag`）。把它放在樣板裡，tag 會在 main 之前送出去，`tag-position` 當場擋下、`&&` 整條中止，**main 與 tag 兩個都沒上去**——正是 TD-906 那個死鎖。逐字反開脫：「這個 repo 的 `pnpm tag` 我記得只打本機」——那正是要量的東西，而 `git tag` 在四個 repo 上行為相同，量都不必量。

## Good Example

- 這個例子是好的，因為用行為在每個 repo 都相同的 `git tag`。

```md
repo 有 `scripts.tag` → 仍用 `git tag "v1.8.0"` 建 local tag。
```

## Bad Example

- 這個例子是壞的，因為 `pnpm tag` 會在 main 之前把 tag 推出去。

```md
「這個 repo 的 `pnpm tag` 我記得只打本機」→ `pnpm tag` → `tag-position` 擋下，main 與 tag 都沒上去。
```

# Rule 4 - 推送順序無條件 main 先、tag 後，推具名 tag

- Level: `MUST`

**推送順序：無條件 main 先、tag 後**

推的是**具名 tag**（`git push origin "v<版本>"`），**NEVER `git push origin --tags`**。順序**無條件**是 main 先、tag 後（`rules/core/commit.detail.md` § Tag 位置），不看這個 repo 有沒有接 `tag-position`；被它以「超前」擋下 **NEVER** 用 `--no-verify` 或 `CLADE_ALLOW_STALE_TAG` 過關（從舊 tag 開 hotfix branch 不走本序列，它的例外條件見 `rules/core/commit.detail.md` § 機械 gate 與它的邊界）。

- 上面串接命令**任一步失敗** → **MUST** 先完整讀 [release-push.md](../release-push.md) § 序列中途失敗的復原，從失敗的那一步接著做；**NEVER** 因為「重跑一次比較乾淨」而再 bump 一次版本號。
- Step 6-Gate 的 `derived=` 是 `tag-v`／`ambiguous`（含 6-B 選 `[1]` 後回頭跑本步驟）→ 推 tag 之後 **MUST** 照 [release-push.md](../release-push.md) § 推 tag 後的觸發確認 確認 run 已建立；其餘 `derived=` 值標「不適用」。
- main-first 的理由與邊界（`--tags` 的例外、`tag-position` 落後方向、deploy-gate 窗口、tag-only push 跑全套 pre-push 的成本）見 [release-push.md](../release-push.md) § 推送順序。

## Good Example

- 這個例子是好的，因為中途失敗時從失敗那一步接著做。

```md
`git push origin "v1.8.0"` 失敗 → 讀 `release-push.md` § 序列中途失敗的復原 → 從推 tag 那一步續做，不再 bump。
```

## Bad Example

- 這個例子是壞的，因為重 bump 一次，且用 `--tags` 與逃生口過關。

```md
推 tag 失敗 →「重跑一次比較乾淨」→ 再 `pnpm version patch` → `CLADE_ALLOW_STALE_TAG=1 git push origin --tags`。
```
