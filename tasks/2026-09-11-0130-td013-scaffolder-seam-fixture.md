# TD-013 — scaffolder ↔ clade registry seam test fixture 撞 manifest schema 收緊

## 你是繼任者，不是 worker

**本 session 把整個位置交給你**，不是派你去做一件子工作。交棒理由：前一段工作（starter native
cutover 收尾）已全部完成並收斂，本 session context 已長，剩下的 TD-013 該由乾淨 context 接手。

- **in-flight dispatch：無。** 本 session 沒有未結的 handshake，沒有等待回收的 worker。
- **背景行程：無**（本 session 自己啟動的）。
- **parent worktree：無**，cwd 一直是 main checkout。

## repo 與 cwd

- **main checkout**：`/home/charles/offline/nuxt-supabase-starter`（monorepo，app root 在 `template/`）
- 測試所在套件：`template/packages/create-nuxt-starter`
- 開發規約：`cd template/` 後讀 `template/CLAUDE.md`；root meta 與 `template/` 的邊界見 root `CLAUDE.md` 與 `.claude/rules/starter-hygiene.md`

## 這件事是什麼（登記在 `docs/tech-debt.md` TD-013）

`template/packages/create-nuxt-starter/test/clade-registry-seam.test.ts:44` 的 fixture 寫死
`.claude/hub.json` 為 `{"version":"0.0.0","modules":{},"localHooks":[]}`，而 clade
`scripts/register-consumer.ts` 現在拒收：

```
invalid consumer manifest: $.modules: no anyOf schema branch matched
```

clade 的 `manifest.schema.json` 對 `modules` 的 anyOf 分支已收緊到**空物件不合法**。

## 本 session 實測到的（2026-09-11 01:2x，不是推論）

```bash
cd template/packages/create-nuxt-starter && npx vitest run test/clade-registry-seam.test.ts
# Tests  2 failed | 2 passed | 1 skipped (5)
```

與 TD-013 登記的數字逐字一致 —— **這條仍然成立，不是已經被別人修掉的舊帳**。

fixture 建在 `/tmp`，**不讀本 repo 的 manifest**，所以這 2 個 failure 與本 repo 產品碼無關。

## 兩條修法（TD-013 自己列的，未拍板）

1. 把 fixture 的 `modules` 補成能通過現行 schema 的最小合法組合（照 `manifest.schema.json`
   的 anyOf 分支選一條）
2. 改由 scaffolder 自己產生 manifest 再餵給 `register-consumer`，讓測試跟著 schema 走而不是寫死

2 比 1 耐用（schema 再收緊時不會重演），但動到 scaffolder 與測試的介面，**MUST 先確認呼叫端**。
選 2 之前先讀 `template/packages/create-nuxt-starter/src/` 裡 manifest 是怎麼產的。

**NEVER 為了讓測試綠而放寬 clade 的 `manifest.schema.json`。** clade 是唯讀參考
（`/home/charles/offline/clade`），本趟不改它；若判出根因真在 clade 標準層，**回報並等 Charles
決定**，不要自己切過去改 + propagate。

## Acceptance（TD-013 逐字）

- `clade-registry-seam.test.ts` 5 個 case 全綠（目前 2 failed / 2 passed / 1 skipped）
- 修法不動 clade `manifest.schema.json`

## 開工前值得知道的三件事

1. **`CLADE_WORK_ID` 是髒的**：ambient 值是 `W-2026-09-10-always-load-diet`，那是更早的 session
   留下來的，與 starter 完全無關，本 session 也沒碰過它。**NEVER** 對它 emit `work.done`
   —— 沒有任何實跑證據支持那件事已完成，而 `--verification` 是 fail-closed 欄位。
2. **TD-014 只剩一項，且不歸本 repo 修**：24 條 blocked error 已於 2026-09-11 全清
   （clade TD-1019 / TD-1066 + v1.12.46）。剩下的是 `<maintainer-domain>` 佔位符在
   `template/.claude/` + `template/.cursor/` 的 22 檔 58 處**無解析說明**，scaffold 出去的
   使用者解不開它。修在 clade 源檔，本 repo 只驗收。不擋任何 gate。
3. **starter 的 clade 投影層現在是健康的**：`.clade/projections/` 8/8、manifest v1.12.46、
   `sync-rules --check` exit 0 `✓ no drift, no orphans`。**如果你看到它退化，那是新問題**，
   不是這條 TD 的一部分。

## 一件卡在 Charles 身上、你接手後由你持有

TDMS 的 nuxt dev server（PID 2247035，整棵樹含子行程 1.7 GB，底下掛著一支 `cloudflared tunnel`
PID 2249216）要不要殺掉。更早之前他一度授權殺掉另一支 3.0 GB 的（PID 2134757），但**授權當下
的前提已不成立**——那支已自行結束，記憶體也回到 available 28 Gi。**他還沒重新答**。
如果他沒再提，不用主動追；那條 tunnel 可能有人正在用，**NEVER** 自行殺掉。

## 本 session 已完成、不要重做

- starter native cutover 收尾：`.clade/projections/` 0/8 → **8/8**，manifest 1.12.37 → **1.12.46**
- clade TD-1019（public profile 對 resource 註解 fail-closed）已解並隨 v1.12.46 散播
- clade TD-1066（sanitizer 認不出不透明 ID；含一筆已公開三週的實際洩漏）已解，
  洩漏檔已移出 starter `origin/main`（Charles 裁示：只移除 HEAD、不改寫歷史、Notion 不輪換）
- clade TD-1014 已結案（11/11 consumer 到 v1.12.46）
- 本 repo TD-014 已收斂範圍、ROADMAP 同步（`88bbea82`）
