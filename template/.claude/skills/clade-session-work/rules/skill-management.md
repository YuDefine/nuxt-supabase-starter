---
description: 新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界
paths: ['.gitignore', '.clade/skills/**', '.claude/skills/**', '.agents/skills/**', '.codex/skills/**', 'capabilities/**/skills/**', 'scripts/install-skills.sh', 'skills-lock.json']
---
<!-- Clade native rule; source: rules/core/skill-management.md; edit canonical source -->
<!-- clade-targets: claude,codex -->
<!-- clade-adapters: claude,codex -->

# Skill 管理

## 三層各自的版控形態

| 層 | 角色 | 版控 |
| --- | --- | --- |
| canonical skill source | **真相層** | **MUST 進版控**（含第三方 skill——上游可能 force-push 或刪除） |
| runtime projection | generator 產生的投影 | **MUST 遵守該 runtime 的 ignore / ownership 契約** |
| `skills-lock.json` | 各 skill 的 source 與 computedHash | **MUST 進版控** |

生成的 runtime instruction 或 skill projection 必須能由 canonical source 完整重生；重生產物是否 tracked、放在哪個 native 目錄，由目標 runtime adapter 宣告。

## 三條 MUST

1. **安裝一律使用該 runtime adapter 已驗證的 copy/install 方式**，不可把另一端的命令當共通 API。
2. **commit 必須帶上 `skills-lock.json`**。安裝工具可能重算 lock 內所有 entry 的 `computedHash`；漏帶會讓 lock 與實際安裝不一致。
3. **NEVER 讓 runtime skill source 是 symlink 指向未 tracked 的 target。** 判準是 target 內容是否進版控；runtime projection 的 symlink 例外必須由 adapter 明列。

## User level 不歸 clade 管

clade 只投影到 consumer repo（與 clade home 自己）。`~/.claude/skills/`、`~/.agents/skills/`、`~/.codex/` 等 user-level 目錄由使用者自行維護，clade **NEVER** 產生、覆寫或稽核其中內容。

user-level 與 repo 內投影同名是合法遮蔽：pi 採 project 版、略過 user 版。`scripts/runtime-health.ts` 的撞名分級據此分 managed（兩邊皆 clade 投影 → 摘要）／mixed（單邊 → fail）／unmanaged（雙邊手寫 → warn）；「clade 投影」的證據是 LOCKED banner 或 `.clade/projections/codex.{capabilities,rules}.json` 的 files 清單。user-level 殘留的舊 clade 投影（退役前寫進 `~/.agents/skills/` 的那批）由使用者刪除，**NEVER** 為它恢復 user-level 投影。

## Skill 撰寫形式

在 `capabilities/**/skills/<name>/` 新建 skill、或改既有 skill 的流程／判準／結構時，**MUST** 走 `/skill-engineering`（`hub-capabilities-skill-engineering`）：新建走 create lane，改版走 optimize lane（先過根因確認閘門，再出編排計畫）。產出形狀以該 skill 委派的 `skill-form-*` 為準：`SKILL.md` 只放最小可執行 SOP（`# SOP` → `## Phase N -- <名>` → 以 READ／THINK／WRITE／DELEGATE 開頭的 step），判準進 `rules/`、穩定輸出骨架進 `templates/`（骨架＋`.example`）、機械工作進 `scripts/`（PEP 723 單檔 Python），只在需要的 step 按需載入。clade 自己的 frontmatter 與 marker（`clade-targets`、`clade-resources`、`metadata.clade`）照舊並存。

| 情境 | 處理 |
| --- | --- |
| 純錯字、斷鏈、路徑改名，不動流程與判準 | 直接改，不必走 lane |
| LOCKED mirror（`<!-- LOCKED: mirrored from … -->`） | 不在本節範圍；改上游再重生 |
| 其餘新增或改版 | `/skill-engineering` |

**閘門要送到人面前。** 根因報告或編排計畫現在就等 user 確認、而 user 不在場（被派出的 worker、relay、unattended）時，**MUST** 用 `flow ask` 送上佇列，一份報告一題，報告路徑寫進 `--question` 或 `--why`，`--carrier` 指向承接答案的 plan 或 tasks 檔；**NEVER** 只把報告標成「待確認」留在 plan 或 tasks 裡——不在佇列上的題目沒有人會看見。plan 已定好先後、還沒輪到的批次不在此列，輪到時先對照現況重驗報告再送。

**NEVER** 用 `skill-creator`（含 Anthropic 內建 `anthropic-skills:skill-creator`）或任何 skill-creator 類工具產生或改寫 clade skill；它們把流程、判準、範例混在同一層，正是本節要消除的形狀。

| 藉口 | 現實 |
| --- | --- |
| 「只是加一段說明，不算改流程」 | 新增的段落若會改變 agent 的行為，它就是判準，屬於 `rules/` 或某個 step；判不出歸屬就是該走 lane 的訊號 |
| 「根因閘門要等確認，太慢」 | 閘門擋的是沒對齊預期就改寫；批次改版可合併成一份報告一次確認，**NEVER** 跳過 |

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 讀或寫 `capabilities/**/skills/**`、`.claude/skills/**`、`.agents/skills/**` 下的 skill 檔（本檔 `paths:`） |
| 消費端 | 新建或改版 skill 的 session（user 不在場時把閘門報告 `flow ask` 送上 `/decisions` 佇列）；commit 0-F（新增 skill／rule 的最佳實踐交叉比對） |
| 觸發點 | 讀寫本檔 frontmatter `paths:` 列的 skill 路徑那一刻由 rules planner 載入（rule-authoring 合法觸發點 ④）；新建 skill 時 `/skill-engineering` 的 description 命中 |

## 來源與安裝邊界

Clade-managed skill 的共同來源在選用 plugin 的 `capabilities/<package>/skills/<name>/`，單端差異在相應 adapter。Consumer 自有與第三方安裝內容先依既有 ownership／安裝紀錄辨認來源；**NEVER** 因它位於 `.claude/skills/` 就把同名內容自動接管為 generator-owned。遷移來源位置需保存原內容、明確 adoption 與可恢復紀錄。

node_modules-backed symlink 只有在 adapter 明列、且 fresh setup 能重建時才可例外。Clade capability planner 拒絕 plugin source 中的 symlink；legacy installer 的例外不能用來放行此 planner 的拒絕。

## 投放範圍宣告（clade-visibility）

skill 預設投進所有選用該 plugin 的 consumer。要收窄時在 SKILL.md 與 `clade-targets` 並列宣告一行：

```html
<!-- clade-visibility: private|clade-home -->
```

| 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `private`＝public consumer 不投（例：綁維護者帳號的 `yudefine-deploy`、維護者個人工作流 `reply-article`／`meeting-notes`）；`clade-home`＝任何 consumer 都不投，只有 clade home 自投影收（例：含內部主機／報價資料的 `ci-runners`、`presale`、`estimate-hours`） |
| 消費端 | `scripts/lib/runtime-capability-plan.ts`（consumer 投影跳過；`buildCanonicalCapabilityPlan` 帶 `cladeHome` 才收 `clade-home`）；`vendor/scripts/audit-clade-leak.ts` 的 `MAINTAINER_ONLY_SKILLS` 是第二層對帳 |
| 觸發點 | 本節；`test/skill-visibility-clade-home.test.ts` 釘住三支 clade-home skill 不進 consumer 投影 |

## 驗證入口與覆蓋邊界

每次新增或更新 skill，MUST 分開驗來源、投影 ownership 與實際 native 載入，不以其中一層通過代替其餘兩層。

| 驗證面 | 實際入口與判讀 |
| --- | --- |
| Clade plugin source 與 target 計畫 | 在 consumer project root 跑 `node <clade-root>/scripts/project-runtime-capabilities.ts --clade-root <clade-root> --targets claude,codex --visibility <private或public> --dry-run`；visibility 先查證。此入口同時規劃 skills／commands／agents，以共享 namespace 查碰撞，error 或 ownership 衝突保留 blocked |
| 本次投影是否仍需變更 | 讀 dry-run 的 `appliedChanges`；名稱雖含 applied，dry-run 只表示預計異動。非零代表尚待 apply／對帳，不是已同步。合法 apply 後重跑應為零；native 載入仍另驗 |
| 第三方安裝與 lock | 依已安裝 installer 的實際 lock/hash 定義驗 `skills-lock.json` 與來源，將內容和 lock 一起提交。此 capability planner 不驗第三方 lock 的 computedHash；缺少該驗證時明列未驗，不報全綠 |
| Fleet ownership 與 tracking | `node <clade-root>/scripts/audit-governance-drift.ts` 的 check13 逐 target 讀 capability ownership state，核對產物 hash、canonical source/hash 與來源 tracked 狀態。`native_ownership` 的 `incomplete` 使 check13 失敗；`absent` 只表示尚無 adoption 證據，保留 legacy tracking 檢查，不算 native 已接入。此檢查不驗第三方 lock computedHash，也不取代當前 manifest 的完整 projection plan |
| Native availability | 在各目標產品入口實際 discovery／呼叫 skill，保留入口版本與 receipt。產生檔案、AGENTS.md 載入或 planner exit 0 都不證明 skill 被原生發現 |

這些檢查由新增／更新 skill 的 session 消費。來源宣告未審、能力未驗或必要入口缺少時，MUST 把受影響 target 列為未完成；不能把不存在的「逐 runtime audit」當成已通過的驗收。

check13 的 native ownership finding 由既有 governance audit／clade-health 消費，讀到漂移就修 canonical source／投影或明確 adoption，不覆寫未知所有權。`absent` 是 informational — 不觸發任何東西；它不能被彙總成兩端已驗證。
