#!/usr/bin/env bash
# PreToolUse:Bash hook — block ad-hoc `git commit --only` of non-whitelist
# paths on main/master.
#
# /commit itself lands with `git commit --only -- <files>` plus a
# `Via: /commit` trailer (SKILL.md Step 4). That path MUST pass.
# Work-loop HANDOFF / tech-debt short commits are the whitelist.
# Product landings on main without Via are the 2026-08-24/25 <consumer-a>
# incident (5 commits, push blocked by provenance-gate).
#
# Session branches (worktree deferred-landing) pass — not main.
#
# ── How a command is judged (TD-1051) ─────────────────────────────────────
# Four 0-A rounds of "patch one syntax, find the next" showed that listing
# dangerous shell (a denylist) never ends. This gate is an ALLOWLIST: it
# evaluates only commands whose effect it can read exactly, and everything
# else is judged by where the commit could land.
#
# Trigger: after deleting quotes and backslashes, the text has a `commit`
# word and a `--only` word, and could run git: a `git` word anywhere, a `$`
# or backtick anywhere (single quotes and heredoc bodies included), or a
# function definition (TD-1128: `rg -e commit -e --only` is a search, not a
# commit). The whole text, not one seg: a function or `| xargs git` puts
# `git` and the words in different segs. A commit without `--only` is not
# this gate.
#
# Allowlist shape — every piece must hold, or the command is "unchecked":
#   command := list ( (`;` | newline) list )*
#   list    := seg ( `&&` seg )*            seg may pipe into filters:
#              seg ( `|` filter )*          filter = tail|head|cat|wc|grep
#   seg     := `cd` [-L|-P] [--] DIR
#            | [rtk] git [-C DIR | --no-pager]* commit OPT* --only OPT* -- PATH+
#            | [rtk] git [-C DIR | --no-pager]* SUB ARG*
#                SUB = add|diff|log|push|restore|rev-parse|show|status
#            | echo|printf|true ARG*
#   OPT     := -m|-F|-C|-c|-t V, --message|--file|--author|--date|--cleanup|
#              --trailer|--fixup|--squash|--reuse-message|--reedit-message|
#              --template [=]V, -q -v -s -e --amend --no-edit --signoff
#              --allow-empty --allow-empty-message --no-gpg-sign
#              --reset-author --status --no-status (and their long forms)
#   Redirects (`>`, `>>`, `2>&1`, `<`, `>|`, `&>`) may appear anywhere in a
#   seg with a literal target. A heredoc (`<<[-]DELIM`) is allowed on a git
#   seg; so is the message idiom `"$(cat <<'EOF' … EOF\n)"` inside double
#   quotes on a git seg (on any other command its body counts as code). A
#   "git seg" here is one whose global options are only -C / --no-pager and
#   whose SUB is a builtin above: `-c alias.x='!sh'`, `--config-env` or an
#   alias subcommand can run an argument or stdin as code (TD-1128). An
#   unquoted DELIM's body must have no `$`, backtick or `\`.
#   Every word is LITERAL: no `$` expansion, no backtick / `$(` (except that
#   idiom), no unquoted glob or brace (`* ? [ { }`); a leading `~` / `~/` is
#   the only expansion. PATH has no `* ? [ \`, no leading `:` and no `..`.
#   DIR (cd / -C) is one literal word; a relative one while CDPATH is set
#   is unchecked. A cd whose list ended before the commit counts only when
#   it led that list (`echo x && cd d; git commit` is unchecked).
#
# Allowlisted: each commit's checkout is resolved exactly (cd chain + -C
# from the session cwd). On main/master, each PATH is resolved against the
# commit's real cwd (`git rev-parse --show-prefix`) and must be on the
# whitelist. An unresolvable cd / -C target fails closed.
#
# Unchecked: blocked when the commit COULD land on main —
#   * the session checkout is main/master, or
#   * the text can point elsewhere: a `$` / backtick expansion (outside the
#     cat-heredoc idiom and heredoc bodies fed to git), `pushd` / `popd` /
#     bare `cd` / `cd -` / `~user` / CDPATH, or any word piece (split on
#     blanks, quotes, `= : ; & | ( ) < > ,`; `-X/path` counts as `/path`)
#     naming an existing path that resolves (logically or physically)
#     outside the session checkout. Pieces are resolved from the session cwd
#     AND from every directory the text's cd / pushd / -C / -D / --chdir
#     chain can reach, so a hop through a system dir or a relative path is
#     followed (system dirs /dev, /proc, /sys, /usr, /bin, /sbin, /lib, /etc
#     are exempt only as final resolved paths).
#   Otherwise (a worktree session that names nothing outside itself) it
#   passes. A session cwd that is not a repo counts every outside path.
#
# `Via: /commit` (the /commit trailer) passes the command only when it sits
# in a git commit's own message: a -m / --message / --trailer value, or the
# heredoc a `-F -` commit reads — not in another git command's argument
# (`git log --grep 'Via: /commit'`, TD-1128), a comment, an `echo`, or a
# script body.
#
# Known boundary: the trigger reads literal `commit` / `--only` words; a
# command that spells them through an expansion is not seen at all. This is
# a guard against mistakes, not against an adversary.

set -euo pipefail

input=$(cat)

command=""
if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || printf '')
fi

# Cheap prefilter; the scan below decides per command (T record).
# `com''mit`, `"--only"`: quotes and backslashes do not hide the words.
dequoted=$(printf '%s' "$command" | tr -d "'\"\\\\")
# Here-strings, not `printf | grep -q`: under pipefail an early-exiting
# reader turns the writer's SIGPIPE into exit 141 — a "no match" here.
if ! grep -qE '(^|[[:space:];&|()=])commit([[:space:];&|()]|$)' <<<"$dequoted"; then
  exit 0
fi
if ! grep -qE '(^|[[:space:];&|()=])--only([[:space:];&|()]|$)' <<<"$dequoted"; then
  exit 0
fi

# Tokenise and match the allowlist shape. Output records (\037-separated):
#   T            some command could be a `git commit --only` (the trigger)
#   V            `Via: /commit` in a git commit's own message
#   N <reason>   not the allowlist shape (first reason only)
#   E            a `$` / backtick expansion in code
#   S            pushd / popd / `cd -` / bare `cd` / `~user` / CDPATH cd
#   X <piece>    a word piece to check against the session checkout, also
#                joined onto every directory a cd / -C / -D chain can reach
#   C <dir>      a commit; dir is the cd / -C chain ("" = session cwd)
#   P <path>     a pathspec of the preceding C
scan=$(awk '
  BEGIN {
    RS = "\001"; OFS = "\037"; home = ENVIRON["HOME"]; cdpath = ENVIRON["CDPATH"]
    nb = 1; base[1] = ""
  }
  function no(why) { if (nr == "") nr = why }
  function out(   k, b, p, seen) {
    if (GU || trig()) print "T"
    if (V) print "V"
    if (nr != "") print "N", nr
    if (E) print "E"
    if (S) print "S"
    for (k in cand) {
      print "X", k
      if (k ~ /^[\/~]/) continue
      for (b = 2; b <= nb; b++) {
        p = join(base[b], k)
        if (!(p in seen)) { seen[p] = 1; print "X", p }
      }
    }
    for (b = 2; b <= nb; b++) if (!(base[b] in seen)) print "X", base[b]
    for (k = 1; k <= nrec; k++) print rec[k]
  }
  function giveup(why) { E = 1; GU = 1; no(why); out(); exit }
  # The text could run `git commit --only` (the prefilter saw both words):
  # a `git` word anywhere (any path, any quoting), a `$` / backtick anywhere
  # (quoted too: `bash -c \047"$G" commit\047` runs it), or a function
  # definition. Whole text, not per seg: `g(){ git "$@"; }; g commit`,
  # `echo commit --only | xargs git` split the words across segs.
  function trig(   t, m, a, k) {
    if (s ~ /[$`]/) return 1
    if (s ~ /(^|[^A-Za-z0-9_])function[ \t]/ || s ~ /[A-Za-z0-9_.:-][ \t]*\([ \t]*\)/) return 1
    t = s; gsub(/[\047"\\]/, "", t)
    m = split(t, a, "[ \t\n;&|()=<>{}`]+")
    for (k = 1; k <= m; k++) if (a[k] ~ /(^|\/)git$/) return 1
    return 0
  }
  # Every directory a cd / -C chain can reach, in any order: each target
  # joined onto every base so far (the unchecked path resolves candidates
  # against all of them, so `cd /etc && cd ../<main>` is seen as <main>).
  function adddir(d,   b, cnt, p) {
    if (d == "~") d = home
    else if (d ~ /^~\//) d = home substr(d, 2)
    else if (d ~ /^~/ || d == "") return
    cnt = nb
    for (b = 1; b <= cnt; b++) {
      p = (d ~ /^\// ? d : join(base[b], d))
      if (p in hasbase) continue
      hasbase[p] = 1; nb++; base[nb] = p
      if (nb > 256) giveup("too many directory changes")
    }
  }
  # A `cd` with no directory before its command ends goes to $HOME.
  function cdend() { if (want == 1) S = 1; want = 0 }
  function cands(t,   m, a, k, p, g) {
    gsub(/[;&|()\n]/, " ; ", t)
    m = split(t, a, "[ \t<>\"\047=:,]+")
    for (k = 1; k <= m; k++) {
      p = a[k]
      if (p == ";") { cdend(); continue }
      if (p == "") continue
      if (want && p ~ /^(-L|-P|-e|--)$/) continue
      if (want) { adddir(p); want = 0 }
      else if (p == "cd" || p == "pushd") want = 1
      else if (p ~ /^(-C|-D|--chdir|--work-tree|--git-dir)$/) want = 2
      g = p
      if (p ~ /^-[A-Za-z][\/~.]/) {
        p = substr(p, 3)
        if (g ~ /^-[CD]/) adddir(p)
      }
      if (p != "" && p != "-" && p != ";") cand[p] = 1
    }
  }
  # Index of the word that runs, past reserved words and `rtk`.
  function effidx(   j) {
    j = 1
    while (j < nw && wl[j] && words[j] ~ /^(if|then|elif|else|while|until|do|!|time)$/) j++
    if (j < nw && words[j] == "rtk" && words[j + 1] == "git") j++
    return j
  }
  function gitseg(   j) { j = effidx(); return j <= nw && words[j] == "git" && wl[j] }
  # Index of the git subcommand past -C DIR / --no-pager; any other global
  # option stops there (it is then not a builtin name).
  function gitsub(   j) {
    j = effidx() + 1
    while (j <= nw) {
      if (words[j] == "-C" && j < nw) { j += 2; continue }
      if (words[j] == "--no-pager") { j++; continue }
      break
    }
    return j
  }
  # A git seg whose arguments and stdin are data (TD-1128): `git -c
  # alias.x=!sh x`, `--config-env` or an alias subcommand run them as code.
  function gitdata(   j) {
    if (!gitseg()) return 0
    j = gitsub()
    return j <= nw && words[j] ~ /^(commit|add|diff|log|push|restore|rev-parse|show|status)$/
  }
  # `Via: /commit` in the own message of this commit seg (TD-1128): a -m /
  # --message / --trailer value; `-F -` makes the fed heredoc the message.
  function commitvia(   j, a, v) {
    if (!gitdata()) return
    j = gitsub()
    if (words[j] != "commit") return
    for (j++; j <= nw; j++) {
      a = words[j]; v = ""
      if (a == "--") break
      if (a ~ /^(-m|--message|--trailer)$/ && j < nw) v = words[++j]
      else if (a ~ /^(-F|--file)$/ && j < nw) { if (words[++j] == "-") segmsg[segid] = 1; continue }
      else if (a == "-F-" || a == "--file=-") { segmsg[segid] = 1; continue }
      else if (a ~ /^(-[Cct]|--(author|date|cleanup|fixup|squash|reuse-message|reedit-message|template))$/) { j++; continue }
      else if (a ~ /^-m/) v = substr(a, 3)
      else if (a ~ /^--(message|trailer)=/) v = substr(a, index(a, "=") + 1)
      if (v ~ /Via: \/commit/) V = 1
    }
  }
  function join(base, dir) {
    if (dir ~ /^\// || base == "") return dir
    return base "/" dir
  }
  function add(ch) { w = w ch; wc = wc ch; inword = 1 }
  # `$(…)` / backtick: skipped whole (quote- and paren-aware), its text
  # counted as code, so the scan goes on to judge what follows it.
  function subst(cl,   j, c, d, q2, body) {
    j = i + (cl == ")" ? 2 : 1); d = 1; q2 = ""
    while (j <= n) {
      c = substr(s, j, 1)
      if (q2 == "\047") { if (c == "\047") q2 = ""; j++; continue }
      if (c == "\\") { j += 2; continue }
      if (q2 == "\"") { if (c == "\"") q2 = ""; j++; continue }
      if (c == "\047" || (c == "\"" && cl == ")")) { q2 = c; j++; continue }
      if (cl == ")") {
        if (c == "(") d++
        else if (c == ")" && --d == 0) break
      } else if (c == "`") break
      j++
    }
    if (j > n) giveup("an unterminated command substitution")
    body = substr(s, i + (cl == ")" ? 2 : 1), j - i - (cl == ")" ? 2 : 1))
    E = 1; wlit = 0; inword = 1; no("command substitution")
    cands(body)
    i = j + 1
  }
  function dollar() {
    if (substr(s, i + 1, 1) == "(") { subst(")"); return }
    E = 1; wlit = 0; no("a `$` expansion"); add("$"); i++
  }
  # "$(cat <<[-]DELIM\n…\nDELIM\n)" — the message idiom. Body is data.
  function idiom(   rest, d, dq, strip, j, t, e, line, body) {
    rest = substr(s, i)
    if (!match(rest, /^\$\([ \t]*cat[ \t]+<<-?[ \t]*/)) return 0
    strip = index(substr(rest, 1, RLENGTH), "<<-") > 0
    j = i + RLENGTH; t = substr(s, j)
    if (match(t, "^\047[A-Za-z0-9_]+\047") || match(t, /^"[A-Za-z0-9_]+"/)) {
      d = substr(t, 2, RLENGTH - 2); dq = 1
    } else if (match(t, /^[A-Za-z0-9_]+/)) {
      d = substr(t, 1, RLENGTH); dq = 0
    } else return 0
    j += RLENGTH; t = substr(s, j)
    if (!match(t, /^[ \t]*\n/)) return 0
    j += RLENGTH; body = ""
    while (1) {
      if (j > n) return 0
      e = index(substr(s, j), "\n")
      if (e == 0) { line = substr(s, j); j = n + 1 } else { line = substr(s, j, e - 1); j += e }
      if (strip) sub(/^\t+/, "", line)
      if (line == d) break
      body = body line "\n"
    }
    t = substr(s, j)
    if (!match(t, /^[ \t\n]*\)/)) return 0
    if (!dq && body ~ /[$`\\]/) giveup("an expansion in a heredoc body")
    # Message data only when a git command consumes it; elsewhere
    # (`sh -c "$(cat <<EOF …)"`, `echo "$(…)" | bash`) the body may be code.
    if (!(nw > 0 && gitdata())) {
      E = 1; no("a command substitution outside a git command"); cands(body)
    }
    w = w body; inword = 1
    i = j + RLENGTH
    return 1
  }
  function endword() {
    if (!inword) return
    if (hdnext) {
      hn++; hdd[hn] = w; hdq[hn] = wq; hds[hn] = hdstrip; hdseg[hn] = segid; hdnext = 0
    } else if (redir) {
      redir = 0
      if (!wlit) no("a non-literal redirect target")
      cands(wc)
    } else {
      nw++; words[nw] = w; wl[nw] = wlit
      cands(wc)
    }
    w = ""; wc = ""; inword = 0; wlit = 1; wq = 0
  }
  function bodies(   k, e, line, body) {
    for (k = hdone + 1; k <= hn; k++) {
      body = ""
      while (1) {
        if (i > n) giveup("a heredoc without its delimiter line")
        e = index(substr(s, i), "\n")
        if (e == 0) { line = substr(s, i); i = n + 1 } else { line = substr(s, i, e - 1); i += e }
        if (hds[k]) sub(/^\t+/, "", line)
        if (line == hdd[k]) break
        body = body line "\n"
      }
      if (!hdq[k] && body ~ /[$`\\]/) { E = 1; no("an expansion in a heredoc body") }
      if (segmsg[hdseg[k]] && body ~ /Via: \/commit/) V = 1
      # A heredoc fed to git is message data; fed to anything else it may
      # be code, so its text counts.
      if (!seggit[hdseg[k]]) {
        no("a heredoc on a non-git command")
        if (body ~ /[$`]/) E = 1
        cands(body)
      }
    }
    hdone = hn
  }
  function commitseg(k,   m, a, only, dash, np, val) {
    if (condpending) no("a cd behind && whose list ended before the commit")
    only = 0; dash = 0; np = 0; val = 0
    for (m = k + 1; m <= nw; m++) {
      a = words[m]
      if (dash) {
        if (a == "" || a ~ /[*?[\\\n]/ || a ~ /^:/) no("the pathspec `" a "`")
        np++; pth[np] = a; continue
      }
      if (val) { val = 0; continue }
      if (a == "--") dash = 1
      else if (a == "--only") only = 1
      else if (a ~ /^(-[mFCct]|--(message|file|author|date|cleanup|trailer|fixup|squash|reuse-message|reedit-message|template))$/) val = 1
      else if (a ~ /^(-[mF].+|--(message|file|author|date|cleanup|trailer|fixup|squash|reuse-message|reedit-message|template)=.*)$/) continue
      else if (a ~ /^(-q|--quiet|-v|--verbose|-s|--signoff|--no-signoff|-e|--edit|--no-edit|--amend|--allow-empty|--allow-empty-message|--no-gpg-sign|--reset-author|--status|--no-status)$/) continue
      else no("`" a "` before `--` in git commit")
    }
    if (val) no("a git commit option without its value")
    if (!only) no("a git commit without a literal `--only`")
    if (!dash || np == 0) no("a git commit without `-- <paths>`")
    nrec++; rec[nrec] = "C" OFS (gd != "" ? gd : cur)
    for (m = 1; m <= np; m++) { nrec++; rec[nrec] = "P" OFS pth[m] }
  }
  function segment(op,   j, k, cmd, lit, d, filt) {
    endword()
    cdend()
    # `a &&` newline `b`: the newline continues the list.
    if (nw == 0 && op == "\n" && (prevop == "&&" || prevop == "||" || prevop == "|")) return
    if (redir || hdnext) { no("a redirect without a target"); redir = 0; hdnext = 0 }
    filt = (prevop == "|")
    if (nw > 0) {
      for (k = 1; k <= nw; k++) {
        if (words[k] == "pushd" || words[k] == "popd") S = 1
        if (words[k] == "cd" && (cdpath != "" || (k < nw && words[k + 1] == "-"))) S = 1
      }
      j = 1
      if (words[1] == "rtk" && nw > 1 && words[2] == "git") j = 2
      cmd = words[j]
      lit = 1
      for (k = 1; k <= nw; k++) if (!wl[k]) lit = 0
      seggit[segid] = gitdata()
      commitvia()
      if (!lit) no("a word with an expansion or glob")
      else if (filt) {
        if (cmd !~ /^(tail|head|cat|wc|grep)$/) no("`" cmd "` after a pipe")
      } else if (cmd == "cd") {
        if (op == "|") no("a cd inside a pipeline")
        k = j + 1
        while (k <= nw && (words[k] == "-L" || words[k] == "-P")) k++
        if (k <= nw && words[k] == "--") k++
        if (k != nw || words[k] == "" || words[k] == "-") no("a cd without exactly one literal directory")
        else {
          d = words[k]
          if (cdpath != "" && d !~ /^(\/|\.\.?(\/|$))/) no("a relative cd while CDPATH is set")
          if (listpos > 0) condcd = 1
          else if (d ~ /^\//) condpending = 0
          cur = join(cur, d)
        }
      } else if (cmd == "git") {
        gd = ""
        for (k = j + 1; k <= nw; k++) {
          if (words[k] == "-C" && k < nw) { k++; gd = join(gd == "" ? cur : gd, words[k]); continue }
          if (words[k] == "--no-pager") continue
          break
        }
        if (k > nw) no("git without a subcommand")
        else if (words[k] == "commit") commitseg(k)
        else if (words[k] !~ /^(add|diff|log|push|restore|rev-parse|show|status)$/) no("`git " words[k] "`")
      } else if (cmd !~ /^(echo|printf|true)$/) no("`" cmd "`")
      if (!filt) listpos++
    }
    if (op == ";" || op == "\n" || op == "") {
      if (condcd) condpending = 1
      condcd = 0; listpos = 0
    } else if (op != "&&" && op != "|") no("`" op "`")
    prevop = op; nw = 0; segid++
  }
  {
    s = $0; n = length(s); i = 1; segid = 1; wlit = 1
    while (i <= n) {
      c = substr(s, i, 1)
      if (q == "\047") { if (c == "\047") q = ""; else { w = w c; wc = wc c }; i++; continue }
      if (q == "\"") {
        if (c == "\"") { q = ""; i++; continue }
        if (c == "`") { subst("`"); continue }
        if (c == "$") { if (idiom()) continue; dollar(); continue }
        if (c == "\\") {
          nc = substr(s, i + 1, 1)
          if (nc ~ /[$`"\\]/) { w = w nc; wc = wc nc; i += 2; continue }
          if (nc == "\n") { i += 2; continue }
        }
        w = w c; wc = wc c; i++; continue
      }
      if (c == "\047" || c == "\"") { q = c; inword = 1; wq = 1; i++; continue }
      if (c == "`") { subst("`"); continue }
      if (c == "$") { dollar(); continue }
      if (c == "#" && !inword) { while (i <= n && substr(s, i, 1) != "\n") i++; continue }
      if (c == "\\") {
        if (i < n && substr(s, i + 1, 1) != "\n") { add(substr(s, i + 1, 1)); wq = 1 }
        i += 2; continue
      }
      if (c == " " || c == "\t") { endword(); i++; continue }
      if (c == "~" && !inword) {
        nc = substr(s, i + 1, 1)
        if (nc == "" || nc ~ /[\/ \t\n;&|()<>]/) { add(home); i++; continue }
        S = 1; no("a `~` prefix other than `~/`")
      }
      two = substr(s, i, 2)
      if (c == "<" || c == ">" || two == "&>") {
        # An all-digit word right before the operator is its fd number.
        if (inword && !wq && w ~ /^[0-9]+$/) { w = ""; wc = ""; inword = 0 } else endword()
        if (c == "&") i++
        i++; nc = substr(s, i, 1)
        if (two == "<<") {
          i++
          if (substr(s, i, 1) == "<") { i++; redir = 1; continue }
          hdstrip = 0
          if (substr(s, i, 1) == "-") { i++; hdstrip = 1 }
          hdnext = 1; continue
        }
        if (nc == "(") giveup("process substitution")
        if (nc == ">" || nc == "|" || nc == "&") i++
        else if (c == "<" && nc == ">") i++
        redir = 1; continue
      }
      if (two == "&&" || two == "||" || two == ";;" || two == "|&") { segment(two); i += 2; continue }
      if (c == ";" || c == "|" || c == "&" || c == "(" || c == ")") { segment(c); i++; continue }
      if (c == "\n") { segment("\n"); i++; bodies(); continue }
      if (c ~ /[*?[{}]/) { wlit = 0; no("an unquoted glob or brace `" c "`") }
      add(c); i++
    }
    if (q != "") giveup("an unterminated quote")
    segment("")
    if (hn > hdone) giveup("a heredoc without its body")
    out()
  }' <<<"$command")

block_unchecked() {
  cat >&2 <<EOF
⛔ Commit blocked: cannot tell which checkout this \`git commit --only\` lands in
   (not the checkable shape: $1; $2)

This gate evaluates only commands it can read exactly (the allowlist in
this hook's header) and blocks the rest when the commit could land on
main. Rewrite as one of:

  cd <worktree> && git commit --only -- <paths>
  git -C <worktree> commit --only -- <paths>

Put heredocs / scripts / pushd / subshell work in a separate Bash call
before the commit. Product landings on main: invoke \`/commit\`.
EOF
  exit 2
}

# Why an unchecked command could still reach a main checkout ("" = cannot).
points_elsewhere() {
  local top tag f1 p d real hit
  top=$(git rev-parse --show-toplevel 2>/dev/null || printf '')
  if [ -n "$top" ]; then
    top=$(cd -P -- "$top" 2>/dev/null && pwd -P) || top=""
  fi
  while IFS=$'\037' read -r tag f1; do
    case "$tag" in
      E) printf '%s' "the text has a \`\$\` / backtick expansion"; return ;;
      S) printf '%s' "the text uses pushd / popd / bare \`cd\` / \`cd -\` / \`~user\` / CDPATH"; return ;;
      X)
        p="$f1"
        case "$p" in
          \~) p="$HOME" ;;
          \~/*) p="$HOME/${p#\~/}" ;;
          \~*) printf '%s' "the text names \`${f1}\`"; return ;;
        esac
        [ -e "$p" ] || continue
        if [ -d "$p" ]; then d="$p"; else d=$(dirname -- "$p"); fi
        # Both the shell's logical cd and the kernel's physical walk.
        hit=""
        for real in "$(cd -L -- "$d" 2>/dev/null && pwd -P)" "$(cd -P -- "$d" 2>/dev/null && pwd -P)"; do
          [ -n "$real" ] || continue
          case "$real/" in
            /dev/*|/proc/*|/sys/*|/usr/*|/bin/*|/sbin/*|/lib/*|/lib64/*|/etc/*) continue ;;
          esac
          if [ -n "$top" ]; then
            case "$real/" in
              "$top"/*) continue ;;
            esac
          fi
          hit=1
        done
        [ -z "$hit" ] || { printf '%s' "the text names \`${f1}\`, outside this checkout"; return; }
        ;;
    esac
  done <<EOF
$scan
EOF
}

if ! grep -qx 'T' <<<"$scan"; then
  exit 0
fi

# /commit Step 4 puts `Via: /commit` in the message. It counts only in a git
# commit's own message — not another git command's argument, a comment, an
# `echo`, or a script body.
if grep -qx 'V' <<<"$scan"; then
  exit 0
fi

reason=$(awk -F '\037' '$1 == "N" { print $2; exit }' <<<"$scan")
if [ -n "$reason" ]; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf '')
  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    block_unchecked "$reason" "the session checkout is ${branch}"
  fi
  why=$(points_elsewhere)
  if [ -n "$why" ]; then
    block_unchecked "$reason" "$why"
  fi
  exit 0
fi

expand_tilde() {
  case "$1" in
    \~) printf '%s' "$HOME" ;;
    \~/*) printf '%s' "$HOME/${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

whitelisted() {
  local p="$1"
  [ -z "$p" ] && return 1
  # `tasks/../packages/foo.ts` matches `tasks/*` before git normalizes.
  case "$p" in
    *..*) return 1 ;;
  esac
  case "$p" in
    HANDOFF.md|ROADMAP.md|docs/tech-debt.md) return 0 ;;
    tasks/*|docs/discussions/*|docs/digests/*|docs/pitfalls/*|docs/archives/*) return 0 ;;
  esac
  if [ "${p#vendor/snippets/}" != "$p" ] && [ "${p%.md}" != "$p" ]; then
    return 0
  fi
  return 1
}

# Every commit is evaluated — a second commit in the same command must not
# ride on the first one's verdict.
blocked=""
branch=""
prefix=""
top=""
check=0
while IFS=$'\037' read -r tag f1; do
  case "$tag" in
    C)
      check=0
      dir=$(expand_tilde "$f1")
      if [ -n "$dir" ]; then
        branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '')
        if [ -z "$branch" ]; then
          cat >&2 <<EOF
⛔ Commit blocked: \`git commit --only\` targets ${dir} but the checkout could not be resolved

An unresolvable cd / -C target is fail-closed on this gate — invoke
\`/commit\` or use an existing, literal path.
EOF
          exit 2
        fi
      else
        dir="."
        branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf '')
      fi
      # Session branches pass; an unresolvable session cwd (not a repo, no
      # cd / -C) stays fail-open — git itself will refuse the commit.
      if [ -z "$branch" ] || { [ "$branch" != "main" ] && [ "$branch" != "master" ]; }; then
        continue
      fi
      # git resolves a pathspec against the commit's cwd, not the repo root.
      prefix=$(git -C "$dir" rev-parse --show-prefix 2>/dev/null || printf '')
      top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || printf '')
      check=1
      ;;
    P)
      [ "$check" = 1 ] || continue
      p=$(expand_tilde "$f1")
      case "$p" in
        /*)
          if [ -n "$top" ] && [ "${p#"$top"/}" != "$p" ]; then
            p="${p#"$top"/}"
          else
            blocked="${blocked}  ${f1}\n"
            continue
          fi
          ;;
        *)
          p="${prefix}${p#./}"
          ;;
      esac
      if ! whitelisted "$p"; then
        blocked="${blocked}  ${f1}\n"
      fi
      ;;
  esac
done <<EOF
$scan
EOF

if [ -z "$blocked" ]; then
  exit 0
fi

cat >&2 <<EOF
⛔ Commit blocked: \`git commit --only\` on ${branch} with paths outside the ad-hoc whitelist

Ad-hoc \`--only\` on main/master is limited to the path whitelist in
rules/core/commit.detail.md § \`--only\` 適用範圍. These paths are not on it
(resolved against the commit's cwd${prefix:+, prefix \`${prefix}\`}):

$(printf '%b' "$blocked")
Fix: invoke \`/commit\` (adds \`Via: /commit\` and runs 0-A).
Do NOT add a fake Via trailer to this command.

Whitelist (HANDOFF / tech-debt / tasks / artifact-tick / …) still uses
\`git commit --only\`. Session-branch commits inside a worktree are not
this gate — only main/master.

Work-loop is not an exception. Packaging if /commit hits 人工檢查;
NEVER --only around 0-A.
EOF
  exit 2
