# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Probe an existing CLI without changing any state and print the facts as JSON.

Fail-closed: by default only `--help` runs (plain and with NO_COLOR=1). Every other
probe reaches code paths that a CLI with a state-changing default action could act
on, so it runs only when named in --allow (or --typo) after the caller has checked
the source. Every call runs in a temporary cwd with stdin from /dev/null, in its own
process group, under a timeout; a CLI that waits for input shows up as
`timed_out: true`. The calls still use the real environment and credentials.

Exit codes: 0 probes ran (whatever the target CLI returned), 1 the target could
not be started, 2 usage error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

UNKNOWN_COMMAND = "__cli_design_probe_unknown__"
UNKNOWN_FLAG = "--cli-design-probe-unknown-flag"
HEAD_CHARS = 3000
MAX_CONSECUTIVE_TIMEOUTS = 3
OPTIONAL_PROBES = ("short_help", "help_subcommand", "version", "unknown_command", "unknown_flag")

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
SUGGESTION_RE = re.compile(
    r"did you mean|similar command|closest|perhaps you meant|maybe you meant|possible commands",
    re.IGNORECASE,
)
EXAMPLES_RE = re.compile(r"^\s*examples?\s*:?\s*$", re.IGNORECASE | re.MULTILINE)
USAGE_RE = re.compile(r"^\s*usage\b", re.IGNORECASE | re.MULTILINE)
LONG_FLAG_RE = re.compile(r"(?<![\w-])--[a-z][a-z0-9-]*")
SECTION_RE = re.compile(
    r"^([A-Za-z][A-Za-z ]*?(commands|subcommands|resources)|commands|subcommands)\s*:?\s*$",
    re.IGNORECASE,
)
ENTRY_RE = re.compile(r"^\s+([a-z][\w:.-]*)(?:\s*,\s*[\w-]+)*(?:\s{2,}|\s*$)")
# argparse subparsers `{a,b}`; a `{json,yaml}` right after a flag (`[--format {json,yaml}]`) is its choices.
CHOICES_RE = re.compile(r"(\S*)\s*\{([a-z][\w-]*(?:,[a-z][\w-]*)+)\}")
# `usage: prog <a|b|c>` right after the program name; later `<x|y>` slots are argument values.
USAGE_CHOICES_RE = re.compile(
    r"^\s*usage\s*:?\s+\S+\s+<([a-z][\w-]*(?:\|[a-z][\w-]*)+)>", re.IGNORECASE | re.MULTILINE
)


def absolutize(argv: list[str]) -> list[str]:
    """Resolve arguments that are existing relative paths, since probes run in a temp cwd."""
    # Path-shaped args (`./cli`) and script files with a suffix after the program (`python mycli.py`).
    # A bare program name is a PATH lookup and a bare word like `db` or `test` is a subcommand, even
    # when a file or directory of that name exists in the cwd.
    return [
        str(Path(a).resolve())
        if not os.path.isabs(a)
        and os.path.exists(a)
        and ("/" in a or (i > 0 and os.path.isfile(a) and Path(a).suffix))
        else a
        for i, a in enumerate(argv)
    ]


def run(argv: list[str], cwd: str, timeout: float, extra_env: dict[str, str] | None = None) -> tuple[dict, str]:
    """Run one probe; returns (JSON record, ANSI-stripped stdout+stderr for parsing)."""
    env = {**os.environ, **(extra_env or {})}
    started = time.monotonic()
    timed_out = False
    proc = subprocess.Popen(
        argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        # Kill the whole group: a wrapper's grandchild holding the pipe would block communicate().
        timed_out = True
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass  # the group exited between the timeout and the kill
        try:
            out, err = proc.communicate(timeout=1)
        except subprocess.TimeoutExpired:
            out, err = b"", b""
    stdout = ANSI_RE.sub("", raw_out := out.decode("utf-8", "replace"))
    stderr = ANSI_RE.sub("", raw_err := err.decode("utf-8", "replace"))
    stream = {(True, True): "both", (True, False): "stdout", (False, True): "stderr", (False, False): "none"}[
        (bool(stdout.strip()), bool(stderr.strip()))
    ]
    record = {
        "argv": argv,
        "exit_code": None if timed_out else proc.returncode,
        "timed_out": timed_out,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "output_stream": stream,
        "ansi_in_stdout": raw_out != stdout,
        "ansi_in_stderr": raw_err != stderr,
        "stdout_head": stdout[:HEAD_CHARS],
        "stderr_head": stderr[:HEAD_CHARS],
    }
    return record, stdout + "\n" + stderr


def help_signals(text: str) -> dict:
    return {
        "has_usage": bool(USAGE_RE.search(text)),
        "has_examples": bool(EXAMPLES_RE.search(text)),
        "flags": sorted(set(LONG_FLAG_RE.findall(text))),
    }


def parse_subcommands(text: str) -> list[str]:
    """Heuristic: entries under a `Commands:`-style header, argparse `{a,b}`, `usage: prog <a|b>`."""
    names: list[str] = []
    in_section = False
    for line in text.splitlines():
        if not line.startswith((" ", "\t")) and line.strip():
            in_section = bool(SECTION_RE.match(line.strip()))
            continue
        if in_section and (m := ENTRY_RE.match(line)):
            names.append(m.group(1).rstrip(":"))
    for before, group in CHOICES_RE.findall(text):
        if not before.lstrip("[").startswith("-"):
            names.extend(group.split(","))
    for group in USAGE_CHOICES_RE.findall(text):
        names.extend(group.split("|"))
    return [n for n in dict.fromkeys(names) if n != "help"]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Probe a CLI with --help by default; other probes only when allowed. Prints facts as JSON.",
        epilog="example: uv run probe_cli.py --allow version,unknown_command --typo atuh --depth 1 -- gh",
    )
    parser.add_argument("--allow", default="", help=f"comma list of extra root probes: {','.join(OPTIONAL_PROBES)}")
    parser.add_argument("--typo", help="probe this misspelled subcommand (pick a read-only name; not a prefix of a real one)")
    parser.add_argument("--depth", type=int, default=0, help="subcommand levels to probe with --help (default 0)")
    parser.add_argument("--commands", help="comma list of root subcommands to probe instead of parsing them from help")
    parser.add_argument("--timeout", type=float, default=10.0, help="seconds per call (default 10)")
    parser.add_argument("--max-commands", type=int, default=60, help="cap on subcommands probed (default 60)")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="target CLI and its prefix args, after --")
    args = parser.parse_args()

    target = args.command[1:] if args.command[:1] == ["--"] else args.command
    allow = {s.strip() for s in args.allow.split(",") if s.strip()}
    if not target or allow - set(OPTIONAL_PROBES):
        parser.print_usage(sys.stderr)
        problem = "missing target command" if not target else f"unknown probe(s) in --allow: {sorted(allow - set(OPTIONAL_PROBES))}"
        print(f"error: {problem}. next: `--allow` takes {','.join(OPTIONAL_PROBES)}; target goes after `--`.", file=sys.stderr)
        return 2
    target = absolutize(target)

    with tempfile.TemporaryDirectory(prefix="cli-design-probe-") as cwd:
        try:
            root_help, root_text = run(target + ["--help"], cwd, args.timeout)
        except (FileNotFoundError, PermissionError) as exc:
            print(f"error: cannot start {target[0]!r}: {exc}. next: check the command path.", file=sys.stderr)
            return 1
        root_help["signals"] = help_signals(root_text)
        probes: dict[str, dict] = {"help": root_help}
        root_subs = (
            [s.strip() for s in args.commands.split(",") if s.strip()]
            if args.commands
            else parse_subcommands(root_text)
        )

        plan = {
            "no_color_help": (["--help"], {"NO_COLOR": "1"}),
            "short_help": (["-h"], None),
            "help_subcommand": (["help"], None),
            "version": (["--version"], None),
            "unknown_command": ([UNKNOWN_COMMAND], None),
            "unknown_flag": ([UNKNOWN_FLAG], None),
        }
        if args.typo:
            plan["typo_command"] = ([args.typo], None)
        selected = {"no_color_help", "typo_command"} | allow
        commands: list[dict] = []
        truncated = False
        root_lines = set(root_text.splitlines())
        if not root_help["timed_out"]:  # a hanging --help means every other call would hang too
            for name, (extra, env) in plan.items():
                if name in selected:
                    probes[name], text = run(target + extra, cwd, args.timeout, env)
                    if name in ("unknown_command", "typo_command", "unknown_flag"):
                        # Only lines not in the root help: a CLI that dumps its USAGE on error must not
                        # count help prose such as "closest" as a suggestion.
                        error_text = "\n".join(l for l in text.splitlines() if l not in root_lines)
                        probes[name]["suggestion_detected"] = bool(SUGGESTION_RE.search(error_text))

            root_output = (root_help["stdout_head"], root_help["stderr_head"])
            frontier = [([], root_subs)]
            consecutive_timeouts = 0
            for level in range(1, args.depth + 1):
                next_frontier = []
                for path, subs in frontier:
                    for sub in subs:
                        if len(commands) >= args.max_commands or consecutive_timeouts >= MAX_CONSECUTIVE_TIMEOUTS:
                            truncated = True
                            break
                        rec, text = run(target + path + [sub, "--help"], cwd, args.timeout)
                        # Compare both streams: Go's `flag` and many hand-written parsers print help to stderr.
                        same_as_root = (rec["stdout_head"], rec["stderr_head"]) == root_output
                        commands.append({"path": path + [sub], "level": level, **rec,
                                         "signals": help_signals(text), "same_as_root_help": same_as_root})
                        consecutive_timeouts = consecutive_timeouts + 1 if rec["timed_out"] else 0
                        # A node that falls back to the root help would re-list the root's children.
                        if rec["exit_code"] == 0 and not same_as_root:
                            next_frontier.append((path + [sub], parse_subcommands(text)))
                frontier = next_frontier

    report = {
        "target": target,
        "depth": args.depth,
        "probes": probes,
        "probes_not_run": sorted((set(plan) | {"typo_command"}) - set(probes)),
        "root_subcommands": root_subs,
        "commands": commands,
        "commands_truncated": truncated,
        "leaf_names": sorted({c["path"][-1] for c in commands} or set(root_subs)),
        "flags_seen": sorted(set(root_help["signals"]["flags"]).union(*(c["signals"]["flags"] for c in commands))),
        "any_timeout": any(p["timed_out"] for p in probes.values()) or any(c["timed_out"] for c in commands),
    }
    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
