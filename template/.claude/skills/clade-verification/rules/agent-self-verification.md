<!-- Clade native rule; source: rules/core/agent-self-verification.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and must come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and must not be silently replaced by a neighbouring runtime.

# Agent Self-Verification

**核心命題**：agent 完成 evidence 收集是**預設職責**，**禁止**把可自動化的驗證（dev login / 截圖 / API round-trip / test / DB query）踢回 user。User handoff 是**最後手段** — 必須主線跑完已知 fallback chain 仍失敗才行。

此規則優先於個別 skill 內嵌的「請 user 確認」捷徑指示；every session always-load。

## Browser 載體邊界

瀏覽器、登入、截圖與 DOM 評估的選擇是 target-native operation。讀取本規則的共通 evidence 契約後，要讀取所選 target 的 adapter fragment；fragment 缺失或能力未驗證時保持 blocked。

## 證據鑑別力（先於下方每一條 NEVER / MUST）

驗收引用的證據 E，要能回答「若被驗命題為假，E 會長什麼不一樣？」——答不出或答案是「一樣」→ E 不是證據，換一個在兩個世界會分岔的觀測。**status code、exit code、「檔案存在」、工具自我宣告、來自常數宣告而非量測的數字，預設視為未分岔訊號**。MUST 11 / 16 / 19 / 20 / 21 是本條的五個實例；新形態回到上面那句自判。降級路徑觸發時要 loud（warning / health degraded），讓假世界主動分岔。實證三例見 [[pitfall-empty-state-screenshot-has-no-discriminating-power]]。

**摘要值（hash / 行數 / 檔案數 / diff 大小）同屬未分岔訊號**：`sha256sum` / `md5sum` / `wc -l` 這類全域函式對空輸入不報錯、照樣回一個外觀正常的值，於是「上游命令死掉」與「內容真的是空的」在它的輸出裡完全相同。**每一次**拿 hash 或 count 當證據，要先驗產生它的那條 pipeline 的 exit code 與非空性；不要從摘要值反推成因（`[ -n "$(printf '' | sha256sum)" ]` 恆真）。實證見 [[pitfall-hash-of-empty-stdout-collapses-distinct-causes]]。

## 否定命題 MUST 先做陽性對照（先於下方每一條具名處方）

**結論形式是「沒有 X」時，要先對量測工具做一次陽性對照**——用一個**已知存在**的目標跑**同一條指令**，確認它回得出非空。**回空就是工具壞了，不是「沒有 X」。** 對照沒跑，那個「沒有」不是證據，不要拿它當任何動作的前提（起 publish、判 lane 空、判沒人在跑、判無違規）。

這條排在所有具名處方（`find -L`、比對 `exe` 不比對 `comm` 等）之前：它不要求事先知道那個坑。「指令跑完、沒報錯、回空」與工具壞掉在 stdout 上完全同形。

**誠實邊界**：陽性對照證的是**工具活著**，不是 **pattern 寫對**——它擋不住「工具對目標 A 有效、對目標 B 無效」。不要把對照通過讀成「這次的查詢是對的」。

**判「某個程式在不在跑」時要貼 [[process-probe]] 的 `is-running.sh`，不要現場自組 `pgrep` / `ps | grep`**：`pgrep -f` 比對整條 cmdline，量的是「有沒有人提到這個字」；該腳本內建兩段對照並把「沒有在跑」（exit 1）與「量不出來」（exit 2）分成不同 exit code。裸 `pgrep` 把這兩個結論折成同一個空輸出。

> 本 rule 的成因（根因同質的 pitfall 群）見 `docs/rule-rationale/agent-self-verification.md`。

## 驗收 gate MUST 收窄到本次觸及的範圍

寫任何 gate（TD 的 `**自驗**`、change brief 的驗收條件、restart brief、tasks.md 的 acceptance）時，
要先跑一次那條指令拿 **baseline**，再把 gate 寫成「相對 baseline 的 delta」或「本次觸及的檔」。

| gate 寫法 | 判定 |
| --- | --- |
| `pnpm typecheck:tests` exit 0 | ❌ repo 本來就 68 errors／22 檔時**結構性不可達**——沒有任何一次正確的工作能讓它成立 |
| `pnpm run doctor` 零 error | ❌ 同型（baseline 4 errors） |
| `pnpm typecheck:tests` 對 `<本次觸及的檔>` 零 error，且**總 error 數 ≤ baseline 的 68** | ✅ 可達、可驗、且擋得住新增退化 |
| `pnpm check` exit 0 | ❌ 若它固定 exit 1 |
| `pnpm check` 的 `<本次觸及的檔>` 區段零新增 finding（baseline 見 `<記在哪>`） | ✅ |

**不要用「repo-wide 指令 exit 0」當 gate，除非你剛剛實跑過、它現在就是 0。** <!-- nuance-clause-reviewed: 2026-08-29 — 例外的 predicate 是「剛剛實跑過」，可觀察；判準（跑哪一條、baseline 記在哪）落在同節上方那張表，不在同一行 --> 紅 baseline 上的 repo-wide 綠燈 gate 會把 item 永久釘成未完成。

**baseline 要落在 gate 旁邊**（數字 ＋ 量測日期 ＋ 指令原文）。

**不要用「先讓它綠、之後再補」處理紅 baseline**：把紅 baseline 本身登記成有 owner 的獨立條目。

**反向邊界：收窄的是「哪些 finding 算本次的」，不是「跑哪些 suite」。** 本次觸及 `package.json`／`pnpm-lock.yaml`／`pnpm-workspace.yaml`／vendored tgz 時，**每一條**會載入依賴樹的 suite（unit、BDD、e2e、build）都要實跑——依賴變更沒有 `.ts` diff，影響面是整張 runtime 解析圖。實證見 `docs/rule-rationale/agent-self-verification.md` § 依賴變更只跑部分 suite。

## Hard rule

### NEVER

對下列場景**禁止**直接 handoff user（真需 user 親手做的，例如真機刷卡，標 `(deferred-user-only: <reason>)`；`flow` 的 decision source 與 work-loop ready count 讀這個標記）：

> **場景 1–3（缺 session cookie／缺 visual evidence／撞 baseline functional gap）的處置路徑全文在
> [[agent-self-verification.screenshot-evidence]] § NEVER — 禁止直接 handoff user 的三個
> verify-channel 場景**——**收任何 verify evidence 之前要先讀那一節**，此處不複述。

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

> **MUST 1 / 4 / 10 / 12 / 13 / 14 全文在 [[agent-self-verification.claim-cross-check]]**（path-scoped：碰 deploy config／auth 路徑／工具定義檔／`.claude/agents/**` 時載入）——派 subagent 前主線先自跑、呼叫外部 CLI 前驗 contract、部署宣稱三方交叉核對、帳號可用性五層、改工具定義前反查 source、daemon 存活對齊自己這條連線。**MUST 16**（登入態要用真瀏覽器斷言）在 [[agent-self-verification.screenshot-evidence]]。
>
> 下面留常駐的八條，觸發都是「任何一次下結論、任何一次跑診斷指令」——綁不到任何檔案，**不要下推**。

> **MUST 2 / 3 / 5 / 6 / 7 / 8 / 9 / 15 的全文在 [[agent-self-verification.screenshot-evidence]]**（缺號刻意，編號被跨 fleet 引用，不要重排）。
> **收任何 `verify:ui` / `review:ui` / `verify:e2e` evidence 之前、撞 baseline functional gap 時、收尾／archive／hand back user 之前要先讀那一份**；下表只是一句話契約。
>
> | MUST | 一句話契約（全文在該檔同名 §） |
> | --- | --- |
> | 2 | 撞 baseline functional gap → 走 [[main-self-collect-fallback-chain]] (a)(b)(c)(d) 四層，**全失敗**才寫 `deferred` |
> | 3 | `(deferred: ...)` annotation 要含逐層 (a)(b)(c)(d) failure trail，缺任一層就不是合格 annotation |
> | 5 | verify:ui / verify:e2e 的 fixture 要進 `seed.sql`，不要用 `curl POST` / `$fetch` / form submit 臨時建 ephemeral data 拍截圖 |
> | 6 | worktree 內要先 `grep -i '<VAR>' .env.local` 確認，不要假設缺失就寫 `blocked on <VAR>` |
> | 7 | capture 與 verification 要在同一個 operation round；驗證失敗 = 截圖作廢，修根因後重拍 |
> | 8 | `[review:ui]` 既有 `[x]` 無 agent 自拍 evidence 一律視為 **false-green**，要無視 checkbox 自拍自驗 |
> | 9 | commit 觸及 `.vue` / `.tsx` / `.jsx` / `.css` / `.scss` 後該 change **全部** UI 截圖視為 stale，要跑 `audit-screenshot-staleness.ts` 到 0 stale |
> | 15 | 收尾前要跑 `flow plan check-close <work_id>` 取得 exit 0，不要逐項查過就當齊全，不要為了變綠改 checkbox 或 feature 檔 |

11. **Negative search 不成立為證據（hard rule）**：下「零命中 / 不存在 / 只有 N 個」的結論前，要先用一個已知會命中的樣本驗過 pattern（known-positive control），並在結論裡寫出「此 pattern 對 `<已知樣本>` 命中」——寫不出來，零命中就不是證據。不要把「我 grep 過了」當成 absence 的證明：pattern 寫錯、資料形狀誤判、假設偷偷收窄範圍，輸出都是零命中。有 structured output（`--json` / `--format json`）時優先用它取代文字 grep；更前一步是先問「有沒有不需要數的判準」（例：gate 已設 `severity: CRITICAL,HIGH`，則輸出的每一條依定義都是 HIGH，根本不必數）。（per [[pitfall-narrow-grep-absence-treated-as-proof]]）

    **時間窗查詢**（`docker logs` / `docker events` / `journalctl` 的 `--since` / `--until`）裸 wall clock 以主機本地時區解讀。每次要：(a) 先用寬鬆窗撈一筆 known-positive control 再收窄；(b) 絕對時間帶時區後綴，寫不出就用相對時間（`--since 30m`）。（見 [[pitfall-docker-logs-absolute-time-parsed-as-host-local-timezone]]）

17. **診斷型指令不要串接後截斷（hard rule）**：判準是**失敗訊息會不會被截掉**，不是輸出長不長。publish / audit / gate / lock acquire 這類「失敗時我要讀原因」的指令，要全量落檔再挑著看，前置檢查與主指令分開跑。

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

18. **拿計數 / 探針當證據前要過三條前提（hard rule）**：MUST 11 管零命中，本條管**非零**的那一半——
    數字印出來、exit 0、量級合理，量的卻不是命題問的東西。**每一次**把數字寫進結論、`### 自驗`、
    TD entry 或 gate 判準之前都要過。

    - **(a) 搜尋路徑清單要不含互為 symlink 的目錄。** ripgrep / grep 依 inode 去重，計數靜默偏低
      且多次執行間漂移。可疑時分別量 A（合併）與子路徑 B、C，`B + C != A` 即為去重生效。
      （per [[pitfall-rg-symlink-target-dedup-undercounts]]）

    - **(b) 判定單位要與命題單位同級。** 命題問「幾**處**」時，`rg -l` / `comm` 這類以整個檔為
      單位的指令只能當粗篩，判準要用逐 occurrence 的 `rg -o` 或直接跑 test。

    - **(c) 探針寫進 `### 自驗` 之前要先跑一次 control**：餵一個已知非空的輸入確認印得出結果，
      再量預期為 0 的那一次；壞探針與真陰性同為 exit 0、stdout 空。不要憑記憶推論某 flag
      會不會被 shell wrapper 吃掉——改寫是形狀相依的。

    | 讀到自己在想 | 現實 |
    | --- | --- |
    | 「數字跑出來了，跟預期差不多」 | 差不多是對**你以為它在量什麼**而言；三條前提量的正是「它在量什麼」 |
    | 「同一條指令我跑過兩次，結果一樣」 | (a) 的漂移可以連續兩次相同；穩定不是正確 |
    | 「`rg -l` 比較快，先用它掃一遍」 | 當粗篩可以，寫進判準就是 (b)。粗篩結果不要直接當結論 |
    | 「探針回 0，正好符合我的判斷」 | 那正是 (c) 要擋的一格——符合預期的空輸出最不會被複驗 |

19. **拿 body 下結論前要先讀 final URL 與狀態碼（hard rule）**：curl 帶
    `-w '%{http_code} %{url_effective}'` 取回兩值先讀。`url_effective` 不是你請求的路徑時
    （被 auth 攔到登入頁即是），body 的 grep 與計數**零訊號**，不要當任何動作的前提，
    尤其 **NEVER** 當重跑 deploy、切 symlink、重啟服務的理由。全文見 [[TD-783]]。

20. **exit code／fatal 構成驗收結論時要取 run-evidence receipt（hard rule）**：只要一個命令的
    **exit code 或錯誤字串**是你宣告「過了／沒過」的依據——deploy、migrate、publish gate、typecheck、
    test run——就要經 `node vendor/scripts/run-evidence.ts -- <命令>` 取得 receipt
    （它先抓原始 bytes 再落檔，receipt 帶 `code`、`signal`、`timedOut` 與兩條 stream 的 sha256）。
    不要拿任何展示層過濾器摘要出來的「無錯誤」當證據。

    展示層 wrapper 不只省略還會替換（被測命令沒執行，卻印出像是命令錯誤的訊息與自己的 exit code），
    且對不同命令形狀表現不同，不要靠「上次用它沒問題」推論。沒有 hook 會攔這一條。
    MUST 17 管截斷、本條管替換。實證見 [[TD-1059]] 與 [[agent-self-verification.structural-and-exit-evidence]]。

21. **檢查的判讀要由檢查結果產生（hard rule）**：為警告或攔截寫驗證指令時，結論字串（「安全」「乾淨」
    「沒人在寫」）要只在檢查結果成立時才出現——讓非預期結果自己非零退出、擋下後續動作，或只印
    證據不印結論。不要在同一則指令裡寫一句無條件輸出的結論：它不依賴結果，那個檢查就沒有失敗路徑，
    而它印在證據下面，是讀者最後讀到的一行。

    ```bash
    # ❌ 結論寫死：上一行印出 ` M docs/tech-debt.md`，最後一行仍是 (empty=safe)，寫入照跑
    git status --porcelain docs/tech-debt.md; echo "(empty=safe)"; python3 - <<'EOF' …
    # ❌ 同形：`git status --porcelain` 不論 dirty 與否都回 0，接 `&&`／`||` 的結論一樣無條件
    git status --porcelain HANDOFF.md || echo "(clean)"
    # ✅ 非預期結果自己擋下寫入；git 本身失敗另有分支（空輸出不等於乾淨）
    st=$(git status --porcelain -- docs/tech-debt.md) || exit 2; [ -z "$st" ] || { echo "OCCUPIED: $st"; exit 1; }; python3 - <<'EOF' …
    ```

    把 `(empty=safe)` 換成更精確的措辭也沒用——問題不在措辭，換一句更準的話仍然無條件印出。
    同一則指令裡跑檢查沒有問題，問題是結論不依賴檢查。MUST 19 管通道回的是不是應用本身，本條管判讀；
    兩者修法不共用。實證見 [[TD-784]]。

22. **要 exit code 就 NEVER 讓那個指令進 pipeline（hard rule）**：`$?` 永遠是 pipeline **最後一段**
    的——`cmd | tail` 的 exit 屬於 tail、`cmd | grep` 的 exit 是「有沒有命中」不是「有沒有出錯」。
    讀任何指令的 exit code 之前要先答兩題：「這個 exit code 是**誰**的」「它的 `0` 是什麼意思」。
    不分指令種類、不分輸出長短：

    ```bash
    log=$(mktemp); cmd > "$log" 2>&1; echo "exit=$? log=$log"   # exit 是 cmd 自己的；log 不共用固定路徑
    ```

    `${PIPESTATUS[0]}` 是次選——它要求記得在**下一行立刻取**，比「不要進 pipeline」多一個失效點。
    本條是 MUST 17 的無限定版：17 管「失敗訊息會不會被截掉」，本條管「exit code 歸屬」，typecheck、
    `git push --dry-run`、稽核這類不在 17 射程內的載體一律由本條接。
    （per [[pitfall-pipeline-exit-code-attributed-to-wrong-command]]／[[TD-707]]）

23. **改動注入子行程環境變數時 MUST 帶該變數重跑測試（hard rule）**：判準是**環境的出生時間 vs
    改動的落地時間**——測試 env／fixture env 早於那行注入改動建立時，跑綠**不算數**。
    不要拿「測試的執行時間 vs 改動的落地時間」當判準——它永遠是「測試比較晚」，
    恆給安全的假答案。觸發判定：`git diff --cached | grep -E 'env:|process\.env\['` 或 diff 內
    出現往 child env 寫入的欄位 → 帶著該變數重跑受影響測試（`VAR=<值> node --test <affected>`）；
    不帶變數的綠燈與沒跑同義。（per [[pitfall-verifier-env-predates-the-change-it-verifies]]／[[TD-802]]）

## 派工前的主線預檢責任在 [[agent-self-verification.screenshot-evidence]]（具名時機 MUST-Read）

**派 subagent / pi / visual verifier 收 evidence 之前，要先讀
[[agent-self-verification.screenshot-evidence]] § 派工前的主線預檢責任**。Reviewer 的 model 選擇依 [[agent-routing]] 當前 Routing Table 與對應
adapter，**不要在本檔複寫該列的 model 選擇**；缺合格執行者時保持驗收未完成。
