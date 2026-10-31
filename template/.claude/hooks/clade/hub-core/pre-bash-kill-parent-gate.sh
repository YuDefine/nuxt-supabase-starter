#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋 kill 由 ps 算出的父程序、PID 1、user manager 與 kill -1（block，exit 2）
#
# 約束：agent 不得 kill 由 ps 算出的父程序（孤兒的父程序是 user systemd，殺掉整個 user session 結束）、
# PID 1、user manager 與 -1。
#
# 型別：安全型 gate。threat model：防漂移（絆索不是牆），誠實但健忘的 agent 順手寫出來的形狀。
# 不承諾完整語意，只認常見入口：`node -e`、腳本檔、heredoc 餵給 shell、alias 與變數裡的指令都看不到。
# 會攔到談論該指令的文字：同一條指令有真的 kill（非字面目標）又在字串裡提到 ppid 也算命中；
# 被誤擋時把查詢與 kill 拆成兩條指令，或改用下方拒絕訊息的替代做法。
#
# 判定（任一命中就擋）：
#   1. kill 的目標不是字面值，且同一條指令出現 ppid／PPID／/proc/*/stat(us)；pkill／killall 不看目標
#   2. kill 的目標是字面 1
#   3. kill 的目標是字面 -1（kill -- -1、kill -9 -1）
#   4. kill 的字面目標（pid 或 -pgid）此刻實際是 systemd（讀 /proc/<pid>/comm）：分兩步查出 user manager
#      的 PID 再 kill 數字，文字比對看不出來；讀不到（程序不存在、非 Linux）照字面 pid 放行
#   5. kill 的目標不是字面值，且同一條指令用 systemctl --user … MainPID、pgrep … systemd、
#      pidof systemd 取 PID；pkill／killall 直接以 systemd 為目標
#   6. pkill／killall 帶 -u／-U／--user／--uid／--euid 卻沒有程序名稱樣式：等於殺光該 user 的全部程序
#      （含 user manager）；`pkill -u $USER node` 這種有名稱樣式的放行
# 放行：字面 pid、字面 -pgid、%job、$$、$!、kill -0（探測不送訊號）、kill -l，不在命令位置的 kill 字樣，
# heredoc 內文，註解，一般字串內文。`bash -c`／`sh -c`／`eval`／`ssh` 的字串引數會展開來判；
# `ssh-keygen`、`foo.sh -c` 這類只是名字長得像的指令不展開。`\kill`（跳過 alias 的寫法）照 kill 判。
#
# 繞行場景：
#   | 繞法 | 預期攔截點 |
#   | `pkill -u $USER`、`killall -u $USER` | 擋：判定 6 |
#   | `\kill $pp`、`\pkill …` | 擋：命令位置容許一個前導反斜線 |
#   | `… | xargs kill` 從 stdin 餵父程序 | 擋：xargs 的 kill 視為非字面目標 |
#   | `bash -c 'kill $pp'`、`ssh host "kill \$pp"` | 擋：字串引數展開來判 |
#   | 另開一條指令算 ppid 再回填字面 pid | 目標是 systemd 才擋（判定 4）；其他父程序放行，檔頭已寫不承諾 |
#   | `ps -ef | awk '{print $3}'` 取父程序 | 不攔：沒有 ppid 字樣，檔頭已寫不承諾 |
#   | 弄壞 perl／jq 讓判定掛掉 | 走下方保守樣式，不靜默放行 |
#
# 判定以 exit 42 表示命中：perl 載入失敗時自己會以 2 結束，NEVER 拿 2 當命中碼。
#
# 判不出來（安全型，倒向擋；但全擋會癱瘓所有含 kill 字樣的 Bash，所以降到保守樣式）：
#   | 分支 | 處置 |
#   | E1 jq 或 perl 不在 | 保守樣式：kill 搭 ppid、kill 1、kill -1 exit 2，其餘 exit 0＋additionalContext 告知 |
#   | E2 判定檔缺失 | 不適用：判定內嵌在本檔 |
#   | E3 stdin 非 JSON、command 欄位缺失 | 同 E1，比對原始 stdin |
#   | E4 判定丟例外、E5 判定非 0／2 退出 | 同 E1；外殼不沿用判定的退出碼 |
#   | E6 逾時 | harness 砍掉 hook 屬 non-blocking，外殼收不到：已知限制 |
#
# 沒有繞過旗標：拒絕訊息的替代做法一定走得通。PreToolUse 只對 agent 的 tool call 觸發，
# user 自己 terminal 打的指令不受影響。

set -uo pipefail

input=$(cat)

# 快篩：絕大多數命令不含 kill，在這裡返回，不付 jq／perl 成本
case "$input" in
  *kill*) ;;
  *) exit 0 ;;
esac

deny() {
  local why=$1
  printf '%s\n' "kill parent gate: 這條指令被擋下。原因：${why}
約束：NEVER kill 父程序、PID 1、user manager 或 -1（孤兒的父程序是 user systemd，殺掉會讓所有 session 結束）。

替代做法：
  - 先看清楚目標：ps -o pid,ppid,args -p <pid>（查詢與 kill 拆成兩條指令，看完再用字面 pid）
  - 收一組程序：kill -- -<pgid>
  - 收 systemd 管的程序：systemctl --user stop <scope>
  - 收某個 user 的特定程序：pkill -u \$USER <程序名稱樣式>（不帶樣式會殺光該 user 全部程序）
本 gate 沒有繞過旗標。" >&2
  exit 2
}

# 保守樣式：判定用不了時只認最危險的形狀，不靜默放行。
conservative() {
  local t=$1 pre='(^|[;&|(`"\\[:space:]])' post='([;&|)`"[:space:]]|$)'
  t=${t//\\n/$'\n'}
  local any="${pre}(kill|pkill|killall)[[:space:]]"
  local ppid='[Pp][Pp][Ii][Dd]|/proc/[^[:space:]/]+/stat'
  local lit="${pre}kill[[:space:]]+(-[[:alnum:]]+[[:space:]]+)*(--[[:space:]]+)?-?1${post}"
  if [[ $t =~ $any ]] && [[ $t =~ $ppid ]]; then
    deny '判定無法執行（保守樣式）：同一條指令有 kill 又有取父程序的寫法。'
  fi
  if [[ $t =~ $lit ]]; then
    deny '判定無法執行（保守樣式）：kill 的目標是 1 或 -1。'
  fi
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"kill parent gate 判定故障（jq／perl 不可用或輸入非預期），只做了保守檢查：kill 前先用 ps -o pid,ppid,args -p <pid> 確認目標，NEVER kill 父程序、PID 1 或 -1。"}}'
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

# 移除 heredoc 內文（行內引號裡的 << 不算 heredoc 開頭）。
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

# 從 $i 的開括號走到對應的閉括號，回傳閉括號位置；走不完回傳字串尾。
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

# 把字串內文換成不會被當指令的形狀：只留命令替換、變數與單一字面 token。
# bash -c／eval／ssh 的字串引數則展開成子指令。
sub quoted_view {
  my ($prefix, $body, $kept) = @_;
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

# 從 $pos 切出這個 simple command 的引數；$(…)、(…)、反引號算同一個 token。
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

# 回傳 kill 真正要送訊號的目標；探測（-0）與 -l 回傳空。
sub kill_targets {
  my @a = @_;
  my ($sig, $eoo, @t) = (0, 0);
  while (@a) {
    my $x = shift @a;
    if (!$eoo) {
      if ($x eq "--") { $eoo = 1; next }
      return () if $x =~ /^(?:-[lL]|--list|--table)$/;
      if ($x =~ /^(?:-s|--signal|-n)$/) {
        my $v = shift(@a) // "";
        return () if $v =~ /^(?:SIG)?0$/i;
        $sig = 1;
        next;
      }
      if ($x =~ /^--signal=(.*)$/) { return () if $1 =~ /^(?:SIG)?0$/i; $sig = 1; next }
      if (!$sig && $x =~ /^-(\w+)$/) { return () if $1 =~ /^(?:SIG)?0$/i; $sig = 1; next }
    }
    $eoo = 1; # 第一個目標之後都是目標：kill 123 -1 的 -1 不是訊號
    push @t, $x;
  }
  return @t;
}

# pkill／killall 帶 user 選項（-u -U --user --uid --euid，含 -9u、-uroot、--user=x）卻沒有名稱樣式。
# 其他帶值選項（-P -g -t …，含 pkill 的 -s <sid>）的值會被當成樣式而放行：絆索不承諾完整語意。
sub user_wide {
  my ($word, @a) = @_;
  my ($user, $pattern, $eoo) = (0, 0, 0);
  while (@a) {
    my $x = shift @a;
    if (!$eoo && $x eq "--") { $eoo = 1; next }
    if (!$eoo && $x =~ /^--(?:user|uid|euid)(=.*)?$/) { $user = 1; shift @a unless defined $1; next }
    if (!$eoo && ($x eq "--signal" || ($word eq "killall" && $x eq "-s"))) { shift @a; next } # 帶值的訊號選項，值不是樣式；pkill 的 -s 是 session
    next if !$eoo && $x =~ /^-(?:SIG)?[A-Z][A-Z0-9]+$/ && $x !~ /^-[A-Z]\d+$/; # 訊號名（-USR1、-KILL）；-U1000 是 -U 選項
    if (!$eoo && $x =~ /^-[A-Za-z0-9]*[uU](.*)$/) {
      $user = 1;
      shift @a if $1 eq "";
      next;
    }
    next if !$eoo && $x =~ /^-/;
    $pattern = 1;
  }
  return $user && !$pattern;
}

local $/;
my $raw = <STDIN> // "";
my $text = strip_heredocs($raw);
(my $scan = $text) =~ s/(?:^|(?<=\s))#.*$//mg;
$scan =~ s/(?<!\\)((?:\\\\)*)\\\n/$1/g;
my $code = sanitize($text);
$code =~ s/&>>?\s*[^\s;&|)]+//g;
$code =~ s/\d*[<>]&\d+//g;
$code =~ s/\d*>>?\s*[^\s;&|)]+//g;

my $parent = $scan =~ m{ppid|/proc/[^\s/]+/stat(?:us)?\b}i;
my $manager = $scan =~ m{systemctl(?=[^;&|\n]*--user)[^;&|\n]*MainPID|\b(?:pgrep|pidof)\b[^;&|\n]*(?<![\w-])systemd(?![\w/-])};
my $manager_named = $scan =~ m{\b(?:pkill|killall)\b[^;&|\n]*(?<![\w-])systemd(?![\w/-])};

my $position = qr{
  (?: ^ | [;&|()`\n\{] | -execdir\b | -exec\b )
  \s*
  (?: (?: then | do | else | elif | if | while | until | ! ) \s+ )*
  (?: (?:env\s+)? \w+=\S* \s+ )*
  ( (?: (?: command | builtin | exec | eval | nohup | setsid | time | env | busybox
          | (?: sudo | doas | nice ) (?: \s+ -\S+ (?: \s+ (?!kill\b) [^-\s]\S* )?? )*
          | timeout (?: \s+ -\S+ (?: \s+ [^-\s]\S* )?? )* \s+ \S+
          | ssh (?: \s+ -\S+ (?: \s+ [^-\s]\S* )?? )* \s+ \S+
          | xargs (?: \s+ -\S+ (?: \s+ (?!kill\b) [^-\s]\S* )?? )*
        ) (?: \s+ -\S+ )* \s+ )* )
  \\? (?: \S*/ )? (kill|pkill|killall) (?= \s | $ | [;&|)`] )
}x;

while ($code =~ /$position/g) {
  my ($prefix, $word, $end) = ($1, $2, pos $code);
  my @args = args_from($code, $end);
  if ($word ne "kill") {
    if ($parent) { print "$word 搭配取父程序的寫法（ppid／PPID／/proc/*/stat）。"; exit 42 }
    if ($manager || $manager_named || grep { /^(?:\S*\/)?systemd$/ } @args) { print "$word 的目標是 user manager（systemd）。"; exit 42 }
    if (user_wide($word, @args)) { print "$word 以 -u／--user 指定 user 卻沒有程序名稱樣式（殺光該 user 的全部程序，含 user manager）。"; exit 42 }
    next;
  }
  my $from_stdin = $prefix =~ /\bxargs\b/;
  next if !kill_targets(@args, "0"); # 探測或 -l：補一個假目標還是回傳空
  my @targets = kill_targets(@args);
  my $dynamic = $from_stdin;
  for my $t (@targets) {
    (my $num = $t) =~ s/^(-?)\+?0*(?=\d)/$1/;
    if ($num eq "1") { print "kill 的目標是字面 1（PID 1）。"; exit 42 }
    if ($num eq "-1") { print "kill 的目標是 -1（送給自己能送到的所有程序）。"; exit 42 }
    if ($num =~ /^-?(\d+)$/ && open(my $fh, "<", "/proc/$1/comm")) {
      my $comm = <$fh> // "";
      if ($comm =~ /^systemd\s*$/) { print "kill 的字面目標 $t 此刻是 systemd（user manager）。"; exit 42 }
    }
    $dynamic = 1 unless $t =~ /^-?\d+$/ || $t =~ /^%/ || $t eq "\$\$" || $t eq "\$!";
  }
  next unless $dynamic;
  if ($parent) { print "kill 的目標不是字面 pid，且同一條指令有取父程序的寫法（ppid／PPID／/proc/*/stat）。"; exit 42 }
  if ($manager) { print "kill 的目標不是字面 pid，且同一條指令有取 user manager PID 的寫法。"; exit 42 }
}
exit 0;
'

reason=$(printf '%s' "$cmd" | LC_ALL=C perl -e "$judge" 2>/dev/null)
rc=$?
case "$rc" in
  0) exit 0 ;;
  42) deny "$reason" ;;
  *) conservative "$cmd" ;;
esac
