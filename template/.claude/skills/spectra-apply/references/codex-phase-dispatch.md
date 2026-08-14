<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-apply — Step 6b C 類 phase codex 派工

> 本檔是 `spectra-apply/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 6b — C 類 phase dispatch：classifier、prescan、implementation、watch、checks

### 1. 封閉本 phase 的輸入

從 `tasks.md`、change artifacts 與 Step 6a 的 classifier JSON 產生：

- `CONSUMER_SLUG`：`basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`，在 main／worktree 都解析成同一 consumer 名。
- `CHANGE_NAME`：change slug。
- `PHASE_NUMBER` / `PHASE_TITLE`：`## N. <title>`。
- `PHASE_TASKS`：本 phase 每個 task 的編號＋逐字描述，保留換行。
- `ALLOWED_PATHS`：每個 task 的預期寫入 path，一行一個；另含本 change `tasks.md` 與 `.spectra/touched/<change>.json`。
- `GIT_BASELINE`：dispatch 前 `git status --short` 中已知既有變更；乾淨時填 `(clean)`。
- `GATE_COMMANDS`：consumer `.claude/rules/local/verify-commands.md` 定義的 L0–L2 exact commands，一行一個。
- `PHASE_EXECUTION`：classifier `phases[]` 中 `n === PHASE_NUMBER` 的 `execution` object。

`CHANGE_NAME` 到 `GATE_COMMANDS` 是 implementation prompt 的 REQUIRED 欄位。`ALLOWED_PATHS` 寫不全，代表工作尚未消化到可外派，回主線補 task→file mapping。

`PHASE_EXECUTION.applicable` 必須為 true；false 代表這不是 Class C，不得用本 recipe。取：

```text
IMPLEMENTATION_COHORT = PHASE_EXECUTION.effective.cohort
IMPLEMENTATION_ORIGIN_ID = spectra-$CONSUMER_SLUG-$CHANGE_NAME-p$PHASE_NUMBER
PRESCAN_ORIGIN_ID = $IMPLEMENTATION_ORIGIN_ID-prescan
```

現行 `rolloutStage=shadow` 時，`effective` 必定是 `spectra-phase-implementation` / Sol high。`mechanical.eligible=true` 只決定 cohort=`shadow-luna-candidate`，**不**授權 Luna mutation。

### 2. Eligible phase 先跑 Luna read-only prescan

若 `PHASE_EXECUTION.prescan.eligible === true`，先走 `spectra-phase-prescan`。Source list 是封閉集合：本 change proposal／design／specs／tasks，加上 task 明列的 target paths；不存在的 optional artifact 在 dispatch 前剔除並於 acceptance 註明，不讓 Luna 自行找入口。

固定欄位只有：

1. 每個 task ID 的逐字 target path；
2. target path 內既有 symbol 名稱＋location；
3. artifacts 明列的 exact gate command＋location；
4. 找不到／矛盾時的 raw value 與 `needs_reconciliation`。

```bash
node ~/offline/clade/vendor/scripts/codex-dispatch.ts \
  --template ~/offline/clade/vendor/snippets/codex-offload/templates/read-heavy-scan.template.md \
  --var "task=對 $CHANGE_NAME phase $PHASE_NUMBER 的封閉 source list 抽取 task→path、既有 symbol 與 exact gate command；每筆附 location + raw_value" \
  --var "acceptance=$PRESCAN_ACCEPTANCE" \
  --var "git_baseline=$GIT_BASELINE" \
  --var "allowed_paths=（只讀；除 /tmp capture 外無寫入授權）" \
  --output-schema ~/offline/clade/vendor/snippets/codex-offload/schemas/read-heavy-scan-result.schema.json \
  --label "$PRESCAN_ORIGIN_ID" \
  --cwd <consumer-worktree-root> \
  --model luna --effort low \
  --route routing-table \
  --tier-basis table-row --table-row spectra-phase-prescan \
  --origin spectra-apply \
  --origin-id "$PRESCAN_ORIGIN_ID" \
  --cohort phase-prescan
```

依 Codex Watch Protocol 收 terminal receipt：

- `exit 0/2` 且有 parseable result → `PRESCAN_EVIDENCE=<receipt.lastMessagePath>`；即使 `needs_reconciliation=true` 仍保留 raw facts，裁決交下一步 Sol high。
- `exit 3/4` → 依標準 fallback 處理；不重試 Luna medium/high。若決定略過 prescan，`PRESCAN_EVIDENCE=(prescan unavailable: <exit/reason>)`，implementation 仍可開始。

若 `prescan.eligible === false`，設 `PRESCAN_EVIDENCE=(not run)`。

### 3. 用泛用 dispatcher 派 Sol high implementation

每一個 C 類 phase 的 effective mutation 都走 named row `spectra-phase-implementation`。Template 與 output schema 是 clade SoT；**NEVER** 複製 raw `codex exec` 或在 caller 自行拼 model flag。

```bash
node ~/offline/clade/vendor/scripts/codex-dispatch.ts \
  --template ~/offline/clade/vendor/snippets/codex-offload/templates/spectra-phase-implementation.template.md \
  --var "change_name=$CHANGE_NAME" \
  --var "phase_number=$PHASE_NUMBER" \
  --var "phase_title=$PHASE_TITLE" \
  --var "phase_tasks=$PHASE_TASKS" \
  --var "prescan_evidence=$PRESCAN_EVIDENCE" \
  --var "git_baseline=$GIT_BASELINE" \
  --var "allowed_paths=$ALLOWED_PATHS" \
  --var "gate_commands=$GATE_COMMANDS" \
  --output-schema ~/offline/clade/vendor/snippets/codex-offload/schemas/spectra-phase-result.schema.json \
  --label "$IMPLEMENTATION_ORIGIN_ID" \
  --cwd <consumer-worktree-root> \
  --model sol --effort high \
  --route routing-table \
  --tier-basis table-row --table-row spectra-phase-implementation \
  --origin spectra-apply \
  --origin-id "$IMPLEMENTATION_ORIGIN_ID" \
  --cohort "$IMPLEMENTATION_COHORT"
```

以 Bash `run_in_background=true` 啟動。Dispatcher 自己持久化 rendered prompt、stdout/stderr、last-message 與 ledger；**NEVER** 另接 pipe 或自行 redirect Codex stdout。

在 Form 3 / Form 4 下，由 worktree subagent 在自己的 sandbox 直接跑上述命令，且由該層完整持有 watch lifecycle；主線不探針。

### 4. Machine-readable marker（shadow-only）

Marker 必須是 phase 內單一行 JSON comment：

```html
<!-- spectra-luna-pilot: {"mode":"docs-update","paths":["docs/example.md"],"gates":["vp check"]} -->
```

`residency-classify.ts` 是唯一 eligibility SoT。它機械驗 mode、exact relative paths、task path equality、gate、pending task cap、path cap、view/mixed 與高風險詞；caller **NEVER** 自己重算或覆寫 `mechanical.eligible`。

現行 shadow stage 的唯一效果：implementation ledger cohort 分成 `shadow-luna-candidate` 與 `shadow-sol-control`。**NEVER** 因 marker 合法就把 Step 3 改成 `spectra-mechanical-substep` Luna low。該 row 先保留為下一 stage 的 locked policy；只有 cohort gate 達標並修改 classifier rollout SoT 後才能成為 effective route。

### 5. 啟動 Codex Watch Protocol

取得 background task ID 後：

1. 簡短告知使用者本 phase 已派出。
2. 依 `agent-routing.codex-watch-protocol.md` 建 canonical keepalive；notification-only，不短輪詢。
3. terminal notification 到達後 claim task ID，讀 dispatcher 的單一 JSON receipt。
4. 依 exit code 分流：
   - `0`：讀 `result`，進下節 checks。
   - `2`：業務 fail；讀 `result` 的 drift／skip／gate 原因，主線決定修補或重派。
   - `3`：機械故障；讀 receipt 指向的 stderr log，依 watch protocol fallback。
   - `4`：配額擋；依 quota fallback，**NEVER** 當成可立即重試的機械故障。

### 6. Notification 後 MUST checks

即使 dispatcher `exit=0` 且 `result.status=pass`，主線仍逐條驗，不採信自報：

1. **Checkbox**：Read `tasks.md`，確認 phase N 全部 `[x]`；skip 的 task 必須仍 `[ ]`。
2. **Commit boundary**：`git -C <wt> log main..HEAD --oneline`，確認該 phase正好一個新 commit，subject 符合 `🧹 chore: wt <change>-phase-<N> — ...`。
   - multiple／missing／format mismatch → AskUserQuestion：[1] squash；[2] `reset --soft main` 後重派；[3] 中止。
3. **View-layer drift double-check**：

   ```bash
   git -C <wt> diff main..HEAD --name-only -- \
     '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' \
     'app/pages/**' 'app/components/**' 'app/layouts/**' \
     'pages/**' 'components/**' 'layouts/**' 'views/**'
   ```

   任一命中 → AskUserQuestion：[1] soft reset＋剔除 view 改動＋重派；[2] 接受並按 B 類重跑；[3] 中止。
4. **Scope discipline**：`git -C <wt> diff main..HEAD --name-only` 對照本次 `ALLOWED_PATHS`。超出範圍 → AskUserQuestion 處理。
5. **Gate replay**：主線自行重跑 `GATE_COMMANDS`；Codex 回報的 gate JSON 只作索引，不替代實跑。
6. **Result integrity**：`result.status` 必須精確為 `pass`；`result.change` / `result.phase` 必須等於本次 dispatch；`scope_drift` / `view_layer_drift` / `uncertain_reasons` 必須為空；commit SHA 必須等於 worktree HEAD。`status=uncertain` 即使 dispatcher exit 0 也不得通過本 check。
7. **Pilot verification record**：上述 checks 結束後立即記一筆，不等 session 收尾：
   - 全部通過 → `pass`
   - gate replay 證明語意不符／測試 regression → `semantic-regression`
   - view 或 scope drift → `scope-drift`
   - background ownership／commit／checkbox lifecycle 缺口 → `lifecycle-orphan`
   - 無法歸入以上 → `inconclusive`

   ```bash
   node ~/offline/clade/vendor/scripts/residency-classify.ts pilot-record \
     --consumer-path . \
     --change "$CHANGE_NAME" --phase "$PHASE_NUMBER" \
     --origin-id "$IMPLEMENTATION_ORIGIN_ID" \
     --cohort "$IMPLEMENTATION_COHORT" \
     --outcome <pass|semantic-regression|scope-drift|lifecycle-orphan|inconclusive> \
     --details "<一行 evidence pointer>"
   ```

   這份 `.spectra/luna-pilot-ledger.jsonl` 只記主線 verification；model／effort／exit 真相仍只在 dispatcher ledger，**NEVER** 手抄進 verification row。

有 gap → 記完 outcome 後 AskUserQuestion：[1] 主線在 worktree 內做 scoped 補丁並另 commit；[2] reset 重派；[3] 中止。

### 7. 下一個 phase

本 phase checks 全過後才 re-classify 下一個 phase。**NEVER** 依上一個 phase 的類別、candidate 或檔位外推後續 phase。
