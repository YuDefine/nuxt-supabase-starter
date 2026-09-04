<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# /commit Step 5-B~5-F 與 Step 8 執行細節

> 本檔是 `SKILL.md` 的 branch 分頁。**Step 5-A 判定「需要 handoff」時 MUST 讀 § 5-B~5-F 並逐步執行**；**Step 8 觸發條件成立（不在 main/master 且 consumer 有 `/ship`）時 MUST 讀 § Step 8**。兩個 branch 都沒命中就不需要讀本檔。

## 5-B. 收集下一步資訊

從本次 session 脈絡、`git log`、`docs/tech-debt.md`、`openspec/ROADMAP.md` 的 Next Moves 萃取（涵蓋 spectra change 與自由任務，不限 openspec）：

- **In Progress**：正在進行但未完結的工作（spectra change / 自由任務皆可，含進度描述）
- **Blocked**：被什麼擋住、需要什麼才能繼續（無則省略此區塊）
- **Next Steps**（不分來源，一律收齊，按優先序排列）：
  - commit 後的驗證動作：人工檢查、截圖 review、deploy smoke test
  - follow-up marker：`@followup[TD-NNN]` 指向的 tech debt
  - session 中浮現但刻意未處理的機會：refactor、抽共用元件、補測試
  - 跨 session backlog：使用者提過的待辦、roadmap 的 near-term 項目
  - 注意事項 / 陷阱：下一人接手前需要知道的隱性脈絡

## 5-C. 寫入 `HANDOFF.md`

依 `.cursor/rules/handoff.mdc` 格式覆寫：

```markdown
# Handoff

## In Progress

- [ ] <任務描述（spectra change 名稱 / 自由任務 / WIP）>
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

```bash
pnpm spectra:roadmap
```

重算 `openspec/ROADMAP.md` 的 AUTO 區塊（Active Changes / Active Claims / Parallel Tracks / Parked Changes）。AUTO 區塊由此命令生成，手動編輯會被下次 sync 覆寫。

若 5-B 收集到的 **Next Steps** 中包含跨 session backlog（不只是「commit 後立刻要做」的驗證動作），依 `.cursor/rules/proactive-skills.mdc` 的「Spectra Roadmap Maintenance」**手動**更新 MANUAL 區塊的 `## Next Moves`，格式：

```text
- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy
```

## 5-E. 把 HANDOFF/ROADMAP 變更納入 commit（不 push）

5-C/5-D 修改的是 tracked 檔（`HANDOFF.md`、`openspec/ROADMAP.md`），**MUST** 在此處 commit 進去，否則 working tree 會 dirty、Step 6-A 的 deploy commit 也不含這次的交接狀態。

```bash
# 只收 5-C/5-D 動到的檔。git add ＋ 裸 git commit 會把 index 裡別的東西一起帶走（含別
# session 預 stage 的），所以這裡走 --only —— 同 rules/core/commit.detail.md § Ad-hoc commit。
paths=()
for f in HANDOFF.md openspec/ROADMAP.md; do
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 && paths+=("$f")
done

# 若沒實際變動（HANDOFF 不需更新、ROADMAP 已 current），跳過 commit
if [ ${#paths[@]} -gt 0 ] && ! git diff --quiet -- "${paths[@]}"; then
  git commit --only -m "$(cat <<'EOF'
📝 docs(handoff): 更新 commit 後交接狀態

Co-Authored-By: Claude <noreply@anthropic.com>
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

**觸發條件**：當前**不在 main / master 分支**，且 consumer 提供 `/ship` skill（會 push branch 並開 PR）。

```text
Commit 完成！要繼續執行 /ship 推送並建立 PR 嗎？
```

- 同意 → 執行 `/ship` skill
- 拒絕或已在 main / master → 跳過

**不觸發**：在 main / master 分支，或 consumer 沒有 `/ship` skill。
