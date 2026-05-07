# Maintainer Tech Debt Register

> 本檔追蹤 **starter 維護倉本身** 的技術債（CI workflow、scaffolder、meta scripts），**不會**被 scaffold 帶到新建專案。
>
> 給新建專案使用的 follow-up register 在 `template/docs/tech-debt.md`（frontmatter `applies-to: post-scaffold`）。
>
> 兩者不要混。

---

## Index

| ID     | Title                                            | Priority | Status | Discovered         | Owner |
| ------ | ------------------------------------------------ | -------- | ------ | ------------------ | ----- |
| TD-001 | Template E2E per-spec Nuxt rebuild 拖慢 e2e 時長 | mid      | open   | 2026-05-07 v0.30.9 | —     |

---

## TD-001 — Template E2E per-spec Nuxt rebuild 拖慢 e2e 時長

**Status**: open
**Priority**: mid
**Discovered**: 2026-05-07 — v0.30.9 修完 cloudflare:sockets 後 e2e 仍在 15 min job timeout 被 cancel
**Location**: `template/playwright.config.ts`、`template/e2e/**/*.spec.ts`、`.github/workflows/template-e2e.yml`、`@nuxt/test-utils` setup pattern

### Problem

CI Template E2E 走 `dev: false`（production build path，避開 dev mode timeout），但 `@nuxt/test-utils` 的 `setup({...})` 對每個 spec 檔都會 spawn 新 Nuxt instance + 完整重新 vite build + nitro build（每個約 30 秒）。

實測 v0.30.9 跑了 11+ 分鐘只跑完 ~11 個 spec（共 23 個），加上實際 test 執行時間明顯撐不過原 15 min job cap。短期把 `timeout-minutes` 拉長到 30 min 讓 e2e 至少能完整跑完一輪確認 tests 是否真的綠，但這是治標。

### Fix approach

- **首選（治本）**：把所有 e2e spec 共用同一個 Nuxt instance — 在 `e2e/setup.ts` 跑單次 `setup({...})`，spec 用 `await useTestContext()` 抓共用實例，避免 per-spec rebuild。預計 e2e 從 11+ min 下探到 < 5 min（單次 build + tests 並行）。
- **次選**：拆 spec 分桶 + matrix 並行（如 `chromium-auth` / `chromium-no-auth` 兩個 job 各自 build 一次），減 wall-clock 但 CI 算力翻倍。
- **不建議**：回頭走 `dev: true` — commit `2b37ca7` 已經因為 dev mode timeout 改 production build，回頭等同倒退。

### Acceptance

- e2e job 從目前 30 min cap 收斂到 ≤ 10 min wall-clock（綠燈狀態）
- 23 specs 全部跑完且 conclusion = success
- `template-e2e.yml` `timeout-minutes` 可調回 15 min
- 本 entry Status 改 done，移除 `template-e2e.yml` 內指向 TD-001 的註解
