---
description: Dev tunnel（vite-plugin-cloudflare-tunnel / cloudflared）跨 consumer convention 索引 — zone-in-account、token scope、restart-loop 防護、冷/熱載入量測四題彙整，各指向權威 § + cookbook + pitfall cross-link
paths: ['nuxt.config.*', '.env', '.env.local', 'package.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/dev-tunnel-convention.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Dev Tunnel Convention（索引）

**核心命題**：dev tunnel（透過 `vite-plugin-cloudflare-tunnel` 或手動 `cloudflared`）是 cross-cutting concern — 跨多個 consumer 共用同一組 org convention（zone / token / hostname）與同一類失敗模式（token-zone account 不匹配、restart loop lockout、cold-load 誤判 hang）。本檔是**索引 hub**：把已散落在 [[dev-port-allocation]] § 2.5/2.6/2.7 與 vite-tunnel skill cookbook 的四題彙整，每題給一句 convention + 指向權威來源 + 對應 pitfall。

> **真相層**：本檔**不重複**規約細節。每個 sub-§ 的 MUST/NEVER 與範本以「指向處」為唯一來源（[[dev-port-allocation]] 或 cookbook README）；本檔只做 convention 摘要 + 入口導航，避免兩處 drift。
>
> 觸發本檔的 consumer 端閱讀時機：寫 / 改 `nuxt.config.ts` 的 `viteCloudflareTunnel` 呼叫、設 `.env(.local)` 的 tunnel 三件套、量測 dev-over-tunnel 載入效能、或在多 Cloudflare account 環境跑 `cloudflared tunnel route dns`。

## § 1 — Zone 必在當前 account 內（multi-account misdirection）

**Convention**：dev tunnel hostname 一律走 `<consumer-id>-dev.<maintainer-domain>`（org convention）。**NEVER** 自由挑其他 zone（`bigbyteedu.com` / 個人域名）。

**為什麼**：`cloudflared tunnel route dns` 在多 Cloudflare account 環境下，若 hostname 對應 zone 不在當前 `~/.cloudflared/cert.pem` 綁定的 account 內，**不會 fail-loud**，而是 silently 把整段 hostname 當 subdomain prefix 附加到該 account 第一個 zone（如寫成 `<host>.<maintainer-domain>.bigbyteedu.com`），外部 DNS 永遠 resolve 不到，但 CLI exit 0。

**權威來源**：
- vite-tunnel skill cookbook `~/offline/clade/vendor/snippets/vite-tunnel/bin/dev-tunnel-setup.sh`（pre-flight zone check：用 CF API 驗 zone 在當前 token account 內，不在則 fail-loud + 列三條切 account 出路）+ 同目錄 README § 多 Cloudflare account 使用情境
- hostname convention 規約：[[dev-port-allocation]] § 2.5

**Pitfall**：[[pitfall-cloudflared-multi-account-cname-misdirection]]

## § 2 — Token scope：必用 cfat_*（含 SSL:Edit）

**Convention**：`.env(.local)` 的 `CLOUDFLARE_API_KEY` **MUST** 是 `cfat_*` account API token，**NEVER** 用 `cfut_*`（Worker token）或 `r_*`（`cloudflared tunnel login` 簽發的 cert.pem token）。必備權限三條：`Cloudflare Tunnel:Edit`（account）+ `SSL and Certificates:Edit`（zone）+ `DNS:Edit`（zone）。

**為什麼**：`vite-plugin-cloudflare-tunnel@1.0.12` named tunnel 主流程無條件呼叫 `/zones/<id>/ssl/certificate_packs` GET（`dist/index.mjs:617`）確認 edge cert，缺 `SSL and Certificates:Edit` → 403 re-throw → crash Nuxt（即使 Universal SSL 已涵蓋）。`cert.pem` / `cfut_*` token 都缺 SSL scope。

**權威來源**：
- 規約 + 三種錯誤 token 來源對照表：[[dev-port-allocation]] § 2.5（含 `.env.local` 三件套範本）
- Token 來源：rental-scout `.env.local` 的 `CLOUDFLARE_API_KEY`（既有可用）/ Notion `Scrects`（待補 cfat_）

**Pitfall**：[[pitfall-vite-plugin-cloudflare-tunnel-token-scope]]

## § 3 — Resilient wrapper：防 restart loop → CF 10502 lockout

**Convention**：consumer `nuxt.config.ts` **NEVER** 裸呼叫 `viteCloudflareTunnel({...})`。**MUST** 包 pre-flight token probe + try-catch wrapper，probe / network 失敗時 fallback 純 localhost、不讓 plugin throw 進 Nuxt。Probe endpoint **MUST** 用 `GET /accounts`（plugin 真正會跑的第一支 call），**NEVER** 用 `/user/tokens/verify`（需 `User Details:Read` permission，多數 Tunnel-only token 沒給 → 會誤判好 token invalid）；probe 用 `AbortController` 設 ≤ 3s timeout。

**為什麼**：plugin 的 `retryWithBackoff` 只包 SSL cert 端點，第一支 auth call `GET /accounts` 裸跑無 retry。token invalid → plugin throw → Nuxt 把 plugin throw 當 fatal auto-restart → 重新 setup 又 throw → 無延遲 spin loop → 十幾秒內累積數十次 auth attempt → 觸發 Cloudflare `code 10502 Too many authentication failures` lockout（15–60 分鐘），期內任何 token verify（含有效新 token）都回 `code 1000 Invalid API Token`。

**權威來源**：
- 規約（含 anti-pattern 判定）：[[dev-port-allocation]] § 2.6
- 範本（`nuxt.config.ts.template` + verify helper）：`~/offline/clade/vendor/snippets/dev-tunnel-resilient/`
- Audit signal：`scripts/dev-port-audit.mjs` § 2.6 `readTunnelResilientWrapper`（裸呼叫報 BARE，diagnostic-only）

**Pitfall**：[[pitfall-vite-plugin-cloudflare-tunnel-restart-loop-lockout]]

## § 4 — 冷/熱載入量測：別把 cold 誤判成 hang

**Convention**：量測 dev-over-tunnel 頁面載入效能（人工或 agent CDP）時 **NEVER** 先 `clearBrowserCache` / `setCacheDisabled(true)`。**MUST** 量「warm」反映日常：第一次載入 populate 快取（不計時）→ 第二次不清快取量 hydrate 時間。warm 數秒內 hydrate（實測 ~6s）= 正常。

**為什麼**：Vite dev 對 `?v=<hash>` node_modules dep 送 `immutable` cache header；一個 Nuxt + @nuxt/ui v4 dev 頁面拆成 ~300–950 個 ES module 請求，cold（清快取）經 tunnel 逐一往返受 cloudflared 並發吞吐限制 → 30–60s 看似 hang。慢 vs 快是 cache-warmth 連續譜，不是 tunnel broken 二元判斷。**NEVER** 因此一路試 CF cache rule `cache:false` / `--protocol http2` / `keepAliveConnections` / 移 plugin / 降版（實證全無效）。

**權威來源**：
- 規約（含無效修法清單）：[[dev-port-allocation]] § 2.7
- 正確量測法 + @nuxt/ui locale deep-import 減模組數範本：`~/offline/clade/vendor/snippets/dev-tunnel-perf/`

**Pitfall**：[[pitfall-vite-dev-over-tunnel-cold-load-misdiagnosis]]

## 與 [[dev-port-allocation]] 的分工

| 主題 | 規約 SoT | 本檔角色 |
| --- | --- | --- |
| Tunnel port 對齊 registry | [[dev-port-allocation]] § 2 | 不涵蓋（屬 port 治理） |
| Zone / token / hostname convention | [[dev-port-allocation]] § 2.5 | § 1 / § 2 索引 + pitfall cross-link |
| Resilient wrapper | [[dev-port-allocation]] § 2.6 | § 3 索引 + pitfall cross-link |
| 冷/熱載入量測 | [[dev-port-allocation]] § 2.7 | § 4 索引 + pitfall cross-link |
| 多 account `route dns` misdirection | vite-tunnel cookbook（非規約 §） | § 1 索引 + pitfall cross-link |

本檔是**導航層**：consumer agent 遇到 dev tunnel 任一題時先讀本檔定位，再跳對應權威 § / cookbook 拿完整 MUST/NEVER 與範本。
