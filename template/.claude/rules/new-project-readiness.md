---
description: 新專案（scaffold / init / 從 starter 灌進既有 repo）期間撞到的每一個報錯、阻礙、體驗不佳處，MUST 修在 clade / starter 源頭並長出機械檢查，NEVER 只修當前 repo。放行 gate 是 scripts/audit-new-project-readiness.ts。
paths: ['.claude/consumer-meta.json', '.claude/hub.json', 'wrangler.{toml,jsonc}', '.gitignore', 'package.json', 'nuxt.config.*']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/new-project-readiness.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# New Project Readiness

**核心命題**：新專案從 starter / framework init 拼起來的那幾個小時，是 fleet 內**唯一**會反覆
重播同一批坑的時段。每一次踩完只修那一個 repo，下一個新專案原樣再踩一遍——而且踩的人
每次都以為自己是第一個。

**Iron Law：新專案期間撞到的每一個報錯 / 阻礙 / 體驗不佳處，MUST 修到「下一個新專案不會再遇到」
才算完成。違反字面就是違反精神——「這個 repo 先繞過去」「等下次遇到再說」「這是那個 repo 自己的
狀況」都不算遵守。**

## MUST

1. **新專案 scaffold 完成、開始寫業務 code 之前**，MUST 跑：

   ```bash
   node ~/offline/clade/scripts/audit-new-project-readiness.ts
   ```

   exit 0 才可放行。exit 1 逐條修完再跑一次，**NEVER** 帶著 finding 往下做——那些 finding
   每一條都來自一次真實事故。

2. **每一個**在新專案期間撞到的問題，MUST 走完三步，**缺一不算修完**：

   | 步 | 動作 | 判準 |
   | --- | --- | --- |
   | (a) | 修當前 repo | 讓自己能往下做 |
   | (b) | 修源頭 | clade 源檔／starter template／scaffold script —— 決定下一個新專案還會不會遇到 |
   | (c) | 長出機械檢查 | 在 `audit-new-project-readiness.ts` 加一個 check，或擴既有 audit 的掃描面 |

   只做 (a) 是把事故留給下一個人。只做 (a)(b) 的話，源頭修好了但沒有人知道它修好了——
   下一次它以別的形狀回來時，沒有東西會響。

3. **驗收 MUST 是「重建」，不是「現在看起來好了」**：源頭修完後，用一次**全新 scaffold**
   （或把該專案砍掉重建）驗證同一批問題不再出現。修在源頭卻沒重建驗過的，一律視為未驗證。

## NEVER

- **NEVER** 因為「這是那個 repo 自己的環境問題」略過 (b)——新專案期間的環境問題，成因幾乎
  都在 scaffold 路徑，不在該 repo。
- **NEVER** 把新專案期間的坑登記成該 repo 的 tech-debt 就結案。tech-debt 記的是「這個 repo
  當下不處理的事」，而 scaffold 缺陷的 owner 不是這個 repo。
- **NEVER** 為了讓 gate 變綠去放寬 check 或改判準。gate 綠不綠不是目標，下一個新專案不再踩才是。
- **NEVER** 靠「我記得要注意 X」代替 (c)。記憶不會投影到下一個 session，check 會。

## 已長出的 check（每條都對應一次真實事故）

| check | 事故 |
| --- | --- |
| `consumer-meta.identity` | 2026-08-24 co-purchase：`.claude/consumer-meta.json` 整份從 nuxt-supabase-starter 複製來，consumerId 冒名、auth/database/deploy 全 none。release-gate 判 undeclared，verification-lease／db-reset-coordination／dev-server-spawn 全部讀到與事實相反的宣告 |
| `artifacts.not-tracked` | 同上：`coverage/` 進版控，`vitest --coverage` 每跑一次重寫整棵目錄，44 檔 5999 行填滿 code review 的 6000 行 budget——該次 review 一行產品程式碼都沒讀到，卻輸出了外觀正常的 verdict |
| `cloudflare.compat-flags` | 同上：Nuxt(framework) 的 `compatibility_flags` 缺 `no_nodejs_compat_v2`。[[cloudflare-workers]] §3.2 早就是 hard rule，缺的是有人擋 |
| `cloudflare.local-dev-binding-declared` | 同上 TD-003：wrangler ↔ workerd handshake 永久 hang，Nitro 的 cloudflare-dev plugin 把失敗 `.catch()` 成空 stub env——失敗與「這個專案沒有 binding」外觀相同，所有碰 D1／R2 的 route 回 500，22 條人工檢查一格都驗不了 |
| `hub-vs-meta.database` | 同上：`.claude/hub.json` 宣告 `db-schema: cf-d1`，`consumer-meta` 宣告 `database.kind: none`。同一件事的兩份宣告矛盾時，下游規約讀到哪一份是碰運氣 |
| `config.parse` | 本 gate 自身第一版：`wrangler.jsonc` 的 trailing comma 讓 `JSON.parse` 失敗回 null，依賴它的兩個 check 直接從輸出消失——長相與「這兩條通過了」完全一樣 |

新增 check 時 MUST 同時在這張表補一列：check 存在的正當性來自它擋掉過什麼，
**NEVER** 加一條沒有事故對應的 check。

## 相關

- [[cloudflare-workers]] §3.2 — compatibility flags 的 hard rule 本體
- [[agent-self-verification]] § 證據鑑別力 — 為什麼「review 讀不到原始碼卻照樣出 verdict」是最該擋的那型
- `registry/conventions.json` → `Local Dev Binding Strategy` — 本機 dev binding 的選型
