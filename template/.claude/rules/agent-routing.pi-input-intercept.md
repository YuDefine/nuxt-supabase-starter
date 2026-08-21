---
description: Codex 模型經 Pi machine dispatch 提出問題時的攔截、評估、代答或升級 protocol；觸及 spectra change / screenshot 情境時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', 'scripts/spectra-advanced/**', '.claude/agents/**', 'screenshots/**/progress.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.pi-input-intercept.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Agent Routing — Codex Input Intercept Protocol

## 核心命題

Pi machine dispatch 使用ephemeral `--no-session` JSON mode，沒有Codex CLI `exec resume`語意。Codex模型需要釐清時，prompt要求它在final response輸出`## Question`；主線收割dispatcher結果後先判斷能否代答，再把「原brief＋已確認答案」組成一份新brief重新dispatch。

**主線 Claude 是攔截層**：答案可由既有證據直接推導就代答；需要產品、業務、架構或風險拍板才升級給user。重派是新的Pi session，routing metadata與`--retry-of`仍完整落ledger。

## Prompt附加段（每一個寫code派工 MUST加）

```markdown
## Asking Questions（MUST）

遇到以下情況，直接在final response提出問題，不要猜測或做假設：

- 需求或spec有歧義，無法從context判斷正確做法
- 需要在兩個以上合理方案之間選擇，且沒有明確偏好訊號
- 缺少必要資訊（API契約、database schema、業務規則）
- brief預期行為與現有code矛盾

提問格式：final response最後輸出`## Question`，每個問題一行。提出問題的這一輪不要做不可逆動作，也不要自行選一案硬做。
```

## 問題偵測（每一次terminal收割 MUST執行）

dispatcher stdout是單一JSON。依序讀：

1. `result`：成功且可解析的business payload。
2. `error`＋`lastMessagePath`：exit 3但Pi已有assistant final text時，讀該檔判斷是否為問題；**NEVER**只看exit 3就當機械故障。
3. final text命中任一條件即視為問題：
   - 含`## Question`section。
   - 以問號結尾，且該輪沒有成功結果或檔案變更證據。

沒有問題才按exit code正常分流。安全網control turn只檢查task狀態，**NEVER**提前讀output tail；terminal notification到達並claim task後才做本節判讀。

## 能否代答

### 可代答

答案可直接引用以下任一來源，且不存在合理第二解：

- 原brief已提供但model漏讀的資訊。
- `rules/core/`或consumer `.claude/rules/`的明確規約。
- 現有code、config、schema的可驗事實。
- 上游官方文件的明確定義。

### 必須升級

- 產品或業務行為選擇。
- 架構方向或真實trade-off。
- 資安、合規、費用或資料風險決策。
- 主線自己也不確定的技術判斷。
- brief與現有code矛盾，且無法證明哪邊是SoT。

灰色地帶升級。代答門檻是答案可附一條可重讀的證據來源，不是「主線覺得大概如此」。

## 重派契約

1. 建立`/tmp/codex-<topic>-<slug>-qa-log.md`，記錄question、answer、source與auto/escalated。
2. 產生新的brief：完整保留原brief，在末尾追加`## Confirmed Answers`，逐題列question、answer與source。
3. 用原model／effort／cwd／route／tier-basis重跑dispatcher，label使用新值並帶`--retry-of <prior-label>`。
4. 新dispatch啟動新的Watch Protocol cycle；回來後重新做問題偵測。
5. 同一工作連續重派3次仍在問，第4次強制升級user；這代表brief或前置資訊仍不完整。

```bash
node ~/offline/clade/vendor/scripts/codex-dispatch.ts \
  --brief /tmp/codex-<topic>-<slug>-answered-<N>.md \
  --cwd <cwd> \
  --label <new-label> \
  --model <sol|luna> --effort <level> \
  --route <same-route> --tier-basis <same-basis> \
  [--table-row <same-row>] \
  --retry-of <prior-label>
```

## 升級給user

用`AskUserQuestion`呈現已消化的問題與2–4個排序選項；每個選項一句「這樣做會怎樣」。若問題要填值而不是選案，明說要填哪些值。收到答案後寫入Q&A log，再走重派契約。

## Q&A Log

```markdown
## Codex Input Intercept Log — <topic>-<slug>

### Q1 (auto-responded)
- **Dispatch**: <prior-label>
- **Question**: <question>
- **Answer**: <answer>
- **Source**: brief / rule:<name> / codebase:<path> / official-doc:<url>

### Q2 (escalated to user)
- **Dispatch**: <prior-label>
- **Question**: <question>
- **Answer**: <user answer>
- **Reason for escalation**: <reason>
```

Log讓代答可審計，也讓問題密度成為brief品質訊號。

## 例外

| 場景 | 處理 |
| --- | --- |
| `codex-review-safe.sh` | 問問題代表review prompt或snapshot不足；修prompt後重新跑wrapper，不走coding dispatcher。 |
| WebSearch routing | 問題罕見；補足查詢條件後以新label重派。 |
| Runtime quota | exit 4不是input intercept；依quota fallback紀律處理。 |
| Pi spawn／protocol故障且無assistant text | exit 3機械故障；不要捏造問題或答案。 |
