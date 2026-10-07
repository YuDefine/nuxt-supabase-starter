# Rule 1 - 版本號升級與 deploy commit：`--only` 與 `&&` 都不可省（Step 6-A，`push-main` 專用）

- Level: `MUST`

判斷升級類型：

- 包含 `feat` → `pnpm version minor --no-git-tag-version`
- 只有 `fix` 或其他 → `pnpm version patch --no-git-tag-version`

建立 deploy commit：

```bash
git commit --only -m "$(cat <<'EOF'
🚀 deploy: 發布新版本 v{新版本號}

- 功能描述一
- 功能描述二

Via: /commit
EOF
)" -- package.json &&      # pnpm-lock.yaml 若一起 bump 就一併列進 pathspec
  git push origin main &&
  git tag "v{新版本號}" &&
  git push origin "v{新版本號}"
```

`--only` 與 `&&` 兩件都不是風格：

- **`git add` ＋ 裸 `git commit` 會把 index 裡別的東西一起收進 deploy commit**——被 gate 刻意擋下不 commit 的檔、別 session 預 stage 的檔都算。那正是 `rules/core/commit.detail.md` § Ad-hoc commit 要求 `--only` 的原因，deploy commit 不是例外。
- **沒有 `&&` 時 commit 失敗照樣往下跑打 tag 那一步，tag 就建在上一個 commit 上**（某 consumer 的 v1.275.1，2026-09-03 實測：deploy commit 被 pre-commit gate 擋下 exit 1，tag 仍建出來，救回要刪 tag、`--only` 重 commit、重建 tag）。後果不對稱——commit 失敗是本機的事，tag 建錯是對外的事。

## Good Example

- 這個例子是好的，因為整條 `&&` 串一次貼，commit 失敗就不會打 tag。

```md
含 `feat` → `pnpm version minor --no-git-tag-version` → 照樣板一次貼上
`git commit --only … -- package.json && git push origin main && git tag "v1.8.0" && git push origin "v1.8.0"`。
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

推的是**具名 tag**（`git push origin "v<版本>"`），**NEVER `git push origin --tags`**。順序**無條件**是 main 先、tag 後（`rules/core/commit.detail.md` § Tag 位置），不看這個 repo 有沒有接 `tag-position`；被它以「超前」擋下 **NEVER** 用 `--no-verify` 或 `CLADE_ALLOW_STALE_TAG` 過關。

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
