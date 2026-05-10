<!--
🔒 LOCKED — managed by clade
Source: rules/core/tech-debt-routing.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Tech debt 路由規則——決定發現的 TD 該登在 clade 還是當前 consumer，以散播範圍與修法歸屬為準
globs: ['docs/tech-debt.md', '**/docs/tech-debt.md']
---

# Tech Debt Routing

繁體中文

**核心命題**：發現問題時要先問「修法落在哪一層」，再決定 TD 登記位置。否則同一條問題會在 5 個 consumer 各自登一遍、互相不知道、修也修不完整。

此規則優先於個別 skill 說明。

---

## 決策流程

對任一 TD 候選問問三個問題：

1. **修法在哪一層改？** clade 中央倉、本 consumer、還是 starter / 其他工具？
2. **修完誰受惠？** 只有當前 consumer，還是 clade propagate 後 5 個 consumer 都受惠？
3. **真相來源是誰？** 修在 consumer 端會被下次 propagate 蓋掉嗎？

依答案路由：

| 修法位置 | 散播後受惠 | TD 登在 |
| --- | --- | --- |
| clade `scripts/` / `vendor/` / `rules/` / `plugins/hub-core/` / `claude-md/core-snippets/` | 全部 5 consumer（散播後） | **clade `docs/tech-debt.md`** |
| 單一 consumer 業務碼（自家 `server/` / `app/` / 自家 migration / 自家 nuxt.config） | 只該 consumer | **該 consumer `docs/tech-debt.md`** |
| starter scaffolder（`packages/create-nuxt-starter/`） | 未來所有 scaffold 出的新專案 | **starter `docs/tech-debt.md`** |
| 同時 clade + consumer 都要改 | 跨層 | **clade 為主、consumer 為輔**：clade TD 描述根因 + 散播計畫，consumer TD 描述本地後置動作（如 `pnpm hub:vendor:force` 後跑某個 backfill） |

---

## 為什麼一律先問 clade

Consumer 端的 `.claude/` / `scripts/spectra-advanced/` / vendor 副本是 clade **投影**（帶 LOCKED banner、chmod 444、checksum gate）。

- 在 consumer 端登 TD 描述「投影層的問題」→ 修法看似在 consumer，但下次 propagate 會把 consumer 修法蓋回 clade 版本 → TD 永遠修不完
- 唯一不被蓋的是 consumer 自家業務檔（`server/api/**`、`server/utils/**`、自家 migration、自家 nuxt.config 業務段、`local/**` rule 等）
- 因此**任何發現「投影層」有問題的 TD，都應追到 clade source 並登在 clade**，不是登在發現它的 consumer

---

## 範例

### 範例 1：audit script glob 對 macOS symlink 路徑失敗

- 問題：`evlog-adoption-audit.mjs` 用 `-g "server/plugins/**"` 對 `/tmp/scaffold` (`/tmp` 是 `/private/tmp` symlink) 不命中
- 修法：改 `**/server/plugins/**`
- 修在哪：`~/offline/clade/scripts/evlog-adoption-audit.mjs`（clade 真相層）
- 散播：propagate 後 5 consumer 的 `scripts/evlog-adoption-audit.mjs` 副本同步收到
- → **登 clade TD**

### 範例 2：perno staging app 廣布 500

- 問題：staging worker `/api/v1/employees/me`、`/api/v1/leave/types` 都 500
- 修法：perno 自家 worker secret / module load / supabase tunnel 排查
- 修在哪：perno 自家 `server/` / `wrangler.jsonc` / GitHub Secrets
- 散播：clade 不參與
- → **登 perno TD**

### 範例 3：scaffolder `nuxthub-ai` 缺 D1 migrations:create

- 問題：`pnpm create nuxt-supabase-starter --evlog-preset nuxthub-ai` 後新專案 `server/database/migrations/` 無 evlog_events migration → 第一次 deploy dead-write
- 修法：starter scaffolder 加 post-scaffold `pnpm hub:db:migrations:create` step（或在 PRESET.md 寫提醒）
- 修在哪：`~/offline/nuxt-supabase-starter/template/packages/create-nuxt-starter/`（starter）
- 散播：未來 scaffold 出的新專案受惠（不影響既有 5 consumer）
- → **登 starter TD**

### 範例 4：跨層問題（clade rule + consumer 後置）

- 問題：clade 新增 `rules/modules/runtime/cf-workers/secrets.md` 規則，consumer 端 `deploy.yml` 沒對齊
- 修法：clade 端定 rule（已 done）；consumer 端各自跑「audit `deploy.yml` 是否有 `secrets:` block」+ 補修
- 修在哪：clade 寫 rule，consumer 補 deploy.yml
- → **clade TD** 描述 rule + 跨 consumer 散播追蹤；**每個 consumer TD** 描述自家 audit 結果 + 補修步驟（互相 cross-link）

---

## 禁止事項

- **NEVER** 在 consumer 端登 TD 描述「`.claude/rules/X.md` 內容怪怪的」/「vendor 某個 helper 行為不對」/「audit script 算錯」/「propagate 沒推某條」/「sync-rules 沒對齊」/「commit hook 邏輯怪」等明顯屬於 clade 真相層的問題。**先到 clade 找 source**
- **NEVER** 把同一條跨 consumer 共通問題在 5 個 consumer 各登一條 TD（duplicate noise + 散播後消失）
- **NEVER** 跳過判斷「下次 propagate 會不會蓋掉我的修」就直接在 consumer 改 + 登 TD
- **MUST** 在跨層 TD 內**互相 cross-link**（clade TD 列出 consumer-side action，consumer TD 引用 clade TD ID）

---

## 速判用 cheatsheet

```
看到 TD 候選 → 問：「修法是改 X？」
  X ∈ {scripts/, vendor/, rules/, plugins/hub-core/, claude-md/core-snippets/, openspec/templates/, docs/} (clade)
    → 登 clade
  X ∈ {scaffolder, template/} (starter)
    → 登 starter
  X ∈ {server/, app/, 自家 migration, 自家 nuxt.config 業務段, local/}
    → 登該 consumer
  X 跨層
    → clade 主、consumer 輔；cross-link
```

---

## 與其他規則的關係

- `rules/core/follow-up-register.md`：管 TD ID 命名 / archive gate / `@followup[TD-NNN]` marker
- 本 rule：管 **TD 登在哪個 repo 的 docs/tech-debt.md**

兩條規則正交。發現 TD 時先依本 rule 路由、再依 follow-up-register 編號 + 寫 entry。
