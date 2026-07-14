---
description: Cloudflare D1 + Drizzle ORM + NuxtHub dev binding + cloudflared tunnel multi-account 規約；Drizzle subquery alias 衝突、NuxtHub `driver: 'd1'` 鎖死 dev binding、cloudflared CNAME 寫錯 zone 三類 silent failure 的 hard rule
paths: ['**/*.{ts,vue,sql}', 'drizzle.config.*', 'wrangler.{toml,jsonc}', 'nuxt.config.*']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/data-layer-d1.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Data Layer — Cloudflare D1 / Drizzle / NuxtHub / cloudflared

> 觸發於任何涉及 D1 / Drizzle / wrangler / Nuxt 設定的 session。五條 hard rule 源自 2026-05-21 / 2026-05-22 rental-scout + clade vite-tunnel 第一手踩坑（pitfall 全文見 `docs/pitfalls/2026-05-2*`）。
>
> Cookbook 範本：`~/offline/clade/vendor/snippets/d1-drizzle/`。

## 通用前提

- **D1 prod vs miniflare local 不對等**：本機 `pnpm dev` 走的是 miniflare 內建 better-sqlite3（容忍度高），prod 是真 D1（嚴格）。任何「本機過、prod 炸」的 sqlite 行為差異**MUST** 當成預設假設，不要靠「dev 跑得起來」當 ship gate
- **D1 binding 只在 Workers / Pages Functions runtime 存在**：純 Nitro Node listener（`pnpm dev`、`node .output/server/index.mjs`）拿不到 `env.DB`；必須走 `wrangler dev` / `nuxthub dev` 才有 binding 注入
- **DDL / DML 驗證**：對 D1 prod 套 schema 前**MUST** 透過 `wrangler d1 execute <db> --remote --command "<sql>"` dry-run，不靠 miniflare 結果做最終判斷

## 1. Drizzle subquery 同名 alias 衝突（hard rule）

Reference：`docs/pitfalls/2026-05-21-drizzle-d1-subquery-column-alias-collision.md`

**Drizzle 0.45.x 對「subquery 內 `sql<T>...as('X')` aliased column + outer SELECT 用 `<subquery>.<colname>` 引用」這個組合，生成的 SQL 不會自動加 subquery alias prefix。** 多個 subquery LEFT JOIN 又把 column alias 成同名（例 `count`）→ outer query 出現多個裸 `"count"` reference → D1 prod 回 `ambiguous column reference` 500、miniflare local 寬鬆挑一個回 200（silent dev-prod parity gap）。

### MUST

1. **每個 subquery 的 column alias MUST 全 query 唯一**（用 subquery alias 當前綴最直接，例 `'mc_count'` / `'lc_count'` / `'dc_count'`）
2. **Outer SELECT MUST 用顯式 qualified reference**：`sql\`coalesce("<sub>"."<col>", 0)\``，不依賴 Drizzle column resolution 自動補 prefix
3. **MUST 對 D1 prod 跑等價 SQL 驗證**：`wrangler d1 execute <db> --remote --json --command "<生成的 SELECT>"`，不靠 `pnpm dev` 過就 ship

### 反例（rental-scout `server/api/admin/groups/index.get.ts` 修法前，2026-05-21 prod 500）

```ts
const memberCounts = db.select({
  groupId: groupMemberships.groupId,
  count: sql<number>`count(*)`.as('count'),   // ← alias 'count'
}).from(groupMemberships).groupBy(...).as('mc')

const listingCounts = db.select({
  groupId: listings.groupId,
  count: sql<number>`count(*)`.as('count'),   // ← 同名 alias
}).from(listings).groupBy(...).as('lc')

return db.select({
  memberCount: sql<number>`coalesce(${memberCounts.count}, 0)`,  // ← Drizzle 生成 coalesce("count", 0)，無 prefix
  listingCount: sql<number>`coalesce(${listingCounts.count}, 0)`,
}).from(groups).leftJoin(memberCounts, ...).leftJoin(listingCounts, ...)
```

生成的 SQL：

```sql
select coalesce("count", 0), coalesce("count", 0) from "groups"
  left join (select "group_id", count(*) as "count" from ...) "mc" on ...
  left join (select "group_id", count(*) as "count" from ...) "lc" on ...
-- D1 prod: ambiguous column reference "count"
```

### 正例（cookbook 完整版見 `vendor/snippets/d1-drizzle/subquery-alias-template.ts`）

```ts
const memberCounts = db.select({
  groupId: groupMemberships.groupId,
  count: sql<number>`count(*)`.as('mc_count'),   // ← unique alias
}).from(groupMemberships).groupBy(...).as('mc')

const listingCounts = db.select({
  groupId: listings.groupId,
  count: sql<number>`count(*)`.as('lc_count'),
}).from(listings).groupBy(...).as('lc')

return db.select({
  memberCount: sql<number>`coalesce("mc"."mc_count", 0)`,    // ← qualified
  listingCount: sql<number>`coalesce("lc"."lc_count", 0)`,
}).from(groups).leftJoin(memberCounts, ...).leftJoin(listingCounts, ...)
```

### 偵測

```bash
# 同檔內任 2+ 個 .as('<sameword>') Drizzle subquery alias
for f in $(grep -rln "\.as('[a-z_]*')" server/ 2>/dev/null); do
  dupes=$(grep -oE "\.as\('[a-z_]+'\)" "$f" | sort | uniq -d)
  [ -n "$dupes" ] && echo "$f: $dupes"
done
```

## 2. NuxtHub D1 dev binding fallback（hard rule）

Reference：`docs/pitfalls/2026-05-21-nuxthub-d1-driver-dev-binding-not-found.md`

**`nuxt.config.ts` 把 `hub.db.driver: 'd1'` 寫在頂層、無 conditional wrap，會鎖死所有環境走 D1 binding 路徑。** `pnpm dev` 跑純 Nitro Node listener，沒人塞 `process.env.DB` / `globalThis.DB`，runtime 直接 throw `[nuxt-hub] DB binding not found`。被 OAuth onSuccess catch 後使用者只看到「登入失敗，請稍後再試」（無 stack trace）。

> Source：`@nuxthub/core/dist/module.mjs:226-241` sqlite dialect 決策樹對 `driver === 'd1'` 直接 break，無 dev fallback、無 helpful error。

### MUST

1. **MUST** `driver: 'd1'` + `connection: { databaseId }` **僅在 build / prod 階段** conditional 釘（pattern 見下方反例 → 正例）
2. **MUST** dev 階段補 `@libsql/client` peer dep（`pnpm add -D @libsql/client`），讓 NuxtHub auto-fallback 到 libsql + `.data/db/sqlite.db`
3. **MUST** dev startup log 觀察點：`[nuxt:hub] ℹ hub:db using sqlite database with libsql driver`（**不是** `with d1 driver`）+ 後續 migration apply log
4. **NEVER** 在 dev 階段「手動 sqlite3 apply migration」當 known startup quirk 跳過 — 這只繞過 startup migration check，runtime 同 root cause 沒解，下次 OAuth / endpoint 仍會炸

### 反例（rental-scout 修法前）

```ts
// nuxt.config.ts
hub: {
  db: {
    dialect: 'sqlite',
    driver: 'd1',                                  // ← 頂層釘，dev 也鎖死走 D1
    connection: { databaseId: '16e5037c-...' },
  },
}
```

### 正例（完整 cookbook 見 `vendor/snippets/d1-drizzle/nuxthub-dev-binding-fallback.ts`）

```ts
hub: {
  db: {
    dialect: 'sqlite',
    ...(process.env.NODE_ENV === 'production' || process.env.NITRO_PRESET?.includes('cloudflare')
      ? {
          driver: 'd1' as const,
          connection: { databaseId: '<your-d1-database-id>' },
        }
      : {}),
  },
}
```

### 偵測

```bash
# 找 nuxt.config.ts 含 driver: 'd1' 且無 conditional wrap
find . -name nuxt.config.ts -not -path "*/node_modules/*" \
  -exec grep -lE "driver:\s*['\"]d1['\"]" {} + \
  | xargs -I {} sh -c 'grep -L "NODE_ENV\|NITRO_PRESET\|nuxt.options.dev" "{}" && echo "{}: unguarded d1 driver"'
```

## 3. cloudflared tunnel multi-account 防護（hard rule）

Reference：`docs/pitfalls/2026-05-21-cloudflared-multi-account-cname-misdirection.md`

**`cloudflared tunnel route dns <tunnel> <hostname>` 在多 Cloudflare account 情境下會 silent 把 CNAME 寫到錯 zone。** `~/.cloudflared/cert.pem` 是 account-level binding；當 hostname 對應 zone 不在 cert account 內，cloudflared 不報 `zone not found`，而是把整段 hostname 當 subdomain prefix 附加到該 account 內第一個 zone（例請求 `rental-scout-dev.<maintainer-domain>` → 寫成 `rental-scout-dev.<maintainer-domain>.bigbyteedu.com`）。CLI exit 0、INF level log，完全不像錯誤。

### MUST

1. **MUST** 在跑 `cloudflared tunnel route dns` 前**先用 CF API 驗證 hostname 對應的 root zone 在當前 cert.pem account 內**（pre-flight zone check）
2. **MUST** pre-flight 失敗（zone 不在當前 account）時 fail-loud，列出三條出路（切 cert / `--origincert` / 改 API token mode），**禁止** silently 繼續
3. **MUST** setup script 第一步先跑 `cloudflared tunnel list` 列出當前 cert 看到的 tunnel，讓使用者確認「現在這個 cert 是不是我預期的 account」
4. **NEVER** 假設「之前在某 account 設過、之後 cloudflared 預設仍是同一個」— `cert.pem` 可能被 `cloudflared tunnel login` 後續 session 覆寫

### 反例（clade vite-tunnel skill setup script 第一版，commit `ceb5689`）

```bash
# 直接呼叫，無 pre-flight
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"
# 結果：CNAME 寫到錯 zone，exit 0，外部 DNS resolver 永遠 resolve 不到
```

### 正例（完整 SOP 見 `vendor/snippets/d1-drizzle/cloudflared-account-pin.md`）

```bash
# 1. 抽 root zone（處理 .com.tw / .co.uk 等多段 TLD）
root_zone=$(echo "$HOSTNAME" | awk -F. '{
  if ($(NF-1) ~ /^(com|co|gov|edu|org|net|ac)$/ && length($NF) == 2)
    print $(NF-2)"."$(NF-1)"."$NF
  else
    print $(NF-1)"."$NF
}')

# 2. 用 CF API 驗 zone 在當前 cert.pem account 內
result=$(curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=$root_zone")
count=$(echo "$result" | jq '.result | length')

if [ "$count" -eq 0 ]; then
  echo "ERROR: zone '$root_zone' 不在當前 cloudflared cert.pem 對應的 account 下"
  echo "三條出路："
  echo "  (a) cloudflared tunnel login   # 切到含 $root_zone 的 account（會覆蓋 cert.pem）"
  echo "  (b) cloudflared --origincert ~/.cloudflared/<other>-cert.pem tunnel route dns ..."
  echo "  (c) 改 API token mode，跳過 cert.pem 認證路徑"
  exit 1
fi

# 3. pre-flight 過了再下 route dns
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"
```

### 偵測

```bash
# 找 vendor snippet / consumer script 直接呼叫 route dns 沒有 pre-flight 的
grep -rnE 'cloudflared[[:space:]]+tunnel[[:space:]]+route[[:space:]]+dns' \
  ~/offline/clade/vendor/snippets/ \
  --include="*.sh" --include="*.mjs" --include="*.ts"
```

## 4. 禁用 `DROP TABLE` table-rebuild recipe（hard rule）

Reference：`docs/pitfalls/2026-05-22-d1-nuxthub-table-rebuild-cascade-children.md`

**Drizzle 對 SQLite parent table 加 `NOT NULL` column 會自動生成 `DROP TABLE + CREATE TABLE __new_* + RENAME` table-rebuild recipe。** Migration 內顯式 `PRAGMA foreign_keys=OFF` 在 standard SQLite 能擋住 children cascade，但 **D1 + NuxtHub auto-migration 組合下失效** — 觀察行為是 NuxtHub 在 `--> statement-breakpoint` 處把 migration 拆成獨立 D1 batch / binding `prepare()` call，`PRAGMA foreign_keys=OFF` 只在第一個 session 生效，後面 `DROP TABLE` 觸發 children cascade。Local sqlite3 cli 跑同樣 SQL 完全沒事（standard SQLite：DROP TABLE 不觸發 ON DELETE CASCADE）→ 純 dev-prod parity gap。

rental-scout 2026-05-21 prod incident：92 個 `checklist_items` row + 35 個 `listing_assets` row + 3 個 listing 的 `lifestyle_stars` 一次全失（R2 blob 還在但 DB 紀錄消失）。

### MUST

1. **NEVER** 對 D1 跑 `DROP TABLE <parent>` + `CREATE TABLE __new_<parent>` + `RENAME TO <parent>` 三段 rebuild recipe（即使顯式 `PRAGMA foreign_keys=OFF`）
2. **MUST** 改用 `ALTER TABLE ADD COLUMN` / `ALTER TABLE DROP COLUMN`（SQLite 3.35+ 支援，D1 支援）
3. 若需加 **FK constraint + NOT NULL + DEFAULT** 三者組合：SQLite **禁止**該組合在 `ADD COLUMN` 同時出現。改成兩步：
   - `ALTER TABLE <table> ADD COLUMN <name> <type> DEFAULT <value>;`（nullable + default）
   - `UPDATE <table> SET <name> = <value> WHERE <name> IS NULL;`（backfill；ADD COLUMN 已自動 default 但留下 idempotent 保險）
   - 接受**沒有 SQL-level FK constraint** 的 drift（D1 預設 `PRAGMA foreign_keys=OFF`，runtime 不 enforce；Drizzle `.references()` 仍驅動 type / migration generation）
4. 若**真**要 rebuild（改 column type）：拆成兩個 migration —
   - migration N：`ALTER TABLE ADD <new_column>` + 應用層 dual-write / dual-read 一段過渡期
   - migration N+M：`ALTER TABLE DROP <old_column>`（SQLite 3.35+ 支援，D1 支援）
5. drizzle-kit 預設 generate destructive rebuild recipe **MUST** 在 migration 檔 review 階段攔下並手改成 ALTER TABLE 形式；**禁止**「drizzle 自動生成的應該沒問題」推理

### 反例（rental-scout `server/db/migrations/sqlite/0004_listings_group_id.sql`，2026-05-21 prod 砍光 children）

```sql
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_listings` (
  `id` text PRIMARY KEY NOT NULL,
  `group_id` text NOT NULL,                  -- ← 新加 NOT NULL column
  ...
);
--> statement-breakpoint
INSERT INTO `__new_listings` (...) SELECT ..., 'grp_default', ... FROM `listings`;
--> statement-breakpoint
DROP TABLE `listings`;                         -- ← 即使 PRAGMA OFF，D1 仍 cascade
--> statement-breakpoint
ALTER TABLE `__new_listings` RENAME TO `listings`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
```

### 正例（完整 cookbook 見 `vendor/snippets/d1-drizzle/safe-schema-patch.sql.template`）

```sql
-- 加 nullable column with default（既有 row 自動 default）
ALTER TABLE `listings` ADD COLUMN `group_id` text DEFAULT 'grp_default';

-- Idempotent backfill（保險）
UPDATE `listings` SET `group_id` = 'grp_default' WHERE `group_id` IS NULL;

-- 之後 add 別的 nullable column 沒問題
ALTER TABLE `listings` ADD COLUMN `service_fee` integer;
```

> ⚠️ schema.ts 內 `.references()` 仍可保留（驅動 Drizzle types）；只是 D1 runtime FK 不 enforce（預設 PRAGMA OFF）。若**真**需要 SQL-level FK enforcement，等下次有別的理由動該 table schema 時走 dual-migration rebuild safe-pattern 一併補。

### 偵測

```bash
# 對 D1 + NuxtHub consumer 掃 migrations 目錄含 table-rebuild recipe
for d in ~/offline/<consumer>; do
  uses_nuxthub=$(grep -lE "@nuxthub/core|hub\.db" "$d/nuxt.config.ts" 2>/dev/null && echo yes || echo no)
  [ "$uses_nuxthub" = "yes" ] || continue
  rebuild_hits=$(grep -rEl "DROP TABLE \`?[a-z_]+\`?|__new_[a-z_]+|RENAME TO" \
    "$d/server/db/migrations" "$d/server/database/migrations" 2>/dev/null | wc -l | tr -d ' ')
  echo "$d: rebuild-hits=$rebuild_hits"
done
```

命中 → **MUST** 立刻 audit + 確認對應 D1 Time Travel retention window 還在（30 天內），準備 recovery；同時改 migration 為 ALTER TABLE 形式。

## 5. D1 Time Travel as first-class safety net（hard rule）

Reference：`docs/pitfalls/2026-05-22-d1-nuxthub-table-rebuild-cascade-children.md`（同 § 4 pitfall — recovery 段）

**Cloudflare D1 內建 Time Travel：每分鐘自動 bookmark，30 天 retention，可 restore 到任一時間點**。這條規約把它從「隱性 safety net」升級成「強制 SOP」— 任何 schema migration 上 prod 前都 **MUST** 主動記下 bookmark，事件發生時不靠運氣救人。

### MUST

1. **MUST** 每次 schema migration 上 prod **前**跑 `wrangler d1 time-travel info <db>` 拿當前 bookmark
2. **MUST** bookmark + ISO timestamp 寫進 PR description / commit message / GitHub Actions deploy job summary（至少一處）
3. **MUST** Schema 變動規模分級：
   - 純 `ALTER TABLE ADD COLUMN`（nullable / with default）→ bookmark **建議**（low risk，但仍記方便事後 audit）
   - 含 `DROP TABLE` / `RENAME TO` / type change / index 重建 → bookmark **強制**
   - 含 user-data table（listings / orders / payments 等）→ bookmark **強制**
4. **MUST** Time Travel bookmark 保存 90 天（涵蓋 Cloudflare 30 天 retention + 60 天 audit buffer）— 寫進 PR description 即足夠（git history 保存）
5. **NEVER** 倚賴「我記得幾點 deploy」反推時間 → restore：精確時間靠 bookmark id，不靠記憶

### Recovery playbook（incident 發生時）

1. **立刻 export 當前 prod state 留底**（雙保險）：
   ```bash
   wrangler d1 export <db> --remote --output prod-current-$(date +%Y%m%d-%H%M%S).sql
   ```
2. **找 incident 前 bookmark**（若 PR description 有記，直接用；否則用時間反推）：
   ```bash
   wrangler d1 time-travel info <db> --timestamp "<ISO before incident>"
   ```
3. **Restore（destructive）**：
   ```bash
   wrangler d1 time-travel restore <db> --bookmark <bookmark>
   ```
   執行後 wrangler 會輸出「undo bookmark」（restore 動作本身也有 bookmark），記下來可 undo 此次 restore
4. **跑 D1-safe schema patch** 取代原 destructive migration（見 § 4 正例 + cookbook template）
5. **補 `_hub_migrations` row** 標記受影響 migration 已 apply，避免 NuxtHub cold start re-apply destructive migration

### 自動化建議（pre-deploy bookmark）

`vendor/snippets/d1-drizzle/pre-migration-bookmark.sh.template` 提供 pre-deploy step skeleton，可掛在 `.github/workflows/deploy.yml`：

```yaml
- name: Record D1 Time Travel bookmark
  run: bash scripts/pre-migration-bookmark.sh
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

bookmark + ISO timestamp 自動寫進 GitHub Actions step summary，事件發生時直接從 workflow run 撈。

### 偵測

```bash
# 該 consumer 是否有 pre-deploy bookmark step
grep -rE "time-travel info|pre-migration-bookmark" .github/workflows/ 2>/dev/null || echo "MISSING: 無 pre-deploy bookmark gate"
```

## 6. 必禁事項彙整

| 行為 | 為什麼禁 |
| --- | --- |
| Drizzle 多 subquery 用同名 `.as('count')` | D1 prod 拒絕 ambiguous column；miniflare local 寬鬆會放行（silent dev-prod gap）|
| Drizzle outer SELECT 用裸 column reference 跨 subquery | Drizzle 不自動補 subquery alias prefix；必須顯式 `"<sub>"."<col>"` |
| `nuxt.config.ts` 頂層無 conditional 寫 `driver: 'd1'` | 鎖死 dev 走 D1 binding 路徑，純 Nitro listener 拿不到 → runtime throw |
| 用「手動 sqlite3 apply」繞過 dev startup `DB binding not found` | 只繞 migration check，runtime endpoint 仍會炸；要解 root cause |
| `cloudflared tunnel route dns` 前不做 pre-flight zone check | 多 account 場景 silent 寫錯 zone，exit 0 + INF log，外部永遠 resolve 不到 |
| 假設 `~/.cloudflared/cert.pem` 永遠是「我預期的 account」 | `cloudflared tunnel login` 會覆寫 cert.pem，跨 session 不可靠 |
| 在 D1 / NuxtHub stack 用「pnpm dev 過 = ship 可」當判斷 | dev-prod parity gap 明顯，**MUST** 對 D1 prod dry-run 等價 SQL |
| 對 D1 跑 `DROP TABLE + CREATE __new_* + RENAME` table-rebuild recipe | D1 + NuxtHub auto-migration 組合下 `PRAGMA foreign_keys=OFF` 失效，children cascade 全砍（standard SQLite 不會這樣）|
| drizzle-kit 生成的 destructive rebuild migration 不審就 commit | drizzle 預設加 NOT NULL column 走 rebuild path；**MUST** 手改成 `ALTER TABLE ADD COLUMN` 形式 |
| Schema 變動上 prod 前不記 D1 Time Travel bookmark | 事件發生時靠運氣 < 30 天才能救；bookmark 寫進 PR description = 免疫 |
| 假設 D1 `PRAGMA foreign_keys=OFF` 對 `DROP TABLE` 也生效 | D1 內部對 DROP TABLE 有 special-case path 不受 PRAGMA 控制（行為觀察） |

## 採用流程

採用本規約的 consumer：

1. 對自家 `server/api/**/*.ts` 跑 § 1 偵測指令；命中改 unique alias + qualified reference
2. 對 `nuxt.config.ts` 跑 § 2 偵測；命中改 conditional wrap + 補 `@libsql/client` dev dep
3. 若採用 cloudflared tunnel skill，setup script 加 § 3 pre-flight（或等 clade vite-tunnel skill v2 自帶 pre-flight）
4. 對自家 `server/db/migrations/` 或 `server/database/migrations/` 跑 § 4 偵測；命中改 `ALTER TABLE` 形式（cookbook 見 `safe-schema-patch.sql.template`）
5. `.github/workflows/deploy.yml` 加 § 5 pre-deploy bookmark step（cookbook 見 `pre-migration-bookmark.sh.template`）
6. Cookbook template `vendor/snippets/d1-drizzle/` cp 進專案後改 `// REPLACE: ...` 處
