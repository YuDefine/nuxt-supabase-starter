# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""cf-crawl helper for Cloudflare Browser Rendering /crawl.

  start   build the request body from CLI flags and create the job via the `cf` CLI
  status  print the job's status and progress via the `cf` CLI
  fetch   page the finished records over the HTTP API and save markdown

Credentials: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN from the environment, else
KEY=VALUE lines in .env, .env.local, ~/.env (values are read literally, never executed).
The token needs the "Browser Rendering - Edit" permission.

Exit codes: 0 ok, 1 API/cf failure, 2 usage error, 3 missing credentials.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CRED_KEYS = ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN")
ENV_LINE = re.compile(r"^\s*(?:export\s+)?(CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN))\s*=\s*(.*)$")
API_BASE = "https://api.cloudflare.com/client/v4/accounts/{account}/browser-rendering/crawl/{job}"
TOKEN_SCOPE_HINT = 'check that CLOUDFLARE_API_TOKEN has the "Browser Rendering - Edit" permission'


def fail(code: int, message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(code)


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = ENV_LINE.match(line)
        if not match:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        out[match.group(1)] = value
    return out


def load_credentials() -> dict[str, str]:
    creds = {key: os.environ.get(key, "") for key in CRED_KEYS}
    for path in (Path(".env"), Path(".env.local"), Path.home() / ".env"):
        if all(creds.values()):
            break
        if not path.is_file():
            continue
        parsed = parse_env_file(path)
        for key in CRED_KEYS:
            if not creds[key] and parsed.get(key):
                creds[key] = parsed[key]
    missing = [key for key in CRED_KEYS if not creds[key]]
    if missing:
        fail(3, f"missing credentials: {', '.join(missing)} (add them to the project .env; the token needs the 'Browser Rendering - Edit' permission)")
    return creds


def positive_int(raw: str) -> int:
    if not raw.isdigit() or int(raw) < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return int(raw)


def unix_seconds(raw: str) -> int:
    if raw.isdigit():
        return int(raw)
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an ISO date or Unix seconds") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def patterns(raw: str | None) -> list[str] | None:
    if raw is None:
        return None
    return [p.strip() for p in raw.split(",") if p.strip()]


def build_body(args: argparse.Namespace) -> dict:
    parsed = urllib.parse.urlparse(args.url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        fail(2, f"--url is not a valid URL: {args.url}")
    body: dict = {"url": args.url, "limit": args.limit, "formats": ["markdown"]}
    if args.depth is not None:
        body["depth"] = args.depth
    if args.source is not None:
        body["source"] = args.source
    if args.no_render:
        body["render"] = False
    if args.since is not None:
        body["modifiedSince"] = args.since
    include, exclude = patterns(args.include), patterns(args.exclude)
    if include or exclude:
        body["options"] = {}
        if include:
            body["options"]["includePatterns"] = include
        if exclude:
            body["options"]["excludePatterns"] = exclude
    return body


def run_cf(argv: list[str]) -> subprocess.CompletedProcess:
    creds = load_credentials()
    try:
        result = subprocess.run(
            ["cf", *argv],
            env={**os.environ, **creds},
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        fail(1, f"cannot run cf: {exc}")
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        fail(1, f"cf {' '.join(argv[:3])} failed (exit {result.returncode}); {TOKEN_SCOPE_HINT}")
    return result


def job_id(raw: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9-]+", raw):
        fail(2, f"--job is not a job ID: {raw}")
    return raw


def cmd_start(args: argparse.Namespace) -> int:
    body = build_body(args)
    if args.print_body:
        print(json.dumps(body, indent=2))
        return 0
    result = run_cf(["browser-run", "crawl", "create", "--body", json.dumps(body)])
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    result = run_cf(["browser-run", "crawl", "get", job_id(args.job), "--limit", "1"])
    try:
        job = json.loads(result.stdout)
    except json.JSONDecodeError:
        fail(1, f"cf browser-run crawl get printed non-JSON output: {result.stdout[:200]}")
    if isinstance(job, dict) and isinstance(job.get("result"), dict):
        job = job["result"]
    print(json.dumps({key: job.get(key) for key in ("status", "finished", "total")}))
    return 0


def get_json(url: str, token: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        hint = f"; {TOKEN_SCOPE_HINT}" if exc.code in (401, 403) else ""
        fail(1, f"GET {urllib.parse.urlparse(url).path} -> HTTP {exc.code}{hint}")
    except urllib.error.URLError as exc:
        fail(1, f"GET {urllib.parse.urlparse(url).path} failed: {exc.reason}")
    return {}


def page_records(base: str, token: str, status: str):
    cursor = None
    while True:
        query = {"status": status, "limit": "50"}
        if cursor:
            query["cursor"] = cursor
        result = (get_json(f"{base}?{urllib.parse.urlencode(query)}", token) or {}).get("result") or {}
        records = result.get("records") or []
        if not records:
            return
        yield from records
        cursor = result.get("cursor")
        if cursor is None:
            return


def file_name_for(page_url: str) -> str:
    name = re.sub(r"^https?://", "", page_url)
    name = re.sub(r"[^a-zA-Z0-9]", "_", name).strip("_")[:120]
    return f"{name or 'page'}.md"


def cmd_fetch(args: argparse.Namespace) -> int:
    job = job_id(args.job)
    creds = load_credentials()
    base = API_BASE.format(account=creds["CLOUDFLARE_ACCOUNT_ID"], job=job)
    token = creds["CLOUDFLARE_API_TOKEN"]
    outdir = Path(args.output)
    outdir.mkdir(parents=True, exist_ok=True)
    merged: list[str] = []
    saved = 0
    for record in page_records(base, token, "completed"):
        page_url, markdown = record.get("url") or "", record.get("markdown") or ""
        if not markdown:
            continue
        saved += 1
        if args.merge:
            merged.append(f"<!-- Source: {page_url} -->\n\n{markdown.rstrip()}\n")
        else:
            (outdir / file_name_for(page_url)).write_text(
                f"<!-- Source: {page_url} -->\n\n{markdown}", encoding="utf-8"
            )
    target = f"{args.output.rstrip('/')}/"
    if args.merge:
        merged_path = outdir / "crawl.md"
        merged_path.write_text("\n---\n\n".join(merged), encoding="utf-8")
        target = str(merged_path)
    skipped = sum(1 for _ in page_records(base, token, "skipped"))
    disallowed = sum(1 for _ in page_records(base, token, "disallowed"))
    print(json.dumps({"saved": saved, "skipped": skipped, "disallowed": disallowed, "output": target}))
    return 0


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        fail(2, f"{self.prog}: error: {message}")


def build_parser() -> argparse.ArgumentParser:
    parser = Parser(prog="crawl.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True, parser_class=Parser)

    start = sub.add_parser("start", help="create a crawl job via the cf CLI")
    start.add_argument("--url", required=True)
    start.add_argument("--limit", "-l", type=positive_int, default=20)
    start.add_argument("--depth", "-d", type=positive_int)
    start.add_argument("--include", help="comma-separated include patterns")
    start.add_argument("--exclude", help="comma-separated exclude patterns")
    start.add_argument("--no-render", action="store_true")
    start.add_argument("--source", choices=("all", "sitemaps", "links"))
    start.add_argument("--since", type=unix_seconds, help="ISO date or Unix seconds")
    start.add_argument("--print-body", action="store_true", help="print the request body and exit")
    start.set_defaults(func=cmd_start)

    status = sub.add_parser("status", help="print the job status as JSON")
    status.add_argument("--job", required=True)
    status.set_defaults(func=cmd_status)

    fetch = sub.add_parser("fetch", help="download completed records as markdown")
    fetch.add_argument("--job", required=True)
    fetch.add_argument("--output", "-o", default=".crawl-output")
    fetch.add_argument("--merge", action="store_true", help="write one merged crawl.md")
    fetch.set_defaults(func=cmd_fetch)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
