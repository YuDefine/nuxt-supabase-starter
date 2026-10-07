#!/usr/bin/env bash
# PreToolUse:Bash — self-hosted Supabase consumers: block a local Supabase stack
# on the desk and tell the agent where the DB actually lives.
#
# Why a hook and not only a rule: db-topology-invariant.md says "NEVER
# `supabase start` on the desk", but native rule projection only loads it when
# the clade-data skill is invoked. An agent running tests never invokes it, tries
# `supabase start`, and gets a bare permission denial with no path forward
# (2026-09-24, observed in one consumer). This hook fires at the exact failure point with the reason.
#
# Scope: consumers whose .clade/manifest.json declares
# modules["db-runtime"] == "supabase-self-hosted". Isolated cloud VMs are the
# named exception in the rule (they MUST run an ephemeral stack): opt in with
# CLADE_EPHEMERAL_DB=1, or run as a Claude Code remote session.
# Consumer-specific next steps (e.g. the worktree DB bootstrap command) go in
# .claude/db-runtime-hint.md and are printed verbatim.
#
# Missing config/dependencies fail open; a matched command fails closed.

set -uo pipefail

[ "${CLADE_EPHEMERAL_DB:-}" = "1" ] && exit 0
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

project_dir=${CLAUDE_PROJECT_DIR:-}
[ -n "$project_dir" ] || exit 0
manifest="$project_dir/.clade/manifest.json"
[ -f "$manifest" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

runtime=$(jq -r '.modules["db-runtime"] // ""' "$manifest" 2>/dev/null) || exit 0
[ "$runtime" = "supabase-self-hosted" ] || exit 0

input=$(cat) || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

command -v perl >/dev/null 2>&1 || exit 0

# Match per command segment, not per line: a segment must itself *start* with the
# supabase CLI (after env assignments, timeout/env/sudo, a package runner, or a
# path), so quoted mentions in git commit -m / grep / echo / heredoc prose pass.
# Shell -c bodies and executable $(...) substitutions are scanned recursively.
# Global flags before the subcommand
# (--debug, --workdir <dir>, …) are skipped. Subcommands that start, stop, or
# rewrite a local stack are blocked; read-only ones (status, migration new, …) pass.
printf '%s' "$cmd" | perl -e '
  use strict; use warnings;
  local $/; my $cmd = <STDIN>;
  my $VALUE_FLAGS = qr/-o|--output|--workdir|--profile|--network-id|--experimental-host|--dns-resolver/;
  sub hit {
    my ($seg) = @_;
    $seg =~ s/^[\s(`{!]+//;
    $seg =~ s/^(?:(?:if|then|do|else|elif|while|until)\s+)+//;
    $seg =~ s/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+//;
    my $timeout_option = qr/(?:--(?:signal|kill-after)\s+\S+|-[sk]\s*\S+|--?[\w-]+(?:=\S*)?)/;
    my $env_option = qr/(?:--(?:unset|chdir)\s+\S+|-[uC]\s*\S+|--?[\w-]+(?:=\S*)?)/;
    while ($seg =~ s/^(?:timeout(?:\s+$timeout_option)*\s+(?:--\s+)?\S+|env(?:\s+$env_option)*(?:\s+--)?|sudo(?:\s+-[ugCDhpr]\s+\S+|\s+-\S+)*|nice(?:\s+-n\s*\S+)?|time)\s+//) {
      $seg =~ s/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+//;
    }
    if ($seg =~ /^(?:\S*\/)?(?:ba|z)?sh\s+(?:(?:--[\w-]+|-[a-z]+)\s+)*-[a-z]*c\s+(["\x27])(.*?)\1?\s*$/s) {
      my ($found) = scan($2);
      return $found;
    }
    if ($seg =~ s/^(?:npx|bunx|pnpm(?:\s+(?:exec|dlx))?|yarn(?:\s+(?:dlx|exec))?)(?:\s+-{1,2}[\w-]+(?:=\S*)?)*\s+(?=(?:\S*\/)?supabase(?:@\S+)?(?:\s|$))//) {
      $seg =~ s/^supabase@\S+(?=\s|$)/supabase/;
    }
    return 0 unless $seg =~ s/^(?:\S*\/)?supabase(?=\s)\s+//;
    while ($seg =~ s/^(?:(?:$VALUE_FLAGS)\s+\S+|--?[A-Za-z][\w-]*(?:=\S*)?)\s+//) {}
    return $seg =~ /^(?:start|stop|db\s+(?:start|reset|push))(?:[\s"\x27)]|$)/ ? 1 : 0;
  }
  # Split on ; & | && || and newlines only outside quotes; heredoc bodies are data.
  sub scan {
    my ($text, $substitution) = @_;
    my @segs; my $cur = q{}; my $q = q{}; my @heredocs;
    my $depth = 0; my $consumed = length $text;
    my @c = split //, $text;
    for (my $i = 0; $i < @c; $i++) {
      my $ch = $c[$i];
      if ($q eq "\x27") { $cur .= $ch; $q = q{} if $ch eq "\x27"; next }
      if ($ch eq "\\" && $i + 1 < @c) {
        if ($c[$i + 1] eq "\n") { $i++; next }
        $cur .= $ch . $c[++$i]; next;
      }
      if ($ch eq q{$} && substr($text, $i, 2) eq q{$(}) {
        my ($found, $length) = scan(substr($text, $i + 2), 1);
        return (1, length $text) if $found;
        # Keep the original token for shell -c unwrapping, but skip its already
        # scanned body so its quotes/separators cannot alter the outer command.
        $cur .= substr($text, $i, $length + 2); $i += $length + 1; next;
      }
      if ($q eq q{"}) {
        $cur .= $ch;
        $q = q{} if $ch eq q{"};
        next;
      }
      if ($ch eq "\x27" || $ch eq q{"}) { $q = $ch; $cur .= $ch; next }
      if ($ch eq "#" && ($cur eq q{} || $cur =~ /\s$/)) {
        $i++ while $i + 1 < @c && $c[$i + 1] ne "\n";
        next;
      }
      if ($ch eq "<" && substr($text, $i, 2) eq "<<" && substr($text, $i) =~ /^<<(-?)[ \t]*(["\x27]?)(?:\\)?([A-Za-z_][\w]*)\2/) {
        my $op = $&;
        push @heredocs, [$3, $1 eq "-"];
        $cur .= $op; $i += length($op) - 1; next;
      }
      if ($ch eq "\n") {
        push @segs, $cur; $cur = q{};
        while (@heredocs) {
          my ($end, $strip_tabs) = @{shift @heredocs};
          my $indent = $strip_tabs ? qr/\t*/ : qr//;
          my $rest = join q{}, @c[$i + 1 .. $#c];
          if ($rest =~ /\A(.*?^$indent\Q$end\E$)/ms) { $i += length $1 } else { $i = $#c }
        }
        next;
      }
      if ($ch eq "(") { $depth++ }
      if ($ch eq ")") {
        if ($substitution && $depth == 0) { $consumed = $i + 1; last }
        $depth-- if $depth > 0;
      }
      if ($ch =~ /[;&|]/) { push @segs, $cur; $cur = q{}; next }
      $cur .= $ch;
    }
    push @segs, $cur;
    for my $seg (@segs) { return (1, $consumed) if hit($seg) }
    return (0, $consumed);
  }
  my ($found) = scan($cmd);
  exit($found ? 0 : 1);
' || exit 0

{
  printf '\n⛔ [clade] blocked a local Supabase stack command on the desk (db-runtime: supabase-self-hosted)\n'
  printf '   The dev and prod databases live on remote LXC hosts; this machine has no Supabase containers,\n'
  printf '   and the dev LXC is shared with other sessions. Do NOT retry, and do NOT ask the user to start it.\n'
  printf '   Instead:\n'
  printf '   - Every DB operation goes through the repo scripts: pnpm db:* (db:reset rebuilds only this worktree'"'"'s clone\n'
  printf '     when the repo is per-worktree; check the topology predicate first).\n'
  printf '   - Full contract: .claude/skills/clade-data/rules/db-topology-invariant.md\n'
  hint="$project_dir/.claude/db-runtime-hint.md"
  if [ -f "$hint" ]; then
    printf '   This repo says:\n'
    sed 's/^/     /' "$hint"
  fi
  printf '   Isolated cloud VM that needs its own ephemeral DB: launch the agent with CLADE_EPHEMERAL_DB=1 in its\n'
  printf '   environment (session launch / settings env). An inline `CLADE_EPHEMERAL_DB=1 supabase start` prefix does not count.\n'
} >&2
exit 2
