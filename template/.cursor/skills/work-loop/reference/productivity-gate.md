<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 准入與生產性：算法、邊界案例、反 Goodhart 防線

> 主檔 pointer：Step 0 § 開場准入判定 與 Step 6.3 § 生產性判定。**判準在主檔，本檔是論證與
> 邊界案例**——執行時不必讀本檔，**改判準之前 MUST 讀**。

## 為什麼要這兩道（實測，不是推測）

`scripts/usage-report.ts` 的歸因區段實測 2026-08-10～13 三天：**loop-unattended 38.0% ＋
loop-interactive 8.0% ＝ 46.0%** 的配額落在 work-loop，而同期 clade 是 **round 78 : completed 28**
（每個完成項平均 2.8 輪，且 completed 多為 rotate / 下推這類內務）。實質產出（交付＋清算）29.5%、
治理內務 48.0%。

原樣可重跑（**務必 `--out`，RTK 會截斷 stdout**）：

```bash
node scripts/usage-report.ts --days 3 --out /tmp/r.md
```

**兩軸正交，缺一不可**：`fingerprintUnchangedRounds` 抓**空轉**（狀態沒變）；6.3 抓**翻攪**
（狀態變了但債沒減）。rotate 一條 TD 會改 fingerprint（slug 消失）——那正是 78:28 的洞。

## 准入

**`debtReady` 的四類定義** 是 `vendor/scripts/work-loop-ready-count.ts` 的檔頭註解（script 即
文件，可變事實不在此 inline）。三件事在那份裡是逐字寫死的：`ready` 與 `debtReady` 是兩個讀數、
內務類 signal 明確排除、`deadSection` 恆 0 是刻意的低估。

三條 NEVER 的依據：

| NEVER | 依據 |
| --- | --- |
| 為了讓 `debtReady >= 1` 而登記新 TD | 量測輪自己製造彈藥＝「量測 → 登記 → 下輪再讀」自循環。2026-08-13 實測近 7 天 opened 40 / closed 10 |
| 用「掃一輪看看」繞過本節 | scan ＋ 分類 ＋ guardrails re-read 是一輪最先燒掉的固定成本，對不准入的輪它的產出完全用不到——與 headroom 判定同型的理由 |
| 不准入時排長間隔 wakeup | wakeup 保留 process 且每醒必付 re-hydrate ＋ guardrails re-read；「時間到就醒」正是 38% 的來源。退出把「再起」交還外部 signal，下次由 runner 既有的 `--min-ready` gate 先擋一次 |

**`no-admissible-work` 走 `stoppedReason` 不是 `roundEndReason`**：它說的是「整個 loop 現在沒有
可推進的債」，不是「這個 process 滿了」。寫成後者會讓 runner 起下一個 process 再判一次同樣的 0。

## P1 的 entropy 過濾（完整算法）

Tier A = `HANDOFF.md`、`tasks/*.md`、`docs/tech-debt.md`。本輪 `git diff <round-start-sha>..HEAD`：

1. 取 Tier A 的移除行集合 `R`、以及 `docs/archives/**` / `*-bodies.md` / `docs/pitfalls/**` 的
   新增行集合 `A`
2. `r ∈ R` 若滿足下列任一，判定為**搬運**而非減量：與某個 `a ∈ A` 含相同 `TD-\d+` id；或與某個
   `a ∈ A` 行級相似度 ≥70%（token 集合的 Jaccard，或等價的行級 diff ratio）
3. Tier A 淨變化 = （總移除行數 − 搬運行數）× (−1) ＋ 新增行數。**過濾後仍 <0 才算 P1 成立**

**改寫語句躲 fuzzy match 的「勤勞搬運」不必在這裡防死**：條目沒關，駐留天數照算、fleet 稽核照紅，
第二軸（`fingerprintUnchangedRounds`）與 TD aging 會接手。**NEVER** 為了堵這個把門檻調到 ≥90%
——那會把正常的 rotate（本來就會微調格式）誤判成減量，方向反了。

## P1–P4 的邊界案例

| 情境 | 判定 | 為什麼 |
| --- | --- | --- |
| rotate 3 條 TD 進 archive，一條都沒關 | **非生產** | entropy 過濾把減量全部歸零，P1 不成立；沒有交付物、沒關 TD、沒 packaging |
| 把一條 TD 的 `**Status**:` 改成 `done`，無 `### 自驗` 實跑輸出、無 `decisions` 條目、無 wontfix 理由 | **非生產** | P3 憑證三選一皆缺 → **不計 P3，也不計 P1**（那是改標籤不是關閉） |
| 就地把一條 TD 關對（Status token 轉 closed-class ＋ 補 `### 自驗` 實跑輸出），主檔行數因 evidence 落盤淨增 | **生產** | P3 成立。P3 不看 heading 是否消失——rotate 由 `closedBloatThreshold` 批次化，關閉那一輪本來就不會有 heading 消失。P1 在此輪不成立（淨增），但 P1–P4 是 OR，不需要 P1 接住 |
| 上一項那條 TD 於數輪後 rotate 進 archive | **非生產**（就這條而言） | 同一條 TD 只在轉 closed-class 那一輪計一次 P3；rotate 是搬運，由 entropy 過濾在 P1 側歸零 |
| 一輪 package 三條決策 | 生產（**只計一次**） | P4 單輪至多貢獻一次；三條 packaging 不等於三輪份的生產 |
| 純收割輪：`inFlight` 的 agent 回報，改動落在 `vendor/` 並過了 scope-verify | 生產 | P2 成立 |
| 只改 `.clade/**`（state、scan 產物） | **非生產** | P2 明確排除 `.clade/`——那是 loop 自己的 bookkeeping，不是交付 |
| 修好一條 audit red，改動落在 `scripts/` | 生產 | P2 成立 |
| 本輪只做 Step 2.7 清算（attended，答完 2 題） | 看有沒有落地 | 答案落 `decisions` 且據以關掉 TD → P3；只答不做 → 非生產（合法的過渡輪，N=2 才停） |

## P3 的 status token 對照（SoT 在 audit script，本表只是導引）

`scripts/audit-tech-debt-hygiene.ts` 的 `statusToken()` 取 `**Status**:` 行的第一個 token，分類由 `STRICT_DONE_RE` / `SOFT_CLOSE_RE` 決定：

| class | token | 常見完整寫法 |
| --- | --- | --- |
| open | `open` / `pending` / `landed` / `blocked` | `open`、`landed-pending-verification`、`blocked-attended-only` |
| closed | `done` / `resolved` / `wontfix` / `deferred` / `mitigated` / `closed` | `done`、`wontfix-until-signal`、`deferred（conditional …）` |

⚠️ `deferred` 與 `wontfix-until-signal` 在 token 層都是 **closed-class** —— 它們仍可能被解凍，但解凍走的是「重新開一條或改回 open」，那一輪的 P3 由該次轉換自己成立，**NEVER** 追溯扣掉先前那次。

**NEVER** 在本檔或 SKILL.md 複製一份 token 清單當判準來源——改了 audit script 卻沒改這裡時，兩份會無聲分歧。本表過期就刪，不要修。

## 為什麼 N=2

與既有 `consecutiveDispatchFailures >= 2`、runner 的「state 連續 2 輪未前進」同構。單一非生產輪
有正當型態（等 notification 的過渡輪、純清算輪），不是噪音就殺會誤傷；連 2 輪已是模式。

停止代價極低——ready gate 一過就能再起；而 N=3 會多放一整輪（unattended 一輪 ≈ 數十 M token）
換不到任何診斷資訊。**NEVER** 因為「這輪快有結果了」自行放寬到 3。

## 與軟配額的關係是包含，不是並列

軟配額（Step 6.2：`landed` 桶非空時，本輪 5 items 至少 1 項 close/verify）不足額的輪，
「不算合法進度」＝ P1–P4 的**計入資格直接取消**，該輪**必為**非生產輪。反向不成立——軟配額
滿足不保證生產（三條都 close 但全是 rotate，P1 仍被 entropy 過濾掉）。

兩條 NEVER 矛盾時**嚴者恆贏**：軟配額是輪內 item 組成的 necessary 條件，生產性是輪整體的
verdict。**NEVER** 拿「軟配額已滿足」論證本輪必為生產輪。

## 反 Goodhart 邊界（這是停止條件，不是目標）

**不衝突的邊界在「方向」**：反 Goodhart 條款禁止把 burn-down 當**最大化目標**（objective）；
6.3 是**停止條件**（fail-safe）。game 一個 objective 的獎勵是「看起來更好」；game 這個停止條件
的獎勵只有「繼續跑」——而繼續跑本身不發任何獎勵，輪次數不是任何 metric 的分子。

**配套硬約束**：runner 注入的 prompt 與 SKILL 全文 **NEVER 出現「本輪目標是讓 ΔTier A < 0」型
措辭**——目標永遠是各 item 自己的驗收 predicate。看到自己在為了讓某個計數下降而挑 item，那已經
是違反。

| Game 法 | 機械防線 |
| --- | --- |
| **假關 TD**（改 Status 標籤無憑證刷 P3） | P3 憑證三選一缺任一 = 不計 P3 **也不計 P1**；`audit-tech-debt-hygiene` 對「條目已關 ∧ 無憑證」出 red——它會回頭把下一輪 `debtReady` 撐起來，game 的淨效果是給自己造工作 |
| **熵搬運偽裝 P1**（rotate 進 archive 刷減量） | entropy 過濾寫在 P1 判定內；改寫語句躲 fuzzy match 的「勤勞搬運」由第二軸接手——條目沒關，駐留天數照算，fleet 稽核照紅 |
| **灌水 packaging 刷 P4** | P4 單輪至多計一次；packaged 條目 MUST 過自主判定七條 AND 的「非自主」證明；`awaiting[]` 是 Charles 親眼看的佇列，垃圾題有立即且不可迴避的社會成本 |
| **把檔案移出 Tier A 量測清單** | 清單寫死在 script、script 在 `vendor/scripts/` ＝ 標準層，改它走 attended publish gate |

## Step 4b 出口分流的兩條設計理由

**dispatch 是 default，登記是付費 fallback**：Restart brief 的內容（檔案路徑、指令、驗收
predicate、已排除方案）就是 thin brief 的內容——寫得出來的當下 dispatch 幾乎恆優於登記，因為
登記多付一次「下一個 session 重新讀懂現場」的成本。`audit-tech-debt-hygiene` 的
`restart-brief-missing` 讓這個代價變成機械可查的，而**不是**讓登記變得更難：它只對本規約生效日
之後新開的 TD 生效，存量不回溯。

**`wontfix-until-signal` 那格 MUST 寫得出可觀察 signal predicate**——寫不出來就不准用該格。
那是等待區，不是掩埋場；沒有 predicate 的等待與放棄事後不可區分。
