<!--
🔒 LOCKED — managed by clade
Source: rules/core/nuxt-dev-watch.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Nuxt Dev Watch

**核心命題**：clade governance 散播 4 套投影（`.claude/` / `.agents/` / `.codex/` / `.clade/`）到每個 consumer 倉，含大量檔案。chokidar 預設 watch consumer cwd 全部 → nuxt main process fd 用量爆衝 → libuv `uv_spawn` 對 nitropack `handlersMeta` 的 esbuild worker spawn 撞 `EBADF` cascade，dev server 完全 paralyze。clade 必須提供 baseline ignore，consumer 對齊即可。

> Cookbook 範本：`vendor/snippets/nuxt-dev-watch/`。
>
> Audit signal：`scripts/audit-nuxt-dev-watch.mjs`。
>
> Pitfall：`docs/pitfalls/2026-05-28-nuxt-chokidar-watch-fd-exhaustion-ebadf.md`。

## MUST

### 1. 兩處 baseline 都要套

`nuxt.config.ts` **MUST** 同時含：

1. **頂層 `ignore`**（Nuxt scanner — component / page / server 掃描排除）
2. **`vite.server.watch.ignored`**（chokidar fd-watch 排除，是 EBADF 根因的真正抓手）

兩處都要 — 缺其一 audit 報 `DRIFT`。`ignore` 影響 build / dev scanner，`vite.server.watch.ignored` 影響 fd 用量；目的不同。

### 2. clade-managed baseline patterns（**MUST** 全留）

兩處 ignore list **MUST** 含以下 5 條 clade 投影層排除（前綴 `**/` 用於 vite，`./` prefix 用於頂層 `ignore`）：

- `.claude/**`
- `.agents/**`
- `.codex/**`
- `.clade/**`
- `.spectra/**`

**NEVER** 刪這 5 條 — clade 散播後這些 dir 必存在，沒排除 = fd 爆衝。Audit `nuxtDevWatchIgnore` block。

### 3. vite default 不會自動 merge

`vite.server.watch.ignored` 一旦設值，**MUST** 明列 vite default 3 條：

- `**/.git/**`
- `**/node_modules/**`
- `**/test-results/**`

否則 vite 不再排除 `node_modules`，整個 watch 直接爆炸。Audit 偵測缺 default 報 `DRIFT`。

### 4. 套用步驟

1. cp `vendor/snippets/nuxt-dev-watch/baseline.template.ts` 對應段落進 consumer `nuxt.config.ts`
2. 跑 `cd ~/offline/clade && node scripts/audit-nuxt-dev-watch.mjs` 驗 status 為 OK
3. 重起 dev server，採樣 fd 用量（`lsof -p $(pgrep -f 'nuxt.mjs dev') | wc -l`）應 < 5000

## NEVER

- **NEVER** 缺頂層 `ignore` 或 `vite.server.watch.ignored` 任一
- **NEVER** 刪 clade-managed baseline 5 條（投影層必排）
- **NEVER** `vite.server.watch.ignored` 設值卻沒含 vite default 3 條
- **NEVER** 在 consumer 自家追加自家 patterns 時刪 / 改 baseline section（自家加段 `// consumer-specific:` 之後追加，不動 baseline）
- **NEVER** 假設 `nuxt --no-fork` / `concurrently` 包裝有關（已驗證跟 fd 用量正交，per 2026-05-28 <consumer-a> session）

## 為什麼這條 rule 存在

- **clade 自己造成 fd 壓力**：散播投影含大量檔（`vueuse-functions/references/` 一個 265 fd），每個 consumer 都繼承
- **chokidar 預設 watch cwd 全部**：無 ignore = fd 用量隨 repo 大小線性增長
- **EBADF 是 system 級失敗**：fd 表壓力到上限，libuv `uv_spawn` 任何 syscall 拒絕；nitropack handlersMeta 第一個 esbuild worker spawn 就死，cascade 整批 handler 全 `Cannot extra route meta`
- **看似 cryptic**：log 沒指 fd / chokidar / watch，只看到 `Error: spawn EBADF` + 大量 handler warn，無 stack（error.stack undefined）→ 沒人會第一時間想到 chokidar
- **每個 consumer 必踩**：規模問題，小 consumer 沒撞**只是還沒到上限**

## 違反偵測

`scripts/audit-nuxt-dev-watch.mjs` 對每個 consumer 偵測：

| Signal | 條件 |
| --- | --- |
| `OK` | 兩處 ignore 都含 5 條 clade-managed baseline + vite default（vite section） |
| `DRIFT` | 一處 ignore 含部分 baseline、另一處缺 |
| `MISSING` | `nuxt.config.ts` 完全沒設 `ignore` 或 `vite.server.watch.ignored` |
| `N/A` | consumer 沒 `nuxt.config.ts`（非 Nuxt consumer） |

Diagnostic-only（exit 0）；consumer 端落地由 consumer 自家 session 處理（per [[clade-role-and-todo-discipline]]）。

## 與其他 rule 的關係

- **`rules/core/dev-port-allocation.md`** — dev tunnel hostname / port / token 規約。本 rule 是 dev startup fd 用量規約，跟 port 正交，但同屬 dev workflow 治理範疇
- **`rules/core/code-style.md`** — vite-plus / oxc 工具鏈，不涵蓋 chokidar / dev watch 範圍
- **`vendor/snippets/dev-tunnel-resilient/`** — cookbook for tunnel restart loop / 10502 lockout，不同根因

## 違反時的回報方式

```text
[Nuxt Dev Watch] baseline 不齊

問題：<consumer>/nuxt.config.ts 缺以下任一：
  - 頂層 ignore: 缺 <missing-patterns>
  - vite.server.watch.ignored: 缺 <missing-patterns>

修正：
  - 套 vendor/snippets/nuxt-dev-watch/baseline.template.ts 兩段 snippet
  - 重跑 audit-nuxt-dev-watch.mjs 確認 OK
  - 採樣 fd 用量驗修法生效（< 5000）

若有充分理由偏離 baseline，記錄到 docs/decisions/YYYY-MM-DD-<topic>.md
```
