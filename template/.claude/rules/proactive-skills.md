<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Proactive Skill Orchestra

所有 Spectra sub-skill 與 Design skill 應在適當情境下**主動調用**，不需使用者手動指定。此規則優先於個別 SKILL.md 的指示。

> 本檔是 trigger 主規則（無 frontmatter，每個 session 必載入）。詳細場景規約拆到 path-scoped reference：
>
> - 動 UI 檔（`app/**/*.vue` / `components/**` / `pages/**` / `layouts/**`）或寫 design artifact：[`proactive-skills.design-checkpoint.md`](./proactive-skills.design-checkpoint.md)
> - 寫 / 改 `openspec/changes/**` / `HANDOFF.md` / `docs/tech-debt.md` / `openspec/ROADMAP.md`：[`proactive-skills.ingest-triggers.md`](./proactive-skills.ingest-triggers.md)

## 原則

1. **診斷驅動**——先理解問題再選工具，不盲目跑所有 skill
2. **內建而非附加**——Design 是實作的一部分，不是完成後的美化步驟
3. **來源無關**——不論規格書來自 Notion、文件、對話或 plan file，流程一致
4. **自主但透明**——主動調用 skill 時簡要告知使用者正在做什麼

## Spectra Sub-skill 自主觸發

### Intake 階段

| 情境 | 觸發 | 說明 |
|---|---|---|
| 收到需求，需求模糊或有多種解讀 | `spectra-discuss` | 先討論釐清，再 propose |
| 收到需求，需求明確 | `spectra-propose` | 直接建立 change |
| 需求來源是外部文件（Notion URL、PDF、貼文） | 先讀取內容 → `spectra-propose` | 提取結構化需求後建立 change |
| Proposal 建立完成 | `spectra-analyze` | 自動檢查一致性（不等使用者要求） |
| Analyze 發現 Critical/Warning | 修復 → 再 `spectra-analyze`（max 2 輪） | 迴圈直到通過 |
| Artifacts 有模糊用詞（TBD、矛盾、缺 scenario） | `spectra-clarify` | 逐項澄清 |

### Implementation 階段

| 情境 | 觸發 | 說明 |
|---|---|---|
| 準備開始或繼續實作 | `spectra-apply` | 按 tasks 執行 |
| 實作中遇到非預期錯誤 | `spectra-debug` | 四階段系統性排查 |
| 實作中發現 spec 有誤或過時 | `spectra-ingest` | 更新 artifacts，不停下實作 |
| 架構決策點（多種做法都可行） | `spectra-discuss` | 記錄決策到 artifacts |
| 需要確認現有規格內容 | `spectra-ask` | 查詢而非猜測 |

### Completion 階段

| 情境 | 觸發 | 說明 |
|---|---|---|
| 所有 tasks 完成 + 人工檢查通過 | `spectra-archive` | 最終歸檔 |
| Archive 完成 + change 有 UI（design review findings） | `design-retro` | 分析 findings、識別重複模式、建議改善 |
| Findings 累積達 5 的倍數（5、10、15…） | `design-retro` | 週期性全量分析 |

### Sub-skill 禁用清單（永不觸發）

| Sub-skill | 規則 | 替代方式 |
|---|---|---|
| `spectra-commit` | **NEVER** 主動觸發 | 走 `rules/core/commit.md` 規範的標準 commit 工序（含 hooks / 訊息格式） |

**原因**：spectra-commit 是 spectra CLI 上游帶來的薄殼，本治理範圍下 commit 必須統一走 `rules/core/commit.md`。Claude 偵測到使用者要 commit Spectra change 的相關檔案時，**MUST** 直接走標準 git / `/commit` 流程，**NEVER** 改派 spectra-commit。

## Scope Discipline

所有 spectra / design workflow 都受 [`scope-discipline.md`](./scope-discipline.md) 約束：範圍外檔案不順手改、途中發現其他問題**不修但必登記**、未知變更先回報不自行清場、不得在 subagent 內執行 `git reset --hard` / `git checkout --` / `git clean`。

登記出口：

- 技術債 → `docs/tech-debt.md` + `@followup[TD-NNN]`
- 當前 session 未完 → `HANDOFF.md`
- 未來工作 → `openspec/ROADMAP.md`
- change 漏項 → `spectra-ingest`
- 架構決策 → `docs/decisions/**`

## Handoff Hygiene

符合以下情況，**MUST** 建立或更新 `HANDOFF.md`（內容要求與接手流程見 [`handoff.md`](./handoff.md)）：

- session 結束時仍有 active change
- 有未 commit 的 WIP
- 有 blocker 需要下一個 session 接手
- 工作移交給其他 agent / runtime

## Manual Review

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

**MUST** 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作是 auto-triage（per [[review-gui-surface]] MUST 9），不是直接引導使用者跑 `pnpm review:ui`**。

Auto-triage + mechanical readiness gate 流程：

1. 逐條讀 pending leaf item 的 annotation，判斷阻塞原因並自行推進：
   - `（fix-requested）` → dispatch `/wt` 修 code → merge-back → 重拍截圖 → strip annotation
   - evidence missing → 走 [[agent-self-verification]] fallback chain 收 evidence
   - `（issue:）` 無 `(claude-analyzed:)` → triage issue 走 (A)-(E) 路由

2. 推進完畢後 **MUST** 跑 mechanical gate script 確認 bucket：
   ```bash
   node ~/offline/clade/vendor/scripts/check-review-readiness.mjs \
     --repo . --change <change-name>
   ```
   - **exit 0** → 可引導 user 到 review-gui
   - **exit 1** → 繼續 auto-triage 或如實報告卡住原因
   - **NEVER** 自判 bucket、NEVER 跳過 script

**NEVER** 在 script exit ≠ 0 時引導 user 到 review-gui — Claude 自判已多次證明不可靠（同根因 pitfall 見 [[review-gui-surface]]）。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框走人工檢查——那是 `pnpm review:ui` 不可用時的 fallback，不是 default path。

正確流程：

1. **Auto-triage first**：推進所有 Claude 可處理的 pending items（fix-requested / evidence missing / issue triage）
2. **首選（DEFAULT）**：auto-triage 後 `bucket=ready` → 主線回「從 **clade home**（`~/offline/clade`）執行 `pnpm review:ui` 開本地 GUI 驗收」（聚合機制與 cwd 規約見下方 § cwd），等使用者跑完 GUI 流程回報後繼續
3. **Fallback**（GUI 不可用時）：截圖 → 逐項展示 → 使用者回覆 OK / 問題 / skip → 依答覆更新 checkbox。GUI 不可用的具體情境見下方 § 例外：fallback 模式

### `[discuss]` items 不在 review:ui 主流程

`[discuss]` items（production 授權 / 商業判斷 / production 觀察類）**MUST** 由 `/spectra-archive` Step 2.5 walkthrough 接管，**NEVER** 在 review:ui 引導流程內處理——trigger 是外部 signal，提前分析只會讓 change 永遠卡在 review:ui pending state。
review-gui 對純 D-only pending 的 change 自動歸「🗓 等 archive walkthrough」群（無接手 prompt）→ 告知 user「跑 `/spectra-archive <change>` 觸發 Step 2.5 walkthrough」；落「🤖 等 Claude 接手」群（仍含 I / V）→ 接手 prompt 對 (D) 只列 walkthrough trigger，不分析、不寫 (claude-discussed:) annotation。
詳細 scope rule 見 [`manual-review.md`](./manual-review.md) § Item Kind Marker `[discuss]` 段。

### Inline Review-GUI Deep-Link（hard rule）

完整 deep-link 規約（URL 格式、cross-consumer prefix、訊息 template、cwd、NEVER 清單）詳見 [[review-gui-surface]] § Inline Review-GUI Deep-Link。本段只保留核心 one-liner：引導使用者跑 `pnpm review:ui` 時，**MUST** 在 chat 訊息中給出 `http://127.0.0.1:5174/review/<consumer-id>:<change-name>` deep-link。

### Dev Server Auto-Spawn（agent 自起，不要叫 user cd）

詳見 [[proactive-skills.dev-server-spawn]]（path-scoped，碰 `scripts/dev-session*` / `consumer-meta.json` / `nuxt.config.*` 時載入）。核心 one-liner：agent 自己起 dev server，**MUST** 經 `vendor/scripts/dev-session.mjs`（durability=zellij），**NEVER** 裸 `nuxt dev` / `pnpm dev` / `run_in_background`。

## Review Tiers

詳見 [[review-tiers]]。

## Screenshot Strategy

詳見 [[screenshot-strategy]]。

### agent-browser Worktree Verify Auth（hard rule）

agent-browser 開 auth-protected URL 前 **MUST** 完成 pre-auth（port 3000 singleton + `__test-login?role=admin&email=...`），**NEVER** 截到空白頁後才開始診斷 auth。完整 cookbook 見 `~/offline/clade/vendor/snippets/agent-browser-auth/README.md`。Pitfall ref: `docs/pitfalls/2026-06-24-agent-browser-auth-blank-page-on-alt-port.md`。

## Knowledge And Decisions

碰到非直覺問題或 workaround，任務結束時應評估沉澱到 `docs/solutions/**`。
做出跨任務的技術取捨時，應評估寫 ADR 到 `docs/decisions/**`。
