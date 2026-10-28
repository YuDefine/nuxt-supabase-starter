#!/usr/bin/env bash
# PostToolUse(*) hook — session context 越過預算門檻時提示走「登記 + 收工」。
# **warn-only，永不 block。**
#
# 為什麼需要這條：2026-08-04 對 ~/.claude/projects 8 天實測，944 個主線 session 裡
# 157 個（17%）平均 context >200k，吃掉 92% 的 context 讀取量；前三名跑到 1,463 turns
# / 平均 594k / 峰值 971k。成本是 N × C / 2（N=turns、C=最終 context），所以同樣工作
# 切成 4 段 ≈ 1/4 成本 —— 平方級槓桿，換 runtime 或換模型都給不了。
#
# 規約早就寫了收工 predicate（rules/core/session-tasks.md § Session context 預算；
# 收工正文在 rules/core/session-tasks.operations.md § 收工，本 hook 是它的觸發錨），
# 但它只在 user 主動問「下一步」時才被讀到；session 自己長到 594k 沒有任何訊號。
# 這個 hook 就是那個缺席的訊號。
#
# 為什麼是 warn 不是 block：收工與否要看手上工作的可切點在哪 —— 正在跑一個不可分割的
# 驗證迴圈時被 block 只會逼出繞道。收件人是主線自己，它知道現在能不能切。
#
# 對應 TD-378。fail-open：拿不到 transcript / 讀不到 usage → 靜默 exit 0。
#
# ## 視窗 profile 表
#
# 先依**生效視窗**（`CLAUDE_CODE_AUTO_COMPACT_WINDOW`）查已核准的 profile，再依 launcher 判級距：
#
# | 生效視窗 | profile | 提示 |
# | --- | --- | --- |
# | `300000` | compact（非主持席：互動主線、派工 child、Fable） | 一級：壓縮觸發點前 32k（300k 時 235k） |
# | `600000` | handoff（主持席） | cc／ccN：soft 300k、hard 500k、hard 後每 +100k |
# | 其他值或未設 | handoff，訊息附一行「不在已核准 profile 表」 | 同上 |
#
# compact profile 的數字由視窗推出，不另寫一份：Claude Code 的觸發點是 `視窗 − 20k − 13k`
# （plan evidence/2026-10-21-探測P1-P5.md § P1），提示線再往前留 32k 緩衝。這段緩衝不是保證——
# 觸發判定比的是「目前 context＋待送訊息」，一個大工具結果可以直接越過提示線；真正的保險是
# PreCompact 落盤（`pre-compact-snapshot.sh`）。
#
# compact profile 不交棒：壓縮會原地發生，提示只叫 session 在下一個自然斷點把進度寫回 plan.md 並
# commit，然後續做。所以這個 profile 沒有 relay 文案——300k 視窗下 500k／600k 根本到不了。
#
# gateway launcher（`ccg`／`ccx`）已從 clade 拆除（2026-09-29）：`ANTHROPIC_BASE_URL` 指向非官方 gateway proxy 的
# session 不是 clade 的派工或收工入口，本 hook 對它不發 numeric 提示。歷史 transcript 的
# ccx／ccg 分類仍由 audit 層保留，NEVER 從那裡刪除歷史歸因。
#
# handoff profile 的 soft 語義是「不要開新的大工作段，小 item 照做」；hard 才是「現在收工」。
#
# ## 越過 soft tier 後的出口
#
# 只寫「不開大工作段」而不寫殘工去處，session 做完手上那件就會停著等 user。所以兩級提示都明寫
# 出口，且依身分分流：
#
# - 主線（`CLADE_DISPATCH_ID` 空）：仍有殘工就**自己** `/handoff relay`／`fanout`，NEVER 停下問
#   user 要不要交棒。
# - 被派出的 child（`CLADE_DISPATCH_ID` 非空）：回報主持（`--complete relay-request --plan`），
#   由主持另開下一棒 —— 權威在 handoff skill `relay-steps.md` § 0，本檔只是觸發錨。
#   env 被剝掉時倒向主線文案：child 照做會自 relay，那條路 helper 仍會接（relay 對 child 開了缺口），
#   方向是「多一棒沒經主持」而不是「停著沒人管」。
#
# 提示門檻與**分類器**門檻 NEVER 綁在一起：`audit-session-context-budget.ts` 的 >200k 是事後
# 統計切點，不是 agent 行為門檻。分類定義改了，本 profile 不必跟著改；反之亦然。
#
# **NEVER 改成相對值門檻**（% of context window）——證據與成本模型全部以絕對 token 計價。
#
# ## 本檔的 C 與狀態列 % 的關係（2026-08-12 實測釐清，不是 bug）
#
# 兩者**分子同定義**：`input + cache_creation + cache_read`，取最後一筆 assistant usage。
# 差在**分母** —— 狀態列的 % 來自 Claude Code 餵給 statusline 的
# `context_window.context_window_size`，實測值是**模型 window 本身**（`claude-opus-5[1m]`
# → `1000000`），**不是** `CLAUDE_CODE_AUTO_COMPACT_WINDOW`（Charles 設 600000）。
#
# 所以「狀態列 30%」= 30% × 1M = **300k**，與本 hook 報的數字一致。拿 600k 去乘得到的
# 180k 是把兩個分母混用的產物 —— 本 hook 沒有提早觸發。
#
# 實測（2026-08-12）：8,507 筆真實 usage 記錄，本檔 grep + awk 的取值與 JSON 解析逐筆比對
# **0 筆不一致**；同一時刻 statusline payload 的 `current_usage` 三欄加總 97,982、
# `used_percentage` 10 —— 三方對得上。
#
# **NEVER 把門檻改成「% of 600k」來遷就狀態列** —— 那同時違反上一行的絕對值 NEVER，且 600k
# 是 auto-compact 觸發點、不是成本模型的基準。要對齊的是**狀態列的分母**
# （`~/.claude/statusline.sh`，user 個人檔），不是本檔。
#
# **NEVER 加回門檻數字的 env 覆寫**（本檔 2026-08-06 前有 `CLADE_CTX_WARN_TIER1` / `TIER2`）：門檻是
# 「判定 agent 行為合不合格的數值」，per coordinator `rules/自主推進判準.md` Rule 2（不放寬約束自身的門檻）只有 user 能放寬。
# 一個 env 變數等於把那道閂交給每個 session 自己 —— 而會想調鬆它的，正是已經超標的那個。
# `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 不是這種破口：它只**選**上表已核准的 profile，值不在表上就退回
# handoff profile；要新增一個視窗值（例如 D14 的 250k）或改任何門檻數字，仍然只有改本檔一途。
#
# ## 為什麼 exit 2
#
# 收件人是 agent，而 **PostToolUse 的 exit 0 到不了它**：官方契約逐字「Stderr from a hook
# that exits 0 goes to the debug log only, never the transcript, and Claude never sees it」，
# exit 2 才是 `Shows stderr to Claude; the tool already ran`。工具已經跑完，exit 2 在
# PostToolUse **不撤銷也不阻擋任何東西** —— 它是唯一能把訊息送到收件人手上的出口。
#
# 這是 2026-08-06 修的：本檔原本 exit 0，所以自 v1.4.x 上線以來每一次
# 提示都只寫進 debug log。TD-378 § baseline 二 當時把「hook 已落地、行為沒有改變」讀成
# 「訊號存在、被忽略」—— 實際上訊號從來沒送達。**NEVER 改回 exit 0。**

set -euo pipefail

payload=$(cat)

detect_origin_launcher() {
  local base_url="${ANTHROPIC_BASE_URL:-}"
  case "${base_url,,}" in
    '' | https://api.anthropic.com | https://api.anthropic.com/* | https://api.anthropic.com:443 | https://api.anthropic.com:443/*) ;;
    *) echo gateway; return ;;
  esac
  case "${CLAUDE_CONFIG_DIR:-}" in
    "$HOME"/.claude-[0-9]*) echo "cc${CLAUDE_CONFIG_DIR##*/.claude-}"; return ;;
  esac
  echo cc
}

LAUNCHER=$(detect_origin_launcher)
# gateway 起源（已拆除的 ccg／ccx）不是 clade 入口：不發 numeric 提示。
[ "$LAUNCHER" != gateway ] || exit 0

WINDOW="${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-}"
PROFILE=handoff
PROFILE_NOTE=""
WARN_AT=300000
STRONG_AT=500000
STRONG_STEP=100000
case "$WINDOW" in
  300000)
    PROFILE=compact
    # 觸發點＝視窗 − 33k；提示線再早 32k（見檔頭 § 視窗 profile 表）
    COMPACT_AT=$((WINDOW - 33000))
    WARN_AT=$((COMPACT_AT - 32000))
    ;;
  600000) ;;
  *)
    PROFILE_NOTE="   （生效視窗 ${WINDOW:-未設} 不在已核准 profile 表，按交棒 profile 判定）"
    ;;
esac

extract() {
  printf '%s' "$payload" |
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

# ── 身分豁免（Charles 2026-09-02 拍板）──────────────────────────────────────
#
# 收工線買的是「successor 從 fresh context 起跑」，而它的前提是**這個 session 有東西可以交**。
# 下面三種身分都不成立，對它們發收工提示等於要求一個交不出東西的收件人去執行收工三步。
#
# 1. in-process subagent（Agent tool：Explore / Plan / general-purpose / Opus 顧問…）
#    —— 它的 tool call 與主線**共用同一份 transcript 與 session_id**（2026-09-02 probe hook
#    實測），所以本 hook 在 subagent 的 tool call 上照樣算得出主線的 C 並提示；而那則提示
#    送到的是 subagent，它既 relay 不了也 fanout 不了。判別靠 payload 的 `agent_id` /
#    `agent_type`：**實測主線 payload 完全沒有這兩個 key**，subagent 的兩個都有。
#    **NEVER 改用 transcript 的 `isSidechain` 判別** —— 同次實測：subagent 的訊息根本沒有寫進
#    那份 transcript（4 筆 assistant 全是主線、`isSidechain` 全 false），拿它判會恆為主線。
#
# 2. Herdr 派出去的顧問 pane（`herdr-session-handoff.ts --advisory`）—— 它的產出是一份建議，
#    沒有殘工可派；env marker 由 dispatch 端注入。
#
# 3. Fable 系列主線（`claude-fable-*`）—— 2026-09-02 Charles 拍板：Fable 主線不受**收工**線約束。
#    只豁免 handoff profile；compact profile 的提示不是收工線，Fable 照樣收。
#
# **這三條 NEVER 是「env 覆寫門檻」的破口**（見上面那條 NEVER）：它們宣告的是**執行身分**，
# 不是門檻數值。兩組門檻數字仍然寫死在本檔、仍然只有改本檔
# 一途。**NEVER** 反過來拿本節論證「所以門檻也可以由 env 調」。
#
# 逐字反開脫：「我這個主線 session 現在做的事很像顧問（只是讀 code 給建議）」—— 不算。
# 判別只認上面三個機械 marker，**NEVER** 從工作性質自評身分。

# `extract` 掃的是**整個 payload**，而 payload 尾端帶 `tool_input` / `tool_response` 的任意
# 檔案內容 —— 主線編輯一個內文含 `agent_type` 字樣的檔（例如本檔），就會靜默命中豁免、
# 整條 hook 從此不再出聲。所以身分欄位只在**第一個 `"tool_input"` 之前**那段 top-level
# JSON 裡找（2026-09-02 實測：`agent_id` / `agent_type` 排在 `tool_input` 之前）。
# **NEVER** 把這兩個欄位改回掃整份 payload —— 誤判方向是「靜默關掉提示」，沒有任何訊號。
payload_head=${payload%%'"tool_input"'*}

extract_head() {
  printf '%s' "$payload_head" |
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

if [ -n "$(extract_head agent_id)" ] || [ -n "$(extract_head agent_type)" ]; then
  exit 0
fi
if [ "${CLADE_ADVISORY_SESSION:-}" = "1" ]; then
  exit 0
fi

transcript=$(extract transcript_path)
session=$(extract session_id)
[ -n "$transcript" ] || exit 0
[ -f "$transcript" ] || exit 0

# Fable 系列主線的豁免要讀 transcript 才判得出來（payload 沒有 model 欄位，2026-09-02 實測）。
# 取尾端最後一個 model 值 —— 與下面算 C 的那筆取自同一段 tail。grep 無 match 時 pipefail 會讓
# 整條非 0，`|| true` 是必要的，NEVER 拿掉。
model=$(tail -c 524288 "$transcript" 2>/dev/null |
  grep -o '"model":"[^"]*"' | tail -1 | sed 's/.*:"//; s/"$//') || true
case "$PROFILE:$model" in
  handoff:claude-fable*) exit 0 ;;
esac

# 只讀尾端 —— transcript 可以到幾百 MB，整檔掃會讓每次 tool call 都付一次 IO。
# 512KB 足以涵蓋最後數十筆 assistant 訊息（每筆 usage 物件約 200 bytes）。
#
# C 的定義逐字對齊 scripts/audit-session-context-budget.ts（input + cache_read + cache_creation）：
# 那支是 TD-378 的量測入口，兩邊用不同定義就無法互相印證。
#
# `[^}]*}` 在第一個 `{` 前就截斷，**這是刻意的、NEVER 放寬成允許巢狀**：真實 usage 物件是
#   {input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens,
#    server_tool_use:{…}, service_tier, cache_creation:{…}, inference_geo,
#    iterations:[{input_tokens, …, cache_creation:{…}}], speed}
# —— `iterations[]` 的元素**自己又帶一個 `cache_creation` 子物件**，所以 usage 內有**兩層**
# 巢狀。2026-08-12 實測：把樣式放寬成容許一層巢狀（`([^{}]|\{[^{}]*\})*`），8,507 筆真實記錄
# 有 **8,233 筆一個 match 都拿不到** → `$ctx` 空 → hook **靜默不觸發**（其餘 274 筆是還沒有
# `iterations` 的舊記錄）。窄樣式反而是對的。
#
# 已知邊界：三個欄位目前都排在第一個子物件之前（8,507 筆 0 例外），這是 CLI 的欄位順序、
# 不是契約。順序若變，C 會**靜默少算**、hook 從此不再觸發 —— 對應 regression test
# 在 test/context-budget-warn.test.ts（realistic-shape 那則）釘住現行形狀。
ctx=$(tail -c 524288 "$transcript" 2>/dev/null |
  grep -o '"usage":{[^}]*}' | tail -1 |
  LC_ALL=C awk '
    {
      total = 0
      for (i = 1; i <= 3; i++) {
        key = (i == 1 ? "input_tokens" : (i == 2 ? "cache_read_input_tokens" : "cache_creation_input_tokens"))
        if (match($0, "\"" key "\":[0-9]+")) {
          seg = substr($0, RSTART, RLENGTH)
          sub(/^[^:]*:/, "", seg)
          total += seg
        }
      }
      print total
    }') || exit 0

[ -n "$ctx" ] || exit 0
case "$ctx" in
  *[!0-9]*) exit 0 ;;
esac

# 已響過的最高級距（絕對 token 值，不是 tier 序號 —— hard tier 之後依 launcher repeat 步長各算一級）。
# compact profile 只有一級。
if [ "$PROFILE" = compact ]; then
  if [ "$ctx" -ge "$WARN_AT" ]; then
    level=$WARN_AT
  else
    level=0
  fi
elif [ "$ctx" -ge "$STRONG_AT" ]; then
  level=$(((ctx - STRONG_AT) / STRONG_STEP * STRONG_STEP + STRONG_AT))
elif [ "$ctx" -ge "$WARN_AT" ]; then
  level=$WARN_AT
else
  level=0
fi

# 同一級距只提示一次 —— 每次 tool call 都響的提示會被整段忽略
# （同 TD-369 / TD-370 記的「恆亮 gate 訓練人跳過」失效形狀）。
state_dir="${TMPDIR:-/tmp}/clade-ctx-budget"
state_file="$state_dir/${session:-unknown}.level"
seen=$(cat "$state_file" 2>/dev/null || echo 0)
case "$seen" in
  '' | *[!0-9]*) seen=0 ;;
esac

# 壓縮（autocompact／`/compact`）後同一 session_id 的 C 會往下掉：已響級距跟著降到現在的級距，
# 之後再漲過門檻才會再響。下降這一刻本身不響 —— 降到的那一級先前已經響過。兩個 profile 都要
# 走到這裡（compact profile 低於 WARN_AT 時 level 也是 0）。**NEVER** 改回「只升不降」，也
# NEVER 在 level 算出來之前就對低於門檻的 C 提早 exit：壓縮後的 session 會從此收不到任何級距提示。
if [ "$level" -lt "$seen" ]; then
  if [ "$level" -eq 0 ]; then
    rm -f "$state_file" 2>/dev/null || true
  else
    printf '%s' "$level" >"$state_file" 2>/dev/null || true
  fi
  exit 0
fi
[ "$level" -gt "$seen" ] || exit 0
mkdir -p "$state_dir" 2>/dev/null || exit 0
printf '%s' "$level" >"$state_file" 2>/dev/null || true

ctx_k=$((ctx / 1000))

if [ "$PROFILE" = compact ]; then
  cat >&2 <<EOF
⚠️ session context 已達 ${ctx_k}k（profile=compact：視窗 $((WINDOW / 1000))k，約 $((COMPACT_AT / 1000))k 原地自動壓縮）。
   在下一個自然斷點把進度寫回 plan.md § 進度（沒有 plan 就寫該工作的 tasks 檔）並 commit，然後續做。
   NEVER 因 context 大小交棒或停下等 user：壓縮會原地發生，PreCompact hook 會先落盤工作狀態。
   壓縮前這段區間 NEVER 開始 publish、0-A 鏈或 relay 這類原子程序；已在跑的照做到可切點。
   判定層全文在 rules/core/session-tasks.context-budget.md（本提示是它的觸發錨）。本提示只響這一次。
EOF
  exit 2
fi

# 出口依身分分流（見檔頭 § 越過 soft tier 後的出口）。
soft_exit=""
if [ -n "${CLADE_DISPATCH_ID:-}" ]; then
  relay_exit="   你是被派出的 child（dispatch ${CLADE_DISPATCH_ID}）：仍有殘工 → 回報主持，NEVER 自 relay、NEVER 停著等 user。
   進度寫回 plan.md § 進度、commit＋push，再
   node ~/offline/clade/vendor/scripts/herdr-session-handoff.ts --complete relay-request --plan <plan.md>
   由主持另開下一棒。沒有 plan.md、repo 有 push_hold、或 helper 拒收時印 self_relay／
   指示改走 /handoff relay，才自己 /handoff relay（判定表：handoff skill relay-steps.md § 0）。"
else
  relay_exit="   仍有殘工 → MUST 自己交棒：1 件（或彼此 serial）走 /handoff relay，N 件可平行走 /handoff fanout。
   NEVER 停下來等 user 處理、NEVER 把「要不要 relay」當題目問 user —— 交棒就是這一級的預設出口。
   真的要 user 拍板的題目寫進 brief 的待決段，隨棒交出去。沒有殘工就直接收工。"
fi
[ -z "$relay_exit" ] || soft_exit="   手上這件（含它的驗證）做完之後：
${relay_exit}"

cost_strong="   此 session 的 context 已超過本 launcher 的 hard tier。"
cost_warn="   此 launcher 的收工線在 $((STRONG_AT / 1000))k；先停止開大工作，才留得下交棒空間。"
if [ -n "$PROFILE_NOTE" ]; then
  cost_strong="${cost_strong}
${PROFILE_NOTE}"
  cost_warn="${cost_warn}
${PROFILE_NOTE}"
fi

if [ "$ctx" -ge "$STRONG_AT" ] && [ -n "${CLADE_DISPATCH_ID:-}" ] && [ -n "$relay_exit" ]; then
  cat >&2 <<EOF
🔴 session context 已達 ${ctx_k}k（launcher=${LAUNCHER}；hard tier $((STRONG_AT / 1000))k）。
${cost_strong}
   現在就交棒，不再開新的工作段；不可分割的單一驗證迴圈跑完即停。
${relay_exit}
EOF
elif [ "$ctx" -ge "$STRONG_AT" ]; then
  cat >&2 <<EOF
🔴 session context 已達 ${ctx_k}k（launcher=${LAUNCHER}；hard tier $((STRONG_AT / 1000))k）。
${cost_strong}
   寫出任何收工訊息之前，MUST 先讀 rules/core/session-tasks.operations.md § 收工
   —— 那裡有收工三步的完整順序、收工訊息契約 A/B 的部件表、Herdr transport 的
   canonical helper 與 fanout 的 worker-before-relay 硬約束。它是 paths-gated
   （tasks/** / HANDOFF.md），本提示是它的觸發錨，NEVER 假設它已經在 context 裡。
   三步摘要（順序不可調換，細節仍以該檔為準）：
   1. 先把殘工派出去 —— 1 件（含多件但彼此 serial）走 /handoff relay 一次交出整個
      位置；N 件可平行走 /handoff fanout，各派一個 worker pane 再交棒給 successor。
      兩者的 successor 都以 fresh context 續跑，本 session 隨即收工。
   2. 派不出去的才寫進 tasks/<date>-<slug>.md（或 HANDOFF.md / 該 work 的 plan Open work；
      沒有 specs/truth/work-lifecycle.md 的 consumer 才寫 docs/tech-debt.md），
      且逐條寫明派不出去的具體外部條件。
   3. 收工。NEVER 用「context 還夠」「只差最後一步」續跑 —— 那正是這條要擋的。
EOF
else
  cat >&2 <<EOF
⚠️ session context 已達 ${ctx_k}k（launcher=${LAUNCHER}；soft tier $((WARN_AT / 1000))k）。此刻起不再開大工作段。
${cost_warn}
   判定層全文在 rules/core/session-tasks.context-budget.md（本提示是它的觸發錨）。
   per rules/core/session-tasks.md § Session context 預算：**NEVER 開新的大工作段**
   （新的 change / 新的多檔重構 / 新的 plan phase）。
   **小 item 照做** —— 單檔文字修正、補一條 TD、勾一個 checkbox 不受本級限制。
   這一級不是叫你現在停：真正的 hard 收工線在 $((STRONG_AT / 1000))k。
${soft_exit}
   本提示只響這一次。
EOF
fi
exit 2
