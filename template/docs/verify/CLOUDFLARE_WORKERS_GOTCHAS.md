# Cloudflare Workers 注意事項

## Request Body Stream

Workers 的 request body 是 ReadableStream，只能讀取一次。

**問題**：如果 middleware 讀取了 body，後續 handler 會收到空 body。

**解法**：

- 在 middleware 中使用 `readBody()` 會快取結果，後續 `readBody()` 會回傳快取
- 如果直接操作 `event.node.req`，需要自行處理

## Node.js API 限制

Workers 不支援所有 Node.js API。常見限制：

| API             | 狀態                  | 替代方案               |
| --------------- | --------------------- | ---------------------- |
| `fs`            | ❌ 不可用             | 使用 KV/R2 Storage     |
| `child_process` | ❌ 不可用             | 使用 Service Bindings  |
| `crypto`        | ✅ 透過 `node:crypto` | 需啟用 `nodejs_compat` |
| `Buffer`        | ✅ 透過 `node:buffer` | 需啟用 `nodejs_compat` |

在 `wrangler.jsonc` 中啟用：

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
}
```

## 環境變數

Workers 的環境變數在 runtime 透過 `process.env` 讀取（Nitro 已處理）。

**注意**：`NUXT_PUBLIC_*` 變數在 **build time** 注入到 client bundle，不是 runtime。
確保 CI/CD build 時有傳入所有 `NUXT_PUBLIC_*` 變數。

## Bundle Size

Workers 有 10MB 的 bundle 大小限制（壓縮後）。

監控方式：

```bash
wrangler deploy --dry-run --outdir dist
ls -lh dist/
```

## Supabase 連線

Workers 無法使用 TCP 長連線。Supabase 的 PostgREST API（HTTP）沒有此限制。

如果需要直接 Postgres 連線（如 Better Auth），需要：

- Cloudflare Hyperdrive（推薦）
- 或使用 Supabase 的 HTTP API
