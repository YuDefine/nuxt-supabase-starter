# Impeccable 完整配置：缺哪項就問哪項

本檔是 UI／有前端 consumer 的 **追問契約**。Catalog 題仍只問 `question-catalog.ts`；這裡**不是** catalog 題，也不是 `ai-guidance:catalog-vs-cli`。**NEVER** 把品牌／theme 寫進 starter CLI flags。

**觸發點：** `project-bootstrap` 在 UI 新專案（mode=`new`、有前端／impeccable 適用）於 scaffold／projection 成功後，agent **MUST 立刻自己載入本檔**，對使用者缺哪項問哪項直到齊，並把答案寫進 `PRODUCT.md`／`DESIGN.md`／theme tokens（寫 PRODUCT.md 由 agent 自己跑 impeccable `init`）。這是 bootstrap **同一條流程的必經段**，不是可選作業。impeccable 是給 **agent 呼叫／bootstrap 內嵌**的 skill；對人類操作者不是必打指令。**NEVER** 叫使用者手打 slash command。

Agent 逐項檢查下表，缺的向 user 追問直到齊；不准默默用預設，也不准列成「稍後再做」就宣告 `READY`。

對齊來源：consumer／starter 的 impeccable **v4.3.1**、`vendor/snippets/impeccable/README.md`（釘 tag 安裝、升降版、`.impeccable/` 版控政策）。

UI predicate：`@nuxt/ui`、或 Nuxt 且有 `pages/`／`app/pages/`。非 UI 專案整表 N/A。

## 追問清單（id 給 inspect／completion 對）

| id | 缺了要問什麼 | 齊的可觀察 predicate |
| --- | --- | --- |
| `design-new` | Agent 自己跑 impeccable（缺 PRODUCT.md 走 `init`，新畫面走 `shape`／new-work 方向回合；不是自己手寫一頁、也不是叫人打 slash command），再依本表把缺欄問完並寫檔 | 本 session agent 已自行跑 impeccable 並落地檔案，或 user 明示本輪不做 UI 視覺（記 N/A 理由） |
| `impeccable-claude` | 要裝 impeccable 給 Claude | `.claude/skills/impeccable/SKILL.md` 存在（copy 目錄或 symlink） |
| `impeccable-agents` | Codex／多 agent 共用路徑 | `.agents/skills/impeccable/SKILL.md` 存在（symlink mode 常只在這裡有實體） |
| `impeccable-cursor` | Cursor 主線要讀得到 | `.cursor/skills/impeccable/SKILL.md` 存在 |
| `impeccable-version` | 鎖定 **4.3.1**（`skill-v4.3.1`） | 每一條存在路徑的 SKILL.md frontmatter 都讀得到版本且等於 `4.3.1`——頂層 `version:` 或 `metadata:` 底下的 `version:`。**讀不到版本也算未齊**，NEVER 當成通過 |
| `install-mode` | copy vs symlink 要跟該 repo 其餘 skill 同一慣例 | 每個所選 target 跑 `ls -la <skills-root>`：impeccable 與鄰居同是真實目錄或同是 symlink；對照 `vendor/snippets/impeccable/README.md` |
| `install-script` | `scripts/install-skills.sh` 必須單行、**釘 tag** `skill-v4.3.1`，禁止 v2 迴圈 | 有 `npx skills add https://github.com/pbakaus/impeccable/tree/skill-v4.3.1`（或 `IMPECCABLE_TAG="skill-v4.3.1"` 帶入同一條 URL）**且沒有**裸 `npx skills add pbakaus/impeccable`、`pbakaus/impeccable@$skill`／`for skill in … adapt animate` |
| `install-agents` | `scripts/install-skills.sh` 的 impeccable 安裝要同時更新 `.agents/skills/`（Codex 讀的那份），寫法照 `vendor/snippets/impeccable/README.md` 標準 snippet | 每一條 impeccable `npx skills add` 的 `--agent`（含 `$VAR` 展開後）都含 `codex`；只有 `claude-code`、或靠 `cursor` 寫 `.agents/skills/` 都算未齊 |
| `product-md` | 要有非 placeholder 的 `PRODUCT.md` | 檔存在、非 `[TODO]`、正文 ≥ 200 chars |
| `product-users` | 目標使用者是誰 | `PRODUCT.md` 有 Users（或同等欄位）；沒有就問 |
| `product-brand` | 品牌名／識別 | `PRODUCT.md` 有 brand |
| `product-tone` | 語氣 | `PRODUCT.md` 有 tone／voice |
| `product-anti-references` | 不要長什麼樣子 | `PRODUCT.md` 有 anti-references |
| `product-principles` | 設計原則 | `PRODUCT.md` 有 strategic principles |
| `product-register` | brand vs product | `PRODUCT.md` 有 `register`；沒有就由 impeccable `init` 問使用者，不准只推論 |
| `design-md` | 色彩／字體／層次／元件／layout | `DESIGN.md` 存在且非空；已有 UI code 卻缺檔 → `/impeccable document`，不要跳過 |
| `design-color-tokens` | Color roles／OKLCH 或 hex／strategy | `DESIGN.md` 有 Color System（或同等） |
| `design-typography` | 字體與尺度 | `DESIGN.md` 有 Typography |
| `design-spacing` | 間距與 layout tokens | `DESIGN.md` 有 spacing／layout |
| `design-components` | 元件慣例 | `DESIGN.md` 有 components |
| `theme-tokens` | 實作層 theme | Nuxt UI：`app/app.config.ts`（Nuxt 4；根目錄 `app.config.ts` 為後援）有 **問過使用者後寫入** 的 `ui.colors`。Starter **不預設品牌色**（不准沿用、也不准假設藍／鋅）。空殼 `ui`、省略 `ui.colors`、或 scaffold 遺留的 `primary: 'blue'` + `neutral: 'zinc'` 都算未齊。否則 `design-system/MASTER.md` 或等價 CSS tokens |
| `live-mode` | init 會帶的 Live Mode | `.impeccable/` 或 impeccable live 設定存在，或 user 明示本輪不安 Live |

`pin`／`unpin`／`hooks`／`doctor` 是 management，**不是**本表必追項；user 問起才讀 `vendor/snippets/impeccable/README.md`。

補正命令（仍要問人、不要默默跑完假裝齊）：缺 md → agent 跑 `/impeccable init`（有 UI code 缺 `DESIGN.md` → 先 `/impeccable document`）。缺安裝 → `vendor/snippets/impeccable/README.md` 標準 snippet（對齊既有 copy／symlink）。缺 design foundation → agent 自己跑 impeccable／本表追問並寫檔。

## 與 BOM 的邊界

BOM 可以**指出**會有 impeccable skill，採用與填內容仍走本表。溝通期 BOM 出完、寫第一個檔之前，UI predicate 為真就把本表未齊項列給 user。
