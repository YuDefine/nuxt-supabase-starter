# create-nuxt-starter

Interactive CLI to scaffold a Nuxt + Supabase project from this starter template.

## Usage

```bash
# wizard mode (對話式選擇)
pnpm create nuxt-supabase-starter my-app

# non-interactive (帶 flag)
pnpm create nuxt-supabase-starter my-app --yes
pnpm create nuxt-supabase-starter my-app --auth nuxt-auth-utils --ci simple
```

## Flags

| Flag                  | Values                                                    | Description                                          |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `--yes`, `-y`         | —                                                         | Skip wizard, use default selections                  |
| `--auth`              | `nuxt-auth-utils` \| `better-auth` \| `none`              | Auth provider                                        |
| `--ci`                | `simple` \| `advanced`                                    | GitHub Actions CI mode                               |
| `--preset`            | `default` \| `fast`                                       | Profile preset (fast skips testing)                  |
| `--fast`              | —                                                         | Alias of `--preset fast`                             |
| `--agents`            | `claude-code,codex,cursor`                                | Comma-separated AI runtime targets                   |
| `--with`              | feature ids                                               | Comma-separated features to add                      |
| `--without`           | feature ids                                               | Comma-separated features to remove                   |
| `--minimal`           | —                                                         | Empty feature set, build up with `--with`            |
| `--evlog-preset`      | `none` \| `baseline` \| `d-pattern-audit` \| `nuxthub-ai` | evlog (wide event logging) tier — default `baseline` |
| `--register-consumer` | —                                                         | Register to clade consumers.local (default `true`)   |
| `--wire-pre-commit`   | —                                                         | Wire pre-commit hub:check hook (default `true`)      |
| `--clone-clade`       | —                                                         | Clone clade if not found (default `true`)            |

## evlog preset

`--evlog-preset` 控制 wide event logging stack 套用 tier。對應 clade `presets/evlog-{baseline,d-pattern-audit,nuxthub-ai}/`。

| Preset             | 適用情境                               | 套件數 | 額外帶起的                                                               |
| ------------------ | -------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `none`             | 純 Nuxt + Supabase starter，不用 evlog | 0      | —                                                                        |
| `baseline`（預設） | 內部工具 / SROI 報告 / 教學系統        | 6      | drain pipeline + 5 件套 enricher + sampling/redaction + client transport |
| `d-pattern-audit`  | 醫療 / 金融 / 公部門合規場景           | 13     | baseline + audit_logs migration + HMAC-signed audit chain + diff-cron    |
| `nuxthub-ai`       | AI agent / RAG / chatbot 應用          | 7      | NuxtHub D1 drain + AI cost tracking + SSE/MCP child logger               |

選擇邏輯（master plan § 2.3）：

```
是否需要 audit chain（合規）？
  yes → d-pattern-audit
  no  → 是否 AI agent stack？
          yes → nuxthub-ai
          no  → baseline
```

### 範例

```bash
# 預設（baseline）— 大多數應用
pnpm create nuxt-supabase-starter my-app

# 純 starter，不要 evlog
pnpm create nuxt-supabase-starter my-app --evlog-preset none

# 合規場景（醫療 / 金融）
pnpm create nuxt-supabase-starter my-app \
  --evlog-preset d-pattern-audit \
  --auth better-auth

# AI agent 應用（NuxtHub D1 + AI cost tracking）
pnpm create nuxt-supabase-starter my-app \
  --evlog-preset nuxthub-ai \
  --with chat,charts
```

## See also

- clade `docs/evlog-master-plan.md` — wide event logging 設計與選擇決策樹
- clade `presets/evlog-*/PRESET.md` — 各 preset 安裝步驟與 nuxt.config 範例
- starter `docs/evlog-client-transport.md` — client transport 設定
