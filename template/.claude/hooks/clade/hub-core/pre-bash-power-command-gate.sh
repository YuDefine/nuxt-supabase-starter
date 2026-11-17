#!/usr/bin/env bash
# PreToolUse:Bash hook — 電源指令（關機、重開、休眠、停 VM／CT）執行前，先確認受害機器上沒有別的 agent 在工作（block，exit 2）
#
# 約束（允許 agent 關機，不是只有人能按）：電源指令只在「會被這條指令關掉的機器上，除了呼叫者自己，沒有 herdr pane 的
# agent_status=working」時放行；有就擋並列出；herdr 查不到（含目標機器連不上）也擋。延遲關機一律擋。
# 受害機器（每個電源子指令各算各的）：不在 ssh 底下＝本機；`ssh <host>`（前綴或字串引數）＝該 host；systemctl -H、
# curl／wget 的 URL 主機也算目標。對應：本機標籤／本機 hostname／localhost／127.*／::1 → 本機；yudefine-proxmox／desk → desk
# （只有 yudefine-proxmox 是 desk 的母機）；zenbook → zenbook；herdr machine list 有的 label → 該 label；認不得的 host
# （含帶引號的變數 `ssh "$H" reboot`）→ 本機＋所有啟用的 peer 都查。本機算進去、但整條另有 ssh 時，ssh 的目標也一併查（超集）。
# 本機標籤順序：$POWER_GATE_LOCAL_HOST（測試用）→ $CLADE_HERDR_MACHINE → ~/.config/clade/herdr-machine → hostname -s。
# pvesh 寫入 /nodes/<node>/status：受害機器是 <node>（cluster 會轉送過去），照上面的對應查。
# 受害者是 guest VM／CT（qm／pct 的 stop 類、pvesh 打 …/qemu|lxc/<id>/status…）：herdr 看不到 guest 裡的 pane，一律擋。
#
# 型別：安全型 gate。threat model：防漂移（絆索不是牆），誠實但健忘的 agent 順手寫出來的形狀。
# 不承諾完整語意：`node -e`、腳本檔、heredoc 餵給 shell、alias 與變數、`pct exec` 容器內的 reboot、沒掛 herdr 的程序都看不到。
#
# 判定（命令位置的指令，`bash -c`／`sh -c`／`eval`／`ssh` 的字串引數展開來判；sudo／doas／nice／timeout／env／nohup／xargs 前綴剝掉）：
#   立即：shutdown（-c 放行）、poweroff、reboot、halt、init／telinit 0|6、kexec -e、pm-*、systemctl／loginctl 電源子命令與 target、
#   pvesh 寫入 /nodes/<node>/status（受害機器是 <node>）；curl／wget 帶寫入旗標打 /api2/json/nodes/<node>/status（受害機器是 URL 主機＋路徑 <node>，改道旗標或抽不出主機就全查；GET 放行）。
#   guest（直接擋）：qm／pct 的 stop 類、pvesh 寫入 …/qemu|lxc/<id>/status…。
#   延遲（不看 herdr，到點時誰在工作現在判不了）：shutdown 時間不是 now／+0、--when 非 now、之前有 sleep／at／batch／systemd-run、排程輸入裡有電源指令。
#
# 繞行場景：
#   | 繞法 | 預期攔截點 |
#   | `ssh "$H" reboot`、`ssh pve 'poweroff'`、`bash -c 'ssh pve reboot'` | 進 herdr 檢查：認不得的 host 查全部機器 |
#   | `ssh yudefine-proxmox reboot`、`pvesh create /nodes/yudefine-proxmox/status` | 進 herdr 檢查：只查 desk，zenbook 的 pane 不算 |
#   | `qm stop 100`、`bash -c 'qm stop 100'`、`pvesh create /nodes/pve/qemu/100/status/stop` | 擋：受害者是 guest |
#   | `sudo reboot`、`/sbin/halt` | 進 herdr 檢查 |
#   | `sleep 60 && reboot`、`echo reboot | at now+1min`、`shutdown -h +60` | 擋：判定 7 |
#   | `grep reboot log`、`echo poweroff`、註解、heredoc 內文、`./reboot.sh` | 放行：不在命令位置 |
#   | 弄壞 perl／jq 讓判定掛掉 | 走保守樣式，不靜默放行 |
#
# 判不出來（倒向擋；全擋會癱瘓含 reboot／init／curl 字樣的 Bash，所以降到保守樣式）：
#   | 分支 | 處置 |
#   | E1 jq／perl 不在、E3 stdin 非 JSON 或無 command、E4／E5 判定丟例外或非預期退出 | 保守樣式：命令位置＋前綴的危險形狀 exit 2，其餘 exit 0＋additionalContext |
#   | E2 判定檔缺失 | 不適用：判定內嵌在本檔 |
#   | E7 herdr 不在／逾時／輸出為空或不是預期 JSON（machine list、pane list 皆同）；目標是 machine list 裡已停用（enabled=false）的 label | 擋（exit 2） |
#   | E6 整支 hook 逾時 | harness 砍掉屬 non-blocking：所有 herdr 查詢共用 10 秒時限（單次 3 秒，SIGTERM 不理再 1 秒 SIGKILL，輸出落暫存檔不等 pipe），時限到了算查不到、擋 |
#
# 判定以 exit 42（直接擋）／43（立即電源指令，進 herdr 檢查）表示命中：perl 載入失敗會以 2 結束，NEVER 拿 2 當命中碼。
# 沒有繞過旗標；PreToolUse 只對 agent 的 tool call 觸發，user 自己 terminal 或 `!` 打的指令不受影響。
# 自足：bash＋jq＋perl＋herdr。生效範圍：clade home 的 .claude/settings.json，以及 vendor/scripts/lib/machine-safety-gate.ts
# （MACHINE_SAFETY_GATES，dev-node.ts self-heal 複製到 ~/.claude/hooks/clade-machine-safety/）的 user scope——受害者是整台機器，任何 repo 都要守。

set -uo pipefail

input=$(cat)

# 快篩：絕大多數命令不含任何電源相關字樣，在這裡返回，不付 jq／perl 成本
case "$input" in
  *shutdown* | *poweroff* | *reboot* | *halt* | *init* | *systemctl* | *loginctl* | *kexec* | *suspend* | *hibernate* | *hybrid-sleep* | *qm* | *pct* | *pvesh* | *pvenode* | *curl* | *wget* | *http* | *pm-*) ;;
  *) exit 0 ;;
esac

deny() {
  printf '%s\n' "power command gate: 這條指令被擋下。原因：$1

替代做法：
  - 先查誰在工作：herdr pane list、herdr --machine <peer> pane list（agent_status=working）；請它們收工後再重試
  - 延遲關機（shutdown +N、at、sleep 串 shutdown）一律不放行：改成當下確認後直接 shutdown -h now
  - 只想看狀態：qm status／pct status／pvesh get …/status／systemctl status（唯讀，放行）
  - 要取消已排程的關機：shutdown -c（放行）
本 gate 沒有繞過旗標。" >&2
  exit 2
}

# 立即電源指令：受害機器上除了呼叫者自己，有 herdr pane 的 agent_status=working 就擋；查不到也擋。
# 受害機器：ssh 的目標 host（沒有 ssh 就是本機），母機 yudefine-proxmox 對應 desk。
peers_check() {
  local what=$1 targets=${2:-} herdr="${HERDR_BIN_PATH:-}" self="${HERDR_PANE_ID:-}"
  # 本機的 herdr 機器標籤（peer 的 machine list 認得的名字）：desk 的 hostname 不是 desk，NEVER 只靠 hostname。
  # 順序同 vendor/scripts/lib/herdr-machine.ts 的 localMachineLabel：CLADE_HERDR_MACHINE → ~/.config/clade/herdr-machine，
  # 都沒有才退回 hostname -s。hostname -s 本身也一律算本機（`ssh <本機 hostname> reboot`）。
  local me myhost cfg
  cfg="${XDG_CONFIG_HOME:-${HOME:-}/.config}/clade/herdr-machine"
  me=${POWER_GATE_LOCAL_HOST:-${CLADE_HERDR_MACHINE:-}}
  me=${me//[[:space:]]/}
  if [ -z "$me" ] && [ -r "$cfg" ]; then
    me=$(tr -d '[:space:]' <"$cfg" 2>/dev/null || true)
  fi
  # POWER_GATE_LOCAL_HOST（測試用）同時頂替 hostname，模擬別台機器時不被跑測試那台的真 hostname 干擾
  myhost=${POWER_GATE_LOCAL_HOST:-$(hostname -s 2>/dev/null || true)}
  [ -n "$me" ] || me=$myhost
  me=${me,,}
  myhost=${myhost,,}
  [ -n "$herdr" ] && [ -x "$herdr" ] || herdr=$(command -v herdr 2>/dev/null || true)
  [ -n "$herdr" ] || deny "${what}。herdr 查不到（找不到 herdr 執行檔），無法確認有沒有別的 agent 在工作，一律擋。"
  command -v jq >/dev/null 2>&1 || deny "${what}。herdr 查不到（jq 不在）。"
  # 輸出落暫存檔不用 $()：herdr 的孫程序（ssh）若撐過 kill 還握著 stdout，$() 會等 pipe 關閉而撐到 hook timeout。
  herdr_query() {
    local sec=$1 f rc=0
    shift
    f=$(mktemp "${TMPDIR:-/tmp}/power-gate.XXXXXX") || return 1
    timeout -k 1 "$sec" "$herdr" "$@" >"$f" 2>/dev/null || rc=$?
    cat "$f"
    rm -f "$f"
    return "$rc"
  }
  local machines label
  local ml_fail=0
  machines=$(herdr_query 3 machine list --json) || ml_fail=1
  # exit 0 但 stdout 為空：jq 也 exit 0 無輸出，會被當成「沒有 peer」而 fail-open（E7）
  [ -n "${machines//[[:space:]]/}" ] || ml_fail=1
  local -a enabled=() disabled=()
  if ((!ml_fail)); then
    local labels dlabels
    labels=$(printf '%s' "$machines" | jq -r 'if type == "array" then .[] | select(.enabled == true) | .label else error("not an array") end' 2>/dev/null) || ml_fail=1
    dlabels=$(printf '%s' "$machines" | jq -r 'if type == "array" then .[] | select(.enabled != true) | .label else error("not an array") end' 2>/dev/null) || ml_fail=1
    while IFS= read -r label; do
      if [ -n "$label" ]; then enabled+=("$label"); fi
    done <<<"$labels"
    while IFS= read -r label; do
      if [ -n "$label" ]; then disabled+=("$label"); fi
    done <<<"$dlabels"
  fi

  # 目標機器 → scope（"@local" 或 peer label）；"@all" = 本機＋所有啟用的 peer
  local -a scopes=()
  local h m found y x
  add_scope() {
    x=$1
    if [ "$x" = "$me" ] || { [ -n "$myhost" ] && [ "$x" = "$myhost" ]; }; then x="@local"; fi
    for y in "${scopes[@]:-}"; do [ "$y" = "$x" ] && return 0; done
    scopes+=("$x")
  }
  if [ -z "$targets" ]; then
    add_scope "@local"
  else
    local -a hosts
    IFS=',' read -r -a hosts <<<"$targets"
    for h in "${hosts[@]}"; do
      if [ "$h" = "$me" ] || { [ -n "$myhost" ] && [ "$h" = "$myhost" ]; }; then
        add_scope "@local"
        continue
      fi
      case "$h" in
        "@local" | localhost | 127.* | ::1) add_scope "@local" ;;
        yudefine-proxmox | desk) add_scope desk ;;
        zenbook) add_scope zenbook ;;
        *)
          found=""
          for m in "${enabled[@]:-}"; do if [ "${m,,}" = "$h" ]; then found=$m; fi; done
          for m in "${disabled[@]:-}"; do
            if [ -n "$m" ] && [ "${m,,}" = "$h" ]; then
              deny "${what}。目標主機 ${h} 在 herdr machine list 裡但已停用（enabled=false），查不到它有沒有 agent 在工作，一律擋。"
            fi
          done
          if [ -n "$found" ]; then
            add_scope "$found"
          elif ((ml_fail)); then
            deny "${what}。herdr 查不到（machine list 失敗），目標主機 ${h} 認不得又列不出 peer 機器，無法確認有沒有別的 agent 在工作，一律擋。"
          else
            add_scope "@all"
          fi
          ;;
      esac
    done
  fi
  local s2
  local -a final=()
  for s2 in "${scopes[@]}"; do
    if [ "$s2" = "@all" ]; then
      final+=("@local")
      for m in "${enabled[@]:-}"; do if [ -n "$m" ]; then final+=("$m"); fi; done
    else
      final+=("$s2")
    fi
  done

  # 所有 herdr 查詢共用一個時限（含上面的 machine list），留在 hook timeout（15s）之內：
  # 超時被 harness 殺掉＝non-blocking＝放行，所以時限到了還沒查完的機器算查不到、一律擋。
  local scope json out working="" failed="" name left seen=" " budget=${POWER_GATE_HERDR_BUDGET:-10}
  for scope in "${final[@]}"; do
    case "$seen" in *" $scope "*) continue ;; esac
    seen="${seen}${scope} "
    if [ "$scope" = "@local" ]; then name="本機(${me:-?})"; else name=$scope; fi
    left=$((budget - SECONDS))
    if ((left < 1)); then failed="${failed} ${name}(逾時)"; continue; fi
    ((left > 3)) && left=3
    if [ "$scope" = "@local" ]; then
      json=$(herdr_query "$left" pane list) || { failed="${failed} ${name}"; continue; }
    else
      json=$(herdr_query "$left" --machine "$scope" pane list) || { failed="${failed} ${name}"; continue; }
    fi
    # exit 0 但 stdout 為空：jq 也 exit 0 無輸出，會被當成「沒有 working pane」而放行（E7）
    if [ -z "${json//[[:space:]]/}" ]; then failed="${failed} ${name}"; continue; fi
    out=$(printf '%s' "$json" | jq -r --arg scope "$scope" --arg self "$self" --arg name "$name" '
      if (.result.panes | type) != "array" then "ERR"
      else .result.panes[]
        | select(.agent_status == "working")
        | select(($scope != "@local") or (.pane_id != $self))
        | "  - [" + $name + "] " + .pane_id + " " + (.label // .terminal_title_stripped // "")
      end' 2>/dev/null) || { failed="${failed} ${name}"; continue; }
    if [ "$out" = "ERR" ]; then failed="${failed} ${name}"; continue; fi
    if [ -n "$out" ]; then working="${working}${out}"$'\n'; fi
  done
  if [ -n "$failed" ]; then
    deny "${what}。herdr 查不到：${failed# }（pane list 失敗或回傳不是預期 JSON），無法確認有沒有別的 agent 在工作，一律擋。${working:+
另外這些 pane 正在 working：
${working%$'\n'}}"
  fi
  if [ -n "$working" ]; then
    deny "${what}。受影響的機器上除了這個 session 自己，還有 agent 正在 working，電源動作會砍掉它們的工作：
${working%$'\n'}
等它們收工（或請主持者讓它們停手）後再重試。"
  fi
  exit 0
}

# 保守樣式的單字判定：$1＝指令名（已去路徑與引號）、$2＝後面的引數。
conservative_match() {
  local word=$1 rest=${2//[\"\']/} sub="" r
  local -a rw
  read -r -a rw <<<"$rest"
  for r in "${rw[@]:-}"; do
    case "$r" in -*) continue ;; esac
    sub=$r
    break
  done
  case "$word" in
    shutdown) case " $rest " in *" -c "*) return 0 ;; esac ;;
    poweroff | reboot | halt | pm-suspend | pm-hibernate | pm-suspend-hybrid) ;;
    init | telinit) case "$sub" in 0 | 6) ;; *) return 0 ;; esac ;;
    systemctl | loginctl)
      case " $rest " in
        *" poweroff "* | *" reboot "* | *" halt "* | *" kexec "* | *" suspend "* | *" sleep "* | *" hibernate "* | *" hybrid-sleep "* | *" suspend-then-hibernate "* | *" soft-reboot "*) ;;
        *) return 0 ;;
      esac
      ;;
    qm | pct) case "$sub" in stop | shutdown | reboot | restart | suspend | reset | hibernate) ;; *) return 0 ;; esac ;;
    kexec) case " $rest " in *" -e "* | *" -f "* | *" --exec "* | *" --force "*) ;; *) return 0 ;; esac ;;
    pvesh)
      case " $rest " in
        *" create "* | *" set "* | *" post "* | *" put "*) case "$rest" in */status* | */stopall* | */suspendall*) ;; *) return 0 ;; esac ;;
        *) return 0 ;;
      esac
      ;;
    pvenode) case "$sub" in stopall | suspendall) ;; *) return 0 ;; esac ;;
    *) return 0 ;;
  esac
  deny "判定無法執行（保守樣式，不問 herdr，一律擋）：${word}。"
}

# 判定用不了時的保守樣式：段首的指令照比；段首是前綴（sudo、ssh、bash -c…）時後面每個字都比（寧可多擋）。
conservative() {
  local t=$1 source=${2:-stdin} c seg w i n chain
  local -a words
  # 跳脫字元先換成佔位，剩下的 " 才是真的字串邊界
  t=${t//\\\\/$'\x01'}
  t=${t//\\\"/$'\x02'}
  if [ "$source" = stdin ] && [[ $t == *'"command"'* ]]; then # 原始 stdin 是 JSON：只看 command 欄位，不拿 JSON 外殼當指令（純 bash，不靠外部工具）
    c=${t#*\"command\"}
    c=${c#*:}
    c=${c#*\"}
    c=${c%%\"*} # 後面還有 description、tool_use_id 等欄位，切在第一個收尾引號
    [ -n "$c" ] && t=$c
  fi
  t=${t//\\n/$'\n'}
  t=${t//\\t/$'\t'}
  t=${t//$'\x02'/\"}
  t=${t//$'\x01'/\\}
  t=${t//;/$'\n'}
  t=${t//&/$'\n'}
  t=${t//|/$'\n'}
  t=${t//\`/$'\n'}
  t=${t//(/$'\n'}
  t=${t//)/$'\n'}
  while IFS= read -r seg; do
    read -r -a words <<<"$seg"
    n=${#words[@]}
    chain=0
    for ((i = 0; i < n; i++)); do
      w=${words[i]}
      w=${w#[\"\']}
      w=${w%[\"\']}
      while [[ $w == \\* ]]; do w=${w#\\}; done
      w=${w##*/}
      case "$w" in
        sudo | doas | pkexec | nice | timeout | ssh | env | nohup | time | command | exec | eval | setsid | xargs | busybox | bash | sh)
          chain=1
          continue
          ;;
        # 命令前的語法詞與變數賦值：只跳過，下一個字才是命令位置（NEVER 因此往後每個字都比）
        do | then | else | elif | if | while | until | '!' | '{' | [A-Za-z_]*=*) continue ;;
      esac
      conservative_match "$w" "${words[*]:i+1}"
      ((chain)) || break
    done
  done <<<"$t"
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"power command gate 判定故障（jq／perl 不可用或輸入非預期），只做了保守檢查：電源指令（shutdown／reboot／poweroff／halt／qm stop／pct stop 等）執行前 MUST 先用 herdr pane list（含 peer 機器）確認沒有別的 agent 在 working。"}}'
  exit 0
}

command -v jq >/dev/null 2>&1 || conservative "$input"
command -v perl >/dev/null 2>&1 || conservative "$input"
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || conservative "$input"
[ -n "$cmd" ] || conservative "$input"

# shellcheck disable=SC2016 # perl 原文，$ 不給 shell 展開
judge='
use strict;
use warnings;

sub strip_heredocs {
  my @out; my @pending;
  for my $line (split /\n/, $_[0], -1) {
    if (@pending) {
      shift @pending if $line =~ /^\t*\Q$pending[0]\E\s*$/;
      next;
    }
    push @out, $line;
    my $code = $line;
    $code =~ s/(?<!<)(?<!<-)(?<!<\s)\x27[^\x27]*\x27//g;
    $code =~ s/(?<!<)(?<!<-)(?<!<\s)"[^"]*"//g;
    while ($code =~ /(?<!<)<<(?!<)-?\s*(?:\x27([^\x27]+)\x27|"([^"]+)"|\\?([\w.-]+))/g) {
      push @pending, $1 // $2 // $3;
    }
  }
  # 分隔字串沒閉合（多半是 1<<2 這種位移）：不當 heredoc，整段照判。
  return $_[0] if @pending;
  return join "\n", @out;
}

sub close_paren {
  my ($s, $i) = @_;
  my ($depth, $n) = (0, length $s);
  for (; $i < $n; $i++) {
    my $c = substr($s, $i, 1);
    if ($c eq "\\") { $i++; next }
    if ($c eq "\x27") { my $e = index($s, "\x27", $i + 1); return $n - 1 if $e < 0; $i = $e; next }
    $depth++ if $c eq "(";
    if ($c eq ")") { $depth--; return $i if $depth == 0 }
  }
  return $n - 1;
}

my $exec_ctx = qr/(?:(?<![\w.-])eval|(?<![\w.-])(?:ba|z|da|k)?sh(?![\w.-])(?:\s+-\w+)*\s+-\w*c|(?<![\w.-])ssh(?![\w.-])[^;&|\n]*)\s+$/;
# ssh 後面還沒出現 host（只有選項）：這個引號字串是 host 或選項值，NEVER 當遠端指令展開。
my $ssh_no_host = qr/(?<![\w.-])ssh(?:\s+(?:-[pilFJoLRDbcemOQSWwBEI]\s+\S+|-\S+))*\s+$/;

sub quoted_view {
  my ($prefix, $body, $kept) = @_;
  if ($prefix =~ $ssh_no_host) {
    (my $tok = $body) =~ s/[\s()`;&|]//g;
    return length($tok) ? $tok : "?quoted";
  }
  if ($prefix =~ $exec_ctx) {
    (my $inner = $body) =~ s/\\([\$`"\\])/$1/g;
    return " ( " . sanitize($inner) . " ) ";
  }
  return $body if $body =~ /^-?[\w%.]+$/;
  return length($kept) ? $kept : "\"\"";
}

sub sanitize {
  my ($s) = @_;
  my ($o, $i, $n) = ("", 0, length $s);
  while ($i < $n) {
    my $c = substr($s, $i, 1);
    if ($c eq "\\") { # 反斜線換行是折行；註解在實體換行就結束，不經這裡
      $o .= substr($s, $i, 2) if substr($s, $i + 1, 1) ne "\n";
      $i += 2;
      next;
    }
    if ($c eq "#" && ($i == 0 || substr($s, $i - 1, 1) =~ /[\s;&|(]/)) {
      my $e = index($s, "\n", $i);
      $i = $e < 0 ? $n : $e;
      next;
    }
    if ($c eq "\x27") {
      my $e = index($s, "\x27", $i + 1);
      $e = $n if $e < 0;
      $o .= quoted_view($o, substr($s, $i + 1, $e - $i - 1), "");
      $i = $e + 1;
      next;
    }
    if ($c eq "\"") {
      my ($j, $kept) = ($i + 1, "");
      while ($j < $n) {
        my $d = substr($s, $j, 1);
        last if $d eq "\"";
        if ($d eq "\\") { $j += 2; next }
        if (substr($s, $j, 2) eq "\$(") {
          my $e = close_paren($s, $j + 1);
          $kept .= " \$(" . sanitize(substr($s, $j + 2, $e - $j - 2)) . ") ";
          $j = $e + 1;
          next;
        }
        if ($d eq "`") {
          my $e = index($s, "`", $j + 1);
          $e = $n if $e < 0;
          $kept .= " \$(" . sanitize(substr($s, $j + 1, $e - $j - 1)) . ") ";
          $j = $e + 1;
          next;
        }
        if (substr($s, $j) =~ /^(\$\w+|\$\{[^}]*\}|\$[\$!])/) {
          $kept .= $1;
          $j += length $1;
          next;
        }
        $j++;
      }
      $o .= quoted_view($o, substr($s, $i + 1, $j - $i - 1), $kept);
      $i = $j + 1;
      next;
    }
    $o .= $c;
    $i++;
  }
  return $o;
}

sub args_from {
  my ($s, $pos) = @_;
  my ($n, @tok, $cur) = (length $s);
  $cur = "";
  for (my $i = $pos; $i < $n; $i++) {
    my $c = substr($s, $i, 1);
    if ($c eq "\\") { $cur .= substr($s, $i, 2); $i++; next }
    if ($c eq "(") {
      my $e = close_paren($s, $i);
      $cur .= substr($s, $i, $e - $i + 1);
      $i = $e;
      next;
    }
    if ($c eq "`") {
      my $e = index($s, "`", $i + 1);
      last if $e < 0;
      $cur .= substr($s, $i, $e - $i + 1);
      $i = $e;
      next;
    }
    last if $c =~ /[;&|)\n]/;
    if ($c =~ /\s/) { if (length $cur) { push @tok, $cur; $cur = "" } next }
    $cur .= $c;
  }
  push @tok, $cur if length $cur;
  return @tok;
}

sub first_nonopt {
  my ($valre, @a) = @_;
  my $eoo = 0;
  while (@a) {
    my $x = shift @a;
    if (!$eoo) {
      if ($x eq "--") { $eoo = 1; next }
      if ($x =~ $valre) { shift @a unless $x =~ /=/; next }
      next if $x =~ /^-/;
    }
    return $x;
  }
  return undef;
}

# systemctl／loginctl 的 -H／--host 目標（user@host 去掉 user@）。
sub host_opts {
  my @a = @_;
  my @out;
  while (@a) {
    my $x = shift @a;
    my $v;
    if ($x =~ /^(?:-H|--host)$/) { $v = shift @a }
    elsif ($x =~ /^--host=(.+)$/) { $v = $1 }
    elsif ($x =~ /^-H(.+)$/) { $v = $1 }
    next unless defined $v;
    $v =~ s/^.*@//;
    push @out, lc $v;
  }
  return @out;
}

my $power_verb = qr/(?:poweroff|reboot|halt|kexec|suspend|sleep|hibernate|hybrid-sleep|suspend-then-hibernate|soft-reboot)/;
my $guest_verb = qr/(?:stop|shutdown|reboot|restart|suspend|reset|hibernate)/;
my $sysctl_val = qr/^(?:-[HMtpsnoT]|--(?:host|machine|type|property|signal|lines|output|root|kill-whom|kill-who|kill-value|state|preset-mode|job-mode|message|when|timeout|reboot-argument|boot-loader-entry|boot-loader-menu|check-inhibitors))$/;
# vmid／node 段都收變數（`/qemu/$id/status/stop`）；路徑後面接 ; & | ) < > 反引號一樣算結尾。
my $status_path = qr{nodes/[^\s/\x27"]+/(?:(?:(?:qemu|lxc)/[^\s/\x27"]+/)?status(?:/(?:stop|shutdown|reboot|suspend|reset|hibernate))?|stopall|suspendall)(?=[\s\x27"?;&|)<>\x60]|$)};

# 電源指令原文樣式（at／systemd-run 的字串、herestring、heredoc 裡也要看得到）。
my $power_text = qr{\b(?:shutdown|poweroff|reboot|halt)\b(?![.\w-])|\binit\s+[06]\b|\b(?:systemctl|loginctl)\s+(?:\S+\s+)*?$power_verb\b|\b(?:qm|pct)\s+$guest_verb\b};

local $/;
my $raw = <STDIN> // "";
my $text = strip_heredocs($raw);
(my $scan = $text) =~ s/(?:^|(?<=\s))#.*$//mg;
$scan =~ s/(?<!\\)((?:\\\\)*)\\\n/$1/g;
my $code = sanitize($text);
$code =~ s/&>>?\s*[^\s;&|)]+//g;
$code =~ s/\d*[<>]&\d+//g;
$code =~ s/\d*>>?\s*[^\s;&|)]+//g;

my $pw = qr/(?:shutdown|poweroff|reboot|halt|init|telinit|kexec|pm-suspend|pm-hibernate|pm-suspend-hybrid|systemctl|loginctl|qm|pct|pvesh|pvenode|curl|wget|https|http)/;

# 命令前的包裝詞（sudo／timeout／ssh／xargs…）；$position、延遲判定、排程判定共用，NEVER 各寫一份讓前綴剝法漂移。
my $prefix_chain = qr{
  (?: (?: command | builtin | exec | eval | nohup | setsid | time | env | busybox
        | (?: sudo | doas | pkexec | nice ) (?: \s+ -\S+ (?: \s+ (?!$pw\b) [^-\s]\S* )?? )*
        | timeout (?: \s+ -\S+ (?: \s+ [^-\s]\S* )?? )* \s+ \S+
        | ssh (?: \s+ -\S+ (?: \s+ [^-\s]\S* )?? )* \s+ \S+
        | xargs (?: \s+ -\S+ (?: \s+ (?!$pw\b) [^-\s]\S* )?? )*
      ) (?: \s+ -\S+ )* \s+ (?: \w+=\S* \s+ )* )*
}x;
my $lead = qr{
  (?: ^ | [;&|()`\n\{] | -execdir\b | -exec\b )
  \s*
  (?: (?: then | do | else | elif | if | while | until | ! ) \s+ )*
  (?: (?:env\s+)? \w+=\S* \s+ )*
}x;

my $position = qr{
  $lead
  ( $prefix_chain )
  \\? (?: \S*/ )? ($pw) (?= \s | $ | [;&|)`] )
}x;

sub delayed_before {
  my ($pos) = @_;
  return substr($code, 0, $pos) =~ m{$lead$prefix_chain\\?(?:\S*/)?(?:sleep|usleep|at|batch|systemd-run)(?=\s|$)} ? 1 : 0;
}

# ssh 目標主機：文字裡（沒有 $ 錨點）最後一個 `ssh [opts] host`；user@ 與 :port 去掉。
my $ssh_host_re = qr{(?<![\w.-])ssh(?:\s+(?:-[pilFJoLRDbcemOQSWwBEI]\s+\S+|-\S+))*\s+([^\s\-()][^\s()]*)};
sub norm_host { my ($h) = @_; $h =~ s/^.*@//; $h =~ s/:\d+$//; return lc $h }
sub ssh_host_in { my ($t) = @_; my $h; while ($t =~ /$ssh_host_re/g) { $h = norm_host($1) } return $h }

# $pos 這個位置被哪個 ssh 的字串引數包住（sanitize 把 ssh 字串展開成 `( … )`）；沒有就 undef。
sub enclosing_ssh {
  my ($pos) = @_;
  my $pre = substr($code, 0, $pos);
  my @stack;
  for (my $i = 0; $i < length $pre; $i++) {
    my $c = substr($pre, $i, 1);
    if ($c eq "(") { my $t = substr($pre, 0, $i); push @stack, ($t =~ /$ssh_host_re\s*$/ ? norm_host($1) : undef) }
    elsif ($c eq ")") { pop @stack }
  }
  my @h = grep { defined } @stack;
  return @h ? $h[-1] : undef;
}

# hit：延遲的直接擋（42）；立即的先記下受害機器，跑完整條指令再一起交給 herdr 檢查（43）。
my ($imm_reason, @imm_targets, $cur_default);
my @cmd_ssh_hosts; { my $t = $code; while ($t =~ /$ssh_host_re/g) { push @cmd_ssh_hosts, norm_host($1) } }
sub hit {
  my ($reason, $delayed, @t) = @_;
  if ($delayed) { print "延遲執行的電源指令（$reason）。延遲關機一律不放行。"; exit 42 }
  # ssh 底下的明示主機（-H localhost、URL localhost）以 ssh 的主機為準之一，一併查（超集，不縮小範圍）。
  # localhost／127.*／::1 與本機同義：先併成 @local，下面「本機就補查 ssh 主機」才吃得到。
  @t = map { /^(?:localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/ ? "\@local" : $_ } @t;
  push @t, $cur_default if !@t || $cur_default ne "\@local";
  # 這個子指令算本機、但整條指令另有 ssh：ssh 的目標也一併查（`ssh pve ls \; reboot` 這類解析不準的寫法不 fail-open）。
  push @t, @cmd_ssh_hosts if grep { $_ eq "\@local" } @t;
  $imm_reason //= $reason;
  push @imm_targets, @t;
}
# 受害者是 guest VM／CT：herdr 看不到 guest 裡的 pane，不論在哪台下指令都直接擋（42）。
sub guest_hit {
  my ($reason, $delayed) = @_;
  if ($delayed) { print "延遲執行的電源指令（$reason）。延遲關機一律不放行。"; exit 42 }
  print "$reason 的受害者是 guest VM／CT。herdr 看不到 guest 裡的 pane，一律擋。";
  exit 42;
}

while ($code =~ /$position/g) {
  my ($prefix, $word, $end, $wpos) = ($1, $2, pos $code, $-[2]);
  my $dctx = delayed_before($wpos);
  $cur_default = ssh_host_in($prefix) // enclosing_ssh($wpos) // "\@local";
  next if $prefix =~ /\bcommand\s+-\w*[vV]/; # command -v reboot 只是查路徑
  my @args = args_from($code, $end);
  if ($word eq "shutdown") {
    next if grep { $_ eq "-c" } @args; # 取消排程，是收回不是動作
    my $when = first_nonopt(qr/(?!)/, @args);
    hit("shutdown", !defined $when || $when !~ /^(?:now|\+0)$/ || $dctx);
  }
  if ($word =~ /^(?:poweroff|reboot|halt)$/) {
    next if @args && !grep { $_ !~ /^(?:--help|--version|-w|--wtmp-only)$/ } @args;
    hit($word, $dctx);
  }
  if ($word =~ /^pm-(?:suspend|hibernate|suspend-hybrid)$/) { hit($word, $dctx) }
  if ($word =~ /^(?:init|telinit)$/) {
    my $lvl = first_nonopt(qr/(?!)/, @args);
    if (defined $lvl && $lvl =~ /^[06]$/) { hit("$word $lvl", $dctx) }
    next;
  }
  if ($word eq "kexec") {
    if (grep { /^(?:-[a-zA-Z]*[ef][a-zA-Z]*|--exec|--force)$/ } @args) { hit("kexec -e", $dctx) }
    next;
  }
  if ($word eq "systemctl" || $word eq "loginctl") {
    my $sub = first_nonopt($sysctl_val, @args);
    next unless defined $sub;
    my @hh = host_opts(@args); # systemctl -H root@pve reboot：受害機器是 -H 的主機
    my $machine = grep { /^(?:-M.*|--machine(?:=.*)?)$/ } @args; # -M：目標是 container，herdr 看不到 container 裡的 pane
    my $delayed = $dctx || join(" ", @args) =~ /(?:^|\s)--when[=\s](?!now(?:\s|$))/; # systemd 的排程重開／關機
    if ($sub =~ /^$power_verb$/) {
      guest_hit("$word -M／--machine $sub", $delayed) if $machine;
      hit("$word $sub", $delayed, @hh);
    }
    if ($word eq "systemctl" && $sub =~ /^(?:start|isolate|restart|try-restart)$/
        && grep { /^(?:systemd-)?$power_verb\.(?:target|service)$/ || /^(?:shutdown|sleep|exit|runlevel[06])\.target$/ } @args) {
      guest_hit("systemctl -M／--machine $sub 電源 target／service", $delayed) if $machine;
      hit("systemctl $sub 電源 target／service", $delayed, @hh);
    }
    next;
  }
  if ($word eq "qm" || $word eq "pct") {
    my $sub = first_nonopt(qr/(?!)/, @args);
    # 關掉的是 guest VM／CT，不是本機；本機 herdr 看不到 guest 裡的 pane
    if (defined $sub && $sub =~ /^$guest_verb$/) { guest_hit("$word $sub", $dctx) }
    next;
  }
  if ($word eq "pvesh") {
    # 路徑引號內的字面值被 sanitize 吃掉，改比對原文。
    while ($scan =~ m{\bpvesh\s+(?:-\S+\s+)*(?:create|set|post|put)\s+[^;&|\n]*?($status_path)}g) {
      my $path = $1;
      my ($node, $guest) = $path =~ m{^nodes/([^/]+)/((?:qemu|lxc)/)?};
      guest_hit("pvesh 對 …/qemu|lxc/<id>/status 寫入", $dctx) if $guest;
      guest_hit("pvesh 對 …/stopall|suspendall 寫入（停該 node 全部 guest）", $dctx) if $path =~ m{/(?:stopall|suspendall)$};
      # 受害機器是 <node>（cluster 會轉送過去）；變數或認不得的 node 由 peers_check 查全部機器
      hit("pvesh 對 /nodes/$node/status 寫入", $dctx, lc $node);
    }
    next;
  }
  if ($word eq "pvenode") {
    # pvenode stopall 一次停掉該 node 全部 guest：目標是 guest，本機 herdr 看不到
    my $sub = first_nonopt(qr/(?!)/, @args);
    if (defined $sub && $sub =~ /^(?:stopall|suspendall)$/) { guest_hit("pvenode $sub（停全部 guest）", $dctx) }
    next;
  }
  # curl／wget／http：帶寫入旗標打 PVE API 的 status 路徑
  if ($scan =~ m{\b(?:curl|wget|https?)\s[^;&|\n]*?/api2/json/$status_path}
      && $scan =~ m{\b(?:curl|wget|https?)\s[^;&|\n]*?(?:(?<=\s)-[A-Za-z]*X\s*(?i:POST|PUT)|(?<=\s)-[A-Za-z]*[dFT](?=\s|$|\S)|--request[=\s]+(?i:POST|PUT)|--method[=\s]+(?i:POST|PUT)|--(?:data|form|json|upload-file|post-data|post-file)\S*|(?<=\s)(?i:POST|PUT)(?=\s))}) {
    # 受害機器是 URL 的主機（認不得的主機＝全查）；沒有 URL 主機、或帶連線改道旗標（--resolve／--connect-to／
    # -x／--proxy／--unix-socket／--proto-default）時 URL 主機不可信，一併查全部。
    guest_hit("$word 對 /api2/json/nodes/*/stopall|suspendall 寫入（停該 node 全部 guest）", $dctx)
      if $scan =~ m{\b(?:curl|wget|https?)\s[^;&|\n]*?/api2/json/nodes/[^\s/\x27"]+/(?:stopall|suspendall)(?=[\s\x27"?;&|)<>\x60]|$)};
    guest_hit("$word 對 /api2/json/nodes/*/qemu|lxc/<id>/status 寫入", $dctx)
      if $scan =~ m{\b(?:curl|wget|https?)\s[^;&|\n]*?/api2/json/nodes/[^\s/\x27"]+/(?:qemu|lxc)/[^\s/\x27"]+/status(?:/(?:stop|shutdown|reboot|suspend|reset|hibernate))?(?=[\s\x27"?;&|)<>\x60]|$)};
    my @uh;
    my $unresolved = 0;
    # 無關的字面 URL 也算（保守多查），但它不能替 status 路徑背書
    while ($scan =~ m{\bhttps?://(?:[^/@\s\x27"]*@)?([^/:\s\x27"?]+)}g) { push @uh, lc $1 }
    # PVE API 會把 POST 轉送給路徑上的 <node>：URL 主機不是唯一受害者，路徑 node 也算目標。
    # 每條 status 路徑都要緊接在字面 http(s)://host(:port) 之後才算解析出 URL 主機；
    # 前面是變數（$PVE/api2/…）、$(…)、或另一個無關 URL 時，該路徑的 URL 主機不可信。
    while ($scan =~ m{(\bhttps?://(?:[^/@\s\x27"]*@)?[^/:\s\x27"?]+(?::\d+)?)?/api2/json/nodes/([^\s/\x27"]+)/(?:(?:qemu|lxc)/[^\s/\x27"]+/)?status}g) {
      push @uh, lc $2;
      $unresolved = 1 if !defined $1;
    }
    push @uh, "?unresolved" if $unresolved || !@uh
      || $scan =~ m{(?<=\s)(?:--resolve|--connect-to|--proxy\S*|--preproxy|--socks\S*|--noproxy|--unix-socket|--abstract-unix-socket|--proto-default|--config|--doh-url|--dns-\S+|--interface)(?=[\s=]|$)}
      || $scan =~ m{(?<=\s)-[A-Za-z]*[xK]}
      || $scan =~ m{\b(?:https?_proxy|all_proxy|HTTPS?_PROXY|ALL_PROXY)=};
    hit("$word 對 /api2/json/nodes/*/status 寫入", $dctx, @uh);
  }
}
if ($code =~ m{$lead$prefix_chain\\?(?:\S*/)?(?:at|batch|systemd-run)(?=\s|$)(?!\s+-[lrdcV]\b)} && $raw =~ $power_text) {
  print "at／batch／systemd-run 排程電源指令。延遲關機一律不放行。";
  exit 42;
}
if (@imm_targets) {
  my %seen;
  print "$imm_reason\nTARGET:" . join(",", grep { !$seen{$_}++ } @imm_targets);
  exit 43;
}
exit 0;
'

reason=$(printf '%s' "$cmd" | LC_ALL=C perl -e "$judge" 2>/dev/null)
rc=$?
case "$rc" in
  0) exit 0 ;;
  42) deny "$reason" ;;
  43) peers_check "${reason%%$'\n'*}" "${reason#*$'\n'TARGET:}" ;;
  *) conservative "$cmd" command ;;
esac
