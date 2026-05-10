<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-d-pattern-audit (auto-generated) -->

# Preset: evlog-d-pattern-audit

T1 + O1（baseline + D-pattern audit_logs + signed chain + outbox dispatcher）。適用：多租戶 SaaS / 高合規（refund / billing / 政府報告）。對應 master plan § 2.3 + § 12。

## 安裝步驟

1. 完成 `evlog-baseline` 全部步驟
2. 跑 D-pattern migration：`pnpm supabase:db push`（migrations/0000 + 0001）
3. `EVLOG_AUDIT_SECRET=$(openssl rand -hex 32)` 寫進 deploy CI（與 DB hash secret **不**共用）
4. cp `server/utils/audit.ts` + `server/plugins/evlog-audit-*.ts` + `server/api/_cron/audit-chain-diff.get.ts`
5. cron schedule diff-cron 每 6 小時（CF Workers Cron Trigger）
6. 測試：拋 audit event，驗 `audit_logs` + `audit_signed_chain` 兩 table 都有對應 row

## nuxt.config.ts pre-applied 範例

```ts
// nuxt.config.ts — evlog-d-pattern-audit preset (T1 + O1)
// 同 evlog-baseline，再加 audit signed chain
export default defineNuxtConfig({
  modules: ['nuxt-auth-utils', '@nuxtjs/supabase', '@sentry/nuxt/module', 'evlog/nuxt'],
  evlog: {
    env: { service: 'YOUR_APP_NAME' },
    include: ['/api/**'],
    sampling: {
      // rates 0-100；error 必為 100
      // audit forceKeep 由 server/plugins/evlog-enrich.ts 末尾 evlog:emit:keep hook wire
      // (evlog 2.16 無內建 audit forceKeep — master plan §14 第 12 條校正)
      rates: { error: 100, warn: 100, info: 50, debug: 0 },
      keep: [{ status: 400 }, { duration: 1000 }],
    },
    redact: {
      // D-pattern consumer 必加 audit-specific paths
      paths: [
        'user.password',
        'body.password',
        'headers.authorization',
        'headers.cookie',
        'access_token',
        'refresh_token',
        'business_keys.email', // audit 內絕對不能存 PII
      ],
      patterns: [/sk-[A-Za-z0-9_-]{20,}/],
      builtins: ['jwt', 'bearer', 'email', 'creditCard'],
      replacement: '[REDACTED]',
    },
    transport: {
      enabled: true,
      endpoint: '/api/_evlog/ingest',
    },
  },
  runtimeConfig: {
    sentry: { dsn: process.env.SENTRY_DSN },
    // O1 overlay：與 DB hash secret **分開** 儲存
    evlogAuditSecret: process.env.EVLOG_AUDIT_SECRET,
  },
})
```

## 檔案清單

- `server/plugins/evlog-drain.ts` ← `vendor/snippets/evlog-drain-pipeline/pipeline.ts`
- `server/plugins/_evlog-drain.README.md` ← `vendor/snippets/evlog-drain-pipeline/README.md`
- `server/plugins/evlog-sentry-drain.ts` ← `vendor/snippets/evlog-sentry-drain/drain.ts`
- `server/plugins/evlog-enrich.ts` ← `vendor/snippets/evlog-enrichers-stack/enrichers.ts`
- `app/utils/evlog-identity.ts` ← `vendor/snippets/evlog-client-transport/identity-helper.ts`
- `docs/evlog-client-transport.md` ← `vendor/snippets/evlog-client-transport/README.md`
- `supabase/migrations/0000_create_audit_logs.sql` ← `vendor/snippets/audit-pattern/migration.sql`
- `server/utils/audit.ts` ← `vendor/snippets/audit-pattern/helper.ts`
- `server/plugins/evlog-audit-drain.ts` ← `vendor/snippets/audit-pattern/drain.ts`
- `docs/audit-pattern.md` ← `vendor/snippets/audit-pattern/README.md`
- `supabase/migrations/0001_create_audit_signed_chain.sql` ← `vendor/snippets/evlog-audit-signed/migration.sql`
- `server/plugins/evlog-audit-enricher.ts` ← `vendor/snippets/evlog-audit-signed/enricher.ts`
- `server/plugins/evlog-audit-signed.ts` ← `vendor/snippets/evlog-audit-signed/drain.ts`
- `server/api/_cron/audit-chain-diff.get.ts` ← `vendor/snippets/evlog-audit-signed/diff-cron.ts`
- `docs/audit-secret-rotation.md` ← `vendor/snippets/evlog-audit-signed/rotation-runbook.md`

## 來源

clade `~/offline/clade/scripts/sync-evlog-presets.mjs` 自動同步。
consumer 端 fork 修改 = drift；改回 clade vendor snippets 並 propagate。
