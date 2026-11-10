# 派工 helper 與 launcher（`relay`／`fanout`／`next` 派工共用）

> 自 [派工共用底座判準.md](派工共用底座判準.md) 同批逐字搬出；章節編號 § 3／3.1／3.2 保留為穩定 ID。
>
> **過渡期（拆分 1/2）**：本檔尚未接線，runtime 仍只讀 [派工共用底座判準.md](派工共用底座判準.md)，它是唯一 SoT。本檔內容由 `test/handoff-dispatch-common-split-sync.test.ts` 釘成與舊檔對應段逐字一致（只容許跨檔連結改寫）；改判準 MUST 先改舊檔再同步本檔。拆分 2/2 切換 SKILL.md／relay／fanout 引用、搬 `registry/rule-invariants.json` 並刪舊檔。

## 3. 只走 canonical helper

唯一 transport 入口是 `vendor/scripts/herdr-session-handoff.ts`。**NEVER** 在 skill 內自行執行 `herdr workspace create`、`herdr tab create`、`herdr agent start` 或 `herdr agent prompt`——那會繞過 durable ownership、session correlation 與 pane 回收契約。

**每一次** dispatch **MUST** 帶任務描述性 `--label`：**三種 topology（split／tab／workspace）都命名 pane**，建 Tab／workspace 時額外命名該 Tab／workspace。**NEVER** 只給 repo 名或倚賴預設值——同一 repo 派出去的多個 session 在 UI 與 patrol 輸出裡會完全無法分辨，而 `fanout` 一次就派 N 個，這件事在 fanout 下不是不便而是致命。helper 缺 label 直接回 `usage_error`，不建立任何東西。

receipt 的 `pane_label_applied` **為 `false`，或這個欄位根本不存在**，兩者是同一格：都代表 pane 可能仍掛著預設標題，**MUST** 照實寫進收工訊息，並當場補 `node ~/offline/clade/vendor/scripts/herdr-visible-identity.ts --pane <pane-id> --label "<任務名稱>"`。**NEVER** 把欄位缺席讀成「這條路徑不適用」「這個 topology 不命名 pane」或「沒報就是沒問題」——實測 58 筆 dispatch record 裡 `false` 出現 0 次、欄位缺席 48 次，缺席正是這條契約唯一真正遇到的失敗形狀。

驗收與自查斷言 **MUST** 寫成「欄位存在且為 `true`」（`has("pane_label_applied") and .pane_label_applied == true`），**NEVER** 寫成 `!== false` / `!= false`——那會讓欄位缺席整批通過。

**判 receipt 時 MUST 讀 `pane_id` 的 workspace 前綴**（`wE:pG` 的 workspace 是 `wE`），**NEVER** 只看 label 就認定放對地方——label 對「pane 落在哪個 workspace」零訊號。

### 3.1 Launcher inherit（relay / fanout / 任何 identity-bound dispatch）

user **沒**點名別的 launcher 時，successor／worker MUST 用**當前這格實際在跑的 runtime**。進入本 Herdr 分支的 helper 從 live process identity 重判：`cc → cc`、`ccN → ccN`（`grok` 2026-10-21 退場）；Pi 只依下方 continuity 契約。這是 handoff 的 runtime affinity hard rule：**agent-routing、工作類型、模型能力、成本與 repo 預設都無權覆蓋**。**NEVER** 沒點名就在 relay、fanout worker 或外部 create-only handoff 上帶 `--launcher`。

當前 runtime 無法辨識，或 helper 不支援建立同 runtime successor 時，**MUST fail closed**：保留 brief 與 pane、回報 blocker。**NEVER** fallback 到 `cc`／`ccN`，也 NEVER 把「至少派得出去」當成跨 runtime 的授權。

`PI_CODING_AGENT=true` 加非空 `PI_SESSION_ID` 代表 Pi runtime（launcher `pi`）；Pi successor 使用 `pi --session-id <fresh-id>` 並走 exact-session ownership gate。

gateway launcher（`ccg`／`ccx`）已從 clade 拆除（2026-09-29）：`ANTHROPIC_BASE_URL` 指向本機 proxy（`http://127.0.0.1:8317`）的 session helper 判為無法辨識、fail closed（`unsupported_launcher`），**NEVER** 建立 gateway successor；`--launcher ccg|ccx` 回 `usage_error`。

`CLADE_CLAUDE_LAUNCHER` 是當初 dispatch 注入 pane 的相容 marker，`/clear` 之後同一格可能已換成別的 binary，marker 不會跟著改。**NEVER** 把它當 SoT。

| 可觀察 predicate | launcher |
| --- | --- |
| `PI_CODING_AGENT=true` 且 `PI_SESSION_ID` 非空 | `pi` |
| `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`（已拆除的 gateway） | 無法辨識，`unsupported_launcher`，不建立 pane |
| 沒有 live runtime identity，才退到 `CLADE_CLAUDE_LAUNCHER` 或 `CLAUDE_CONFIG_DIR` | 退路，不是優先 |

**例外**（兩條 dispatch 入口，簽署身分不變）：

| 可觀察 predicate | 帶什麼 |
| --- | --- |
| user 白紙黑字點名另一個**仍支援的 Herdr successor launcher**（例如「用 cc2 接手」） | `--relay --launcher <那個>` |
| user 白紙黑字點名另一個仍支援的 Herdr launcher，且這次是 create-only | create-only `--launcher <那個>` |

沒點名就不要帶 `--launcher`。user 說「handoff／relay／fanout」本身**不等於**授權換 runtime；必須在當次要求中明確點名目標 launcher。`--launcher` 只覆蓋 successor／child 的 binary 與相容 marker，**不改** current pane 的簽署身分——誰能簽 relay 仍由 `HERDR_ENV`、current pane、exact runtime session 驗證。`--launcher ccg|ccx` 一律回 `usage_error`。

`--reclaim` / `--complete` / `--continue` / `--adjudicate` / `--recover-orphan` / `--coordinate-claim` / `--parent-pane` **NEVER** 帶 `--launcher`。

**Rationalization table**：

| 藉口 | 現實 |
| --- | --- |
| 「這格 `CLADE_CLAUDE_LAUNCHER=cc2`，relay 繼承它才對」 | 那是 W1 被派出來時注入的。當前若有 live Pi identity，繼承 marker 會把目前工作交錯 runtime |
| 「帶 `--launcher` 才能簽 relay／改了簽署身分」 | 簽署仍是 `HERDR_ENV` + current pane + exact runtime session。`--launcher` 只選 successor binary |
| 「agent-routing 判這類工作更適合 cc／ccN」 | routing 可決定 bounded executor，不能改 handoff successor／worker 的 runtime affinity；要跨 runtime 必須由 user 當次明示 |
| 「當前 runtime 辨識不到，先 fallback 到 cc2 至少能接」 | 辨識失敗是 blocker，不是授權；handoff 必須 fail closed |

### 3.2 `<routing-model>` 的值域：`sonnet`／`fable`／`haiku` NEVER 是其中之一

`--model` 走 [[agent-routing]] 查表，本節只關掉一個具名落點。

**判定落在「sonnet 等級」時，那件事屬於 delegate-sub，不是 Herdr pane 的 `sonnet`。** 每次判定算出「這件事只值 sonnet」欄位就被填成 `sonnet` —— 2026-09-09 實測連續五筆全部這樣填，而且全部配 `--route manual`，因為沒有任何政策列產得出那個 model。helper 自 2026-09-10 起直接拒收（`refuseRetiredClaudeTier`，`usage_error`；2026-09-24 起 Fable／Haiku 也一併拒收）。

**delegate-sub 的載體（2026-10-21 起）**：xAI 退訂（Charles 2026-10-06）後 Grok 的兩條 transport——Herdr `--launcher grok` 與 Pi `--model grok-xai`——都已退場（helper 對 `--launcher grok` 回 `usage_error`、dispatcher 對 `grok-xai` exit 1），`DELEGATE_SUB_CHAIN` 為空，鏈尾即首跳（[[agent-routing.routing-table]] § delegate-sub）：

| 你手上這件事 | MUST |
| --- | --- |
| 判定是 sonnet 等級、要改檔 | in-process `Agent({ subagent_type: 'sonnet-implementer' })`，brief 帶一行 `routing-row: delegate-sub`（Claude Sonnet 5.5（effort: high），frontmatter 釘死） |
| 判定是 sonnet 等級、唯讀 | in-process `Agent({ subagent_type: 'dispatch-fallback' })`（Claude Opus 5.5（effort: low），frontmatter 釘死） |
| relay successor，判定「還是主線複雜度」 | `--model opus`。successor 接手的是整個主線位置，要 mutation 也要判斷，本來就不該降檔 |
| relay successor，判定「只值 sonnet 等級」 | 不交出位置：本 session 留著，把那件事照上兩列 in-process 派掉。交出位置的前提仍是「有人要接手主線」，不是「有工作沒做完」 |
| 任何一格想填 `sonnet` | 回上表重判。**NEVER** 因為 helper 要求明確 `--model` 就在 Claude 值域裡挑一個 —— 那正是上述五筆的成因逐字 |

**relay successor NEVER 是 Pi seat**：`--launcher pi` 只在 predecessor 本身已是已驗證 Pi runtime 時成立（`herdr-session-handoff.ts` 的 relay-continuity）。
