<!-- Clade native rule; source: rules/core/agent-self-verification.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and MUST come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and MUST NOT be silently replaced by a neighbouring runtime.


# Agent Self-Verification

**核心命題**：agent 完成 evidence 收集是**預設職責**，**禁止**把可自動化的驗證（dev login / 截圖 / API round-trip / test / DB query）踢回 user。User handoff 是**最後手段** — 必須主線跑完已知 fallback chain 仍失敗才行。

此規則優先於個別 skill 內嵌的「請 user 確認」捷徑指示；every session always-load。

## Browser 載體邊界

瀏覽器、登入、截圖與 DOM 評估的選擇是 target-native operation。讀取本規則的共通 evidence 契約後，MUST 讀取所選 target 的 adapter fragment；fragment 缺失或能力未驗證時保持 blocked。

## 證據鑑別力（先於下方每一條 NEVER / MUST）

驗收引用的證據 E，MUST 能回答「若被驗命題為假，E 會長什麼不一樣？」——答不出或答案是「一樣」→ E 不是證據，換一個在兩個世界會分岔的觀測。**status code、exit code、「檔案存在」、工具自我宣告、來自常數宣告而非量測的數字，預設視為未分岔訊號**。MUST 11 / 16 / 19 / 20 是本條的四個實例；新形態回到上面那句自判。降級路徑觸發時 MUST loud（warning / health degraded），讓假世界主動分岔。實證三例見 [[pitfall-empty-state-screenshot-has-no-discriminating-power]]。

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

**NEVER 用「repo-wide 指令 exit 0」當 gate，除非你剛剛實跑過、它現在就是 0。** <!-- nuance-clause-reviewed: 2026-08-29 — 例外的 predicate 是「剛剛實跑過」，可觀察；判準（跑哪一條、baseline 記在哪）落在同節上方那張表，不在同一行 --> 沒跑過就寫上去的
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

> **場景 1–3（缺 session cookie／缺 visual evidence／撞 baseline functional gap）的處置路徑全文在
> [[agent-self-verification.screenshot-evidence]] § NEVER — 禁止直接 handoff user 的三個
> verify-channel 場景**——**收任何 verify evidence 之前 MUST 先讀那一節**，此處不複述。

4. **工具呼叫 error**（CLI flag 錯、env 缺、process exit non-zero）→ 先 read source code 確認 CLI contract，**不**把 error message 原文 forward 給 user（往往誤導）

### NEVER（句型黑名單）

下列句型出現在 output 即違反本 rule，必須改寫：

> **verify-channel 那一半的句型（缺 X 請你…／請取 ADMIN_COOKIE／截圖無法驗證所以跳過／原文 forward
> 瀏覽器工具 error／`blocked on <ENV_VAR>`／「截圖已拍」未驗內容／`[x]` 視為已驗收）全文在
> [[agent-self-verification.screenshot-evidence]] § NEVER（句型黑名單 — verify-channel 那一半）。**
> 下面留的三條在**完全沒有 UI** 的 session 也會發作，所以不下推：

- 「grep 不到 X，所以 X 不存在」「零命中，確認沒有」「只有 N 個」「無任何 / 沒有任何 X」（未附 known-positive control 就把 negative search 當證據；per 下方 MUST 11）
- 「curl 打過了，302 / 200，登入流程正常」「cookie jar 有存到，session 沒問題」（對**帶登入態**的流程，curl 的狀態碼不是證據；per 下方 MUST 16）
- 「連結已產生 / `href` 對了，所以點下去會登入成功」（讀 artifact 的形狀不等於驗它的行為；per 下方 MUST 16）

### MUST

> **MUST 1 / 4 / 10 / 12 / 13 / 14 全文在 [[agent-self-verification.claim-cross-check]]**（path-scoped：碰 deploy config／auth 路徑／工具定義檔／`.claude/agents/**` 時載入）——派 subagent 前主線先自跑、呼叫外部 CLI 前驗 contract、部署宣稱三方交叉核對、帳號可用性五層、改工具定義前反查 source、daemon 存活對齊自己這條連線。**MUST 16**（登入態 MUST 用真瀏覽器斷言）在 [[agent-self-verification.screenshot-evidence]]。
>
> 下面留常駐的五條，觸發都是「任何一次下結論、任何一次跑診斷指令」——綁不到任何檔案，**NEVER 下推**。


> **MUST 2 / 3 / 5 / 6 / 7 / 8 / 9 / 15 的全文已下推 [[agent-self-verification.screenshot-evidence]]**
> ——缺號是刻意的：編號跨 fleet 被逐字引用，**NEVER** 為了連號重排。
>
> **收任何 `verify:ui` / `review:ui` / `verify:e2e` evidence 之前、撞 baseline functional gap 的
> 那一刻、以及收尾／archive／hand back user 之前 MUST 先讀那一份**——下表只有一句話契約，執行細節
> （(a)–(e) 五層順序、五步重拍流程、failure trail 逐字格式、canonical 指令）不在這裡，
> **NEVER** 憑「我記得那條大概是這樣」跳過那次 Read。
>
> | MUST | 一句話契約（全文在該檔同名 §） |
> | --- | --- |
> | 2 | 撞 baseline functional gap → 走 [[main-self-collect-fallback-chain]] (a)(b)(c)(d) 四層，**全失敗**才寫 `deferred` |
> | 3 | `(deferred: ...)` annotation **MUST** 含逐層 (a)(b)(c)(d) failure trail，缺任一層就不是合格 annotation |
> | 5 | verify:ui / verify:e2e 的 fixture **MUST** 進 `seed.sql`，**NEVER** 用 `curl POST` / `$fetch` / form submit 臨時建 ephemeral data 拍截圖 |
> | 6 | worktree 內 **MUST** 先 `grep -i '<VAR>' .env.local` 確認，**NEVER** 假設缺失就寫 `blocked on <VAR>` |
> | 7 | capture 與 verification **MUST** 在同一個 operation round；驗證失敗 = 截圖作廢，修根因後重拍 |
> | 8 | `[review:ui]` 既有 `[x]` 無 agent 自拍 evidence 一律視為 **false-green**，**MUST** 無視 checkbox 自拍自驗 |
> | 9 | commit 觸及 `.vue` / `.tsx` / `.jsx` / `.css` / `.scss` 後該 change **全部** UI 截圖視為 stale，**MUST** 跑 `audit-screenshot-staleness.ts` 到 0 stale |
> | 15 | 收尾前 **MUST** 跑 `audit-evidence-completeness.ts` 取得 exit 0，**NEVER** 逐項 `--has-evidence` 查過就當齊全，**NEVER** 為了變綠改 checkbox |

11. **Negative search 不成立為證據（hard rule）**：下「零命中 / 不存在 / 只有 N 個」的結論前，**MUST** 先用一個已知會命中的樣本驗過 pattern（known-positive control），並在結論裡寫出「此 pattern 對 `<已知樣本>` 命中」——寫不出來，零命中就不是證據。**NEVER** 把「我 grep 過了」當成 absence 的證明：pattern 寫錯、資料形狀誤判（表格儲存格繼承 / 多種寫法 / 跨行屬性 / 別名 import）、未言明的假設偷偷收窄範圍，三者的輸出**都是零命中**，跟真的不存在外觀完全相同，而換一個工具重跑同一個 pattern 驗不到任何一項。有 structured output（`--json` / `--format json`）時優先用它取代文字 grep；更前一步是先問「有沒有不需要數的判準」（例：gate 已設 `severity: CRITICAL,HIGH`，則輸出的每一條依定義都是 HIGH，根本不必數）。（per [[pitfall-narrow-grep-absence-treated-as-proof]]）

    **時間窗查詢**（`docker logs` / `docker events` / `journalctl` 的 `--since` / `--until`）是本條最常被違反的形態——裸 wall clock 字串以**主機本地時區**解讀，exit code 恆 0、無 warning。每次 MUST：(a) 先用寬鬆窗撈一筆 known-positive control 再收窄；(b) 絕對時間帶時區後綴（`2026-08-05T10:00:00Z`），寫不出時區就用相對時間（`--since 30m`）。空輸出為何與「真的沒發生」同形，見 § 證據鑑別力。（機制與實錄見 [[pitfall-docker-logs-absolute-time-parsed-as-host-local-timezone]]）

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

19. **拿 body 下結論前 MUST 先讀 final URL 與狀態碼（hard rule）**：curl 帶
    `-w '%{http_code} %{url_effective}'` 取回兩值先讀。`url_effective` 不是你請求的路徑時
    （被 auth 攔到登入頁即是），body 的 grep 與計數**零訊號**，**NEVER** 當任何動作的前提，
    尤其 **NEVER** 當重跑 deploy、切 symlink、重啟服務的理由。全文見 [[TD-783]]。

20. **exit code／fatal 構成驗收結論時 MUST 取 run-evidence receipt（hard rule）**：只要一個命令的
    **exit code 或錯誤字串**是你宣告「過了／沒過」的依據——deploy、migrate、publish gate、typecheck、
    test run——就 **MUST** 經 `node vendor/scripts/run-evidence.ts -- <命令>` 取得 receipt
    （它先抓原始 bytes 再落檔，receipt 帶 `code`、`signal`、`timedOut` 與兩條 stream 的 sha256）。
    **NEVER** 拿任何展示層過濾器摘要出來的「無錯誤」當證據。

    **展示層不只會省略，還會替換。** 2026-09-10 實測（rtk 0.48.0）：`rtk err node -e 'console.error("boom")'`
    回 `sh: 1: Syntax error: "(" unexpected` 與 **exit 2**——被測命令**根本沒有執行**，而它真正的
    exit code 是 7。那一行讀起來像「我的命令寫錯了」，所以最自然的反應是去改命令，不是懷疑 wrapper。
    同一支 filter 對無 metachar 的命令**正確**保留 fatal 與 exit code，所以**NEVER** 靠「我上次用它沒問題」
    推論這次也沒問題：差別在被測命令有沒有 shell metachar，而那不是你在讀輸出時會注意的事。
    機制、三組對照與上游 issue 見 [[TD-1059]]。

    **這條與 hook 層的防守不重疊，兩者都要。** `vendor/scripts/evidence-hook.ts` 是 fleet 的
    **唯一 rewrite owner**：它自己 spawn `rtk hook claude` 取 permission decision，但包進 run-evidence 的是
    **原始**命令。所以經 Bash tool 的命令已經是防守後的——本條管的是**你自己在命令列裡手打**
    filter 的那些時刻（`rtk err` / `rtk test` / 任何 `| tail` 式截斷），那條路徑沒有任何 hook 接得到。
    **NEVER** 因為「反正 hook 有接」就略過本條。另見 MUST 17（診斷型指令 NEVER 串接後截斷）——
    那條管截斷，本條管替換，同一個判準的兩面。實證全文見 [[agent-self-verification.structural-and-exit-evidence]]。

## 派工前的主線預檢責任在 [[agent-self-verification.screenshot-evidence]]（具名時機 MUST-Read）

**派 subagent / pi / visual verifier 收 evidence 之前，MUST 先讀
[[agent-self-verification.screenshot-evidence]] § 派工前的主線預檢責任**——抽具體 path、
pre-verify baseline、baseline gap 時先自跑一輪 fallback 再派、以及「subagent 回報 `deferred`
不是終局」四條都在那裡。Reviewer 的 model 選擇依 [[agent-routing]] 當前 Routing Table 與對應
adapter，**NEVER 在本檔複寫該列的 model 選擇**；缺合格執行者時保持驗收未完成。

## 違反時的回報方式

```text
[agent-self-verification] Hard rule violation
修正：黑名單句型 → 走 fallback chain 自跑；`(deferred:)` 缺 trail → 補 (a)(b)(c)(d) 失敗原因；error 原文 forward → read source / --help 驗 CLI contract
繞過：真需 user 親手做（真機刷卡等）→ 標 `(deferred-user-only: <reason>)`
```
