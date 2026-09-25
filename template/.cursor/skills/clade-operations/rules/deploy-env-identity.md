---
description: 決定「這份執行中的程式跑在哪個部署目標」時——標 Sentry / evlog 的 environment、選告警路由、開關環境專屬 feature、擋 destructive endpoint——判斷該讀哪個值；症狀是 staging 的事件混進 production 的判讀
paths:
  - 'sentry*.config.*'
  - '**/sentry*.ts'
  - 'nuxt.config.*'
  - 'Dockerfile'
  - '**/Dockerfile'
  - 'wrangler.toml'
  - 'wrangler.jsonc'
  - '.github/workflows/**'
  - 'server/plugins/**'
  - 'packages/*/server/plugins/**'
  - 'packages/**/server/plugins/**'
---
<!-- Clade native rule; source: rules/core/deploy-env-identity.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Deploy Env Identity（部署身分取自注入，不取自 build mode）

## 適用條件（可觀察 predicate）

本檔的不變量在**同時滿足**下列兩條時生效：

1. repo 有 **≥2 個部署目標**（staging / preview / production 任兩者）
2. 那些目標**跑同一份 production build**——同一個 image tag、同一份 `nuxt build` 產物、同一次 `wrangler deploy` 的 bundle

只有單一部署目標的 repo 現在不受約束；**但加第二個環境的那一刻就受約束**。

## 不變量

**每一個**消費「我跑在哪個環境」的地方——不是只有最顯眼的那一個——都適用：

1. **MUST** 取自**部署時注入的顯式 env var**（`NUXT_APP_ENV` / `APP_ENV` / `DEPLOY_ENV` 這類，名稱不拘，語意必須是「部署目標」）。
2. **NEVER** 從 build 期常數推導：`process.env.NODE_ENV`、`import.meta.env.NODE_ENV`、`import.meta.env.MODE`、`import.meta.env.PROD`、`import.meta.env.DEV`、`import.meta.dev`。它們描述 build 模式而非部署目標，staging 與 production 共用 build 時恆等。
3. **注入失敗的 fallback MUST 是顯眼的 `'unknown'`**，**NEVER** 是 `'production'`。

### 誰是消費者（窮舉的形狀，不是窮舉的清單）

任何「值不同、行為就不同」且該值代表部署目標的地方：

| 消費者 | 錯誤形狀的後果 |
| --- | --- |
| Sentry / 其他 APM 的 `environment` | staging 事件混進 production 的 error rate、issue 判讀、告警路由 |
| evlog / wide event 的 `env.environment` | 同上，且污染的是事後鑑識的主要資料源 |
| 告警 webhook 路由（Discord / Slack / PagerDuty 分流） | staging 的噪音打進 production oncall |
| 環境專屬 feature flag、seed / fixture 開關 | staging 拿到 production 的行為 |
| destructive admin endpoint 的 guard | 最嚴重：staging 的防護等級掉到 production 的假設上 |

**MUST** 在改動任一消費者時把**同一個 repo 內的其他消費者一起看過**。

## 接線：三個位置各自的正確來源

| 位置 | 讀什麼 | 為什麼不是別的 |
| --- | --- | --- |
| server / nitro plugin | runtime config 的 server-only 欄位（`config.appEnv`） | runtime 注入，改值不必重 build |
| client 端、且在框架 init **之前**執行（`sentry.client.config.ts`） | build 期 inline 的常數（`import.meta.env.NUXT_PUBLIC_APP_ENV`，由 `vite.define` 產生） | 這段程式跑在 runtime config 可用之前；且部署目標若是刻意的 server-only 欄位，client 本來就讀不到 |
| build 期注入鏈 | deploy workflow `--build-arg` → `Dockerfile ARG` → build step env → `vite.define` | 缺任何一環，client 端會 inline 成 `''`，落到 `'unknown'`（顯眼，符合不變量 3） |

client 走 build-arg 意味著**改部署目標要重 build**。這是這條路徑的代價，不是缺陷——接受它，**NEVER** 為了省一次 build 把 client 端改回讀 build mode。

## 測試要求

違反是無聲的，**MUST** 有機械 gate 釘住整條接線，並接進 `pnpm check` 與 CI。

**斷言 MUST 跑在剝掉整行註解後的行為 view 上**（檔內註解會逐字提到 `NODE_ENV`；per [[testing-anti-patterns]] §「對設定檔原文的斷言，標的是行為本身」）。

gate 的 exit code 與輸出走 [[checker-contract]]。可直接抄的實作（含剝註解的 `code_of`、六條斷言、mutation 驗證清單）在 `~/offline/clade/vendor/snippets/deploy-env-identity/`。

## 反開脫

| 實錄開脫 | 為什麼不成立 |
| --- | --- |
| 「staging 跑的本來就是 production build，標 production 沒錯啊」 | 標的是**部署目標**不是 build 模式。這句話恰好複述了病因 |
| 「fallback 填 `'production'` 比較安全，至少不會漏掉真的 prod 事件」 | 反了。填 `'production'` 讓注入斷掉這件事永遠不會被發現；`'unknown'` 會在第一個事件就自己現身 |
| 「先讓 Sentry 這條對，evlog 那邊之後再說」 | 兩者吃同一個病因、同一次改動就能一起修。分兩次的那一半會被忘記——這就是本檔 § 誰是消費者 的來源事件 |
| 「加個 env var 要動 Dockerfile 跟兩支 workflow，太麻煩了」 | 接線一次，之後每個新消費者都免費。不接線的代價是每一筆 observability 資料的可信度 |

> 一次具體失敗的完整重現、fleet 掃描結果與各 consumer 現況：
> [[pitfall-build-mode-cannot-distinguish-staging-from-production]]。
