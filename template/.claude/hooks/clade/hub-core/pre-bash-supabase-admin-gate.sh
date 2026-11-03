#!/usr/bin/env bash
# PreToolUse:Bash hook — agent 以 supabase_admin 連線／SET ROLE／執行 SQL 之前，先要有 Charles 當次授權（block，exit 2）
#
# 約束：rules/core/prod-access.md § supabase_admin：先問再用。supabase_admin 是 Supabase 自架 DB 最高權限的
# superuser，agent 用它改的任何東西（ALTER ROLE、GRANT、擁有者變更）都繞過 prod-sql 的白名單與 plan/apply。
#
# 型別：安全型 gate。threat model：防漂移（絆索不是牆），誠實但健忘的 agent 順手寫出來的形狀；
# 不承諾完整語意——腳本檔內、變數展開後、`node -e` 裡的 supabase_admin 看不到。
#
# 判定：一條指令切成片段（`&&` `||` `;` `|` 換行），片段的命令位置（略過 env 賦值、sudo／env／timeout／rtk 之類
# 的包裝）是 DB／遠端／shell 用戶端（psql、pg_dump、pg_restore、pg_dumpall、pgbench、docker、ssh、bash、sh、zsh、
# supabase）時：
#   1. 該片段帶 -U supabase_admin、--username=supabase_admin、user=supabase_admin、PGUSER=supabase_admin、
#      supabase_admin@host、supabase_admin:密碼@host 任一 → 擋
#   2. 同一條指令另有 SET [SESSION|LOCAL] ROLE／SET SESSION AUTHORIZATION supabase_admin（常在 heredoc 或 -c 的
#      另一行）→ 擋
# 放行：命令位置不是上列用戶端的片段（git commit／gh pr 的訊息、grep、echo 裡提到 supabase_admin 不擋）、
# 餵給非用戶端指令（cat、python3 等）的 heredoc 內文、`node scripts/prod-sql.ts …`（bootstrap 走設定檔裡的
# admin_psql，授權來源另有規定）、隔離的雲端 VM（CLAUDE_CODE_REMOTE=true 或 CLADE_EPHEMERAL_DB=1，
# 沿用 supabase-local-gate 的例外）。
#
# 授權怎麼帶：Charles 在 flow 決策卡答應後，把那題的 span id 放在該條指令的前綴：
#   CLADE_SUPABASE_ADMIN_GRANT=<span id> ssh root@… docker exec … psql -U supabase_admin …
# 前綴只放行它所在的那一個片段（`GRANT=… true; psql -U supabase_admin` 的 psql 照擋）。前綴只擋「忘了問」，
# 不驗 span 是否真的存在；偽造 span 是違規，不是這個 gate 的邊界。每一次使用各問一次，前綴不跨指令。
#
# 繞行場景：
#   | 繞法 | 預期攔截點 |
#   | `ssh host 'docker exec db psql -U supabase_admin'` | 擋：ssh 片段含 -U supabase_admin |
#   | `bash -c "psql -U supabase_admin"` | 擋：bash 片段 |
#   | `psql postgresql://supabase_admin:pw@host/db` | 擋：supabase_admin:…@ |
#   | `psql <<EOF` 內 `SET ROLE supabase_admin;` | 擋：判定 2 |
#   | `GRANT=… true; psql -U supabase_admin` | 擋：前綴只放行自己的片段 |
#   | `export PGUSER=supabase_admin; psql` | 放行（已知漏洞）：字串在 `export` 片段、`psql` 片段看不到；絆索不是牆 |
#
# 缺依賴 fail-open；命中才 fail-closed。

set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0
[ "${CLADE_EPHEMERAL_DB:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0

input=$(cat) || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0
case "$cmd" in
  *supabase_admin*) ;;
  *) exit 0 ;;
esac

printf '%s' "$cmd" | LC_ALL=C LANG=C LANGUAGE=C perl -e '
  use strict; use warnings;
  local $/; my $cmd = <STDIN>;
  my $GRANT = qr/^\s*CLADE_SUPABASE_ADMIN_GRANT=[0-9A-Za-z_-]{6,}\s/;
  my $CLIENT = qr/(?:psql|pg_dump|pg_dumpall|pg_restore|pgbench|docker|ssh|bash|sh|zsh|supabase)/;
  my $USE = qr/(?:(?:-U\s*|--username[=\s]\s*|\buser=|\bPGUSER=)["\x27]?supabase_admin\b|\bsupabase_admin(?::[^@\s]*)?@)/i;
  my $SETROLE = qr/\bSET\s+(?:SESSION\s+|LOCAL\s+)?(?:ROLE\s*(?:=|TO)?\s*|SESSION\s+AUTHORIZATION\s+)["\x27]?supabase_admin\b/i;

  sub is_client {
    my ($seg) = @_;
    my $s = $seg;
    $s =~ s/^[\s(`{!]+//;
    while ($s =~ s/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+//
        || $s =~ s/^sudo\s+(?:-[ugCDhpr]\s+\S+\s+|-\S+\s+)*//
        || $s =~ s/^(?:env|timeout\s+\S+|rtk(?:\s+proxy)?|nice|time|command|exec)\s+(?:-\S+\s+)*//) {}
    $s =~ s/^\S*\///;
    return $s =~ /^$CLIENT(?:\s|$)/ ? 1 : 0;
  }

  # 先剝掉餵給非用戶端指令的 heredoc 內文（cat <<EOF、python3 - <<EOF 寫檔不算用 supabase_admin）。
  # 只有「<< 那一整行沒有任何用戶端片段」且「結尾標記真的出現」才剝；<<< 不算 heredoc。
  my @lines = split /\n/, $cmd, -1;
  my @kept;
  for (my $i = 0; $i < @lines; $i++) {
    my $line = $lines[$i];
    push @kept, $line;
    next unless $line =~ /(?<!<)<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
    my $tag = $2;
    next if grep { is_client($_) } split /&&|\|\||;|\|/, $line;
    my $end;
    for (my $j = $i + 1; $j < @lines; $j++) {
      my $t = $lines[$j]; $t =~ s/^\s+//; $t =~ s/\s+$//;
      if ($t eq $tag) { $end = $j; last }
    }
    next unless defined $end;
    $i = $end;
  }
  my $body = join "\n", @kept;

  my ($client_seen, $use_hit) = (0, 0);
  for my $seg (split /&&|\|\||;|\||\n/, $body) {
    next if $seg =~ $GRANT;
    next unless is_client($seg);
    $client_seen = 1;
    $use_hit = 1 if $seg =~ $USE;
  }
  if ($use_hit || ($client_seen && $body =~ $SETROLE)) {
    print STDERR "\n⛔ [clade] 以 supabase_admin 連線／SET ROLE／執行 SQL 之前，要先有 Charles 當次授權\n";
    print STDERR "   做法：flow ask（或 --complete blocked --decision-for charles）寫明主機、指令、寫入類別與筆數；\n";
    print STDERR "         Charles 答應後，把那題的 span id 放在該條指令的前綴：CLADE_SUPABASE_ADMIN_GRANT=<span id> <指令>\n";
    print STDERR "   不要換其他高權限帳號重試；被擋就停下回報。規約：rules/core/prod-access.md § supabase_admin\n";
    exit 2;
  }
  exit 0;
'
exit $?
