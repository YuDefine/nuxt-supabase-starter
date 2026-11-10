#!/usr/bin/env bash
# PreToolUse:Bash hook — 本機電源指令（關機、重開、休眠、停 VM／CT）執行前，先確認本機沒有別的 agent 在工作（block，exit 2）
#
# 約束（允許 agent 關機，不是只有人能按）：本機電源指令只在「本機除了呼叫者自己，沒有 herdr pane 的
# agent_status=working」時放行；有就擋並列出；herdr 查不到也擋。延遲關機一律擋。
# 目標不是本機（ssh 底下、systemctl -H、curl／wget 打 PVE API、qm／pct 停 guest、pvesh 打 guest 或別的 node）：
# 本版不判受害機器，一律擋，NEVER 當本機查——本機 herdr 看不到 guest 或別的 node 裡的 pane。
#
# 型別：安全型 gate。threat model：防漂移（絆索不是牆），誠實但健忘的 agent 順手寫出來的形狀。
# 不承諾完整語意：`node -e`、腳本檔、heredoc 餵給 shell、alias 與變數、`pct exec` 容器內的 reboot、沒掛 herdr 的程序都看不到。
#
# 判定（命令位置的指令，`bash -c`／`sh -c`／`eval`／`ssh` 的字串引數展開來判；sudo／doas／nice／timeout／env／nohup／xargs 前綴剝掉）：
#   立即：shutdown（-c 放行）、poweroff、reboot、halt、init／telinit 0|6、kexec -e、pm-*、systemctl／loginctl 電源子命令與 target、
#   pvesh 寫入 /nodes/<本機 hostname|localhost>/status。
#   遠端（直接擋）：qm／pct 的 stop 類（受害者是 guest）、pvesh 寫入 …/qemu|lxc/<id>/status…（guest）或 /nodes/<別的 node>/status
#   （cluster 會轉送到該 node；node 是變數也算）、curl／wget 帶寫入旗標打 /api2/json/nodes/*/status（GET 放行）。
#   延遲（不看 herdr，到點時誰在工作現在判不了）：shutdown 時間不是 now／+0、--when 非 now、之前有 sleep／at／batch／systemd-run、排程輸入裡有電源指令。
#
# 繞行場景：
#   | 繞法 | 預期攔截點 |
#   | `ssh "$H" reboot`、`ssh pve 'poweroff'`、`bash -c 'ssh pve reboot'` | 擋：目標不是本機 |
#   | `qm stop 100`、`pvesh create /nodes/pve/qemu/100/status/stop`、`pvesh create /nodes/<別台>/status` | 擋：受害者是 guest／別的 node |
#   | `sudo reboot`、`pvesh create /nodes/<本機>/status`、`/sbin/halt` | 進 herdr 檢查 |
#   | `sleep 60 && reboot`、`echo reboot | at now+1min`、`shutdown -h +60` | 擋：判定 7 |
#   | `grep reboot log`、`echo poweroff`、註解、heredoc 內文、`./reboot.sh` | 放行：不在命令位置 |
#   | 弄壞 perl／jq 讓判定掛掉 | 走保守樣式，不靜默放行 |
#
# 判不出來（倒向擋；全擋會癱瘓含 reboot／init／curl 字樣的 Bash，所以降到保守樣式）：
#   | 分支 | 處置 |
#   | E1 jq／perl 不在、E3 stdin 非 JSON 或無 command、E4／E5 判定丟例外或非預期退出 | 保守樣式：命令位置＋前綴的危險形狀 exit 2，其餘 exit 0＋additionalContext |
#   | E2 判定檔缺失 | 不適用：判定內嵌在本檔 |
#   | E7 herdr 不在／逾時／輸出為空或不是預期 JSON | 擋（exit 2） |
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

local_check() {
  local what=$1 herdr="${HERDR_BIN_PATH:-}" self="${HERDR_PANE_ID:-}" json out
  [ -n "$herdr" ] && [ -x "$herdr" ] || herdr=$(command -v herdr 2>/dev/null || true)
  [ -n "$herdr" ] || deny "${what}。herdr 查不到（找不到 herdr 執行檔），無法確認有沒有別的 agent 在工作，一律擋。"
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
  # 所有 herdr 查詢共用一個時限，留在 hook timeout（15s）之內：超時被 harness 殺掉＝non-blocking＝放行，
  # 所以時限到了還沒查完就算查不到、一律擋。
  local left budget=${POWER_GATE_HERDR_BUDGET:-10}
  left=$((budget - SECONDS))
  if ((left < 1)); then deny "${what}。herdr 查不到（查詢逾時），一律擋。"; fi
  ((left > 3)) && left=3
  json=$(herdr_query "$left" pane list) || deny "${what}。herdr 查不到（pane list 失敗或逾時），一律擋。"
  # exit 0 但 stdout 為空：jq 也 exit 0 無輸出，會被當成「沒有 working pane」而放行（E7）
  [ -n "${json//[[:space:]]/}" ] || deny "${what}。herdr 查不到（pane list 輸出為空），一律擋。"
  out=$(printf '%s' "$json" | jq -r --arg self "$self" '
    if (.result.panes | type) != "array" then "ERR"
    else .result.panes[]
      | select(.agent_status == "working")
      | select(.pane_id != $self)
      | "  - " + .pane_id + " " + (.label // .terminal_title_stripped // "")
    end' 2>/dev/null) || deny "${what}。herdr 查不到（回傳不是預期 JSON），一律擋。"
  [ "$out" != "ERR" ] || deny "${what}。herdr 查不到（回傳不是預期 JSON），一律擋。"
  [ -z "$out" ] || deny "${what}。本機除了這個 session 自己，還有 agent 正在 working，電源動作會砍掉它們的工作：
${out}
等它們收工（或請主持者讓它們停手）後再重試。"
  exit 0
}

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
use Sys::Hostname ();

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

# 整條指令有 ssh 就不當本機（超集）：`ssh "$H" reboot`、`ssh pve ls \; reboot` 都不能退成只查本機。
my $has_ssh = $code =~ /(?<![\w.-])ssh(?![\w.-])/ ? 1 : 0;
my $imm_reason;

# hit：延遲或目標不是本機的直接擋（42）；立即的本機指令記下來，整條跑完再交給 herdr 檢查（43）。
sub hit {
  my ($reason, $delayed, $remote) = @_;
  if ($delayed) { print "延遲執行的電源指令（$reason）。延遲關機一律不放行。"; exit 42 }
  if ($remote || $has_ssh) { print "$reason 的目標不是本機（ssh／遠端 API／-H／guest VM・CT／別的 PVE node）。本機 herdr 看不到那台的 pane，本版不判遠端受害機器，一律擋。"; exit 42 }
  $imm_reason //= $reason;
}

while ($code =~ /$position/g) {
  my ($prefix, $word, $end, $wpos) = ($1, $2, pos $code, $-[2]);
  my $dctx = delayed_before($wpos);
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
    my $remote = grep { /^(?:-[HM].*|--(?:host|machine)(?:=.*)?)$/ } @args;
    my $delayed = $dctx || join(" ", @args) =~ /(?:^|\s)--when[=\s](?!now(?:\s|$))/; # systemd 的排程重開／關機
    if ($sub =~ /^$power_verb$/) { hit("$word $sub", $delayed, $remote) }
    if ($word eq "systemctl" && $sub =~ /^(?:start|isolate|restart|try-restart)$/
        && grep { /^(?:systemd-)?$power_verb\.(?:target|service)$/ || /^(?:shutdown|sleep|exit|runlevel[06])\.target$/ } @args) {
      hit("systemctl $sub 電源 target／service", $delayed, $remote);
    }
    next;
  }
  if ($word eq "qm" || $word eq "pct") {
    my $sub = first_nonopt(qr/(?!)/, @args);
    # 關掉的是 guest VM／CT，不是本機；本機 herdr 看不到 guest 裡的 pane
    if (defined $sub && $sub =~ /^$guest_verb$/) { hit("$word $sub（停 guest）", $dctx, 1) }
    next;
  }
  if ($word eq "pvesh") {
    # 路徑引號內的字面值被 sanitize 吃掉，改比對原文。
    while ($scan =~ m{\bpvesh\s+(?:-\S+\s+)*(?:create|set|post|put)\s+[^;&|\n]*?($status_path)}g) {
      my $path = $1;
      my ($node, $guest) = $path =~ m{^nodes/([^/]+)/((?:qemu|lxc)/)?};
      (my $me = lc(Sys::Hostname::hostname() // "")) =~ s/\..*//;
      # guest 路徑停的是 guest；別的 node（含變數）cluster 會轉送過去：都不是本機
      my $stopall = $path =~ m{/(?:stopall|suspendall)$}; # 停的是該 node 全部 guest，node 是本機也一樣
      my $remote = $guest || $stopall || !(lc($node) eq "localhost" || (length $me && lc($node) eq $me));
      hit("pvesh 對 …/status 寫入", $dctx, $remote);
    }
    next;
  }
  if ($word eq "pvenode") {
    # pvenode stopall 一次停掉該 node 全部 guest：目標是 guest，本機 herdr 看不到
    my $sub = first_nonopt(qr/(?!)/, @args);
    if (defined $sub && $sub =~ /^(?:stopall|suspendall)$/) { hit("pvenode $sub（停全部 guest）", $dctx, 1) }
    next;
  }
  # curl／wget／http：帶寫入旗標打 PVE API 的 status 路徑；URL 目標算遠端
  if ($scan =~ m{\b(?:curl|wget|https?)\s[^;&|\n]*?/api2/json/$status_path}
      && $scan =~ m{\b(?:curl|wget|https?)\s[^;&|\n]*?(?:(?<=\s)-[A-Za-z]*X\s*(?i:POST|PUT)|(?<=\s)-[A-Za-z]*[dFT](?=\s|$|\S)|--request[=\s]+(?i:POST|PUT)|--method[=\s]+(?i:POST|PUT)|--(?:data|form|json|upload-file|post-data|post-file)\S*|(?<=\s)(?i:POST|PUT)(?=\s))}) {
    hit("$word 對 /api2/json/nodes/*/status 寫入", $dctx, 1);
  }
}
if ($code =~ m{$lead$prefix_chain\\?(?:\S*/)?(?:at|batch|systemd-run)(?=\s|$)(?!\s+-[lrdcV]\b)} && $raw =~ $power_text) {
  print "at／batch／systemd-run 排程電源指令。延遲關機一律不放行。";
  exit 42;
}
if (defined $imm_reason) { print $imm_reason; exit 43 }
exit 0;
'

reason=$(printf '%s' "$cmd" | LC_ALL=C perl -e "$judge" 2>/dev/null)
rc=$?
case "$rc" in
  0) exit 0 ;;
  42) deny "$reason" ;;
  43) local_check "$reason" ;;
  *) conservative "$cmd" command ;;
esac
