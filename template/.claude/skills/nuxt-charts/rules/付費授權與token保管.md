# 付費授權與 token 保管

> 讀取時機：`nuxt-charts` SKILL.md Phase 3 step 1，任何付費原始碼落地之前（三條取得路徑皆同）。

# Rule 1 - 付費原始碼 NEVER 進公開 repo

- Level: `MUST`
- 範圍：**每一條**取得路徑都適用——從鏡像 `YuDefine/nuxt-charts-assets` 複製、從 nuxtcharts.com/blocks 的 Code 分頁複製、`nuxt-charts add`。
- 落地前先在目的 repo 跑 `gh repo view --json visibility -q .visibility`。結果**不是** `PRIVATE` 或 `INTERNAL` 就停下——`PUBLIC`、指令報錯、沒有 GitHub remote、未登入都算——**NEVER** 執行 `nuxt-charts add`、**NEVER** 貼上 block 程式碼或複製 template 檔；只能用 npm 上的開源 `nuxt-charts` chart。
- 鏡像 repo `YuDefine/nuxt-charts-assets` 本身只能是 `PRIVATE`：clone 前的可見度檢查已寫進 `付費內容取得路徑.md` Rule 1 的判定段（Phase 2 就會跑到），印 `NOT-PRIVATE` 就停下回報，**NEVER** 從它取用，**NEVER** 把它轉公開、fork 到公開位置或把整包推到別的 repo。
- 理由：授權是 Commercial License，原始碼公開等於把付費內容發給所有人；鏡像收的是全部 block 與 template，一旦公開就是整包外流。

# Rule 2 - token 只存在兩個地方

- Level: `MUST`
- CLI Access Token（前綴 `nct_`）與 UI Editor Token 的唯一保管處是 Notion「Scrects」頁的「Nuxt Charts」段，取用流程照 `secret-custody` 規約，Notion 讀取照 `notion-ops` 派工。
- 本機只存在 CLI 自己的設定裡，每台機器設一次。
- **NEVER** 把 token 寫進 repo 任何檔（`.env*`、`nuxt.config.*`、腳本、文件）、commit message、對話輸出；**NEVER** 把 token 字面值打進任何指令（`add -t <token>`、`config set-token <token>` 都會留在 shell 歷史與 session transcript）。

# Rule 3 - token 只經指令替換交接，輸出一律遮罩

- Level: `MUST`
- 遮罩：`nct_` 開頭的串不論長短整段遮掉；其餘任何 16 字元以上的連續 `[A-Za-z0-9_-]` 串只留前 4 碼，不依賴 token 前綴（UI Editor Token 的格式官方未公開）。sed 運算式**逐字寫在每一條指令裡**，**NEVER** 存成 shell 變數再引用——變數不跨 tool call 保留，空的運算式會讓 sed 原樣印出 token。
- 設定 token 時，先把取值結果放進變數並確認取值成功且非空，才交給 CLI；取值失敗就停，**NEVER** 讓空字串蓋掉本機已可用的 token。整段在同一個 tool call 內跑完：

```bash
t="$(<從保管處取值、只把值印到 stdout 的命令>)" && [ -n "$t" ] \
  && nuxt-charts config set-token "$t" 2>&1 | sed -E 's/nct_[A-Za-z0-9_-]+/nct_…(masked)/g; s/([A-Za-z0-9_-]{4})[A-Za-z0-9_-]{12,}/\1…(masked)/g'
unset t
```

- 要走 CLI 時檢查本機有沒有設好 token（讀鏡像與網站 Code 分頁都不用 token），同樣只看遮罩後的輸出：

```bash
nuxt-charts config show 2>&1 | sed -E 's/nct_[A-Za-z0-9_-]+/nct_…(masked)/g; s/([A-Za-z0-9_-]{4})[A-Za-z0-9_-]{12,}/\1…(masked)/g'
```

- **NEVER** 直接跑沒接遮罩的 `nuxt-charts config show`；取值命令 **NEVER** 先把值印出來或寫進檔案再交接。
