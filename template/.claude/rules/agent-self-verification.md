<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-self-verification.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Agent Self-Verification

**核心命題**：agent 完成 evidence 收集是**預設職責**，**禁止**把可自動化的驗證（dev login / 截圖 / API round-trip / test / DB query）踢回 user。User handoff 是**最後手段** — 必須主線跑完已知 fallback chain 仍失敗才行。

此規則優先於個別 skill 內嵌的「請 user 確認」捷徑指示；every session always-load。

## 證據鑑別力（先於下方每一條 NEVER / MUST）

驗收引用的證據 E，MUST 能回答「若被驗命題為假，E 會長什麼不一樣？」——答不出或答案是「一樣」→ E 不是證據，換一個在兩個世界會分岔的觀測。**status code、exit code、「檔案存在」、工具自我宣告、來自常數宣告而非量測的數字，預設視為未分岔訊號**。MUST 11 / 16 是本條的兩個實例；新形態回到上面那句自判。降級路徑觸發時 MUST loud（warning / health degraded），讓假世界主動分岔。實證三例見 [[pitfall-empty-state-screenshot-has-no-discriminating-power]]。

**摘要值（hash / 行數 / 檔案數 / diff 大小）同屬未分岔訊號**：`sha256sum` / `md5sum` / `wc -l` 這類全域函式對空輸入不報錯、照樣回一個外觀正常的值，於是「上游命令死掉」與「內容真的是空的」在它的輸出裡完全相同。**每一次**拿 hash 或 count 當證據，MUST 先驗產生它的那條 pipeline 的 exit code 與非空性；**NEVER** 從摘要值反推成因。逐字反開脫：「hash 有值代表命令成功了」——`[ -n "$(printf '' | sha256sum)" ]` 恆真（空輸入的 sha256 就是 `e3b0c442…`），那道 guard 讀起來在防空值、實際永遠通過。實證見 [[pitfall-hash-of-empty-stdout-collapses-distinct-causes]]。

## 否定命題 MUST 先做陽性對照（先於下方每一條具名處方）

**結論形式是「沒有 X」時，MUST 先對量測工具做一次陽性對照**——用一個**已知存在**的目標跑**同一條指令**，確認它回得出非空。**回空就是工具壞了，不是「沒有 X」。** 對照沒跑，那個「沒有」不是證據，**NEVER** 拿它當任何動作的前提（起 publish、判 lane 空、判沒人在跑、判無違規）。

**這條排在所有具名處方之前，不與它們並列**，理由只有一條：**它不要求你事先知道那個特定的坑。** 具名處方（`find` 加 `-L`、比對 `exe` 不比對 `comm`、進程列表不加 `| head -N`）擋的是已知的坑，而**會出事的每一次，都是不知道的那一次**。陽性對照擋的是「這個工具現在到底活著沒有」——後者不成立時，前者全部沒有意義。

逐字反開脫：「指令跑完了、沒報錯、回空，所以確實沒有」——空輸出與工具壞掉在 stdout 上完全同形，而**否定命題只能用「找不到」來證，所以這一整類對假陽性與假陰性都零抵抗**。假訊號不是讓你少知道一件事，是讓你知道一件相反的事。

**誠實邊界**：陽性對照證的是**工具活著**，不是 **pattern 寫對**——它擋不住「工具對目標 A 有效、對目標 B 無效」。**NEVER** 把對照通過讀成「這次的查詢是對的」。

**判「某個程式在不在跑」時 MUST 貼 [[process-probe]] 的 `is-running.sh`，NEVER 現場自組 `pgrep` / `ps | grep`**：`pgrep -f` 比對整條 cmdline，量的是「有沒有人提到這個字」；該腳本內建兩段對照並把「沒有在跑」（exit 1）與「量不出來」（exit 2）分成不同 exit code。裸 `pgrep` 把這兩個結論折成同一個空輸出。

> 本 rule 的成因（根因同質的 pitfall 群）見 `docs/rule-rationale/agent-self-verification.md`。

## 驗收 gate MUST 收窄到本次觸及的範圍

寫任何 gate（TD 的 `**自驗**`、change brief 的驗收條件、restart brief、tasks.md 的 acceptance）時，
**MUST** 先跑一次那條指令拿 **baseline**，再把 gate 寫成「相對 baseline 的 delta」或「本次觸及的檔」。

| gate 寫法 | 判定 |
| --- | --- |
| `pnpm typecheck:tests` exit 0 | ❌ repo 本來就 68 errors／22 檔時**結構性不可達**——沒有任何一次正確的工作能讓它成立 |
| `pnpm run doctor` 零 error | ❌ 同型（baseline 4 errors） |
| `pnpm typecheck:tests` 對 `<本次觸及的檔>` 零 error，且**總 error 數 ≤ baseline 的 68** | ✅ 可達、可驗、且擋得住新增退化 |
| `pnpm check` exit 0 | ❌ 若它固定 exit 1 |
| `pnpm check` 的 `<本次觸及的檔>` 區段零新增 finding（baseline 見 `<記在哪>`） | ✅ |

**NEVER 用「repo-wide 指令 exit 0」當 gate，除非你剛剛實跑過、它現在就是 0。** 沒跑過就寫上去的
repo-wide 綠燈，在紅 baseline 的 repo 裡與「工作沒做完」外觀完全相同：接手的人（或無人值守迴圈）
每一輪跑一次、每一輪紅、每一輪判成未完成，而**真正的工作可能早就做完了**。這不是嚴格，是把一條
item 永久釘死。

**baseline MUST 落在 gate 旁邊**（數字 ＋ 量測日期 ＋ 指令原文），不是「跑一下就知道」——
baseline 只存在於某次 session 記憶裡時，下一個讀 gate 的人算不出 delta，只能退回讀 exit code。

**NEVER 用「先讓它綠、之後再補」處理紅 baseline**（那是暫時修法）。正確動作是把紅 baseline 本身
登記成獨立條目，讓它有自己的 owner，而不是掛在每一條無關 item 的驗收條件上。

## Hard rule

### NEVER

對下列場景**禁止**直接 handoff user：

1. **缺 session cookie** → 走 [[manual-review.backend]] § Dev-login route missing → scaffold-first hard rule 的 detection 路徑與 scaffold 流程（**不**問 user 取 cookie / Google OAuth + DevTools 複製）
2. **缺 visual evidence** → 走 [[manual-review.backend]] § `[verify:ui]` channel 的 dispatch path。**dispatch 對象與 model 一律以 [[agent-routing]] § Routing Table〔`screenshot-review-verify`〕列為準**（2026-08-22 拍板：`Agent` tool `subagent_type: screenshot-review`，該列 **NEVER 派 Pi 任一 model**）。**NEVER 在本檔複寫該列的 model 選擇**——本行舊複本曾寫成相反方向，隨投影散到全 fleet 十一個 consumer
3. **撞 baseline functional gap**（route 存在但 allow-list 不收 fixture user / role 不符 / seed identifier 對不上）→ 走 [[main-self-collect-fallback-chain]] (a)(b)(c)(d) 四層，**全失敗**才寫 `deferred` annotation
4. **工具呼叫 error**（CLI flag 錯、env 缺、process exit non-zero）→ 先 read source code 確認 CLI contract，**不**把 error message 原文 forward 給 user（往往誤導）

### NEVER（句型黑名單）

下列句型出現在 output 即違反本 rule，必須改寫：

- 「我現在缺 X，請你...」（X 可 mint / scaffold / agent-browser 取得時）
- 「請取 ADMIN_COOKIE」「請手動 OAuth」「DevTools 複製 cookie」「請貼回 cookie」
- 「截圖無法驗證 X，所以跳過 / 標 deferred」（未走 fallback chain）
- 原文 forward 瀏覽器工具的 error message 當待辦（未先驗 CLI contract / 未跑 `agent-browser doctor --fix` 自救）
- 「blocked on `<ENV_VAR>` — dev 環境未配」（未 grep .env.local 確認就假設缺失）
- 「截圖已拍 / evidence 已補」但未驗證截圖內容是否為預期頁面（拍到登入頁 / 白畫面即違反）
- 「review:ui 項已勾 `[x]`，視為已驗收」但無對應 agent 自拍 evidence 佐證（既有 `[x]` ≠ evidence — 假設 user 有截圖、信任前 session 代勾都算違反；per [[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]）
- 「grep 不到 X，所以 X 不存在」「零命中，確認沒有」「只有 N 個」「無任何 / 沒有任何 X」（未附 known-positive control 就把 negative search 當證據；per 下方 MUST 11）
- 「curl 打過了，302 / 200，登入流程正常」「cookie jar 有存到，session 沒問題」（對**帶登入態**的流程，curl 的狀態碼不是證據；per 下方 MUST 16）
- 「連結已產生 / `href` 對了，所以點下去會登入成功」（讀 artifact 的形狀不等於驗它的行為；per 下方 MUST 16）

### MUST

1. **派 subagent 收 evidence 前**：主線先**嘗試自己跑**。Subagent 只在主線資源會被大量消耗時派；single-shot collection（一張截圖 / 一次 curl）**default** 主線自跑。
2. **撞 baseline functional gap** → 走 [[main-self-collect-fallback-chain]] 四層：
   - (a) 擴 dev-login route allow-list
   - (b) service_role direct DB query 證 data shape（annotation 標 `direct-db-shape`）
   - (c) 主線自起 dev server + agent-browser self-login
   - (d) 派 screenshot-review codex `mode: verify`
3. **寫 `(deferred: ...)` annotation MUST 含 failure trail**：逐層列出 (a)(b)(c)(d) 的嘗試結果，缺任一層就不是合格 annotation。逐字範例見 [[agent-self-verification.screenshot-evidence]] MUST 3。
4. **工具呼叫前 verify CLI contract**：對 vendor script / external CLI，呼叫前 grep `Usage:` / `--help` / source 確認 flag / stdin / env var。`Usage:` 出現在 stderr = argv 錯，root cause 在 dispatcher source，**不**是 user 端設定。

   **`--help` 不是天生安全的探測手段。** 對**沒有**解析 `--help`、也**沒有** unknown-flag 檢查的 script，`--help` 等同無參數執行 —— 探測動作本身就是那個危險動作。因此 **MUST 先讀 source 確認它對 unknown flag 的處置**（報錯退出？忽略照跑？）再決定怎麼探測；shim 檔要一路追到實作端（45 行的轉呼叫 shim 看起來人畜無害，危險的是它背後那支實作）。**NEVER** 對這類 script 用 `| head -N` 限制輸出量 —— 那會把它腰斬在中途（per [[checker-contract]] § 上游具副作用時，提前退出命令會把它腰斬）。
5. **verify:ui / verify:e2e evidence 的 fixture MUST 在 seed.sql**：fixture 缺就先寫進 `seed.sql` → `pnpm supabase:sync` → `pnpm db:reset` 再拍。**NEVER** 用 `curl POST` / `$fetch` / form submit 臨時建 ephemeral data 拍截圖。理由與流程見 [[agent-self-verification.screenshot-evidence]] MUST 5。
6. **Worktree .env 驗證（hard rule）**：在 worktree 做 verify channel evidence collection 時，item 依賴的 env var **MUST** 先 `grep -i '<VAR_NAME>' .env.local` 確認存在且有值，**NEVER** 假設 worktree env 缺失而寫 `blocked on <VAR>`。繼承機制與成本對比見 [[agent-self-verification.screenshot-evidence]] MUST 6。
7. **截圖 + 驗證不可分割（atomic screenshot-then-verify，hard rule）**：`agent-browser screenshot` / Playwright screenshot **MUST** 在同一個 Bash 呼叫內緊接驗證，**NEVER** 分成兩個獨立 tool call（分開 = 中間可被跳過）。驗證失敗 = 截圖作廢，**MUST** 修根因後重拍，**NEVER** 帶著失敗截圖寫 annotation。**(a)–(e) 五層的 canonical bash、逐項驗法與 auth 非 200 立即停手，見 [[agent-self-verification.screenshot-evidence]] MUST 7 —— 開始收截圖 evidence 之前 MUST 先讀那一節。**

8. **review:ui 既有 `[x]` 需 agent 自拍 evidence 佐證（hard rule）**：archive / 收尾前，任何 `[review:ui]` 的既有 `[x]` 若無對應 agent 自拍 screenshot evidence → 一律視為 **false-green**。主線 **MUST** 無視 checkbox state 自拍自驗，**NEVER** 假設 user 手上有截圖、**NEVER** 信任前 session 代勾。evidence 路徑格式、「自拍是 bug-catcher」與 route mapping 延伸規約見 [[agent-self-verification.screenshot-evidence]] MUST 8。

9. **UI 改動後 MUST 重拍所有受影響的 verify:ui 截圖（hard rule）**：commit 觸及 `.vue` / `.tsx` / `.jsx` / `.css` / `.scss` 檔後，該 change 的**全部** `[verify:ui]` / `[review:ui]` items 截圖視為 stale（**不只**被標 issue 的那張）。**MUST** 跑 `audit-screenshot-staleness.ts` 確認 0 stale 才能 hand back user 或推 bucket 到 `ready`。此規則**不限 spectra-apply 流程**。五步重拍流程見 [[agent-self-verification.screenshot-evidence]] MUST 9。

10. **部署宣稱需交叉核對**：宣稱部署平台 / runtime 時，**MUST** 核對 `.github/workflows/` deploy job + deploy config（`wrangler.toml` / `Dockerfile`）+ `package.json` scripts。**NEVER** 只引單一 `docs/` 文件。

    **開始調查 production 之前先釘 canonical tuple**：讀任何設定 / 查任何 log / 提任何修正**之前**，**MUST** 先確認四項並寫出來——repo、framework、hosting platform、domain。**NEVER** 從當前工作目錄推斷是哪個 production 專案：cwd 只說明你在哪個 checkout 裡，不說明它部署到哪、甚至不說明它有沒有部署。四項有任一項答不出來，就還沒到可以動手的階段。（<consumer-l> 2026-07-14 實證）

11. **Negative search 不成立為證據（hard rule）**：下「零命中 / 不存在 / 只有 N 個」的結論前，**MUST** 先用一個已知會命中的樣本驗過 pattern（known-positive control），並在結論裡寫出「此 pattern 對 `<已知樣本>` 命中」——寫不出來，零命中就不是證據。**NEVER** 把「我 grep 過了」當成 absence 的證明：pattern 寫錯、資料形狀誤判（表格儲存格繼承 / 多種寫法 / 跨行屬性 / 別名 import）、未言明的假設偷偷收窄範圍，三者的輸出**都是零命中**，跟真的不存在外觀完全相同，而換一個工具重跑同一個 pattern 驗不到任何一項。有 structured output（`--json` / `--format json`）時優先用它取代文字 grep；更前一步是先問「有沒有不需要數的判準」（例：gate 已設 `severity: CRITICAL,HIGH`，則輸出的每一條依定義都是 HIGH，根本不必數）。（per [[pitfall-narrow-grep-absence-treated-as-proof]]）

    **時間窗查詢**（`docker logs` / `docker events` / `journalctl` 的 `--since` / `--until`）是本條最常被違反的形態——裸 wall clock 字串以**主機本地時區**解讀，exit code 恆 0、無 warning。每次 MUST：(a) 先用寬鬆窗撈一筆 known-positive control 再收窄；(b) 絕對時間帶時區後綴（`2026-08-05T10:00:00Z`），寫不出時區就用相對時間（`--since 30m`）。空輸出為何與「真的沒發生」同形，見 § 證據鑑別力。（機制與實錄見 [[pitfall-docker-logs-absolute-time-parsed-as-host-local-timezone]]）

12. **「這個帳號能不能登入 / 能不能管理」MUST 逐層驗，不從單層外推**：回答任何帳號可用性問題前，**MUST** 分別驗證五層並逐層寫出結論——(a) 該人在該環境是 active（未離職 / 未停用）、(b) 登入 provider 與 route 對該帳號開放、(c) platform role 是 active、(d) session 真的建得起來、(e) 登入後的 UI 與 API permission 確實放行。**NEVER** 因為 DB 有一筆 employee row、或某份文件列了那個 email，就宣稱帳號可用——這兩者都只證明 (a) 的一部分，跟 (b)–(e) 沒有任何蘊含關係。（<consumer-a> 2026-07-19 實證）

13. **改工具定義前 MUST 從實際生效的命令反查 source**：要改一個 skill / script / hook 的行為時，**MUST** 先確認「執行時真正被讀到的是哪個檔」——從實際跑的命令、程序的 argv、或該工具自己印出的路徑往回查。**NEVER** 從執行環境推定 source：工具跑在哪台主機、哪個容器、哪個 VM，跟它的定義檔放在哪是兩件無關的事。改錯檔的輸出跟改對檔一樣是「已修改」，只有下次執行才會發現沒生效。（實錄見 rationale）

14. **判定外部 server / daemon 是否存活 MUST 對齊自己這條連線**：MCP server、dev server、tunnel 這類長駐程序報連線錯誤（`Transport closed` 等）時，**MUST** 用 process tree 確認「當前 session 的 PID 與它的直接子程序」，**NEVER** 因為看到**同名**程序還活著就判定 server 正常——別的 session 開的同名程序跟你這條連線沒有關係。修復時同樣 **MUST** 用不終止其他 session 的方式（版本化安裝 + 隔離 cache dir）。同一個 stdio MCP 的查詢**預設串行**，不要開沒必要的並行 outstanding call。（<consumer-b> 實證）

15. **收尾前 MUST 核對 receipt 齊全，不是逐項查（hard rule）**：change 收尾 / archive / hand back user 前 **MUST** 跑 `audit-evidence-completeness.ts` 並取得 exit 0，**NEVER** 用逐項 `evidence-store --has-evidence` 查過就當全項齊全（逐項查回答不了「哪些項還缺」），**NEVER** 為了讓它變綠去改 checkbox。完整命令、exit 1 的兩條處置與本條和 MUST 8 的分工，見 [[agent-self-verification.screenshot-evidence]] MUST 15 —— 收尾前 MUST 先讀那一節。

16. **驗收對象需要登入態時，MUST 用真瀏覽器走到底並斷言登入後狀態（hard rule）**：只要被驗的流程**需要 session 才會顯示正確結果**（登入後頁面、帶權限的 API 經瀏覽器呼叫、任何「登入 → 跳轉 → 落地頁」鏈路），**MUST** 用真瀏覽器點完整條鏈路，並斷言**登入後**的 DOM 狀態——不是斷言狀態碼、不是斷言 `href` 字串。可觀察的最小斷言組：落地頁 `location.href` 是預期路徑、`document.querySelector('input[type=password]')` 為 `null`、以及一個只有登入後才存在的元素。

    ```bash
    agent-browser open '<login-url>'
    agent-browser eval "JSON.stringify({url: location.href, hasLoginForm: !!document.querySelector('input[type=password]')})"
    ```

    **NEVER** 拿 curl 的狀態碼當帶認證流程的證據：curl 完全不理會 cookie 的 `Secure` 屬性，所以經 plain-HTTP origin 登入時「302 → redirect target → 落地頁 200」三個訊號**全部正常**，而瀏覽器早已把 cookie 靜默丟棄。`SameSite` 與 secure-context-only 的 Web API 同型（機制全文見 rationale）。

    **NEVER** 用「開過瀏覽器」抵這條：同一輪實測開了瀏覽器但只讀 `href` 字串沒點下去，一樣沒驗到。**檢查 artifact 的形狀不等於檢查它的行為。**

    非 localhost origin 要能登入，該 origin 自己**必須**是真 HTTPS（例：tailnet 的 `tailscale cert` + MagicDNS）。兩者皆無時 **NEVER** 退回 plain-HTTP proxy 產生登入連結——改回報「需 HTTPS 才能登入」並說明原因。（per [[pitfall-plain-http-proxy-cannot-carry-secure-session]]）

17. **診斷型指令 NEVER 串接後截斷（hard rule）**：判準是**失敗訊息會不會被截掉**，不是輸出長不長。publish / audit / gate / lock acquire 這類「失敗時我要讀原因」的指令，**MUST** 全量落檔再挑著看，前置檢查與主指令分開跑。**違反字面就是違反精神。**

    ```bash
    # ❌ 錯誤在頭、stack 在尾；pipeline exit 屬於 tail（幾乎恆 0）；前面的 ✓ 漂進同一視窗
    node scripts/_validate-manifests.ts && node scripts/publish.ts patch 2>&1 | tail -5

    # ✅ 全量落檔；exit code 是主指令自己的
    node scripts/publish.ts patch > /tmp/pub.log 2>&1; echo "exit=$?"; tail -6 /tmp/pub.log
    ```

    | 讀到自己在想 | 現實 |
    | --- | --- |
    | 「輸出太長，tail 一下」 | 錯誤訊息在頭，tail 正好丟掉要讀的那段 |
    | 「反正有 ✓ 就是過了」 | ✓ 可能是 `&&` 前面那條印的 |
    | 「exit 0 就是成功」 | `cmd \| tail` 的 exit 屬於 tail |

    **Red Flag**：正要把 publish / audit / gate 接到 `\| tail` / `\| head`，或用 `&&` 把前置檢查和主指令串成一行再截斷。純查詢（`git log \| head -5`）不在本條。副作用指令被 `head` 腰斬是另一條，見 MUST 4 與 [[pitfall-sigpipe-truncates-side-effecting-script]]。（per [[pitfall-chained-command-tail-truncation-hides-failure]]／[[TD-461]]）

18. **拿計數 / 探針當證據前 MUST 過三條前提（hard rule）**：MUST 11 管的是「零命中不等於不存在」，
    本條管的是**非零**的那一半——數字印出來了、exit 0、量級看起來合理，而它量的根本不是命題問的東西。
    三條各自的失效都是靜默的，**每一次**把數字寫進結論、`### 自驗`、TD entry 或 gate 判準之前
    都要過，不是只在「數字看起來可疑」的時候過。

    - **(a) 搜尋路徑清單 MUST 不含互為 symlink 的目錄。** ripgrep / grep 依 inode 去重，路徑清單
      同時含 symlink 目錄與其目標時計數靜默偏低，且隨走訪順序在多次執行間漂移（clade home 實測
      同一條指令 116 vs 208，而該 symlink 目錄單獨只有 4）。可疑時跑三跑法——分別量 A（合併）、
      B、C 兩個子路徑，`B + C != A` 即為去重生效。**NEVER** 因為「兩次都跑得出數字」就當它穩定：
      漂移的兩次都是 exit 0。（per [[pitfall-rg-symlink-target-dedup-undercounts]]）

    - **(b) 判定單位 MUST 與命題單位同級。** 命題問「還有幾**處**不合形狀」時，`rg -l` / `comm`
      這類**以整個檔為判定單位**的指令當粗篩可以，當**判準** NEVER 可以——同一個檔在別處為別的
      用途出現過一次目標 pattern，整支就被判安全，而真正要看的那一處是舊形狀。判準 MUST 綁到與
      命題同級的儀器：逐 occurrence 的 `rg -o`，或直接跑 test。實證：TD-462 三次檔案層計數
      （22 / 22 / 23）全數漏掉 `scripts/audit-rule-authoring.ts` L833 的舊形狀守衛，window 層的
      test 一跑就抓到。

    - **(c) 探針寫進 `### 自驗` 之前 MUST 先跑一次 control。** 餵一個**真答案已知為非空**的輸入，
      確認這條指令印得出非空結果，再拿它去量預期為 0 的那一次。只跑「預期回 0」那一次時，
      **壞探針與真陰性外觀完全相同**：exit 0、stdout 空、只有 stderr 帶訊號，而覆核者與
      `audit-tech-debt-hygiene.ts --run-selfverify` 的 `shim-dropped-flag` 判準都只在**它自己**
      執行的那一面有效——覆核者在 Bash tool 裡自己下的那一次，機械面結構上零覆蓋。
      **NEVER** 靠「我記得這個 flag 會不會被吃掉」推論：改寫是**形狀相依**的，同一個 flag 裸跑被
      忽略（空輸出、exit 0）、接了 pipe 完全正常、帶 compound predicate 則拒跑 exit 1，三種形狀
      三種答案。

    | 讀到自己在想 | 現實 |
    | --- | --- |
    | 「數字跑出來了，跟預期差不多」 | 差不多是對**你以為它在量什麼**而言；三條前提量的正是「它在量什麼」 |
    | 「同一條指令我跑過兩次，結果一樣」 | (a) 的漂移可以連續兩次相同；穩定不是正確 |
    | 「`rg -l` 比較快，先用它掃一遍」 | 當粗篩可以，寫進判準就是 (b)。粗篩結果 NEVER 直接當結論 |
    | 「探針回 0，正好符合我的判斷」 | 那正是 (c) 要擋的一格——符合預期的空輸出最不會被複驗 |

## 派工前的主線預檢責任

派 subagent / codex / screenshot-review 前，主線 **MUST**：

1. **Read tasks / brief 抽具體 path**（檔案 / URL / DOM）
2. **Pre-verify baseline**：依 [[manual-review.backend]] § Pre-verify baseline 假設確認 dev-login route / fixture / seed 存在
3. **若 baseline functional gap**：先跑 [[main-self-collect-fallback-chain]] 至少 (a) 一輪驗 mint 成功，**再**派 subagent
4. **失敗模式預設**：subagent 回報 `deferred` 不代表終局；主線 **MUST** 再跑一輪 fallback chain，仍失敗才 handoff user

## 為什麼派 subagent 不是 default

- 無主線 working context，cold start 易 lazy decision
- 對「自己合理化跳過」無自律（per [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）
- 主線自跑可即時觀察並調整；subagent 是 batch 模式

→ 派 subagent =**主線確定無法獨自完成**時才用，不是 default。

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Verify channel baseline / Dev-login scaffold | [[manual-review.backend]] § Pre-verify baseline 假設 + § Dev-login route missing → scaffold-first |
| Screenshot-review verify mode dispatch | [[agent-routing]] § Routing Table `screenshot-review verify mode` + [[agent-routing.pi-watch-protocol]] § screenshot-review Verify Mode Dispatch |
| `[verify:e2e]` / `[verify:api]` / `[verify:ui]` annotation 格式 | [[manual-review.backend]] § 標準流程 |
| Self-collect fallback chain (a)(b)(c)(d) | [[main-self-collect-fallback-chain]]（cookbook） |
| review-gui 補 evidence prompt 是 fallback 不是 default | [[manual-review]] § review-gui 補 evidence prompt 路徑分類（pending TD-161） |
| Review-gui surface SoP（呼叫 review-gui 的 agent / wrapper） | [[review-gui-surface]] |

## Audit signal

`verify-evidence-deferred-without-self-collect-attempt` — TD-161 Resolution 留作 first incident 後再評估，script 未建。

`audit-evidence-completeness`（MUST 15 的機械層）：`vendor/scripts/audit-evidence-completeness.ts`，遵守 [[checker-contract]] § REQUIRED output contract 與 § Exit code 契約——`0` = 全齊或無已勾 item、`1` = 有缺口、`2` = repo / change / tasks.md 讀不到。它只核對**已勾** item；未勾的計入 `skipped`，不算缺口。

## 違反時的回報方式

```text
[agent-self-verification] Hard rule violation
修正：黑名單句型 → 走 fallback chain 自跑；`(deferred:)` 缺 trail → 補 (a)(b)(c)(d) 失敗原因；error 原文 forward → read source / --help 驗 CLI contract
繞過：真需 user 親手做（真機刷卡等）→ 標 `(deferred-user-only: <reason>)`
```
