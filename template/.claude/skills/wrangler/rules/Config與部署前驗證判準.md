# Rule 1 - 新 config 用 `wrangler.jsonc`，環境用 environments 分開

- Level: `SHOULD`
- 新增或重寫 config 時用 `wrangler.jsonc`（新欄位支援較完整），不新開 TOML；既有 TOML 的專案只在本次任務需要時才遷移。
- staging 與 production 用 `env.<name>` 分開設定，部署與驗證都指定 `--env`。

## Good Example

- 這個例子是好的，因為 staging 的 binding 放在 environment 底下，部署時指定環境。

```jsonc
{
  "name": "api",
  "compatibility_date": "2026-09-01",
  "env": {
    "staging": {
      "kv_namespaces": [{ "binding": "CACHE", "id": "<staging-namespace-id>" }]
    }
  }
}
```

## Bad Example

- 這個例子是壞的，因為 staging 與 production 共用頂層 binding，部署 staging 會寫到 production 資源。

```jsonc
{
  "name": "api",
  "kv_namespaces": [{ "binding": "CACHE", "id": "<production-namespace-id>" }]
}
```

# Rule 2 - `compatibility_date` 維持專案已測過的值

- Level: `MUST`
- 不順手把 `compatibility_date` 改成今天；要改時必須是本次任務的明確目的，並驗證受影響的 runtime 行為。

## Good Example

- 這個例子是好的，因為只加 binding，沒有動已測過的日期。

```jsonc
"compatibility_date": "2025-11-01",
"kv_namespaces": [{ "binding": "CACHE", "id": "<id>" }]
```

## Bad Example

- 這個例子是壞的，因為加 binding 時順手把日期改成今天，等於未驗證地切換 runtime 行為。

```jsonc
"compatibility_date": "2026-10-21",
"kv_namespaces": [{ "binding": "CACHE", "id": "<id>" }]
```

# Rule 3 - 改 config 後依序跑 types、專案驗證與 deploy dry run，再部署

- Level: `MUST`
- 每次改 config 都依序跑：`wrangler types` → 專案 typecheck／tests → `wrangler deploy --dry-run --config <檔> --env <環境>`，全過才 deploy。
- `--dry-run` 只編譯不部署（`https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy`）；它不驗 live binding 與 production 行為，部署後仍要另外驗證。

## Good Example

- 這個例子是好的，因為三項驗證依序跑並指定環境，且說明 dry run 驗不到的部分。

```bash
pnpm exec wrangler types
pnpm typecheck && pnpm test
pnpm exec wrangler deploy --dry-run --config wrangler.jsonc --env staging
# 部署 staging 後實際呼叫用到 CACHE 的 endpoint 驗 binding
```

## Bad Example

- 這個例子是壞的，因為改完 config 直接部署，型別與 bundle 都沒驗。

```bash
pnpm exec wrangler deploy
```

# Rule 4 - 會自己開 TCP 連線的套件先對 Workers socket 限制，部署後實打一次

- Level: `MUST`
- 引入或改用會自己開 TCP 的套件（SMTP 寄信、資料庫或 Redis driver、MQ client 等，底層走 `node:net`／`node:tls` 或 `cloudflare:sockets` 的 `connect()`）之前，先對照 Workers TCP sockets 文件（`https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/`）的限制：port 25 預設封鎖、不能連 Cloudflare IP 段與 localhost／私有網段、socket 只能在 handler 內建立、`net.Server` 不支援；`node:net` 還要有 `nodejs_compat`（`https://developers.cloudflare.com/workers/runtime-apis/nodejs/net/`）。
- 命中任一限制就不要用這個套件：寄信改用 HTTP API 的郵件服務或 Email Workers，資料庫優先走 binding（D1、Hyperdrive）或 HTTP driver。
- `wrangler types`、typecheck 與 `deploy --dry-run` 都不會真的建立連線，全過也不代表能連。用到這類套件時，部署到 staging 後 **MUST** 實際呼叫一次會建立連線的 endpoint，確認連得上才算驗證完成。

## Good Example

- 這個例子是好的，因為先對照限制、改用 HTTP API，部署後再實打驗證。

```md
1. 需求要寄信 → SMTP 走 port 25／587 的 TCP，port 25 在 Workers 封鎖 → 改用郵件服務的 HTTP API（`fetch`）。
2. 跑 `wrangler types`、typecheck、`wrangler deploy --dry-run --env staging`。
3. 部署 staging 後實際觸發一次寄信 endpoint，確認收得到信。
```

## Bad Example

- 這個例子是壞的，因為只看型別與 dry run 過了就部署，SMTP 套件要到正式執行才連不出去。

```md
1. `pnpm add <smtp-client>`，在 handler 設定 host 與 port 25。
2. typecheck 與 `wrangler deploy --dry-run` 都過 → 直接 deploy production。
```
