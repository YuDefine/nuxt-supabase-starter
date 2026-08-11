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

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。三條契約：

1. 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作是 auto-triage**（per [[review-gui-surface]] MUST 9），不是直接引導使用者跑 `pnpm review:ui`
2. 推進完畢後 **MUST** 跑 `node ~/offline/clade/vendor/scripts/check-review-readiness.ts --repo . --change <change-name>` 確認 bucket；**exit 0 才可引導 user 到 review-gui**
3. **NEVER** 自判 bucket、**NEVER** 跳過 script、**NEVER** 在 exit ≠ 0 時引導 user 到 review-gui —— Claude 自判已多次證明不可靠

Auto-triage 的三類 pending item 路由、`[discuss]` item 的歸屬、review-gui deep-link 格式與 fallback 模式見 [[proactive-skills.manual-review-entry]]（path-scoped：碰 `openspec/changes/**` 時載入）。

### Dev Server Auto-Spawn（agent 自起，不要叫 user cd）

詳見 [[proactive-skills.dev-server-spawn]]（path-scoped，碰 `scripts/dev-session*` / `consumer-meta.json` / `nuxt.config.*` 時載入）。核心 one-liner：agent 自己起 dev server，**MUST** 經 `vendor/scripts/dev-session.ts`（durability=herdr），**NEVER** 裸 `nuxt dev` / `pnpm dev` / `run_in_background`。

**採用 per-worktree backing service（DB clone / PostgREST sidecar）的 consumer**：起 dev server **MUST** 先驗那些服務存在，缺席時 fail-loud 並點名是哪個服務、修復指令是什麼。launcher 的「port 有沒有 LISTENING」對這個問題恆為真，所以它擋不住 —— 第一個發現異常的會是瀏覽器，而它只會顯示 app 為「後端抖動」寫的 503/500，完全指不到 DB。同一條要求適用於任何預期 backing service 在的入口（integration test、收 verify evidence），不只 dev server。條款全文見 [[db-preview-env]] § 缺席側。

## Review Tiers

詳見 [[review-tiers]]。

## Screenshot Strategy

詳見 [[screenshot-strategy]]。

### agent-browser Worktree Verify Auth（hard rule）

agent-browser 開 auth-protected URL 前 **MUST** 完成 pre-auth（port 3000 singleton + `__test-login?role=admin&email=...`），**NEVER** 截到空白頁後才開始診斷 auth。完整 cookbook 見 `~/offline/clade/vendor/snippets/agent-browser-auth/README.md`。Pitfall ref: `docs/pitfalls/2026-06-24-agent-browser-auth-blank-page-on-alt-port.md`。

## Knowledge And Decisions

碰到非直覺問題或 workaround，任務結束時應評估沉澱到 `docs/solutions/**`。
做出跨任務的技術取捨時，應評估寫 ADR 到 `docs/decisions/**`。
