<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Agent / model routing 規則——某些工作必須 handoff 到指定的 runtime + model，而不是在當前 agent / model 直接執行
globs: ['**/*']
---

# Agent Routing

**核心命題**：不是所有工作都該由當前 agent / model 直接做。當某類工作交給另一個 runtime + model 組合的成本/品質明顯更好時，必須 handoff 而不是硬幹。

此規則優先於個別 skill 內嵌的工具呼叫指示。

## Routing Table

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| **Web search**（網頁搜尋、即時資料、外部資訊查詢） | **Codex（GPT-5.5 medium）** | 搜尋型查詢適合中等思考預算 + Codex 的搜尋整合；不浪費 Claude Code 的 context 與 token。 |
| **Spectra `propose` 階段**（discuss → propose 銜接） | **使用者選擇 A. Codex GPT-5.5 xhigh / B. Claude Code 繼續做** | propose 牽涉抽象決策、需高思考預算；給使用者選擇權。詳見 `spectra-propose` Step 0 與 `ux-completeness.md` Workflow Integration。 |

## WebSearch Handoff（具體做法）

Claude Code session 內偵測到「需要 WebSearch」時：

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 改成輸出 handoff 訊息給使用者：

   ```
   🔎 此工作需要 web search → 交給 Codex（GPT-5.5 medium）

   請切換到 Codex CLI（或在 IDE 內切到 Codex），把模型設為 GPT-5.5 medium，執行：

       <把要查的問題 / 關鍵字 / 上下文清楚列出>

   並把搜尋結果（連結 / 摘要）帶回來，本 session 會接續處理。
   ```

3. **STOP** 等使用者帶結果回來再繼續

### 例外（仍可在當前 session 直接處理）

- **本機檔案 / 已下載文件**內容查詢——用 Read / Grep 即可，不算 web search
- **使用者明確要求** 「直接用 WebSearch」——尊重使用者指令
- **Codex 本身就是當前 runtime**——已經在對的位置，不需要 handoff
- **`WebFetch` 抓單一已知 URL**——這是抓取，不是搜尋；可直接做

## 為什麼集中寫在這

- 跨 skill / 跨情境的 routing 規則散落在各 SKILL.md 會漂移
- 集中一處方便加新 routing rule（例如未來 image gen / long-doc summary 的最佳 runtime）
- consumer 端 `.claude/rules/agent-routing.md` 帶 `🔒 LOCKED` banner，**禁止**本地 override

## 必禁事項

- **NEVER** 在 Claude Code session 直接呼叫 `WebSearch` 工具（改 handoff 給 Codex GPT-5.5 medium）
- **NEVER** 在 Spectra discuss → propose 銜接點省略 A/B 詢問（除非 discuss 已收到 B 答覆並標記）
- **NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table
