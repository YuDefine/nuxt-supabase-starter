#!/usr/bin/env bash
# PreToolUse:Bash hook — 直呼 heavy gate 防漏；已受閘命令保留負載 advisory。
#
# 觸發條件：tool_input.command 的 shell 指令位置命中重型直呼。
# 行為：wrapper 可用時拒絕直呼；wrapper 缺席時警告並放行。
# 已包裝命令只在 load 超過核數時印 advisory；不再對數萬 PID 跑 ps/pgrep。
#
# 為什麼需要它（TD-615）：18 個 agent session 共用 6 核，每個 session 都可以自己決定
#   何時起一套 CI 等級的測試，彼此不知道對方在跑。代價不只是全體變慢——
#   2026-08-24 實測 load 67 / 6 核（≈11x）時，5 筆
#   playwright 紅燈被誤歸因給一個 commit，三個 session 先後投入追查；降到 load 11
#   後同一棵樹重跑 28 passed / 0 failed。超賣會產生**看起來像真缺陷的假訊號**。
#
# 為什麼沒有鎖（TD-615 Restart brief 的「先決定鎖的載體」，本次選了第三案）：
#   PreToolUse 拿不到「這個 job 何時結束」的訊號，所以鎖交給 clade-gate/gate-slot
#   持有；advisory 只讀 /proc/loadavg，不維護跨 session 狀態。
#
# 2026-09-27：直呼繞過 gate-slot 已有 PID 實證；canonical package/vp 入口由各自 script 持鎖。
#
# 直跑測試同樣收進閘門：
#   ① 列出 1–5 個測試檔的 `node --test`／`vitest run` 直呼也須受閘——wrapper 會把它分到
#      light semaphore（不排 heavy slot），代價只剩改寫命令；放行的直跑行程沒有任何
#      slot 標記，多個 session 同時跑會繞過閘門的總量上限。
#   ② 被派出的 worker（CLADE_DISPATCH_ID 非空）跑不帶 lane 的整套測試（`pnpm test`、
#      `--lane=full`、`clade-gate run test -- <沒列檔的 runner>`）一律擋下：廣範圍回歸交 PR CI。
#      確實要跑：`CLADE_ALLOW_FULL_SUITE=1`（命令前綴、同一命令串 export、或 session 環境），
#      回報時寫明理由。
#
# fail-open：解析失敗 / 無 jq / 讀不到 load → 靜默 exit 0。

set -uo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# Most commands have no heavy executable. Skip the lexer for them, including
# large UTF-8 commit messages and heredoc bodies.
needs_lex=0
case "$cmd" in
  *vitest*|*vue-tsc*|*tsc*|*nuxt*|*'--test'*|*check.ts*|*run-evidence.ts*|*run-node-tests*) needs_lex=1 ;;
esac
dispatched=0
env_allow_full=0
if [ -n "${CLADE_DISPATCH_ID:-}" ]; then
  dispatched=1
  # 派工環境多一條整套阻擋，只有可能命中阻擋的命令才需要 lexer。別用 *test* ——
  # 多數 commit message／heredoc 都含 test 字樣，lexer 在大輸入上是逐字元掃描。
  case "$cmd" in *pnpm*test*|*clade-gate*test*) needs_lex=1 ;; esac
fi

if ((needs_lex)); then
# Tiny shell lexer: only unquoted separators create a new command. Heredoc bodies
# are data. Unknown syntax stays fail-open; the patrol covers spawned processes.
raw_kind=''
raw_note=''
suite_kind=''
gate='test'
declare -a words=() heredocs=() heredoc_tabs=()
word='' word_started=0 quote='' want_heredoc=0 here_body=0 comment=0 redirect_target=0

targeted_test_files() {
  local files=0 skip_value=0 arg
  for arg in "$@"; do
    if ((skip_value)); then skip_value=0; continue; fi
    case "$arg" in
      run|--) continue ;;
      --test-name-pattern|--reporter|--project|-t) skip_value=1; continue ;;
      -*) continue ;;
    esac
    if [[ $arg =~ \.(test|spec)\.[cm]?[jt]sx?$ ]]; then
      ((files+=1))
    else
      return 1
    fi
  done
  ((files > 0 && files <= 5 && !skip_value))
}

# Whole-suite = 沒有任何 positional（檔案／目錄／name filter），且沒有 full 以外的
# --lane／--project。帶值旗標的值不算 positional；旗標清單與 bin/clade-gate 的
# SUITE_VALUE_FLAGS 同一份，改一處 MUST 同步。
suite_without_lane() {
  local -a a=("$@")
  local i=0 arg
  while ((i < ${#a[@]})); do
    arg=${a[i]}
    case "$arg" in
      --) ;;
      --lane|--project)
        [[ ${a[i+1]:-} == full ]] || return 1
        ((i+=1)) ;;
      --lane=*|--project=*)
        [[ ${arg#*=} == full ]] || return 1 ;;
      --import|--require|-r|--loader|--experimental-loader|--conditions|-C|--input-type|--inspect|--inspect-brk|--inspect-port|-e|--eval|-p|--print|--max-old-space-size|--max-semi-space-size|--test-reporter|--test-reporter-destination|--test-concurrency|--test-name-pattern|--test-skip-pattern|--test-timeout|--reporter|-t|--dir|--root|--config|-c|--maxWorkers|--minWorkers|--maxConcurrency|--pool)
        [[ ${a[i+1]:-} == -* || $((i + 1)) -ge ${#a[@]} ]] || ((i+=1)) ;;
      -*) ;;
      *) return 1 ;;
    esac
    ((i+=1))
  done
  return 0
}

# argv after clade-gate: `run <label> -- <inner...>`。內層只對認得出的 test runner 判整套
# （`node --test`、run-node-tests.ts、vitest 含 npx／pnpm exec 形、`vp test`）；認不出的
# 包裝不算整套，與 bin/clade-gate 的 wholeSuiteRunnerArgs 判法一致。
check_gate_suite() {
  local arg runner_ok=0 inner
  ((dispatched)) || return 0
  [[ ${1:-} == run && ${2:-} == test ]] || return 0
  while (($#)); do arg=$1; shift; [[ $arg == -- ]] && break; done
  (($#)) || return 0
  # Skip the runner's own executable words so `node scripts/run-node-tests.ts` is
  # judged on its arguments, not on the script path.
  case "${1##*/}" in
    node)
      shift
      while [[ ${1:-} == -* ]]; do
        case "$1" in
          --test) runner_ok=1; shift ;;
          --import|--require|-r|--loader|--experimental-loader|--conditions|-C|--input-type|--inspect|--inspect-brk|--inspect-port|-e|--eval|-p|--print|--max-old-space-size|--max-semi-space-size|--test-reporter|--test-reporter-destination|--test-concurrency|--test-name-pattern|--test-skip-pattern|--test-timeout)
            shift
            [[ $# -eq 0 || ${1:-} == -* ]] || shift ;;
          *) shift ;;
        esac
      done
      inner=${1:-}
      if ((runner_ok == 0)) && [[ ${inner##*/} == run-node-tests.ts ]]; then
        runner_ok=1
        shift
      fi ;;
    vitest|npx|pnpm)
      runner_ok=1
      shift; [[ ${1:-} == vitest || ${1:-} == exec ]] && shift; [[ ${1:-} == vitest ]] && shift ;;
    vp)
      shift
      [[ ${1:-} == test ]] && { runner_ok=1; shift; } ;;
    *) return 0 ;;
  esac
  ((runner_ok)) || return 0
  [[ ${1:-} == run ]] && shift
  if suite_without_lane "$@"; then suite_kind="clade-gate run test（未列檔、未帶 lane）"; fi
}

skip_timeout_prefix() {
  # Bash's dynamic scope exposes check_words' local i here.
  # Leave i at the wrapped executable.
  ((i+=1))
  while ((i < ${#words[@]})); do
    case "${words[i]}" in
      -s|--signal|-k|--kill-after) ((i+=2)) ;;
      --signal=*|--kill-after=*|--foreground|--preserve-status|--verbose) ((i+=1)) ;;
      -*) ((i+=1)) ;;
      *) ((i+=1)); break ;; # duration
    esac
  done
}

check_words() {
  local i=0 tool sub arg saw_export=0
  local allow_full=$env_allow_full
  [[ ${CLADE_ALLOW_FULL_SUITE:-} == 1 ]] && allow_full=1
  ((${#words[@]})) || return
  while ((i < ${#words[@]})); do
    arg=${words[i]}
    if [[ $arg =~ ^[A-Za-z_][A-Za-z_0-9]*= ]]; then
      [[ $arg == CLADE_ALLOW_FULL_SUITE=1 ]] && allow_full=1
      ((i+=1)); continue
    fi
    case "$arg" in
      export) saw_export=1; ((i+=1)); continue ;;
      env|command|time|if|then|do|while|until|'!') ((i+=1)); continue ;;
      timeout) skip_timeout_prefix; continue ;;
    esac
    break
  done
  if ((i >= ${#words[@]})); then
    # `export CLADE_ALLOW_FULL_SUITE=1` 單獨成命令時，同一命令串後面的命令吃得到。
    ((saw_export)) && ((allow_full)) && env_allow_full=1
    return
  fi
  tool=${words[i]##*/}
  sub=${words[i+1]:-}
  case "$tool" in
    clade-gate) ((allow_full)) || check_gate_suite "${words[@]:i+1}"; return ;;
    pnpm)
      case "$sub" in
        run) ((i+=1)); sub=${words[i+1]:-} ;;
        exec) ((i+=1)); sub=${words[i+1]:-} ;;
      esac
      # Package scripts are the canonical boundary; the hook cannot infer their
      # implementation in each consumer. Coverage audit checks those scripts.
      if [[ ${words[i]:-} != exec ]] && [[ $sub =~ ^(check|test(:[[:alnum:]_-]+)?|typecheck|build)$ ]]; then
        # `test:<lane>` names a lane; bare `test` and `test:full` are the whole suite.
        if ((dispatched && !allow_full)) && [[ $sub == test || $sub == test:full ]] &&
          suite_without_lane "${words[@]:i+2}"; then
          suite_kind="pnpm $sub"
        fi
        return
      fi
      if [[ $sub == vp && ${words[i+2]:-} == check ]]; then return; fi
      if [[ $sub == vitest ]] && targeted_test_files "${words[@]:i+2}"; then raw_note=light; fi
      case "$sub" in vue-tsc|tsc|vitest) raw_kind="pnpm exec $sub" ;; esac
      ;;
    npx)
      if [[ $sub == vitest ]] && targeted_test_files "${words[@]:i+2}"; then raw_note=light; fi
      case "$sub" in vue-tsc|tsc|vitest) raw_kind="npx $sub" ;; esac
      ;;
    vue-tsc) raw_kind=vue-tsc ;;
    tsc) if [[ $sub == -p || $sub == --project || $sub == --project=* ]]; then raw_kind=tsc; fi ;;
    nuxt) if [[ $sub == typecheck ]]; then raw_kind='nuxt typecheck'; fi ;;
    vitest)
      # A few explicit test files still go through the gate; it routes them to light.
      if targeted_test_files "${words[@]:i+1}"; then raw_note=light; fi
      raw_kind=vitest
      ;;
    node)
      if [[ $sub == *clade-gate ]]; then
        ((allow_full)) || check_gate_suite "${words[@]:i+2}"
      elif [[ $sub == --test ]]; then
        if targeted_test_files "${words[@]:i+2}"; then raw_note=light; fi
        raw_kind='node --test'
      elif [[ $sub == *run-node-tests.ts ]]; then raw_kind='node scripts/run-node-tests.ts'
      elif [[ $sub == *scripts/check.ts ]]; then raw_kind='node scripts/check.ts'
      elif [[ $sub == *run-evidence.ts ]]; then
        local j
        for ((j=i+2; j<${#words[@]}; j++)); do
          if [[ ${words[j]} == -- ]]; then
            words=("${words[@]:j+1}")
            check_words
            return
          fi
        done
      fi
      ;;
  esac
  case "$raw_kind" in *tsc*|*typecheck*|*check.ts*) gate=typecheck ;; esac
}
flush_word() {
  ((word_started)) || return
  if ((want_heredoc)); then heredocs+=("$word"); heredoc_tabs+=("$((want_heredoc == 2))"); want_heredoc=0
  elif ((redirect_target)); then redirect_target=0
  else words+=("$word"); fi
  word='' word_started=0
}
flush_command() {
  flush_word
  if [[ -z $raw_kind && -z $suite_kind ]]; then check_words; fi
  words=()
}

# Byte indexing keeps Bash substring extraction linear for UTF-8 input that
# actually contains a heavy-tool candidate.
LC_ALL=C
for ((pos=0; pos<${#cmd}; pos++)); do
  ch=${cmd:pos:1}
  if ((comment)); then
    if [[ $ch == $'\n' ]]; then comment=0; flush_command; fi
    continue
  fi
  if ((here_body)); then
    if [[ $ch == $'\n' ]]; then
      candidate=$line
      if [[ ${heredoc_tabs[0]} == 1 ]]; then
        while [[ $candidate == $'\t'* ]]; do candidate=${candidate#$'\t'}; done
      fi
      if [[ $candidate == "${heredocs[0]}" ]]; then
        heredocs=("${heredocs[@]:1}")
        heredoc_tabs=("${heredoc_tabs[@]:1}")
        if ((${#heredocs[@]} == 0)); then here_body=0; fi
      fi
      line=''
    else
      line+=$ch
    fi
    continue
  fi
  if [[ -n $quote ]]; then
    if [[ $ch == "$quote" ]]; then quote=''
    elif [[ $ch == '\' && $quote == '"' ]]; then ((pos+=1)); word+=${cmd:pos:1}
    else word+=$ch; fi
    continue
  fi
  case "$ch" in
    '#')
      if ((word_started)); then word+=$ch
      else comment=1; fi
      ;;
    "'"|'"') quote=$ch; word_started=1 ;;
    '\') ((pos+=1)); word+=${cmd:pos:1}; word_started=1 ;;
    ' '|$'\t'|$'\r') flush_word ;;
    '<'|'>')
      # The immediately preceding digit is a file descriptor, not an argv.
      if [[ $word =~ ^[0-9]+$ ]]; then word='' word_started=0; else flush_word; fi
      if [[ $ch == '<' && ${cmd:pos+1:1} == '<' ]]; then
        ((pos+=1))
        if [[ ${cmd:pos+1:1} == '<' ]]; then ((pos+=1)) # here-string, no body
        elif [[ ${cmd:pos+1:1} == '-' ]]; then want_heredoc=2; ((pos+=1))
        else want_heredoc=1; fi
      else
        redirect_target=1
        if [[ ${cmd:pos+1:1} == '&' ]]; then ((pos+=1)); fi
      fi
      ;;
    $'\n')
      flush_command
      if ((${#heredocs[@]})); then here_body=1; line=''; fi
      ;;
    '&'|'|'|';'|'('|')') flush_command ;;
    *) word+=$ch; word_started=1 ;;
  esac
done
flush_command
wrapper=''
if [ -x .clade/bin/clade-gate ]; then wrapper=.clade/bin/clade-gate
elif [ -x bin/clade-gate ]; then wrapper='node bin/clade-gate'; fi
if [ -n "$suite_kind" ]; then
  printf '[clade] 被派出的 worker（CLADE_DISPATCH_ID 非空）不在本機跑不帶 lane 的整套測試：%s。\n' "$suite_kind" >&2
  printf '  改跑相關測試檔（%s run test -- node --test <檔>，1–5 檔走 light slot）；廣範圍回歸交 PR CI。\n' "${wrapper:-clade-gate}" >&2
  printf '  確實要在本機跑整套：CLADE_ALLOW_FULL_SUITE=1（命令前綴、同一命令串 export、或 session 環境），回報時寫明理由。\n' >&2
  exit 2
fi
if [ -n "$raw_kind" ]; then
  if [ -n "$wrapper" ]; then
    if [ "$raw_note" = light ]; then
      printf '[clade] 直跑測試已擋下：%s。改用 %s run test -- <原命令>（1–5 個測試檔走 light slot，不排 heavy）。\n' "$raw_kind" "$wrapper" >&2
    else
      printf '[clade] 未受閘的 heavy 命令已擋下：%s。改用 %s run %s -- <原命令>。\n' "$raw_kind" "$wrapper" "$gate" >&2
    fi
    exit 2
  fi
  printf '[clade] heavy 命令 %s：此環境沒有 clade-gate，放行並請在可用環境補受閘執行。\n' "$raw_kind" >&2
  exit 0
fi
fi

# ── 快篩：絕大多數 Bash 命令不是重型 job，在這裡就返回 ────────────────────────
case "$cmd" in
  *vitest*|*playwright*|*'vp test'*|*'vp check'*|*'node --test'*|*vue-tsc*|*'tsc '*|*'tsc -'*) ;;
  *'nuxt typecheck'*|*'nuxt build'*|*'vite build'*|*'pnpm build'*|*'pnpm install'*) ;;
  *publish.ts*|*propagate.ts*) ;;
  *) exit 0 ;;
esac

# ── 量 load 與核數（Linux /proc 優先，其餘走 uptime；兩者都失敗就 fail-open）──
if [ -r /proc/loadavg ]; then
  load1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null) || exit 0
else
  load1=$(uptime 2>/dev/null | sed -n 's/.*load averages*:[[:space:]]*\([0-9.]*\).*/\1/p') || exit 0
fi
[ -n "$load1" ] || exit 0

if command -v nproc >/dev/null 2>&1; then
  ncores=$(nproc 2>/dev/null)
else
  ncores=$(sysctl -n hw.ncpu 2>/dev/null)
fi
[ -n "${ncores:-}" ] && [ "$ncores" -gt 0 ] 2>/dev/null || exit 0

# ── 判定：load 超過核數才出聲。process census 交 resource-patrol 定時跑。 ──
over=$(awk -v l="$load1" -v c="$ncores" 'BEGIN { print (l > c) ? 1 : 0 }' 2>/dev/null) || exit 0
[ "$over" = '1' ] || exit 0

ratio=$(awk -v l="$load1" -v c="$ncores" 'BEGIN { printf "%.1f", l / c }' 2>/dev/null)

{
  printf '\n⚠️  [clade] 現在起重型 job，結果可能不可信\n\n'
  printf '  load average(1m)：%s ／ %s 核  ＝ %sx\n' "$load1" "$ncores" "${ratio:-?}"
  cat <<'MSG'

  超賣的代價不只是慢。高負載下 playwright 的 locator wait 逾時，回報形式與真缺陷
  **完全相同**（具名到 spec 與行號），只看輸出分不出來——2026-08-24 實測一次因此
  被誤歸因給某個 commit，三個 session 先後投入追查。

  送出前先判：
    1. 這輪結果會被拿去**下判斷**嗎（publish gate / 歸因 / 驗收）？
       → 是就先降載：等上面那幾個跑完，或 `herdr agent list` 看誰在跑
    2. 只是想看會不會過、失敗了也只是重跑？→ 照跑
    3. 已經拿到紅燈且 load 高於核數 → 那是「沒驗到」不是「驗出問題」，
       MUST 降載重跑後才寫歸因（clade-publish Step 1.5 ②）

  （此段僅 advisory；未包閘的直呼命令在前段已拒絕）

MSG
} >&2

exit 0
