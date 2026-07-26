<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/change-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Turbo Dispatch（`--turbo` 專屬）

> 本檔從 SKILL.md § 3t 搬移，觸發條件與分組已隨主流程的四組併發契約更新。主檔 pointer：「啟用 `--turbo` 時 MUST 先完整讀本檔」。

### 3t. Turbo dispatch（`--turbo` 專屬）

**觸發條件**：`--turbo` flag 啟用 + item cap 未耗盡 + 以下任一成立：

- spectra 的四組都沒有主線可做的 item（全部 blocked / skipped / ready-for-review / 已 dispatch）
- **扇出組已達 in-flight cap（4）** —— 此時 spectra 還有未 dispatch 的 item 也照樣進 turbo，否則主線會在 cap 之下乾等

第二條是必要的：6 個 applyInProgress 配 cap 4 時，「spectra 全部 dispatch 完畢」永遠不成立，turbo 會被無限期推遲。

**掃描來源**（依序掃，合併成 turbo priority list）：

1. **HANDOFF.md**——掃以下段落（段落名可能因 consumer 而異，靠 `##` / `###` heading 辨識）：
   - `## 你接下來要做的事` / `## Next Steps` / `## Outstanding` / `## Follow-up` / `## In Progress`（只取未完成項）
   - 每個 heading 下的 `- [ ]` 未勾項 = 一個 turbo item；已勾 `- [x]` 跳過
   - 純文字段落（無 checkbox）視為單一 turbo item

2. **`openspec/ROADMAP.md`**——掃以下段落：
   - `## Next Moves` 下的 `###` 子段（每個子段 = 一個 turbo item）
   - `## Active Changes` 下的 `### In progress` / `### Draft`（若未被 spectra scan 涵蓋）

**Spectra change association（turbo 進入分類前 MUST 跑）**：

Step 1 scan 的 `entries[].name` + `PARKED_JSON` 的 parked change names 合併成 active change name set。對 **每一個** turbo candidate，若其文字含 active change name set 中任一 name（word boundary match，非 substring；例如 change name `fix-pinia` 命中「fix-pinia 的 Phase 3」但不命中「fix-pinata」）→ 直接分類為「spectra change 引用」→ 走 3f。

此步驟在分類表之前跑，命中的 turbo item **NEVER** 再走分類表的 code task / investigation / blocked / ambiguous 路由。

**為什麼**：HANDOFF 條目通常用自然語言引用 change name（「完成 fix-pinia Phase 3」「A6 E2E 需要修」），不會寫死 `/spectra-apply fix-pinia`。靠字面路徑比對會漏掉這些 → turbo 降級成 ad-hoc brief dispatch → spectra-apply 的 phase 結構、evidence 收集、verify cycle 全部丟失（2026-07 <consumer-a> 實證：A6 live E2E + fix-pinia remaining phases 被分類為 code task / investigation → 深度不足 → user 必須停 loop 開 focused spectra-apply session 手動推）。

**Turbo item 分類與 dispatch**：

| 類型 | 辨識方式 | Dispatch |
| --- | --- | --- |
| spectra change 引用 | 內容含 `/spectra-apply <name>` 或 `openspec/changes/<name>`，**或**文字命中 § Spectra change association 的 active change name | 走 3f applyInProgress（已被 Step 1 涵蓋則跳過） |
| code task（有明確檔案路徑 / 行為描述） | 含 `server/` / `app/` / `scripts/` / `.vue` / `.ts` / `.mjs` 等路徑，或含動詞（「改」「加」「修」「移除」「重構」） | worktree 內直接實作：`/wt turbo-<slug>: <brief>`，brief 從 HANDOFF/ROADMAP 條目萃取 |
| investigation / research | 含「調查」「確認」「檢查」「分析」「audit」 | 主線直接執行（不需 worktree），結果寫回 HANDOFF 對應條目 |
| blocked / 需 user 決策 | 含「待 user」「待確認」「blocked」「需拍板」 | **跳過**，log 到 Step 5 Skipped |
| 模糊 / 無法判斷 | 以上皆不符 | **跳過**，log 到 Step 5 Skipped（`turbo: ambiguous item`） |

**Turbo dispatch 規則**：

- **分組同主流程**：**每一個** turbo item 依上表 dispatch 欄落進 [dispatch-topology.md](dispatch-topology.md) 的組別——spectra change 引用 / code task → 扇出組（受同一個 ≤4 in-flight 上限），investigation → 主線即時組。turbo 不是獨立於四組之外的第五條路徑
- **Commit 紀律同主流程**：`git commit --only -- <paths>`，每個 turbo item 獨立 commit
- **完成後 MUST 更新 HANDOFF / ROADMAP**：勾 `[x]` 或補完成摘要，讓下一輪不重複做
- **Error handling 同主流程**：失敗 → log + skip + fail-streak
- **NEVER** 自創 spectra change — turbo 只做已登記的非 spectra 工作；需要開 change 的大項 → skip + log「建議 `/spectra-propose`」
- **NEVER** 動標準層（`.claude/rules/` / `CLAUDE.md` / clade 源檔）— 護欄不因 turbo 鬆綁
- **NEVER** 跨 consumer 操作 — turbo 仍限當前 consumer

**Turbo skip 合法理由窮舉（MUST，其他一律 dispatch）**：

只有以下 4 條理由可以跳過一個 turbo 候選，**NEVER** 自創其他理由：

1. **需 spectra-propose** — 工作規模需開 spectra change 追蹤
2. **跨 consumer 操作** — turbo 限當前 consumer
3. **動標準層** — `.claude/rules/` / `CLAUDE.md` / clade 源檔
4. **blocked on external signal** — 等 user 決策 / 等 deploy / 等第三方

以下**不是**合法跳過理由（per [[pitfall-change-loop-turbo-self-rationalized-idle]]）：
- ❌「needs careful testing」— worktree isolation + codex 就是為此設計的
- ❌「complex」「多個 scripts 有不同 scope」— codex effort=high 處理
- ❌「not ideal for quick wins」— turbo 不只做 quick wins
- ❌「需要 visual verification」— 非 .vue 的 backend 不需要
- ❌「這輪已做了一個 turbo 了」— 沒有 per-round turbo 上限（除 --unattended 3-item cap）
- ❌「等 agents 完成再處理」— 扇出組滿 4 就是 turbo 該啟動的時機，不是該等的時機。等 notification 期間 **MUST** 繼續 dispatch turbo（investigation 類主線直接做、code task 類等扇出組空位），不是等
- ❌「先寫 HANDOFF status」— HANDOFF status 是 Step 5（四組皆空且 in-flight 歸零之後），不是中途的 exit ramp

**Turbo 進度在 Step 5 獨立段落報告**（見 § Step 5 turbo 段）。

## Step 5 Turbo 段模板

`--turbo` 啟用且有 turbo item 時，在 Step 5 HANDOFF template 的 `📊 Progress` 段之後加：

```markdown
### 🚀 Turbo (非 spectra 工作，`--turbo` 啟用時)

- `<item-slug>` — ✅ completed — <一句話摘要> — committed as `<short-hash>`
- `<item-slug>` — ⏸ skipped — <原因>
- `<item-slug>` — 📊 in-progress — <進度摘要>

_(未啟用 `--turbo` 或無 turbo item 時整段不寫)_
```
