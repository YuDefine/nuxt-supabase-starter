---
description: Consumer dev server port 中央分配 + audit（避免跨 consumer 撞號）
paths: ['package.json', 'nuxt.config.ts', 'registry/consumers.json', 'registry/consumers.schema.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/dev-port-allocation.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Dev Port 中央分配

**核心命題**：consumer 越來越多，dev server port 撞號是 cross-cutting concern — 不集中分配必然撞。本規約把 dev port 變成 clade 標準層治理：registry 集中分配、規約強制宣告、audit 偵測漂移與衝突。

> SoT：`registry/consumers.json` 每個 consumer entry 的 `dev_ports` object。
>
> Audit signal：`scripts/dev-port-audit.mjs`。
>
> Cookbook 範本：`vendor/snippets/dev-port/`。

## MUST

### 1. 顯式宣告 port

- **MUST** consumer `package.json` 的 `dev` script 必須顯式帶 `--port <registry.dev_ports.nuxt>`
- **NEVER** 裸 `nuxt dev`（吃 Nuxt default 3000）
- **NEVER** 省略 `--port` flag

### 2. Tunnel port 對齊

- **MUST** consumer `nuxt.config.ts` 若使用 `vite-plugin-cloudflare-tunnel`，plugin 的 `port:` 必須等於 registry `dev_ports.nuxt`
- 寫法可為 hard-code number 或 `Number(process.env.NUXT_DEV_PORT ?? <registry-value>)`，audit 兩種都接受

### 3. Registry 唯一性

- **MUST** 新 consumer 進 `registry/consumers.json` 必須認領未用的 +10 號 port（3000, 3010, 3020, …）
- **NEVER** 兩個 consumer 在 registry 取同 `dev_ports.nuxt` 值
- **MUST** 改 port 必須先在 clade `registry/consumers.json` commit + publish + propagate，再改 consumer 端的 dev script / tunnel config

## 自治區（規約不強制）

- `.env.example` 是否寫 `NUXT_DEV_PORT=<value>` 由 consumer 自定 — dev script 的 `--port` flag 是 SoT，env 不需重複
- 子 service port（Storybook / Vitest UI / Vite preview / Wrangler）— schema 預留欄位，本輪未分配，consumer 用到時再進 registry

## Why

跨 consumer 同時跑 dev（例：開兩個 IDE / window）必然觸發 Nuxt port auto-increment（3000 → 3001），但 `vite-plugin-cloudflare-tunnel` 的 `port:` 是 hard-coded → tunnel 會打到先啟動的那個 consumer，後啟動的看似跑起來實際不通。這種 silent fail 不會出現在 log，只在「我打 tunnel URL 怎麼看到別的 consumer 的畫面」這種 user-visible symptom 才暴露。中央分配從架構上消除這種狀態。

## How to apply

| 情境 | 動作 |
| --- | --- |
| 新 consumer 進 registry | 取下一個未用 +10 號（目前 3000–3060 已用，下一個是 3070） |
| 既有 consumer 改 port | 先改 clade registry → publish patch → propagate → 改 consumer 自家 dev script + tunnel port |
| Audit 報 DRIFT | consumer user 在 consumer 自家 session 改 dev script / tunnel port 對齊 registry；clade 主線不替 consumer 執行 |
| Audit 報 CONFLICT（兩 consumer 同 port） | clade 主線立即解：選一個 consumer 改用未用 +10 號，registry commit + publish + propagate |

## 當前分配（snapshot，以 registry 為準）

| consumer | dev_ports.nuxt |
| --- | --- |
| <consumer-a> | 3040 |
| nuxt-supabase-starter | 3020 |
| <consumer-c> | 3010 |
| <consumer-d> | 3060 |
| <consumer-b> | 3000 |
| rental-scout | 3050 |
| clade | — (source-of-truth，非 Nuxt consumer) |

下一個可用：**3070**。

## Anti-pattern

- ❌ 裸 `nuxt dev`（吃 default 3000，必跟 <consumer-b> 撞）
- ❌ 在 `.env.local` 設 `PORT=3050` 但 dev script 沒帶 `--port` flag — Nuxt 不一定吃 `PORT` env（要 `NITRO_PORT`），且 `.env.local` 是 gitignored，協作者 clone 完不知道
- ❌ 改 consumer 端 port 沒先改 clade registry — 下次 audit 報 DRIFT，且新 consumer 加入時可能撞號

## 何時不適用

- consumer 不跑 Nuxt（例如純 static site、Workers-only） — `dev_ports.nuxt` 可省略，schema 不強制必填
- consumer `business_activity = paused` 仍受規約約束（avoid silent drift），但 audit DRIFT 不視為 hot follow-up
