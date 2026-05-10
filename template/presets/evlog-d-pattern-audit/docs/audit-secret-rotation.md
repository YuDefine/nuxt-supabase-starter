<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-d-pattern-audit -->
<!-- source: vendor/snippets/evlog-audit-signed/rotation-runbook.md -->
<!-- to: presets/evlog-d-pattern-audit/docs/audit-secret-rotation.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# EVLOG_AUDIT_SECRET Rotation Runbook

Source: clade docs/evlog-master-plan.md § 13.2 #2

evlog signed chain 的 secret 不應永遠不換。rotation 觸發條件 + 完整流程如下。

## 觸發條件

- **Quarterly**：建議每季 rotate（與 SOC2 evidence cycle 對齊）
- **暴露**：env 洩漏、Worker dump、員工離職、Sentry trace 含 secret
- **secret 強度提升**：原本用 32 byte，要升到 64 byte
- **algorithm 升級**：sha256 → sha512

## 流程概觀（5 步）

```
1. 預備新 secret
2. 寫入新版本（雙 secret 期：舊與新都接受）
3. propagate 到 5 consumer + 重啟 Worker
4. monitor diff-cron false-positive 直到歸零
5. 最後 cutover：移除舊 secret
```

## 詳細步驟

### Step 1：預備新 secret

```bash
# 32 byte hex (sha256 對應強度)
openssl rand -hex 32

# 或 64 byte（sha512 對應）
openssl rand -hex 64
```

把新 secret + 新 version number 記下：

| Field     | 舊         | 新         |
| --------- | ---------- | ---------- |
| secret    | `0xabc...` | `0xdef...` |
| version   | 1          | 2          |
| algorithm | sha256     | sha256     |
| 開始日    | 2026-02-01 | 2026-05-09 |

### Step 2：雙 secret 期 — drain 用新 secret，cron 雙驗證

drain side：

```ts
// packages/core/server/plugins/evlog-audit-signed.ts
const config = useRuntimeConfig()
const secret = config.evlog.auditSecret // 從 env 讀新 secret
const secretVersion = config.evlog.auditSecretVersion // = 2

const signedAuditDrain = signed(auditWriter, {
  strategy: 'hmac',
  secret,
  algorithm: 'sha256',
})
```

新 row 寫入 `audit_signed_chain` 時 `signed_secret_version = 2`。

cron side：

```ts
// diff-cron.ts 的 verification 改成「依 row.signed_secret_version 找對應 secret 重算」
const SECRETS: Record<number, string> = {
  1: process.env.EVLOG_AUDIT_SECRET_V1!, // 舊
  2: process.env.EVLOG_AUDIT_SECRET_V2!, // 新
}

const recomputed = computeEvlogHash(SECRETS[s.signed_secret_version], a, s.evlog_prev_hash)
```

env 同時有兩條 secret。production 配置：

```
EVLOG_AUDIT_SECRET=0xdef...        # = V2，drain 用
EVLOG_AUDIT_SECRET_V1=0xabc...     # = 舊，cron 驗 v1 row 用
EVLOG_AUDIT_SECRET_V2=0xdef...     # = 新（同 EVLOG_AUDIT_SECRET）
```

### Step 3：propagate 到 5 consumer + 重啟 Worker

```bash
# clade 端先 publish 含新 secret env schema 的版本
cd ~/offline/clade
node scripts/publish.mjs patch
node scripts/propagate.mjs

# perno（O1 適用）：
cd ~/offline/perno
# 設新 env：
wrangler secret put EVLOG_AUDIT_SECRET     # 貼新 secret
wrangler secret put EVLOG_AUDIT_SECRET_V1  # 貼舊 secret（cron 驗 v1 用）
wrangler secret put EVLOG_AUDIT_SECRET_V2  # 貼新（與 EVLOG_AUDIT_SECRET 相同）

# 重啟 Worker（推新 deploy）
pnpm build && wrangler deploy
```

非 perno consumer 不裝 O1，跳過。

### Step 4：監控 diff-cron false-positive

cutover 時間越近，舊 v1 row 越多，cron 應持續 0 drift（除非真的有問題）。

監控查詢：

```sql
SELECT
  drift_type,
  count(*) AS drift_count,
  max(detected_at) AS latest
FROM public.audit_chain_drift
WHERE detected_at > now() - interval '24 hours'
  AND resolved_at IS NULL
GROUP BY drift_type;
```

預期：所有 drift_type count = 0。

如果出現 `evlog_hash_mismatch`：

1. 確認 row.signed_secret_version 對應的 secret 是否正確
2. 確認 cron env 兩條 secret 都 set
3. 重 deploy cron

如果出現 `evlog_chain_break`：

- rotation 期間理論上不該發生（chain 不依賴 secret）
- 出現代表 drain instance race（多 worker 同時寫）— 加 advisory lock per tenant

### Step 5：cutover — 移除舊 secret

新 secret 跑滿 retention 期（建議 30+ 天，audit_logs 保留期）後，舊 v1 row 已超過 audit retention 不會再被 cron 驗。

```bash
# 確認沒有任何 audit_signed_chain row 是 v1：
psql -c "SELECT count(*) FROM audit_signed_chain WHERE signed_secret_version = 1"
# count = 0 才能進下一步

# 移除 V1 secret
wrangler secret delete EVLOG_AUDIT_SECRET_V1

# diff-cron.ts 的 SECRETS map 移除 [1]
```

完成。下次 quarterly rotation 重複此流程，version 遞增到 3。

## 反模式

| 反模式                                                                   | 為什麼壞                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 直接換 secret 不過渡期                                                   | 舊 row 全部變成 evlog_hash_mismatch drift；cron 滿屏 false-positive 無法分辨真 drift |
| 兩 secret 用同一 env name 切換                                           | drain 在 propagate 中途會混 — 部分 instance 用舊、部分用新；version 註記跟不上       |
| 忘了 backfill SECRET_V1 env                                              | cron 重算 v1 row 拿不到 secret → false-positive evlog_hash_mismatch                  |
| 用 audit_signed_chain.evlog_prev_hash 重算 chain（取代 secret rotation） | chain 不依賴 secret；rotation 不該動 chain                                           |

## Step 結束時的 checklist

- [ ] 新 secret 已 generate 並安全儲存（1Password / Vault）
- [ ] secret version 在 hub.json / env 都遞增
- [ ] 5 consumer（實際只 perno）的 worker 已重 deploy
- [ ] diff-cron.ts 的 SECRETS map 含舊與新
- [ ] 24 小時觀察 audit_chain_drift 無新 row
- [ ] 30+ 天後 cutover：移除舊 secret env + diff-cron map entry
- [ ] runbook 註記下次預定 rotation 日期
