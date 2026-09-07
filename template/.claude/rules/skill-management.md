---
description: 新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界
paths: ['.gitignore', '.clade/skills/**', '.claude/skills/**', '.agents/skills/**', '.codex/skills/**', '.cursor/skills/**', 'plugins/*/skills/**', 'scripts/install-skills.sh', 'skills-lock.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/skill-management.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Skill 管理

## 三層各自的版控形態

| 層 | 角色 | 版控 |
| --- | --- | --- |
| canonical skill source | **真相層** | **MUST 進版控**（含第三方 skill） |
| runtime projection | generator 產生的投影 | **MUST 遵守該 runtime 的 ignore / ownership 契約** |
| `skills-lock.json` | 各 skill 的 source 與 computedHash | **MUST 進版控** |

生成的 runtime instruction 或 skill projection 必須能由 canonical source 完整重生；重生產物是否 tracked、放在哪個 native 目錄，由目標 runtime adapter 宣告。

## 為什麼第三方 skill 也要進版控

第三方 skill 的來源在別人的 repository。上游 force-push、refactor、刪除或改名都可能讓原版本無法重建，而 skill 內容會實質影響 agent 行為，是行為契約的一部分。

## 三條 MUST

1. **安裝一律使用該 runtime adapter 已驗證的 copy/install 方式**，不可把另一端的命令當共通 API。
2. **commit 必須帶上 `skills-lock.json`**。安裝工具可能重算 lock 內所有 entry 的 `computedHash`；漏帶會讓 lock 與實際安裝不一致。
3. **NEVER 讓 runtime skill source 是 symlink 指向未 tracked 的 target。** 判準是 target 內容是否進版控；runtime projection 的 symlink 例外必須由 adapter 明列。

## 來源與安裝邊界

Clade-managed skill 的共同來源在選用 plugin 的 `plugins/<plugin>/skills/<name>/`，單端差異在相應 adapter。Consumer 自有與第三方安裝內容先依既有 ownership／安裝紀錄辨認來源；**NEVER** 因它位於 `.claude/skills/` 就把同名內容自動接管為 generator-owned。遷移來源位置需保存原內容、明確 adoption 與可恢復紀錄。

node_modules-backed symlink 只有在 adapter 明列、且 fresh setup 能重建時才可例外。Clade capability planner 目前拒絕 plugin source 中的 symlink；legacy installer 的例外不能用來放行此 planner 的拒絕。

## 驗證入口與覆蓋邊界

每次新增或更新 skill，MUST 分開驗來源、投影 ownership 與實際 native 載入，不以其中一層通過代替其餘兩層。

| 驗證面 | 實際入口與判讀 |
| --- | --- |
| Clade plugin source 與 target 計畫 | 在 consumer project root 跑 `node <clade-root>/scripts/project-runtime-capabilities.ts --clade-root <clade-root> --targets claude,codex,cursor --visibility <private或public> --dry-run`；visibility 先查證。此入口同時規劃 skills／commands／agents，以共享 namespace 查碰撞，error 或 ownership 衝突保留 blocked |
| 本次投影是否仍需變更 | 讀 dry-run 的 `appliedChanges`；名稱雖含 applied，dry-run 只表示預計異動。非零代表尚待 apply／對帳，不是已同步。合法 apply 後重跑應為零；native 載入仍另驗 |
| 第三方安裝與 lock | 依已安裝 installer 的實際 lock/hash 定義驗 `skills-lock.json` 與來源，將內容和 lock 一起提交。此 capability planner 不驗第三方 lock 的 computedHash；缺少該驗證時明列未驗，不報全綠 |
| Fleet ownership 與 tracking | `node <clade-root>/scripts/audit-governance-drift.ts` 的 check13 逐 target 讀 capability ownership state，核對產物 hash、canonical source/hash 與來源 tracked 狀態。`native_ownership` 的 `incomplete` 使 check13 失敗；`absent` 只表示尚無 adoption 證據，保留 legacy tracking 檢查，不算 native 已接入。此檢查不驗第三方 lock computedHash，也不取代當前 manifest 的完整 projection plan |
| Native availability | 在各目標產品入口實際 discovery／呼叫 skill，保留入口版本與 receipt。產生檔案、AGENTS.md 載入或 planner exit 0 都不證明 skill 被原生發現 |

這些檢查由新增／更新 skill 的 session 消費。來源宣告未審、能力未驗或必要入口缺少時，MUST 把受影響 target 列為未完成；不能把不存在的「逐 runtime audit」當成已通過的驗收。

check13 的 native ownership finding 由既有 governance audit／clade-health 消費，讀到漂移就修 canonical source／投影或明確 adoption，不覆寫未知所有權。`absent` 是 informational — 不觸發任何東西；它不能被彙總成三端已驗證。
