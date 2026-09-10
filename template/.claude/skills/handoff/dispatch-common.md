# Dispatch 共用規約（`relay` / `fanout` / `next` 派工時共用）

`park` 不開任何 pane，**不走本檔**；它只做交接寫入，收工訊息用 § 5 的 **B**。

本檔是 [relay-steps.md](relay-steps.md) 與 [fanout-steps.md](fanout-steps.md) 的共用底座：preflight、durable thin brief 紀律、runtime cleanup、parent worktree lifecycle、收工訊息契約。兩支只寫各自差異，**NEVER** 在自己的檔內重述本檔內容。

## 0. Host operation contract

下文的 session inventory、file inspection、question、bounded execution、completion inspection 與 keepalive 都是**能力名稱**，不是要求每個 runtime 提供同名工具。執行前由 selected runtime adapter 綁定實際介面：

- session inventory：用當前對話與已載入 task carrier 記錄盤點；host 若提供工作清單工具可一併核對，不能假設每個 host 都有可信的 per-session inventory。
- file inspection／mutation：使用該 host 的檔案操作；adapter 必須列出實際可用的 read/write 或 `exec` route。
- 詢問操作：host 提供結構化提問工具時使用該工具；否則在對話中提問。需要回答的動作在答案前保持未執行。
- bounded execution／completion：使用 adapter 宣告的 host operation；缺少可驗證 background 或 completion surface 時，只阻擋依賴該 dispatch 的步驟並保留 durable work。
- keepalive：只有 host 有 verified keepalive operation 才執行；不可把 Claude 專用的 `ScheduleWakeup` 當成跨 runtime 必備。

Common text may retain literal tool names in incident evidence or protocol keys. Such names identify the original evidence; they do not override the selected adapter contract.

## 1. Preflight

依序確認：

```bash
command -v herdr
```

再判呼叫者在不在 Herdr pane：

| `HERDR_ENV` | 允許 | 拒絕 |
| --- | --- | --- |
| `= 1`（在 Herdr pane 內） | 全部：dispatch / relay / reclaim / complete / harvest | — |
| 空（Cursor、Codex、一般 shell） | create-only dispatch（`--cwd --label --prompt`／`--prompt-file`）**加上** harvest（`--coordinate`／`--coordinate-resume`）。可辨識 live runtime 時不帶 `--launcher`、原生繼承；辨識不到或 helper 不支援同 runtime 時 fail closed。只有 user 當次明確點名不同 runtime 才帶 `--launcher`。拓樸永遠是 Tab／workspace，**忽略** inherited `HERDR_PANE_ID` | `--relay` / `--reclaim` / `--complete` / `--continue` / `--recover-orphan` / `--parent-pane` → `not_in_herdr` |

**NEVER** 在 Cursor 裡 `export HERDR_ENV=1` 或假裝自己是 focused pane。那會讓 split／reclaim 打到使用者當下盯著的工作。

create-only 的成功 receipt 是 `dispatched`，**不是** `relay_dispatched`（沒有 predecessor pane 可交）。`command -v herdr` 失敗才 STOP；不得宣稱已交接或輸出「目前這裡收工」。identity-bound 在外部被拒時同樣不得輸出「目前這裡收工」。

### `CLADE_DISPATCH_ID` 分流（本 session 自己是不是被派出來的 child）

| `CLADE_DISPATCH_ID` | `relay` | `fanout` |
| --- | --- | --- |
| 空（main line session） | 照常 | 照常 |
| 非空（coordinated child） | 照常——helper 對 relay 開了 nested 缺口 | **STOP，改走 `relay`** |

`fanout` 的第一個動作是裸 dispatch，而 helper 對 coordinated child 的裸 dispatch 一律回 `nested_dispatch_refused`（`herdr-session-handoff.ts`，grep `status: 'nested_dispatch_refused'`；NEVER 在跨檔引用寫行號，用 grep 得到的唯一字串當錨點）。那道 guard 防的是**責任樹擴張**——一個還欠著 outcome 的 child 又生出更多工作。`relay` 是唯一缺口，因為它做的是相反的事：把位置橫向移交、自己站下來。

**NEVER** 為了讓 fanout 在 child 內跑起來而去取 `--recovery-token`：orphan recovery 的前提是 **parent 已死**，拿它繞過一道針對「parent 還活著」設計的 guard 是偽造前提。逐字反開脫：「反正 recovery token 拿得到」「這個 parent 大概也不會來收了」。

本 session 若持有尚未回報的 `--complete` 義務（它是被 dispatch 出來的 child，而 coordinator 還在等 outcome），**MUST 先回報 outcome 再 relay**，不得把未結的 handshake 一起丟給 successor。

> relay 開出來的 successor **不帶** `CLADE_DISPATCH_ID`（helper 刻意不注入 correlation env，見該檔 grep `TD-547` 的註解段），所以它是 main line、可以自由 fanout。被 fanout 派出去的 **worker 帶**該 env，因此 worker 只能 relay，不能再 fanout。

### `--cwd` 指向既存工作區時的佔用探測（fail closed）

上一節判「本 session 能不能派」，本節判「**目標能不能收**」。兩者互不替代。

**觸發 predicate**：`--cwd` 指向的目錄**不是本 session 建立的**，且已存在——典型是 `<repo>-wt/<slug>` linked worktree、或任何非空的既有 checkout。本 session 剛用 `/wt` 建出來的乾淨 worktree 不觸發。

命中就 **MUST 依序**跑三步，**任一步命中、或 ownership 判不出來 → NEVER 派，改走 [[concurrent-session-probe]] § 探測之後：協商**：

```bash
# (a) 耐久訊號 —— 唯一不受 process 時序影響的一步，NEVER 跳過
grep -nE '<該 worktree 的 slug>' <目標 repo>/HANDOFF.md   # ownership / parking / 「由某 session 持有」條目
ls <目標 repo>/.clade/claims/ 2>/dev/null                  # 活 claim
```

```bash
# (b) session 層 —— concurrent-session-probe 入口 A 三步，第 3 步無條件必跑
```

```bash
# (c) 檔案層新鮮度
git -C <該 worktree> status --porcelain     # 非空 = 有人正在寫
git -C <該 worktree> log -1 --format=%cr    # 最後一筆 commit 幾分鐘前？
```

**(a) 不可省，而且它排第一是有理由的**：(b) 與 (c) 都是 point-in-time 量測，對「兩個 item 之間什麼都不跑」的迴圈型 runner 有結構性 race（見 [[concurrent-session-probe]] 入口 A 第 3 步的盲區聲明）。HANDOFF 的 ownership 條目與 `.clade/claims/` 是**耐久**的——它們在 runner 睡覺時仍然存在。

**三步全空 ≠ 沒人在動。** 對非本 session 建立的既存工作區，三步全空只證明「此刻沒抓到」，預設仍是 **fail closed**：要嘛在目標 repo 的 HANDOFF 找到明確的「無人持有」記載，要嘛跑協商拿到對方的信號，兩者都沒有就 NEVER 派。

逐字反開脫（想到這些就是本節正要被違反）：

- 「HANDOFF 上面是有寫 ownership 不明，但那是上一輪的事了」
- 「`ps` 掃過沒東西，應該沒人在跑」
- 「worktree 是我們自己 repo 的，不會有外人」
- 「先派下去，撞到再說 —— 反正 worker 會 STOP」

最後一條特別要擋：worker 的 STOP 條款是**事故發生後**的損害控制，不是預防。2026-08-28 實測，撞上時 `package.json` / `pnpm-lock.yaml` 已經被兩邊併發寫過，混合 commit 已經 land，per-item bisect 已經失效——worker 停手停不掉已經發生的事。

## 2. 建 durable thin brief

1. 從當前對話與已載入 task carrier 記錄與對話脈絡盤點**本 session**未完成工作、已驗 evidence、失敗 gate、安全邊界與下一個 bounded action。
2. arg 後面帶了一句工作描述時，以該句作 brief 主題；沒帶才自行萃取主題。
3. brief 必須落在接手 pane 讀得到的 tracked repo 路徑，優先更新本 session 自己的 `tasks/<timestamp>-<slug>.md`；已存在足夠完整的 task／HANDOFF 條目時可直接引用，不重複建立。
4. brief 至少包含：repo 與 main checkout cwd、工作指針、目前狀態、已驗證 evidence、剩餘步驟、適用規約、安全／授權邊界、原 session 保留 runtime 的 ownership。
5. prompt 只指向 durable brief，並明寫「先讀 brief 與 repo 規約，再自行續跑；gate 失敗即停，不向原 session 輪詢」。
6. worker brief（`fanout` 的每一份）**MUST** 寫明：做完自己那段卻留下殘工時，把殘工另寫一份 durable
   brief，並用 `--complete success --followup-brief <absolute-path>` 帶回來——見 § 6。

6b. worker brief **MUST** 同時寫明相反的那一半：**那段工作就是整件 work 的最後一步、沒有殘工**時，
   收尾改帶 `--work-done --verification '<一句可查證的實跑摘要>'`。helper 已經支援這兩個旗標，
   缺的一直是「有人被告知要用它」——2026-08-28 實測整條脊椎的「已收」欄恆為 0，六態的終態從來
   沒有被按過，而每一個 worker 收尾時手上都握著按它所需的憑證。

   三條機械限制由 helper 自己擋，**NEVER** 在 brief 裡改寫它們：只接受 `--complete success`；
   `--verification` 缺或空就拒（[[flow-work-tracking]] § R1 的唯一 fail-closed 點）；與
   `--followup-brief` **互斥**——殘工與完成宣稱不能同時為真，而那份 followup brief 正是還有殘工
   的證據。

   **NEVER 讓 worker 預設帶 `--work-done`。** pane 回 `success` 說的是「這個 pane 做完了被派來做
   的事」，那是比「這件 work 完成了」**嚴格更小**的宣稱——一件 work 常橫跨數個 pane。自動升級等於
   替沒人做過的宣稱簽名。opt-in 明示是刻意的。

7. brief 的**範圍**依 [[agent-routing.dispatch-execution]] § 派多少 判定：與被派工作構成串行鏈的環，預設一起寫進同一份 brief。
   brief 裡出現「X 由主線處理」「不要做 X」這類句子時，**MUST** 能具名說出主線做 X 需要 worker 沒有的什麼；
   說不出來就刪掉那句、把 X 寫進 brief。

**NEVER** 把完整 transcript、token、cookie、credential 或與工作無關的 dirty state 塞進 brief。

## 3. 只走 canonical helper

唯一 transport 入口是 `vendor/scripts/herdr-session-handoff.ts`。**NEVER** 在 skill 內自行執行 `herdr workspace create`、`herdr tab create`、`herdr agent start` 或 `herdr agent prompt`——那會繞過 durable ownership、session correlation 與 pane 回收契約。

**每一次** dispatch **MUST** 帶任務描述性 `--label`：**三種 topology（split／tab／workspace）都命名 pane**，建 Tab／workspace 時額外命名該 Tab／workspace。**NEVER** 只給 repo 名或倚賴預設值——同一 repo 派出去的多個 session 在 UI 與 patrol 輸出裡會完全無法分辨，而 `fanout` 一次就派 N 個，這件事在 fanout 下不是不便而是致命。helper 缺 label 直接回 `usage_error`，不建立任何東西。

receipt 的 `pane_label_applied` **為 `false`，或這個欄位根本不存在**，兩者是同一格：都代表 pane 可能仍掛著預設標題，**MUST** 照實寫進收工訊息，並當場補 `node ~/offline/clade/vendor/scripts/herdr-visible-identity.ts --pane <pane-id> --label "<任務名稱>"`。**NEVER** 把欄位缺席讀成「這條路徑不適用」「這個 topology 不命名 pane」或「沒報就是沒問題」——實測 58 筆 dispatch record 裡 `false` 出現 0 次、欄位缺席 48 次，缺席正是這條契約唯一真正遇到的失敗形狀。

驗收與自查斷言 **MUST** 寫成「欄位存在且為 `true`」（`has("pane_label_applied") and .pane_label_applied == true`），**NEVER** 寫成 `!== false` / `!= false`——那會讓欄位缺席整批通過。

**判 receipt 時 MUST 讀 `pane_id` 的 workspace 前綴**（`wE:pG` 的 workspace 是 `wE`），**NEVER** 只看 label 就認定放對地方——label 對「pane 落在哪個 workspace」零訊號。

### 3.1 Launcher inherit（relay / fanout / 任何 identity-bound dispatch）

user **沒**點名別的 launcher 時，successor／worker MUST 用**當前這格實際在跑的 runtime**。helper 自己從 live process identity 重判：`cx → cx`、`cc → cc`、`ccw → ccw`、`ccg → ccg`、`ccagy → ccagy`、`grok → grok`。這是 handoff 的 runtime affinity hard rule：**agent-routing、工作類型、模型能力、成本與 repo 預設都無權覆蓋**。**NEVER** 沒點名就在 relay、fanout worker 或外部 create-only handoff 上帶 `--launcher`。

當前 runtime 無法辨識，或 helper 不支援建立同 runtime successor 時，**MUST fail closed**：保留 brief 與 pane、回報 blocker。**NEVER** fallback 到 `cc`／`ccw`，也 NEVER 把「至少派得出去」當成跨 runtime 的授權。

`cx` 是 native Codex launcher：selected runtime adapter 以 `CODEX_THREAD_ID` 或 live native-Codex evidence 判定，helper 以 `cx resume <fresh-id>` 建立 Codex successor。`PI_CODING_AGENT=true` 加非空 `PI_SESSION_ID` 代表 Pi runtime（launcher `pi`），不是 Codex；Pi successor 使用 `pi --session-id <fresh-id>`。兩者都走 exact-session ownership gate。

`ccx` 是退役例外：helper 仍辨識 live `ccx-*`，只為了回 `retired_launcher`，**NEVER** 再建立 ccx successor。需要 GPT／Codex successor 時可由 user 明示 `--launcher cx`；當前已是 cx 時不帶旗標即原生繼承。

`CLADE_CLAUDE_LAUNCHER` 是當初 dispatch 注入 pane 的相容 marker，`/clear` 之後同一格可能已換成別的 binary，marker 不會跟著改。**NEVER** 把它當 SoT。

| 可觀察 predicate | launcher |
| --- | --- |
| `PI_CODING_AGENT=true` 且 `PI_SESSION_ID` 非空 | `pi` |
| `CODEX_THREAD_ID` 非空或 live native-Codex evidence | `cx` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`（或 sonnet／haiku）以 `ccg-` 開頭，且 `ANTHROPIC_BASE_URL=http://127.0.0.1:8317` | `ccg` |
| 同上，prefix `ccagy-` | `ccagy` |
| 同上，prefix `ccx-` | `retired_launcher`，不建立 pane |
| 沒有 live runtime identity，才退到 `CLADE_CLAUDE_LAUNCHER` 或 `CLAUDE_CONFIG_DIR` | 退路，不是優先 |

**例外**（兩條 dispatch 入口，簽署身分不變）：

| 可觀察 predicate | 帶什麼 |
| --- | --- |
| user 白紙黑字點名另一個**仍支援的 successor launcher**（「successor 走 cx」「用 ccw 接手」） | `--relay --launcher <那個>` |
| user 白紙黑字點名另一個仍支援的 launcher，且這次是 create-only（「用 cx」） | create-only `--launcher <那個>` |

沒點名就不要帶 `--launcher`。user 說「handoff／relay／fanout」本身**不等於**授權換 runtime；必須在當次要求中明確點名目標 launcher。`--launcher` 只覆蓋 successor／child 的 binary 與相容 marker，**不改** current pane 的簽署身分——誰能簽 relay 仍由 `HERDR_ENV`、current pane、exact runtime session（Claude 或 Pi）驗證。`--launcher ccx` 一律回 `retired_launcher`；`cx`、`ccg` 維持完整支援。

`--reclaim` / `--complete` / `--continue` / `--adjudicate` / `--recover-orphan` / `--parent-pane` **NEVER** 帶 `--launcher`。

**Rationalization table**：

| 藉口 | 現實 |
| --- | --- |
| 「這格 `CLADE_CLAUDE_LAUNCHER=ccw`，relay 繼承它才對」 | 那是 W1 被派出來時注入的。當前若有 live Pi identity，繼承 marker 等於把 cx session 的工作交給 ccw |
| 「帶 `--launcher` 才能簽 relay／改了簽署身分」 | 簽署仍是 `HERDR_ENV` + current pane + exact runtime session。`--launcher` 只選 successor binary |
| 「沒點名，但我自己想把 cx successor 換成 ccw」 | live runtime 是 SoT；只有 user 明確點名另一個仍支援的 launcher 才覆蓋 |
| 「agent-routing 判這類工作更適合 cc／ccw」 | routing 可決定 bounded executor，不能改 handoff successor／worker 的 runtime affinity；要跨 runtime 必須由 user 當次明示 |
| 「當前 runtime 辨識不到，先 fallback 到 ccw 至少能接」 | 辨識失敗是 blocker，不是授權；handoff 必須 fail closed |

### 3.2 `<routing-model>` 的值域：`sonnet` NEVER 是其中之一

`--model` 走 [[agent-routing]] 查表，本節只關掉一個具名落點。

**判定落在「sonnet 等級」時，pane 不是它的 transport。** Herdr pane 的 model 值域是 Claude-only，所以每次判定算出「這件事只值 sonnet」，transport 就給不出更便宜的座位，欄位於是被填成 `sonnet` —— 2026-09-09 實測連續五筆全部這樣填，而且全部配 `--route manual`，因為沒有任何政策列產得出那個 model。helper 自 2026-09-10 起直接拒收（`refuseSonnetTier`，`usage_error`）。

| 你手上這件事 | MUST |
| --- | --- |
| fanout worker，判定是 sonnet 等級 | **不派 pane**。改走 `node ~/offline/clade/vendor/scripts/pi-dispatch.ts --model grok-xai --effort high --route claude-delegate-sub --tier-basis delegate-sub --workspace-access <readonly\|mutation> --brief <brief.md> --label <slug>`。它不佔 Tab，也不進 `--relay` 的 in-flight 轉移——§ 4 的比對 gate 只對得上 pane dispatch，pi worker 的 outcome 走 ledger |
| relay successor，判定「還是主線複雜度」 | `--model opus`。successor 接手的是整個主線位置，要 mutation 也要判斷，本來就不該降檔 |
| relay successor，判定「只值 sonnet 等級」 | **不要 relay**。那件事用上一列的 grok worker 派掉，本 session 自己留著。交出位置的前提是「有人要接手主線」，不是「有工作沒做完」 |
| 任何一格想填 `sonnet` | 回上表重判。**NEVER** 因為 helper 要求明確 `--model` 就在 Claude 值域裡挑一個 —— 那正是上述五筆的成因逐字 |

**relay successor NEVER 是 Pi seat**：`--launcher pi` 只在 predecessor 本身已是已驗證 Pi runtime 時成立（`herdr-session-handoff.ts` 的 relay-continuity）。Claude 主線 relay 給 grok 這條路不存在，所以上表第三列給的是「不要 relay」，**NEVER** 讀成「想辦法讓 pi 接 pane」。

## 4. Runtime cleanup

盤點**本 session 自己啟動**的每一個 background task、subagent、monitor、dev server 與 shell：

| 狀態 | 動作 |
| --- | --- |
| successor／worker 後續不需要 | 停止 |
| successor 仍需要 | 保留，逐一記錄用途與對應 pane |
| 由接手 pane 或其他 session 建立 | 不動 |

successor 繼承的是整個位置，所以「接手後仍需要」的範圍比直覺寬，**NEVER** 因為「我要收工了」就一律停掉。無法確認 ownership 時先保留並在 receipt 標明，不以猜測做破壞性 cleanup。

**本 pane 誰來關，依 receipt 分流 —— NEVER 無條件套用其中一條。**

| receipt | 本 pane 的歸宿 |
| --- | --- |
| `relay_dispatched`（Herdr 內交棒，**有** predecessor record） | **由 successor 回收，NEVER 自己關。** successor 讀完 brief、確認繼承後跑 `--reclaim <本 pane> --verified`，那一步同時把 scrollback 落盤存證。本 session 自己 close 就是拿 lifecycle 當 completion，也會毀掉那份 scrollback |
| `dispatched`（create-only，**無** predecessor record） | **MUST 自己收尾關閉。** 沒有任何人會來 reclaim 它 —— 這條路徑不寫 predecessor record（§ 5 的表逐字承認「NEVER 填本 pane id 或 predecessor（沒有）」），所以「等 successor 回收」在這裡等的是一個不存在的角色 |

**create-only 自關不毀證據**：scrollback 由 helper 落在 `~/.cache/clade/dispatch-log/<dispatch_id>.log`，
與 pane 是否存活無關。上一列那條「自己 close 會毀掉 scrollback」的理由**只對 relay 成立**
（那份存證是 `--reclaim` 那一步寫的），**NEVER** 把它外推到 create-only 來論證不該自關。

> 2026-08-28 實證：user 點名 `ccw` → 依 § 3.1 例外必須走 create-only → 本節原本的無條件措辭
> 讓來源 pane 在收工後繼續留著接收訊息，而規約同時禁止它自己關。**清理責任被指派給一個在該分支
> 上不存在的角色**，pane 因此無限期存活。user 逐字回報：「我希望收工就自己關掉，不要再留下來接收訊息」。

## 4.1 Parent worktree lifecycle

交出 session 位置**不**自動處置 parent cwd。若本 session 位於 linked worktree，MUST 實跑並記錄 `path`、`branch`、`dirty`、`merged_to_main`、`locked`：

| 狀態 | 動作 |
| --- | --- |
| workflow 明定 parked | 保留，receipt 寫 `retained: <owner + next landing event>` |
| 已登記批次、尚未正式落地 | 保留来源與佇列，successor 依 commit skill `batch.md` 接手；換 session 不強制結批 |
| 已登記批次且正式落地 | 主動跑 `wt-helper batch cleanup`；登記時的落地授權含安全回收，不重問 remove／retain，依結果逐來源記 removed／retained 原因 |
| clean + fully merged + 無 unique commit／WIP + 無 parking contract，且已有該 worktree 明確 remove 授權 | 移除 worktree 與 branch，receipt 寫 `removed` |
| 同上但無 remove 授權 | 用 host question operation 問 `remove`／`retain`；有 structured question surface 就用它，沒有就用目前對話；答案前停止收工訊息 |
| dirty、未 fully merged、ownership 不明 | fail closed 列 blocker，**NEVER** 用 `--force` 代替判斷 |

worktree 若 `retained`，brief **MUST** 已寫明它由 successor 接手——否則交出去的位置少了它的工作區。

helper receipt 中的 `retained: false` 只描述 child pane，**NEVER** 拿它代替 parent cwd 的 worktree lifecycle receipt。

## 5. 收工訊息契約

**四個 arg 全部收工。** 差別只在有沒有交出 pane：

### A. 有交出 pane（`relay` / `fanout` / `next` 派工後）

成功事件是 helper 回傳 **`relay_dispatched`**（Herdr 內交棒）或 **`dispatched`**（Cursor／外部 create-only 派出 pane）。**不是**「successor 完成了工作」，那不再是本 session 的事。

| 部件 | 契約 |
| --- | --- |
| 首行 | 內部 relay／fanout：逐字包含 `目前這裡收工；位置已交給 successor。` 外部 create-only：逐字包含 `目前這裡收工；已派出 successor pane。` |
| Relay receipt | 僅 `relay_dispatched`：successor workspace／tab／pane／runtime session、本 pane id、`predecessor_dispatch_id`、`relayed_dispatch_ids`（沒有就明寫「無」） |
| Dispatch receipt | 僅外部／bare `dispatched`：successor workspace／tab／pane／runtime session／`dispatch_id`。**NEVER** 填本 pane id 或 predecessor（沒有）。**MUST** 另註明本 pane 將自行關閉（§ 4 create-only 那列），**NEVER** 寫成「等 successor 回收」 |
| Worker receipt | **只有 `fanout`**：逐筆列 dispatch_id、label、pane、在做什麼 |
| 工作摘要 | durable brief 路徑與一句主題 |
| Runtime cleanup | 已停止項目；保留項目逐一寫用途與對應 pane。兩者皆空也明寫「無」 |
| Worktree lifecycle | `not-applicable`，或五欄實測 + `removed`／`retained: <owner + next landing event>` |
| user 本人要做的事 | 只列 successor 無法代做者；沒有就省略 |

### B. 沒有交出 pane（`park`，或 `next` 盤點後判定無事可派）

| 部件 | 契約 |
| --- | --- |
| 首行 | 收工判定 ＋ 觸發的門檻。一句 |
| 落點 | 未完項登記在哪：`<檔路徑>` ＋ 條目。**NEVER** 只寫「已記全」——那是**你**知道的事實，不是 user 拿得到的東西 |
| Worktree lifecycle | 同上 |
| user 本人要做的事 | 只列 user 非做不可的（回答問題、permission、credentials、GUI／產品決策），逐條一句。沒有就整段不出現 |

### 兩者共通

完成訊息送出後，本 session 的下一個動作**只能是結束回合**。**NEVER** 追加建議、再跑 tool、續推 brief 裡的工作、輪詢任何接手 pane、或等它回應。逐字反開脫：「反正還沒關掉，順手做完」「等它讀完 brief 我再確認一下」。

`relay_refused`／`transport_error`／任何 preflight failure **NEVER** 輸出「目前這裡收工」。

## 6. worker 回報 success 時還有殘工

`success` 是唯一會**關掉** worker pane 的 outcome。因此只寫在 summary 散文或 pane scrollback 裡的殘工，
在收割那一刻就消失了——而它同時也是最容易發生的情況：worker 做完自己那段，順手發現一件它不該做
或做不完的事。

**worker 側（MUST）**：把殘工寫成 durable brief（tracked repo 路徑，至少含工作指針、已驗證 evidence、
剩餘步驟、檔案所有權），再帶進 completion：

```bash
node <clade-central-repo>/vendor/scripts/herdr-session-handoff.ts \
  --complete success --summary '<已完成與驗證>' --followup-brief <absolute-brief-path>
```

**那份 brief 的首段 MUST 逐字帶上這一句**（TD-908）：

> 本 brief 是**工作指令**，不是待辦盤點。`\nx` / `\my` / 收工判定不適用於剛被派出的 pane——
> 即使 brief 讀起來像「已完成 ＋ 剩餘」清單也一樣。MUST 先把 brief 的每一項實際做完再回報。

殘工 brief 天生長成「已完成 ＋ 剩餘」兩段——那正是收工盤點的形狀，所以下一棒會把它讀成一題
「現在該做什麼」而不是一份工作指令，然後零工作就把上一棒的 summary 原樣回報成 success
（<consumer-a> 2026-09-03 同一輪兩次命中）。dispatch 時 helper 會在 prompt 最前面注入同一句，但
**brief 檔本身也要有**：它會被獨立讀（relay successor 逐字帶路徑、收割者自己開檔看），
那些場合沒有 helper 的注入。

helper 對這個欄位是 fail-closed 的：非絕對路徑、檔案不存在、不是普通檔、空檔、或搭配 `success`
以外的 outcome，一律 `usage_error` 而**不**寫任何 durable state。它在 `success` 的 `summary` 與
`followup_brief` **逐字等於同 parent 上一筆 completion** 時也會拒收（`completion_refused`，
`reason: duplicate-of <dispatch-id>`）——那是上面那個誤讀的機械兜底，撞到它代表這一棒還沒說出
自己做了什麼。它也與 `--successor-receipt` 互斥——
已經有 live successor 接手時，那份殘工已經有主人了。

**NEVER** 自己 fanout 去派那一跳（helper 回 `nested_dispatch_refused`）。**NEVER** 因為「順手做完比較快」
就自行續推殘工——那正是 worker scope 要擋的事。

**收割者側（MUST）**：`completion_success` receipt 的 `followup_brief` 非空 = 手上多了一件已具名、
已落檔、**還沒有人接**的工作：

| 收割者狀態 | 動作 |
| --- | --- |
| context 還撐得住，且該殘工本 session 合法做得完 | 直接照那份 brief 做完 |
| context 還撐得住，但殘工與手上的工作可平行 | `/handoff fanout` 把它派成一個 worker |
| 收割者自己也撞到 [[session-tasks]] § Session context 預算 的收工線 | `relay`／`fanout` 交棒，successor brief **MUST** 逐字帶上那個 `followup_brief` 路徑 |

**NEVER 把 `followup_brief` 讀完就當作已經處理**——它是一份還沒有人做的工作，不是一份回報。
**NEVER 因為「worker 回的是 success」就認定這條 dispatch 已經結案**：`success` 說的是 worker 那一段
做完了，`followup_brief` 說的是它旁邊還有一段沒人接。逐字反開脫：「它回 success 了，那就是好了」
「殘工我記在收工訊息裡就行」「下一個 session 讀 HANDOFF 自然會看到」。

**收割者自身耗盡 context 不是這條的終端狀態。** 這條的終端狀態只有兩種：那份 brief 的工作**已完成**，
或它**已經在另一個 live session 手上**（fanout worker／relay successor，且路徑已寫進對方的 brief）。
一個已收工 session 手上的 `followup_brief` 路徑既不是前者也不是後者，**NEVER** 拿它當收斂——
收工訊息不是 dispatch。
