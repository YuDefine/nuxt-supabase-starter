---
description: Tech debt 路由規則——決定發現的 TD 該登在 clade 還是當前 consumer，以散播範圍與修法歸屬為準
paths: ['docs/tech-debt.md', '**/docs/tech-debt.md']
---
<!-- Clade native rule; source: rules/core/tech-debt-routing.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Tech Debt Routing

先問「修法落在哪一層」，再決定 TD 登記位置。此規則優先於個別 skill 說明；TD 編號與 entry 格式見 [[follow-up-register]]，entry 的 `**自驗**` gate 寫法見 [[agent-self-verification]] § 驗收 gate MUST 收窄到本次觸及的範圍。

---

## 決策流程

對任一 TD 候選問問三個問題：

1. **修法在哪一層改？** clade 中央倉、本 consumer、還是 starter / 其他工具？
2. **修完誰受惠？** 只有當前 consumer，還是 clade propagate 後所有 consumer 都受惠？
3. **真相來源是誰？** 修在 consumer 端會被下次 propagate 蓋掉嗎？

依答案路由：

| 修法位置 | 散播後受惠 | TD 登在 |
| --- | --- | --- |
| clade `scripts/` / `vendor/` / `rules/` / `capabilities/core/` / `claude-md/core-snippets/` | 全部 consumer（散播後） | **clade `docs/tech-debt.md`** |
| 單一 consumer 業務碼（自家 `server/` / `app/` / 自家 migration / 自家 nuxt.config） | 只該 consumer | **該 consumer `docs/tech-debt.md`** |
| starter scaffolder（`packages/create-nuxt-starter/`） | 未來所有 scaffold 出的新專案 | **starter `docs/tech-debt.md`** |
| 同時 clade + consumer 都要改 | 跨層 | **clade 為主、consumer 為輔**：clade TD 描述根因 + 散播計畫，consumer TD 描述本地後置動作（如 `pnpm hub:vendor:force` 後跑某個 backfill） |

---

## 就地標記（發現當下留下來，不靠記憶）

蓄意簡化在當下不登記，事後就只能靠記憶——而記憶不跨 session。在 code 裡就地標記，之後機械收割成候選。

**格式**（`scripts/harvest-td-markers.ts` 認的就是這個）：

```
// CLADE-TD: <ceiling — 這個做法在什麼條件下會不夠> → <upgrade path — 屆時換成什麼>
// CLADE-TD(TD-087): <同上；已有 TD entry 時回指編號>
```

- **MUST 同時寫 ceiling 與 upgrade path**，用 `→` 分隔。只寫「這裡之後要改」的裸 marker 不算——沒有 ceiling 就沒有「何時該動它」的判準，那就是永遠不會被處理的那種 marker
- **NEVER 用裸 `TODO` / `FIXME` / `XXX` 承載這個角色**（fleet 掃描假陽性遠多於真陽性，獨特前綴才可收割）
- **標記不取代登記**：跨 session 或會影響他人的缺口仍 MUST 進 `docs/tech-debt.md` 走本檔的決策流程。marker 承接的是「當下判斷還不值得開一條 TD entry，但忘了就再也找不回來」那一層

**收割**：`node scripts/harvest-td-markers.ts [--repo <path>]` 掃出所有 marker 輸出候選清單。它**只出清單、不寫 `docs/tech-debt.md`**；升級成正式 entry（過 `scripts/audit-tech-debt-hygiene.ts`）是人的判斷。

## 為什麼一律先問 clade

Consumer 端的 `.claude/` / `.clade/` / vendor 副本是 clade **投影**（帶 LOCKED banner、chmod 444、checksum gate）。

- 在 consumer 端登 TD 描述「投影層的問題」→ 修法看似在 consumer，但下次 propagate 會把 consumer 修法蓋回 clade 版本 → TD 永遠修不完
- 唯一不被蓋的是 consumer 自家業務檔（`server/api/**`、`server/utils/**`、自家 migration、自家 nuxt.config 業務段、`local/**` rule 等）
- 因此**任何發現「投影層」有問題的 TD，都應追到 clade source 並登在 clade**，不是登在發現它的 consumer

---

## 禁止事項

- **NEVER** 在 consumer 端登 TD 描述「`.claude/rules/X.md` 內容怪怪的」/「vendor 某個 helper 行為不對」/「audit script 算錯」/「propagate 沒推某條」/「sync-rules 沒對齊」/「commit hook 邏輯怪」等明顯屬於 clade 真相層的問題。**先到 clade 找 source**
- **NEVER** 把同一條跨 consumer 共通問題在各 consumer 各登一條 TD（duplicate noise + 散播後消失）
- **NEVER** 跳過判斷「下次 propagate 會不會蓋掉我的修」就直接在 consumer 改 + 登 TD
- **MUST** 在跨層 TD 內**互相 cross-link**（clade TD 列出 consumer-side action，consumer TD 引用 clade TD ID）
