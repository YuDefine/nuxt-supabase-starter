# Maintainer Tech Debt Register

> 本檔追蹤 **starter 維護倉本身** 的技術債（CI workflow、scaffolder、meta scripts），**不會**被 scaffold 帶到新建專案。
>
> 給新建專案使用的 follow-up register 在 `template/docs/tech-debt.md`（frontmatter `applies-to: post-scaffold`）。
>
> 兩者不要混。

---

## Index

| ID     | Title                                                   | Priority | Status | Discovered         | Owner |
| ------ | ------------------------------------------------------- | -------- | ------ | ------------------ | ----- |
| TD-001 | Template E2E 跑超過 15 min（root cause = retry 放大）   | mid      | done   | 2026-05-07 v0.30.9 | —     |

---

## TD-001 — Template E2E 跑超過 15 min（root cause = retry 放大）

**Status**: done（2026-05-07，v0.30.11 後）
**Priority**: mid
**Discovered**: 2026-05-07 — v0.30.9 修完 cloudflare:sockets 後 e2e 仍在 15 min job timeout 被 cancel
**Location**: `template/playwright.config.ts`、`template/e2e/**/*.spec.ts`、`.github/workflows/template-e2e.yml`

### Problem

CI Template E2E 在 v0.30.9 與 v0.30.10 持續撞 timeout，原以為是 `@nuxt/test-utils` 的 `setup({...})` 對每個 spec 重新 spawn Nuxt instance + 重 build。**實際調查後此假設不成立**：`@nuxt/test-utils/playwright` 的 `_nuxtHooks` fixture 是 `scope: "worker"`（見 `node_modules/@nuxt/test-utils/dist/playwright.mjs:24-33`），加上 CI 設 `workers: 1`，所有 spec 本來就共用同一個 Nuxt instance，沒有 per-spec rebuild。

**真正 root cause**：`auth.spec.ts` 的 login selector / a11y 與實際頁面對不齊，test 失敗後 Playwright `retries: 2` 從頭重跑，wall-clock 被放大 3x（單次 ~4 min × 3 ≈ 12 min），加上前面 Supabase 啟動 / build 撐爆 15 min job cap。

### Resolution

`de5227d` 修正 login page selector / a11y 對齊 e2e spec → e2e step 從 retry 連環失敗變成 ~1m 52s 一次跑完。最近兩次 v0.30.11 run（`25485436035`、`25486587955`）穩定在 6 min wall-clock，遠在 acceptance「≤ 10 min」之內。

收尾動作：

- `template-e2e.yml` `timeout-minutes` 30 → 15（done）
- 移除 `template-e2e.yml` 內指向 TD-001 的註解（done）
- 本 entry Status 改 done，修正 Problem 描述記錄真 root cause（done）

### Lesson

下次 CI timeout 先看實際 step timing（`gh run view <id> --json jobs`）找瓶頸落在哪一 step，不要只憑直覺猜「per-spec rebuild」之類的 fixture-level 假設 — 這次猜錯多寫了 30 min 的 cap 跟一條治本路徑。Playwright 的 `retries` 在 CI 預設啟用，flaky test 會把單一 step 時間放大 N+1 倍，是常見而容易被忽略的時間放大器。
