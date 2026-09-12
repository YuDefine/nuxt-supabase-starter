# Step 1.8: Component Candidates（Nuxt UI stack 專用）


> 來源：`design/SKILL.md` § Step 1.8（2026-08-03 拆出——只有偵測到 Nuxt UI stack 的 branch 會走這段）


對應規約：[[nuxt-ui-mcp]]（必走 `nuxt-ui-remote` MCP、ban prescriptive synthesis）。

這一步管的是**元件選擇**。查詢是 plan 階段的強制動作：憑訓練記憶列出的元件看起來合理，實際可能偏離當前版本。

**MUST** 對 plan 內每一個 UI surface 走完以下三件事，缺一不可：

1. **Query** — 用 `nuxt-ui-remote` MCP（`search-components` / `get-component` / `list-examples` / `search-composables`）取得該場景可用的元件與其真實 slot / variant / prop。**NEVER** 憑記憶列元件。
2. **列出 ≥2 個候選組合** — 不是「找到一個能做的就寫進 plan」。單一元件能達成的需求，往往組合起來體驗更好（例：`USelect` 可以，但 `UInput` + `UCommandPalette` 支援搜尋與鍵盤操作）。
3. **開 Component 決策頁讓 user 選** — agent **NEVER** 代選。loop 見 [decision-page.md](../decision-page.md) § Component。多 surface 一頁一個 combination set，**NEVER** 一 surface 一頁。選擇理由與被淘汰的候選寫在卡片 `thesis` / `case`，選完再寫進 plan。

**Plan 寫入格式**：

```markdown
### Component Candidates
Surface：管理後台的刀具選擇欄位
Query 來源：nuxt-ui-remote `search-components: select`, `get-component: UCommandPalette`

| 候選 | 組成 | 適合 | 不適合 |
| --- | --- | --- | --- |
| A | `USelect` | 選項 < 20、純點選 | 無搜尋、長清單難用 |
| B | `UInput` + `UCommandPalette` | 選項多、需搜尋與鍵盤操作 | 首次使用者不知道可以打字 |
| C | `UModal` + `UTable` | 需要同時看多欄資訊再選 | 開關 modal 打斷流程 |

選擇：**B**（Component 決策頁 ANSWER）。刀具編號有數百筆且使用者記得部分編號，搜尋是主要入口。
淘汰：A 選項數量撐不住；C 的資訊量在這個欄位用不到。
```

**Block 條件**：plan 涉及 UI surface 但缺 Component Candidates 區塊、該區塊只列一個候選、或沒開決策頁 → **不得**進 build / ship phase。

**兩個補強工具**（能跑就跑，比紙上比較準）：

- `/impeccable live` — 在瀏覽器當下生成多個視覺變體並挑選，正是「難以言述時」的候選比較工具
- `/impeccable critique` — 對候選做 persona testing 與 cognitive load 評估，**在選定之前跑**，不要等實作完

#### live 在 Nuxt 專案的正確接法

live 的 prerequisite 是「dev server with HMR **或一個靜態 HTML 檔**」。**Nuxt 專案走靜態 HTML 那條**，理由是硬的：live 注入的是 `<script src="http://localhost:PORT/live.js">`，而 Nuxt 4 的 `app/app.vue` 是 Vue SFC——template 內沒有 `</body>` 可當 anchor，也不接受 `<script>` 標籤。改寫 HTML shell 只為了掛 live，是拿 SSR 輸出去換一個設計階段工具，不划算。

讓 live 作用在 mockup 目錄，實測可行（<consumer-b> 2026-07-29）：

```jsonc
// .impeccable/live/config.json
{
  "files": ["design/mockups/**/*.html"],
  "insertBefore": "</body>",
  "commentSyntax": "html",
  "cspChecked": true
}
```

mockup 用 Tailwind CDN 寫近似版即可——這個階段要比的是版面與互動模式，不是像素級的元件還原。真元件的 API 細節由上面的 query 負責、實作時驗。

啟動：`node "$IMPECCABLE/scripts/live.mjs"`（`$IMPECCABLE` 的解析見 [decision-page.md](../decision-page.md) § 路徑解析；回 `ok: true` + `serverPort` 即成功）。poll **MUST** 走背景任務（Claude Code 的 background task，或其他 runtime 的等價機制），不要用短 timeout 阻塞 shell。

> `.mjs` 投影曾因 LOCKED banner 用錯註解語法而全數 SyntaxError，live 因此長期不可用；v1.4.369 已修（見 `sync-to-codex` § injectLockedBanner）。若 `live.mjs` 第一行報 `Invalid or unexpected token`，代表該 consumer 的投影還沒更新到該版本。

**為什麼是強制 step**：實作後才發現「另一個組合體驗更好」，代價是整段重做（fleet 實證：`ai-chat-ui` → `ai-ui-rebuild` → `0b-ai-chat-rework`，同一塊 UI 跨三週六個 change）。候選比較在 plan 階段做，成本是幾分鐘；在實作後做，成本是重寫。
