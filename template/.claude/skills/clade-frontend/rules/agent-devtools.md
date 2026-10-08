---
description: Nuxt DevTools v4（devframe）＋ medula 讓 agent 經 MCP 讀寫前端狀態時的授權契約——保留授權（clientAuthTokens、NEVER disableAuthorization）、MCP 一律 bearer、缺 token 即關、token 等級同 secret；升 @nuxt/devtools 或改 vite.devtools 時套用
paths: ['nuxt.config.*', 'pnpm-workspace.yaml']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/agent-devtools.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# Agent DevTools（Nuxt DevTools v4／devframe＋medula）

Nuxt DevTools v4 以 devframe 對 agent 開 MCP（`/__devtools/__mcp`）與 RPC（`/__devtools/__sse`、WS side-car），medula 在上面加 Pinia／Vue／router 的讀寫工具。暴露面來自 DevTools v4 本身、不是 medula：**每一個**升到 `@nuxt/devtools` v4 的 consumer 從那一刻起適用本檔。PoC 實測（2026-10-06）：MCP 路由在授權開著時，偽造 `Origin` 的請求仍讀得到 `runtimeConfig` 裡的 secret——授權只管瀏覽器頁面信不信任，不保護 node 端工具。所以要三層：本檔管層 1、層 2；層 3（dev tunnel 必須掛 Cloudflare Access）在 [[dev-tunnel-convention]] § 6。

探測模組 `vendor/snippets/agent-devtools/access-probe.mjs` 由 propagate 投影；**每一個** consumer 的 `nuxt.config.*` **MUST** 存在才動態載入它，**NEVER** 靜態 import（檔案不在時 dev server 起不來）；不在而 tunnel 要開時當作探測不通過。範本、探測模組與版本組合：`vendor/snippets/agent-devtools/`（`nuxt.config.ts.template` 的 `BEGIN／END agent-devtools` 區塊、`versions.json`）。

## 層 1：保留授權

- **每一個** consumer 以 `vite.devtools.clientAuthTokens: [token]` 讓 agent 取得頁面信任（agent 端寫 `localStorage['__DEVFRAME_CONNECTION_AUTH_TOKEN__']` 後 reload）。
- **每一個** consumer 的 `nuxt.config.*` **NEVER** 設 `disableAuthorization`——它會讓偽造 `Origin` 的 SSE session 也受信任。

## 層 2：MCP 一律 bearer，缺 token 即關

- **每一個** consumer **MUST** 以 `vite.devtools.mcp: { authorization: token }` 要求 bearer；沒有 token 時 **MUST** `mcp: false`。**NEVER** 退回無驗證的 MCP。
- agent 端：`DEVFRAME_MCP_AUTH_TOKEN=<token> npx devframe connect`。

## token 是 secret 等級

- token **MUST** 只從不入庫的 `.env.local`（`DEVFRAME_AUTH_TOKEN`）讀；同一個值供層 1 與層 2。**NEVER** 寫進 tracked 檔、log、稽核輸出、PR 描述或對話。
- 理由（2026-10-08 實測）：帶對的 token 經 `/__devtools/__sse` 的 node 端 RPC 讀得到 `runtimeConfig`；沒帶或帶錯被拒（`DF0036`）。token 外流等於 secret 外流。

## 區網（綁非 loopback、沒有 tunnel）

- DevTools 照開，只靠層 1、層 2（Charles 2026-10-07 定案）。實測支撐：區網上沒帶 token 的 SSE RPC 被拒，WS side-car 只 listen `127.0.0.1`。
- **NEVER** 以「綁非 loopback」關 DevTools；層 3 的關閉條件只有「有 tunnel 而 Access 探測不是 `access`」。
- `terminals_spawn` 維持 devframe 預設只允許 presets，**NEVER** 放寬 terminal presets。

## 升級

版本組合、`pnpm-workspace.yaml` 的 `overrides` 與 `minimumReleaseAgeExclude` 一律照 `vendor/snippets/agent-devtools/versions.json`。pnpm 10 與 11 都寫 `pnpm-workspace.yaml`；**NEVER** 寫 `package.json` 的 `pnpm.overrides`（pnpm 11 安靜忽略）。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | clade 端 `node scripts/dev-port-audit.ts` 對 consumer 的 `nuxt.config.*` 含 `disableAuthorization`、或宣告 DevTools v4 卻沒有 `BEGIN agent-devtools` marker → 該列 FAIL、exit 1；`@nuxt/devtools` 與 `versions.json` 不一致只報不 FAIL |
| 消費端 | 主持者（relay 升級時帶該 consumer 的稽核列）；改 `nuxt.config.*`／升 DevTools 的 consumer session |
| 觸發點 | 本檔 paths-gated 於 `nuxt.config.*`、`pnpm-workspace.yaml`（設定 DevTools 與升級 override 的那一刻）；`dev-port-audit.ts` 的 FAIL 輸出直接印本檔位置 |
