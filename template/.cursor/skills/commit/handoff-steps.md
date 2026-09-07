<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# /commit Step 5-B~5-F 與 Step 8 執行細節

<!-- clade-targets: claude,codex,cursor -->

> 本檔是 `SKILL.md` 的 branch 分頁。**Step 5-A 判定「需要 handoff」時 MUST 讀 § 5-B~5-F 並逐步執行**；**Step 8 觸發條件成立（不在 main/master 且 consumer 有 `/ship`）時 MUST 讀 § Step 8**。兩個 branch 都沒命中就不需要讀本檔。

## 5-B. 收集下一步資訊

從本次 session 脈絡、`git log`、`docs/tech-debt.md`、repo 根目錄 `ROADMAP.md` 的 Next Moves 萃取（涵蓋 plan package 與自由任務）：

- **In Progress**：正在進行但未完結的工作（plan package / tasks 檔 / 自由任務皆可，含進度描述）
- **Blocked**：被什麼擋住、需要什麼才能繼續（無則省略此區塊）
- **Next Steps**（不分來源，一律收齊，按優先序排列）：
  - commit 後的驗證動作：人工檢查、截圖 review、deploy smoke test
  - follow-up marker：`@followup[TD-NNN]` 指向的 tech debt
  - session 中浮現但刻意未處理的機會：refactor、抽共用元件、補測試
  - 跨 session backlog：使用者提過的待辦、roadmap 的 near-term 項目
  - 注意事項 / 陷阱：下一人接手前需要知道的隱性脈絡

## 5-C. 寫入 `HANDOFF.md`

依當前 runtime 已投影的 `handoff` 與共享檔規約更新。先核對現有內容與寫入者，保留其他工作的有效條目，再同步本次已變動的狀態；下列是內容格式，不是整檔覆寫授權：

```markdown
# Handoff

## In Progress

- [ ] <任務描述（work slug / 自由任務 / WIP）>
- <做到哪、關鍵檔案或決策點>

## Blocked

- <blocker 描述；無則省略整個區塊>

## Next Steps

1. <下一步，按優先序>
2. <...>
```

**禁止**：

- 編造不存在的 in-progress / blocker
- 為了「填滿」區塊灌水 —— 真沒有就省略該區塊

## 5-D. 同步 Spectra ROADMAP

先依 canonical manifest 與實際 script 判定本 repo 是否使用 Spectra。已選用且有 ROADMAP 時執行下列同步；已選用卻缺命令時回報實際缺口，不宣稱同步完成。未選用 Spectra 的 repo 更新其既有待辦 carrier，記錄本步的 Spectra 分支未觸發。

手動維護 repo 根目錄 `ROADMAP.md` 的 `## Next Moves`：把本次 session 產生的未來工作依 `high/mid/low` 插入，已完成的移除。

若 5-B 收集到的 **Next Steps** 中包含跨 session backlog（不只是「commit 後立刻要做」的驗證動作），依當前 runtime 已投影的 `proactive-skills`「Spectra Roadmap Maintenance」**手動**更新 MANUAL 區塊的 `## Next Moves`，格式：

```text
- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy
```

## 5-E. 把 HANDOFF/ROADMAP 變更納入 commit（不 push）

5-C/5-D 實際修改或建立的 carrier，**MUST** 在此處以已授權的精確 paths commit 進去，否則 Step 6-A 的 deploy commit 不含這次的交接狀態。沿 Step 0-Scope 核對歸屬；新建 carrier 先以具名 path 加入 index，再用 `--only`，不漏掉 untracked 文件。署名沿 SKILL.md Step 4 的實際身份政策。

```bash
# 只收 5-C/5-D 動到的檔。git add ＋ 裸 git commit 會把 index 裡別的東西一起帶走（含別
# session 預 stage 的），所以這裡走 --only —— 同 rules/core/commit.detail.md § Ad-hoc commit。
# paths 只填 5-C/5-D 本次確實修改、已核對授權與歸屬的 carrier。
# 新建檔先 git add -- <該新檔>；既有其他 session staged 維持原狀。
paths=(<本次已確認的 carrier paths>)

# 若沒實際變動（HANDOFF 不需更新、ROADMAP 已 current），跳過 commit
if [ ${#paths[@]} -gt 0 ] && [ -n "$(git status --porcelain -- "${paths[@]}")" ]; then
  git commit --only -m "$(cat <<'EOF'
📝 docs(handoff): 更新 commit 後交接狀態

Via: /commit
EOF
)" -- "${paths[@]}"
  git log -1 --oneline
fi
```

> 注意：這個 commit **不** push。它**不**重新 bump 版本（不是 deploy），只是把 HANDOFF/ROADMAP 落入 history。它會跟 Step 6-A 的 bump/deploy commit 一起在同一次 `git push origin main` 送出（走 6-B 時沒有 deploy commit，本 commit 由 6-B 的那次 push main 送出）——刻意延後 push 是為了讓發版 commit（HANDOFF commit + deploy commit）只觸發**一次** main push，不讓第二次 push 取消掉第一次 push 已排入佇列的 staging run（見 `~/offline/clade/vendor/snippets/deploy-gate/README.md`）。

## 5-F. 報告

```text
✅ HANDOFF.md 已更新（已入 commit / 無變更略過）
✅ ROADMAP 已同步（已入 commit / 無變更略過）
（或：無可延續工作，HANDOFF.md 已清空 / 未建立）
```

## Step 8: 自動銜接 /ship

```bash
git branch --show-current
```

**觸發條件**：當前**不在 main / master 分支**，且當前 runtime 實際載入的 consumer 能力提供 `ship` skill（會 push branch 並開 PR）。存在另一端的 `.cursor/skills/ship` 不能證明本入口已提供。

本任務已有對應 branch push／PR 的明確授權時直接依該 scope 執行；缺授權才用當前可用詢問工具或對話提出下列問題，沒有回答不執行。

```text
Commit 完成！要繼續執行 /ship 推送並建立 PR 嗎？
```

- 同意 → 執行 `/ship` skill
- 拒絕或已在 main / master → 跳過

**不觸發**：在 main / master 分支，或 consumer 沒有 `/ship` skill。
