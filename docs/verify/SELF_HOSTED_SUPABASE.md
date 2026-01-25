# Self-hosted Supabase 部署指南

> 本文件說明如何部署與維護 Self-hosted Supabase，適用於需要完全控制基礎設施的情境。

---

## 1. 概述

### 1.1 適用情境

| 情境               | 推薦方案       |
| ------------------ | -------------- |
| 快速原型、小型專案 | Supabase Cloud |
| 資料隱私要求高     | Self-hosted    |
| 需要客製化設定     | Self-hosted    |
| 無法存取外部網路   | Self-hosted    |
| 成本控制需求       | Self-hosted    |

### 1.2 架構概覽

```
[Client] → [Cloudflare Tunnel / Nginx] → [Kong Gateway :8000]
                                              ↓
                         [PostgreSQL] ← [Auth/Storage/Realtime]
                              ↓
                         [Studio :3000]
```

### 1.3 Cloud vs Self-hosted 差異

| 項目           | Cloud                       | Self-hosted            |
| -------------- | --------------------------- | ---------------------- |
| URL            | `https://<ref>.supabase.co` | 自訂 domain            |
| Migration 部署 | `supabase db push`          | `docker exec` 執行 SQL |
| Studio         | `supabase.com/dashboard`    | 自架 Studio            |
| 資料庫存取     | API Gateway 僅限            | 可直連或 Tunnel        |
| CI/CD 整合     | 自動推送                    | 手動執行或腳本觸發     |
| MCP 端點       | `mcp.supabase.com`          | 自架 Kong MCP 路由     |

---

## 2. 部署流程

### 2.1 環境準備

```bash
# 建立部署目錄
mkdir -p /opt/supabase
cd /opt/supabase

# 下載官方 docker-compose
git clone --depth 1 https://github.com/supabase/supabase.git
cp -r supabase/docker/* .
rm -rf supabase
```

### 2.2 設定環境變數

```bash
# 複製範本
cp .env.example .env

# 編輯必要設定
vim .env
```

**必要設定項目：**

| 變數                | 說明            | 產生方式                           |
| ------------------- | --------------- | ---------------------------------- |
| `POSTGRES_PASSWORD` | PostgreSQL 密碼 | `openssl rand -base64 32`          |
| `JWT_SECRET`        | JWT 簽名密鑰    | `openssl rand -base64 32`          |
| `ANON_KEY`          | 匿名存取金鑰    | 使用 JWT 工具產生                  |
| `SERVICE_ROLE_KEY`  | 服務角色金鑰    | 使用 JWT 工具產生                  |
| `SITE_URL`          | 應用程式 URL    | `https://your-app.example.com`     |
| `API_EXTERNAL_URL`  | API 外部 URL    | `https://supabase-api.example.com` |

### 2.3 產生 JWT Keys

```bash
# 使用 Supabase 提供的工具
npx supabase-keys generate --secret <JWT_SECRET>
```

輸出範例：

```
anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

將產生的 keys 填入 `.env`。

### 2.4 啟動服務

```bash
docker compose up -d
```

### 2.5 驗證啟動

```bash
# 檢查服務狀態
docker compose ps

# 測試 API
curl -s http://localhost:8000/rest/v1/ \
  -H "apikey: <ANON_KEY>" | jq
```

---

## 3. 外部存取設定

### 3.1 Cloudflare Tunnel（推薦）

> Cloudflare Tunnel 提供免費的安全通道，無需開放防火牆。

```yaml
# cloudflared config.yml
tunnel: <tunnel-id>
credentials-file: /path/to/credentials.json

ingress:
  - hostname: supabase-api.example.com
    service: http://localhost:8000
  - hostname: supabase-studio.example.com
    service: http://localhost:3000
  - service: http_status:404
```

啟動 Tunnel：

```bash
cloudflared tunnel run <tunnel-name>
```

### 3.2 Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name supabase-api.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name supabase-studio.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 3.3 端口衝突處理

如果主機上有其他服務佔用預設端口，可調整 `docker-compose.yml`：

| 服務      | 預設端口 | 建議替代 | 原因                  |
| --------- | -------- | -------- | --------------------- |
| Kong      | 8000     | 8001     | Portainer 使用 8000   |
| Studio    | 3000     | 3001     | 開發 server 使用 3000 |
| Supavisor | 5432     | 5433     | 其他 PostgreSQL 使用  |

---

## 4. MCP 設定

### 4.1 .mcp.json 設定

```json
{
  "mcpServers": {
    "local-supabase": {
      "type": "http",
      "url": "http://localhost:54321/mcp"
    },
    "remote-supabase": {
      "type": "http",
      "url": "https://supabase-api.example.com/mcp"
    }
  }
}
```

### 4.2 Claude Code 權限設定

```json
{
  "permissions": {
    "allow": [
      "mcp__local-supabase__list_tables",
      "mcp__local-supabase__execute_sql",
      "mcp__local-supabase__list_migrations",
      "mcp__remote-supabase__list_tables",
      "mcp__remote-supabase__execute_sql"
    ]
  },
  "enabledMcpjsonServers": ["local-supabase", "remote-supabase"]
}
```

### 4.3 Kong MCP 路由

確認 Kong 已啟用 MCP 路由。Self-hosted Supabase 的 Kong 預設包含 `/mcp` 端點。

如果 MCP 無法連線，檢查 Kong 設定：

```bash
docker compose logs kong | grep mcp
```

---

## 5. Migration 部署

### 5.1 開發流程（與 Cloud 相同）

```bash
# 1. 建立新的 migration
supabase migration new <description>

# 2. 編輯 SQL 檔案
vim supabase/migrations/YYYYMMDDHHMMSS_<description>.sql

# 3. 本地測試
supabase db reset
supabase db lint --level warning

# 4. 產生 TypeScript types
pnpm db:types
```

### 5.2 部署到 Self-hosted

**方法一：docker exec（推薦）**

```bash
# 複製 migration 到容器
docker cp supabase/migrations/<timestamp>_<name>.sql supabase-db:/tmp/

# 執行 migration
docker exec supabase-db psql -U postgres -d postgres -f /tmp/<timestamp>_<name>.sql
```

**方法二：psql 直連（需 VPN 或內網）**

```bash
PGPASSWORD=<password> psql \
  -h <host> -p 5432 -U postgres -d postgres \
  -f supabase/migrations/<timestamp>_<name>.sql
```

**方法三：批次執行**

```bash
# 複製所有 migration 檔案
for f in supabase/migrations/*.sql; do
  docker cp "$f" supabase-db:/tmp/
done

# 依序執行
docker exec supabase-db bash -c \
  'for f in /tmp/*.sql; do psql -U postgres -d postgres -f "$f"; done'
```

### 5.3 驗證部署

```bash
# 查看 migration 狀態
docker exec supabase-db psql -U postgres -d postgres -c \
  "SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"

# 檢查表格結構
docker exec supabase-db psql -U postgres -d postgres -c "\dt public.*"
```

### 5.4 重啟 PostgREST

如果新增了表格或函式，需要讓 PostgREST 重新載入 schema cache：

```bash
docker compose restart rest
```

---

## 6. 備份與還原

### 6.1 自動備份設定

```bash
#!/bin/bash
# /opt/supabase/scripts/backup.sh

BACKUP_DIR=/opt/supabase/backups
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE=$BACKUP_DIR/supabase_$DATE.sql.gz

mkdir -p $BACKUP_DIR

# 備份資料庫
docker exec supabase-db pg_dump -U postgres -d postgres | gzip > $BACKUP_FILE

# 保留最近 30 天
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE"
```

設定 Crontab：

```bash
# 每天凌晨 3 點備份
0 3 * * * /opt/supabase/scripts/backup.sh >> /var/log/supabase-backup.log 2>&1
```

### 6.2 手動備份

```bash
# 完整備份
docker exec supabase-db pg_dump -U postgres -d postgres > backup.sql

# 僅備份特定 schema
docker exec supabase-db pg_dump -U postgres -d postgres \
  --schema=public --schema=your_schema \
  --no-owner --no-privileges > schema_backup.sql

# 壓縮備份
docker exec supabase-db pg_dump -U postgres -d postgres | gzip > backup.sql.gz
```

### 6.3 還原

```bash
# 還原完整備份
docker exec -i supabase-db psql -U postgres -d postgres < backup.sql

# 還原壓縮備份
gunzip -c backup.sql.gz | docker exec -i supabase-db psql -U postgres -d postgres

# 停用 FK 檢查後還原（避免順序問題）
docker exec -i supabase-db psql -U postgres -d postgres << 'EOF'
SET session_replication_role = 'replica';
\i /tmp/backup.sql
SET session_replication_role = 'origin';
EOF
```

---

## 7. 維護操作

### 7.1 常用指令

| 操作            | 指令                                                   |
| --------------- | ------------------------------------------------------ |
| 查看服務狀態    | `docker compose ps`                                    |
| 查看日誌        | `docker compose logs -f <service>`                     |
| 重啟單一服務    | `docker compose restart <service>`                     |
| 重啟所有服務    | `docker compose restart`                               |
| 進入 PostgreSQL | `docker exec -it supabase-db psql -U postgres`         |
| 查看 migration  | `SELECT * FROM supabase_migrations.schema_migrations;` |

服務名稱對照：

| 服務       | 名稱       |
| ---------- | ---------- |
| PostgreSQL | `db`       |
| PostgREST  | `rest`     |
| Kong       | `kong`     |
| Studio     | `studio`   |
| Auth       | `auth`     |
| Storage    | `storage`  |
| Realtime   | `realtime` |

### 7.2 健康檢查

```bash
# API 健康檢查
curl -s https://supabase-api.example.com/rest/v1/ \
  -H "apikey: <ANON_KEY>" | jq

# PostgreSQL 連線測試
docker exec supabase-db pg_isready -U postgres

# 查看資料庫連線數
docker exec supabase-db psql -U postgres -c \
  "SELECT count(*) FROM pg_stat_activity;"
```

### 7.3 日誌分析

```bash
# PostgREST 日誌
docker compose logs -f rest

# Kong 日誌
docker compose logs -f kong

# PostgreSQL 日誌
docker compose logs -f db

# 查看慢查詢（需啟用 pg_stat_statements）
docker exec supabase-db psql -U postgres -c \
  "SELECT query, calls, total_exec_time, mean_exec_time
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC LIMIT 10;"
```

---

## 8. 版本升級

### 8.1 升級流程

```bash
# 1. 備份
./scripts/backup.sh

# 2. 拉取最新映像
docker compose pull

# 3. 停止服務
docker compose down

# 4. 啟動新版本
docker compose up -d

# 5. 驗證
curl -s https://supabase-api.example.com/rest/v1/ \
  -H "apikey: <ANON_KEY>"
```

### 8.2 回滾到舊版本

```bash
# 指定版本標籤
docker compose down
docker compose -f docker-compose.yml up -d
```

如需使用特定版本，修改 `docker-compose.yml` 中的映像標籤。

---

## 9. Migration 回滾

> Self-hosted 沒有 `supabase migration repair` 可用，需手動處理。

### 9.1 撰寫回滾腳本

建議為每個 migration 建立對應的回滾腳本：

```
supabase/
├── migrations/
│   └── 20250101000000_create_users.sql
└── rollback/
    └── 20250101000000_rollback.sql
```

### 9.2 執行回滾

```bash
# 1. 執行回滾 SQL
docker exec -i supabase-db psql -U postgres -d postgres \
  < supabase/rollback/<timestamp>_rollback.sql

# 2. 更新 migration 狀態（可選）
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "DELETE FROM supabase_migrations.schema_migrations WHERE version = '<timestamp>';"
```

### 9.3 完整回滾（從備份還原）

```bash
# 停止服務
docker compose down

# 移除資料卷
docker volume rm supabase_db-data

# 重新啟動
docker compose up -d

# 還原備份
docker exec -i supabase-db psql -U postgres -d postgres < backup.sql
```

---

## 10. 常見問題

| 問題                   | 原因                  | 解法                          |
| ---------------------- | --------------------- | ----------------------------- |
| MCP 無法連線           | Kong 未啟用 MCP 路由  | 檢查 Kong 設定與日誌          |
| Migration 執行失敗     | 權限不足或語法錯誤    | 檢查 PostgreSQL 日誌          |
| Studio 無法存取        | Tunnel/Nginx 設定錯誤 | 檢查 proxy 設定               |
| PostgREST 找不到新表格 | Schema cache 未更新   | `docker compose restart rest` |
| 備份檔案過大           | 資料量增長            | 設定增量備份或壓縮            |
| 連線數過多             | 連線未正確關閉        | 檢查應用程式連線池設定        |

---

## 11. 安全建議

- [ ] 使用強密碼（至少 32 字元隨機字串）
- [ ] 限制資料庫外部存取（只允許 Kong Gateway）
- [ ] 定期更新 Docker 映像
- [ ] 設定 SSL/TLS（Cloudflare 或自簽憑證）
- [ ] 監控異常登入嘗試
- [ ] 定期測試備份還原流程
- [ ] 設定防火牆規則
- [ ] Studio 設定強密碼或限制 IP 存取

---

## 12. 相關文件

| 文件                                                                   | 說明               |
| ---------------------------------------------------------------------- | ------------------ |
| [SUPABASE_MIGRATION_GUIDE](./SUPABASE_MIGRATION_GUIDE.md)              | Migration 開發流程 |
| [ENVIRONMENT_VARIABLES](./ENVIRONMENT_VARIABLES.md)                    | 環境變數設定       |
| [DATABASE_OPTIMIZATION](./DATABASE_OPTIMIZATION.md)                    | 資料庫效能優化     |
| [RLS_BEST_PRACTICES](./RLS_BEST_PRACTICES.md)                          | RLS 最佳實踐       |
| [Supabase MCP 指南](../SUPABASE_MCP.md)                                | MCP 整合指南       |
| [Supabase Self-hosting](https://supabase.com/docs/guides/self-hosting) | 官方文件           |
