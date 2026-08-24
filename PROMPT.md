# 初始提示詞

把下面整段複製、貼給**任何一個 AI**（Claude Code / Codex / Cursor / Gemini / ChatGPT 都可以），它就會帶你用這套 starter 建立一個可開發的專案。

適用兩種起手式：

- **全新專案** —— 還沒有目錄
- **已有 repo** —— 已經開好 git repo、寫了 README 描述產品，但還沒有 code

你的機器需要先有 `git`、`node`、`pnpm`。提示詞的第一步會替你確認，缺了會告訴你缺哪個。

---

## 複製這一段

````text
你要幫我用 `nuxt-supabase-starter` 建立一個 Nuxt 專案。請照下面的順序做。

## 鐵則（違反任何一條，這次協作就失敗了）

1. **技術選型由 CLI 問我，不由你決定。** 不要替我挑認證方式、資料庫、部署平台、
   UI 套件或測試框架，也不要從我的 README 去「推斷」我想要什麼。你的工作是把
   CLI 跑起來讓它問我，不是代替我回答。
2. **不要手寫專案骨架。** 不要 `nuxi init`、不要自己貼 `nuxt.config.ts`、不要自己
   `pnpm add` 一堆套件。骨架一律由 starter CLI 產生 —— 手寫的版本會缺掉這套
   starter 內建的 CI、hooks、規則與部署配置，而那正是我要用它的理由。
3. **一次只跑一條指令，跑完把實際輸出貼給我，再跑下一條。** 不要把多個步驟用
   `&&` 串成一次執行 —— 串起來的話中間的失敗會被吞掉。
   （`cd <目錄> && <一條指令>` 不算串接，那只是幫指令定位工作目錄。）
   失敗就停下來報錯誤原文，不要自己想辦法繞過去。
4. **不要刪我的檔案。** 任何刪除、覆蓋、`--force`、`rm -rf` 都要先問我。
   唯一例外是 Step 5 明確指名的 `.claude/.first-run`，那是 scaffold 產生的
   一次性標記，不是我的檔案。

## Step 0 — 前置檢查與定位

先跑這三條（一次一條），確認工具都在：

```bash
git --version
```
```bash
node --version
```
```bash
pnpm --version
```

任何一條不存在就停下來告訴我缺什麼，不要自己裝。

然後只問我這一題：**專案要建在哪個目錄？**

不要問技術問題。那些是 Step 2 的 CLI 要問的。依我的回答決定 Step 2 怎麼填：

| 我說 | `<執行目錄>`（Step 2 用） | `<專案名>`（Step 2 用） | `<專案目錄>`（Step 3–5 用） |
| --- | --- | --- | --- |
| 「已經有 repo 了，在 `/path/to/foo`」 | `/path/to/foo`（repo 自己） | `.` | `/path/to/foo` |
| 「建一個新的，叫 foo」 | 要放 foo 的**父目錄** `/path/to` | `foo` | `/path/to/foo` |

我很可能只給你一個名字（「叫 my-app」）或一段相對路徑（「放在 ./test」）而不是絕對路徑。
那種情況下**以你當前的 `pwd` 當父目錄換算成絕對路徑**，然後把換算結果告訴我確認，
再往下走。三個值一律用絕對路徑，**NEVER** 留相對路徑 —— 你每執行一條指令可能都是
新的 subshell，相對路徑會漂到別的地方去。

這三個值請你在 Step 0 就算好、寫下來，後面每一步照著填，不要臨場再推導。

既有 repo 一定要用 `.`，不要填 repo 名 —— 填 repo 名會在 repo 裡再長出一層
同名子目錄。`.` 不會有巢狀，專案名稱會自動取目錄的 basename。

## Step 1 — 取得 starter

先看在不在（鐵則 3：一次一條，這裡也不例外）：

```bash
ls -d ~/offline/nuxt-supabase-starter
```

**不存在** → clone：

```bash
git clone https://github.com/YuDefine/nuxt-supabase-starter ~/offline/nuxt-supabase-starter
```

**已存在** → 更新。這條失敗（例如本地有改動、或不是 fast-forward）就把錯誤原文
貼給我，**不要**改用 clone 硬蓋掉：

```bash
git -C ~/offline/nuxt-supabase-starter pull --ff-only
```

## Step 2 — 讓 CLI 問我

**這一步你不准執行。** CLI 是互動式的，會停在選單等人按鍵；你代跑只會卡死，
或更糟 —— 你替我把選項填掉了，那就直接違反鐵則 1。

你要做的是：把下面兩條指令填好 `<執行目錄>` 與 `<專案名>`（值來自 Step 0 的表），
以純文字輸出給我，然後**停下來等我回報**。

```bash
pnpm --dir ~/offline/nuxt-supabase-starter/template/packages/create-nuxt-starter install --ignore-scripts
```
```bash
cd <執行目錄> && pnpm --dir ~/offline/nuxt-supabase-starter/template/packages/create-nuxt-starter dev <專案名>
```

CLI 會依序問我 stack preset 與其餘選項，然後自己完成 scaffold、安裝依賴、
初始化 git、並在有 clade 的機器上註冊 consumer。

我回報後，你會看到三種結果之一：

- **「專案 … 建立完成！」加一個框框列出接下來的步驟** → 全新專案的正常結果，直接往下。
- **「偵測到既有 repo「…」，將就地展開 starter」** → 既有 repo 的正常結果。它會保留我的
  git 歷史與 README，`.gitignore` 是合併不是覆蓋。確認它列的處置清單沒問題就往下。
- **「目錄已存在，且含有 scaffold 會覆蓋到的內容」** → 它會列出擋住的項目和三條路。
  跟我一起挑一條。**不要自己選第 3 條去清空目錄**（鐵則 4）。

CLI 收尾若印出**黃色警告**（不是在那個框框裡、而是框框下方的 `WARN`），照抄給我 ——
那代表這個 stack 還差一步才完整。目前已知的一種：選 void.cloud 部署時會要你跑
`npx void init --agents`，它會產生當前版本正確的 `wrangler.jsonc` 並裝上 void 的
skill 與 MCP。**那一步缺了不會讓 build 失敗，會在部署當下才炸**，所以不要因為
Step 3 全綠就跳過它。

## Step 3 — 驗收

先切到專案目錄。你的工具每次執行可能是獨立 subshell，所以**下面每一條都要
帶上這個 `cd`**，不要假設上一條的目錄還在：

```bash
cd <專案目錄> && pwd
```

確認 `pwd` 印出來的是 `<專案目錄>` 之後，**一條一條跑**，每條把實際輸出貼給我：

```bash
cd <專案目錄> && cat .claude/.first-run
```
（scaffold 剛完成才會有這支；沒有就跳過，不是錯誤）

**這支檔案裡的 `instructions` 就是暖機流程**，照它列的步驟做，不要只挑其中一條跑。

**唯一的例外是它的最後一步「刪掉 marker」—— 那一步留到 Step 5 再做。**
（marker 是寫給「單獨進到這個專案的 AI」看的，所以它自己帶了刪除步驟；
你手上有這份提示詞，刪除由 Step 5 統一負責。兩邊都刪會讓你在 Step 3 中途就把它清掉，
後面 Step 5 的回報就少了依據。）

下面 Step 3 的驗收與 marker 重疊的部分（`verify:starter`）跑一次就好。

```bash
cd <專案目錄> && pnpm verify:starter
```

```bash
cd <專案目錄> && pnpm spectra:roadmap
```

```bash
cd <專案目錄> && pnpm spectra:claims
```

```bash
cd <專案目錄> && pnpm check
```

```bash
cd <專案目錄> && pnpm build
```

**不要跑 `pnpm dev`。** 那是常駐 process，在你的工具裡會一直 hang 到 timeout。
`pnpm build` 過了就代表這套 stack 組得起來。我要自己開來看時會自己跑 dev。

**`verify:starter` 的 exit code 有三態，不要一律當紅燈：**

| exit | 意思 | 你該做什麼 |
| --- | --- | --- |
| `0` | 全綠 | 往下 |
| `2` | 有 WARN 無 FAIL（典型：可選的 OAuth 環境變數還沒填） | **往下**，把 WARN 清單列給我就好 |
| `1` | 有 FAIL | 停下來報錯 |

`pnpm check` 與 `pnpm build` 則是 exit 非 0 就停。

停下來時只報錯誤原文，不要一邊改一邊往下跑。

## Step 4 — clade 中央倉（可選）

clade 是這套 starter 的規則 / skills / hooks / CI gate 的中央倉。有它，專案才會
吃到那些治理層；沒有它，專案照樣跑得起來，只是少掉那一層。

**clade 是私有 repo。** 你沒有存取權就 clone 不下來，這不是你做錯什麼。

先看在不在：

```bash
ls -d ~/offline/clade
```

跑得出路徑就是存在；`No such file or directory` 就是不存在。

- **存在** → Step 2 的 CLI 多半已經自動註冊過了。跑這條確認：
  ```bash
  cd <專案目錄> && pnpm hub:check
  ```
  **這條失敗不算流程失敗**（鐵則 3 在這裡不適用）：CLI 會在互動時問我要不要登記，
  我可能答了不要，那樣就不會有對應設定。把輸出貼給我，在 Step 5 記成
  「clade 未接上」往下走，不要停在這裡。
- **不存在** → 告訴我「clade 不在這台機器上」，並問我有沒有存取權。
  **不要自己去 clone**（私有 repo，多半會失敗）。我說我有權限、也要裝，才給我
  clone 指令讓我自己跑。裝好後專案的 `pnpm hub:bootstrap` 會把規則拉下來。
- **我說不用 clade** → 跳過整個 Step 4。這不是錯誤狀態。

## Step 5 — 收尾回報

用這個格式回報，不要加別的：

- **專案位置**：<絕對路徑>
- **CLI 選了什麼**：preset + 我在互動時挑的選項（照 CLI 摘要抄，不要自己補）
- **驗收結果**：Step 3 每一條的 exit code / 關鍵輸出
- **clade**：已接上 / 不在這台機器 / 我明示不用
- **下一步**：三件我現在就做得完的事，每件一句話

`.claude/.first-run` 裡列的暖機步驟**都做完之後**才刪掉它（鐵則 4 的唯一例外）。
沒做完就刪，等於把那份指示丟掉而且沒有人會再看到它：

```bash
cd <專案目錄> && rm -f .claude/.first-run
```

## 我可能會問你的事

- 「這個專案有哪些指令可以跑？」→ 讀 `package.json` 的 scripts 再答，不要憑印象
- 「這套 starter 有什麼？」→ 讀專案內的 `docs/`，不要從網路上找
````

---

## 這段提示詞在防什麼

每一條都對應一次實測撞到的失敗，不是想像出來的。

| 沒有它會發生什麼 | 對應哪一條 |
| --- | --- |
| AI 從你的 README 猜你要 Supabase 還是 D1，然後照它猜的做 | 鐵則 1、Step 0 只問目錄 |
| AI 直接 `nuxi init` 手寫骨架，starter 的 CI / hooks / 規則全部沒進來 | 鐵則 2 |
| AI 把四條驗收指令 `&&` 串起來一次跑完，中間的錯誤被吞掉 | 鐵則 3、Step 3 分開的程式碼區塊 |
| 撞到「目錄不為空」，AI 自作主張清空你的 repo | 鐵則 4、Step 2 的處置說明 |
| 既有 repo 填了 repo 名，結果在 repo 裡長出同名子目錄 | Step 0 的對照表 |
| AI 代跑互動式 CLI，卡死或替你把選項填掉 | Step 2 開頭的禁令 |
| AI 跑 `pnpm dev`，工具 hang 到 timeout 才收工 | Step 3 改用 `pnpm build` |
| AI 去 clone 私有的 clade，拿到 404 後開始亂試 | Step 4 明說 clade 是私有 |
| 專案建好了但沒有任何一條指令真的跑過就宣告完成 | Step 3 + Step 5 的回報格式 |
| AI 讀了 `.first-run` 的暖機指示，只挑一條跑完就把 marker 刪掉 | Step 3 的「照它列的步驟做」+ Step 5 的刪除前提 |
| 選了 void.cloud，Step 3 全綠就宣告完成，缺的那一步到部署當下才炸 | Step 2 結尾的「照抄黃色警告」 |
| 全新專案順利建好，AI 卻因為對不上列出的情境而卡住不敢往下 | Step 2 的三種結果 |
| 我只說「叫 my-app」，AI 拿相對路徑往下跑，指令漂到別的目錄 | Step 0 的 `pwd` 換算規則 |
| AI 照 marker 的最後一步在 Step 3 就把它刪掉，Step 5 沒東西可回報 | Step 3 的刪除例外說明 |
| `pnpm hub:check` 失敗（我當初答了不要登記），AI 當成嚴重錯誤停下 | Step 4 的「這條失敗不算流程失敗」 |
| Step 5 的 `rm` 沒帶 `cd`，在別的目錄執行後報錯或刪錯檔 | Step 5 的完整指令 |

## 相關文件

- 手動走完整流程：[docs/QUICK_START.md](docs/QUICK_START.md)
- 把 starter 整合進**已經有 code** 的既有專案：[docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md)
- CLI 的完整 flag 清單：[docs/CLI_SCAFFOLD.md](docs/CLI_SCAFFOLD.md)
