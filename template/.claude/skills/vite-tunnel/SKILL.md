---
name: vite-tunnel
description: 建 Cloudflare Named Tunnel 給本機 dev server（跨裝置 OAuth / webhook 測試用）。
metadata:
  clade:
    invocation: explicit
disable-model-invocation: true
effort: medium
---


本 skill 會改本機配置與外部 Cloudflare 資源。載入 skill 不代表已授權 DNS、token、OAuth provider 或對外開放；依本次既有授權執行，缺資源決策或帳號授權時才詢問。

步驟細節、範本與 Gotchas 的 SoT 是 cookbook `~/offline/clade/vendor/snippets/vite-tunnel/README.md`（下稱 cookbook），本 skill 只排順序與判準。

# SOP

## Phase 1 -- 判定是否適用與路線

1. READ 讀取情境、`package.json`、lockfile、`wrangler.*` 與實際載入的 Vite／Nuxt config。
2. THINK 讀取 `rules/路線選擇判準.md`，判定改道或選定官方 Vite／第三方／獨立 cloudflared 路線；改道就依該規則轉去對應做法並結束本 skill。

## Phase 2 -- 前置與憑證

1. READ 讀取 cookbook § 採用步驟 第 1–2 步、§ 多 Cloudflare account 使用情境 與 § Token 管理。
2. DELEGATE 取得 hostname、tunnel name 與實際 dev URL，驗 `cloudflared` 可執行，以實際 account／zone ID 核對選定 certificate 與目標 zone。
3. DELEGATE 由專案指定且已授權的 secret store 取 token（指定 Notion 時用 `ntn api`）；缺權限就列出精確缺少的 account／zone scope 交使用者授權。

## Phase 3 -- 建立或重用 locally-managed tunnel（選用 helper 時）

1. READ 讀取 cookbook § 採用步驟 第 3 步與 § 多 Cloudflare account 使用情境 § 程式層防護。
2. DELEGATE 注入 `CLOUDFLARE_API_KEY`、設 `CLOUDFLARE_ACCOUNT_ID`／`CLOUDFLARE_ZONE_NAME`（非預設 certificate 另設 `TUNNEL_ORIGIN_CERT`）後跑 `~/offline/clade/vendor/snippets/vite-tunnel/bin/dev-tunnel-setup.sh <hostname> <project>-dev`；遠端操作後失敗時先查現有資源再決定重跑，NEVER 自行刪除 tunnel 或 DNS 當回滾。

## Phase 4 -- 接上 dev server

1. READ 讀取 cookbook § 選擇實際載入的整合路線 中選定路線的小節（A／B／C）與 § 採用步驟 第 4–5 步。
2. WRITE 依選定路線修改：第三方路線安裝 plugin 並只 merge generic 範本的 plugin 與 `server.allowedHosts` 兩塊；官方路線 merge workers 範本的 `cloudflare({ tunnel })`；獨立 cloudflared 路線把 ingress 指向已驗證的 dev URL 並記錄 process handle。NEVER 覆蓋使用者既有的 `vite.config.ts`。

## Phase 5 -- 註冊 OAuth callback

1. DELEGATE 查出專案實際的 callback route。
2. READ 讀取 `references/OAuth-provider設定入口.md` 找到該 provider 的設定位置。
3. DELEGATE 依既有授權把 `https://<hostname>/<實際-callback-path>` 加進 provider 設定，保留仍在使用的 localhost callback；需要使用者本人登入或授權時才交給本人。

## Phase 6 -- 啟動與驗收

1. DELEGATE 依路線啟動 dev server（官方路線按 `t + Enter` 拉 tunnel；第三方路線等 plugin 的 ready log；獨立路線另啟 named tunnel），再跑 `curl -I https://<hostname>`。
2. READ 讀取 `rules/驗收與排障判準.md` 逐條驗收；有一條沒過就照該規則查 cookbook § Gotchas 修正後從本 Phase step 1 重跑。


