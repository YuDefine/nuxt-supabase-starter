# Rule 1 - 6-B 不建 tag、不發版（`tag-v` / `manual` / `unknown`）

- Level: `NEVER`

這些形狀下 **建 tag 就是部署 production**（`tag-v`），或部署本來就不由 `/commit` 負責（`manual`）。因此本步驟不建 tag、不發版。

**本步驟 NEVER 做以下四件事**，即使本次 commit 含 `feat`、即使使用者說「commit 完就好」：

- ❌ `pnpm version <patch|minor>` —— 未發版就不該有版本號 bump
- ❌ `🚀 deploy:` commit —— main 上出現「發布新版本 vX」卻沒有對應 tag，會讓下一個接手的人誤判已發版
- ❌ `pnpm tag` / `git tag`
- ❌ `git push origin --tags` / `git push origin v<版本>`（推 tag 就是發版，不論用哪種寫法）

## Good Example

- 這個例子是好的，因為停在 push main，版本號與 tag 都沒動。

```md
`verdict=needs-approval`、本次含 `feat` → 不 bump、不建 deploy commit、不打 tag → 進 6-B.0。
```

## Bad Example

- 這個例子是壞的，因為 main 上出現「發布新版本」卻沒有對應 tag。

```md
走 6-B 但「反正有 feat」→ `pnpm version minor` ＋ `🚀 deploy:` commit → push main，沒有 tag。
```

# Rule 2 - 6-B.0：先判 `git push origin main` 本身是不是部署（先於 push）

- Level: `MUST`

`needs-approval` 是個混合袋。`tag-v` / `manual` 這兩種**已確認**的形狀下，push main 什麼都不會觸發；但「宣告缺漏 / 宣告與 workflow 不符 / 推不出單一結論 / 腳本不存在」這幾格，**沒有人知道 main push 會不會部署 production**。同一句 `git push origin main` 在後者就是一次未經授權的部署 —— 而 6-Gate 攔下 tag 的保護在這裡完全沒有覆蓋到。

判定只看 Step 6-Gate 已經印出來的那兩行，不必再跑任何東西：

| Step 6-Gate 輸出 | 本步驟動作 |
| --- | --- |
| `status=confirmed` **且** `derived=` 不是 `push-main` | 直接 `git push origin main` |
| 其餘全部：`status=mismatch` / `undeclared` / `unconfirmable`，或 `derived=push-main`，或 `deploy-trigger-check.ts` 不存在 | **NEVER 先 push**，先照下面取得授權 |

第二個條件（`derived` 不是 `push-main`）不能省：`declared=pr-merge` + `derived=push-main` 會拿到 `status=confirmed` 卻仍被送進 6-B，而那種拓樸下 main push 就是部署。

未確認時 **MUST** 先透過本入口的使用者詢問介面取得下列選擇，**NEVER** 先推了再問。沒有專用工具時直接提問；同一範圍已有明確回答時沿用，不重問：

- **`[1] 授權 push main`** → 明確告知「本 repo 推不出 main push 會不會觸發部署」後才 `git push origin main`，接著往下走發版提問
- **`[2] 先不 push`** → 停在 local commit。**MUST** 在 Step 5 的 HANDOFF 登記「已 commit 未 push」：哪幾個 commit、卡在哪一格（`status=` / `detail=` 原文照抄）、下一步要補的是宣告還是 workflow

**NEVER 把「使用者沒有回應」讀成 `[1]`。** 這條沒有安全預設值 —— 未確認形狀的預設值是「可能對 production 跑 migration」。

## Good Example

- 這個例子是好的，因為未確認形狀先取得授權才推。

```md
`status=mismatch` → 先問使用者 `[1] 授權 push main`／`[2] 先不 push` → 選 `[2]`
→ 停在 local commit，HANDOFF 登記「已 commit 未 push」與 `status=`／`detail=` 原文。
```

## Bad Example

- 這個例子是壞的，因為把沒回應讀成授權，先推了再問。

```md
`status=undeclared`、使用者沒回應 → `git push origin main` → 再問「要不要發版」。
```

# Rule 3 - 6-B.1：push 之後發版另問

- Level: `MUST`

```bash
git push origin main
```

`git push origin main` 完成後（6-B.0 判定可直接推，或使用者選了 `[1]`），發版尚未取得明確授權時 **MUST** 透過本入口的使用者詢問介面取得下列選擇；沒有專用工具時直接提問。既有同範圍發版授權持續有效：

- **`[1] 現在發版`** → **MUST 先讀該 repo 的 `HANDOFF.md` 發版段與 `.github/workflows/`**，確認有沒有固定發版路徑（例：先跑 precheck workflow 拿到 `SAFE` 才授權 deploy、staging-gate 要求同 SHA 的 staging 已綠）。**有固定路徑就照它走，NEVER 直接 `git push origin --tags` 蓋過去**；沒有固定路徑才回頭執行 6-A 的 bump / tag / push main 與 tag
- **`[2] 先不發版`** → 本次到此為止。**MUST** 在 Step 5 的 HANDOFF 裡登記「已 land 未發版」：寫明哪幾個 commit、下次發版該升 major/minor/patch、以及不發版的理由（若使用者有給）

**NEVER 把「使用者沒有回應」讀成 `[1]`。** 這條問題沒有安全的預設值——`tag-v` 的預設值是「對 production 跑 migration」。

> **Step 6b 的前提**：Step 6b 的 Notion 同步依賴 tag 已推出。走 6-B 且使用者選 `[2]` 時 **MUST 跳過 Step 6b**（沒有 tag 可同步）；選 `[1]` 並實際完成發版後才執行。

## Good Example

- 這個例子是好的，因為選「現在發版」後先找該 repo 的固定發版路徑。

```md
使用者選 `[1] 現在發版` → 讀 `HANDOFF.md` 發版段與 `.github/workflows/` → 有 precheck workflow → 照它走，拿到 `SAFE` 才授權 deploy。
```

## Bad Example

- 這個例子是壞的，因為沒回應就當成發版，且蓋過固定路徑。

```md
問了發版沒人回 → 視為 `[1]` → `git push origin --tags`。
```
