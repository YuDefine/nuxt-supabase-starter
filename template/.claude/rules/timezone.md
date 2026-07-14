<!--
🔒 LOCKED — managed by clade
Source: rules/core/timezone.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Timezone 規約

適用於 Nuxt 3 / Nitro + 自架 Supabase（LXC PostgreSQL）的 consumer。
完整 cookbook 與範本見 `vendor/snippets/timezone/`。

## 核心原則

DB 存 UTC instant，顯示層轉 local。所有中間層不做隱式轉換，每一處 timezone 轉換都顯式標註。

## Must

1. **Instant 欄位一律 `timestamptz`**。純日曆日期用 `date`。`timestamp`（無時區）只用於外部系統同步表且 MUST 搭配 `COMMENT ON COLUMN` 宣告 TZ 語意
2. **`Intl.DateTimeFormat` / `toLocaleString` / `toLocaleDateString` 每次呼叫都 MUST 帶 `{ timeZone }` 參數**——不依賴 process `TZ`
3. **API instant 一律 RFC 3339（帶 `Z` 或 offset）**。date-only 用 `YYYY-MM-DD` string，不轉 `Date`
4. **DB function 的 business day 計算用 `AT TIME ZONE` + half-open range**（`>= starts_at AND < ends_at`），禁止 `BETWEEN`
5. **`timestamp → timestamptz` migration MUST 顯式 `USING ... AT TIME ZONE`**，帶原欄位的 TZ 語意

## Never

1. **NEVER 用 `+ interval '8 hours'` 做 timezone conversion**——那是推移 instant，不是轉換顯示。正確寫法：`AT TIME ZONE 'Asia/Taipei'`
2. **NEVER 在業務邏輯直接用 `CURRENT_DATE` / `now()::date` / `date_trunc('day', ...)`**——session TZ = UTC 時，台北 00:00-08:00 回傳「昨天」
3. **NEVER 用 `new Date(date.toLocaleString(...))` round-trip**——parser 行為因 runtime 而異
4. **NEVER 依賴跨 transaction 的 `SET TIME ZONE`**（pooler transaction mode 不保留）
5. **NEVER 讓同名欄位在不同表有不同 TZ 語意卻未標註**

## AT TIME ZONE 方向

搞反方向是 8h 偏移最常見根因。

| Input type | `AT TIME ZONE 'X'` 結果 | 語意 |
|---|---|---|
| `timestamp` | → `timestamptz` | 把 naive 值**當作** X 解讀 |
| `timestamptz` | → `timestamp` | 把 instant **轉成** X 的 wall time |

## 偵測 signal

對應 `scripts/audit-timezone.mjs`：

| Signal | 說明 |
|---|---|
| `tz.intervalConversion` | SQL 中 `+ interval '8 hours'` 或 `- interval '8 hours'` |
| `tz.currentDateRaw` | SQL 中裸用 `CURRENT_DATE` / `now()::date` |
| `tz.localeRoundTrip` | JS 中 `new Date(...toLocaleString(...))` |
| `tz.formatterNoTz` | `Intl.DateTimeFormat` / `toLocaleString` 缺 `timeZone` |
| `tz.naiveApiResponse` | API handler 回傳 `timestamp` 欄位未經 offset 補全 |
