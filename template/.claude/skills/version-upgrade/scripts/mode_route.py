# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""version-upgrade Step 0：依「為什麼要動版本 × 動到哪個範圍」算出 route。

用法：uv run mode_route.py [--cwd <目錄>] [--plan <計畫檔>] [--reason <理由>]… [--scope <範圍>] [--] [參數…]
stdout 印 key=value：`cwd_kind=`、`input_shape=`、`route=`、`phase=`，必要時 `candidates=`、`resume_item=`、`resume_route=`、`focus=`。
參數裡的 `--reason`／`--scope`（例：relay brief 的 `/version-upgrade --reason security --scope consumer`）與放在 `--` 前同義。
exit 0＝判定完成（含 `route=ask`／`route=judge`／`route=mismatch`）；exit 2＝用法錯、cwd 或 --plan 不存在。

cwd_kind：
  clade-home    git toplevel 有 `scripts/clade-home-runtime.ts`（clade 本體或其 worktree）
  consumer      git toplevel 有 `package.json`＋lockfile，或有 `.github/workflows/`（含 consumer 的 worktree）
  other         以上皆非

理由（reason）：routine 例行補落後｜release 追某個上游 release｜toolchain packageManager／runtime｜
  deprecated EOL／deprecated／改名｜security 依賴安全通報｜rollback 上游壞版釘回｜skills 第三方 skill 上游｜
  major framework major migration（不收）｜non-node 非 Node 生態（不收）
範圍（scope）：consumer｜fleet｜clade｜machine｜remote

input_shape：
  empty                  無參數
  keywords               全是固定子命令（可多個＝複選，G2）：routine actions toolchain skills machine parity audit
                         `actions` 走 routine，另印 `focus=actions`：計畫檔只收 kind=action 的列
  release-url            `https://github.com/<owner>/<repo>/releases/tag/<tag>`
  pkg-version            `<pkg>@<ver>`、`<pkg> v<ver>`、`<pkg> <ver>`
  rollback               `rollback <pkg>@<ver>`
  freeform               其餘自然語言，一律 `route=judge`，交 rules/mode分流判準.md 的語意表判，判完帶 --reason/--scope 重跑

route：`<reason>.<scope>`（複選時逗號分隔，phase 同序）；`resume`（--plan 指向有未完成列的計畫檔）；
  `out.work-route`／`out.non-node`（不收，交去處）；`ask`（範圍或理由判不出，印 candidates）；`judge`；`mismatch`。
沒帶 --plan 時 NEVER 判續跑——cwd 是 worktree 不代表在升版中段。
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

LOCKFILES = ("pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock")
RELEASE_URL = re.compile(r"^https://github\.com/[^/\s]+/[^/\s]+/releases/tag/\S+$")
VERSION = r"v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?"
PKG = r"(?:@[a-z0-9][\w.-]*/)?[a-z0-9][\w.-]*"
PKG_AT = re.compile(rf"^{PKG}@{VERSION}$", re.IGNORECASE)
PKG_SPACE = re.compile(rf"^{PKG}\s+{VERSION}$", re.IGNORECASE)
ROLLBACK = re.compile(rf"^rollback\s+{PKG}@{VERSION}$", re.IGNORECASE)

REASONS = ("routine", "release", "toolchain", "deprecated", "security", "rollback", "skills", "major", "non-node")
SCOPES = ("consumer", "fleet", "clade", "machine", "remote")

# 子命令 → (理由, 固定範圍或 None＝依 cwd)
KEYWORDS: dict[str, tuple[str, str | None]] = {
    "routine": ("routine", None),
    "actions": ("routine", None),
    "toolchain": ("toolchain", None),
    "skills": ("skills", None),
    "machine": ("routine", "machine"),
    "parity": ("toolchain", "remote"),
    "audit": ("security", None),
}

# 理由 × 範圍 → Phase；沒列的組合＝不收（mismatch）。入口表的 SoT 在 rules/mode分流判準.md Rule 1
PHASES: dict[tuple[str, str], str] = {
    ("routine", "consumer"): "B",
    ("routine", "fleet"): "F-routine",
    ("routine", "clade"): "K",
    ("routine", "machine"): "M",
    ("routine", "remote"): "P",
    ("release", "consumer"): "B",
    ("release", "fleet"): "F",
    ("release", "clade"): "K",
    ("release", "machine"): "M",
    ("release", "remote"): "P",
    ("toolchain", "consumer"): "T",
    ("toolchain", "fleet"): "T",
    ("toolchain", "clade"): "T",
    ("toolchain", "machine"): "M",
    ("toolchain", "remote"): "P",
    ("deprecated", "consumer"): "B",
    ("deprecated", "fleet"): "F-routine",
    ("deprecated", "clade"): "K",
    ("deprecated", "machine"): "M",
    ("deprecated", "remote"): "P",
    ("security", "consumer"): "B",
    ("security", "fleet"): "F-routine",
    ("security", "clade"): "K",
    ("rollback", "consumer"): "C",
    ("rollback", "fleet"): "F",
    ("rollback", "clade"): "K",
    ("rollback", "machine"): "M",
    ("skills", "consumer"): "S",
    ("skills", "fleet"): "S",
    ("skills", "clade"): "S",
}

# 計畫檔狀態欄：這些值以外（done／skipped／failed）都算已結案
OPEN_STATES = ("pending", "in-progress", "blocked")


def git_toplevel(cwd: Path) -> Path | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return None
    if out.returncode != 0:
        return None
    return Path(out.stdout.strip())


def cwd_kind(cwd: Path) -> str:
    root = git_toplevel(cwd) or cwd
    if (root / "scripts" / "clade-home-runtime.ts").is_file():
        return "clade-home"
    has_pkg = (root / "package.json").is_file() and any((root / f).is_file() for f in LOCKFILES)
    if has_pkg or (root / ".github" / "workflows").is_dir():
        return "consumer"
    return "other"


def input_shape(args: list[str]) -> tuple[str, list[str]]:
    text = " ".join(a.strip() for a in args if a.strip())
    if not text:
        return "empty", []
    if ROLLBACK.match(text):
        return "rollback", []
    if RELEASE_URL.match(text):
        return "release-url", []
    if PKG_AT.match(text) or PKG_SPACE.match(text):
        return "pkg-version", []
    tokens = [t.lower() for t in re.split(r"[\s,]+", text) if t]
    head = tokens[0]
    # parity 可帶一個工具名
    if head == "parity" and len(tokens) <= 2:
        return "keywords", ["parity"]
    if all(t in KEYWORDS for t in tokens):
        return "keywords", list(dict.fromkeys(tokens))
    return "freeform", []


def default_scope(kind: str) -> str | None:
    """依 cwd 推範圍；clade home 同時可能是「全 fleet」或「clade 自身」，推不出。"""
    return "consumer" if kind == "consumer" else None


def resolve(reasons: list[tuple[str, str | None]], kind: str, scope: str | None) -> list[str] | None:
    """回 `<reason>.<scope>` 清單；任一項範圍推不出回 None。"""
    out = []
    for reason, fixed in reasons:
        if reason == "major":
            out.append("out.work-route")
            continue
        if reason == "non-node":
            out.append("out.non-node")
            continue
        s = fixed or scope or default_scope(kind)
        if s is None:
            return None
        out.append(f"{reason}.{s}")
    return list(dict.fromkeys(out))


def phase_of(code: str) -> str:
    if code.startswith("out."):
        return code
    reason, scope = code.split(".", 1)
    return PHASES.get((reason, scope), "")


PLAN_ROUTE = re.compile(r"^-\s*route[：:]\s*`([^`]+)`")


def plan_route(plan: Path) -> str | None:
    """計畫檔表頭 `- route：`<reason>.<scope>`` 那一行的值；讀不到或不在 PHASES 回 None。"""
    for line in plan.read_text(encoding="utf-8").splitlines():
        m = PLAN_ROUTE.match(line.strip())
        if m:
            code = m.group(1).strip()
            return code if "." in code and phase_of(code) not in ("", code) else None
    return None


def first_open_row(plan: Path) -> str | None:
    """計畫檔的「狀態」欄有 OPEN_STATES 之一的第一列，回該列 item 欄。"""
    header: list[str] | None = None
    for line in plan.read_text(encoding="utf-8").splitlines():
        if not line.lstrip().startswith("|"):
            header = None
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = cells
            continue
        if all(set(c) <= set("-: ") for c in cells):
            continue
        if "狀態" not in header:
            continue
        state = cells[header.index("狀態")].strip("` ").lower() if len(cells) == len(header) else ""
        if state in OPEN_STATES:
            return cells[0].strip("` ")
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cwd", default=".", help="判定用的工作目錄（預設目前目錄）")
    parser.add_argument("--plan", help="計畫檔（templates/upgrade-plan.md 形狀）；有未完成列 → route=resume")
    parser.add_argument("--reason", action="append", choices=REASONS, default=[], help="語意判讀後的理由，可重複")
    parser.add_argument("--scope", choices=SCOPES, help="語意判讀後的範圍")
    parser.add_argument("args", nargs="*", help="使用者給 /version-upgrade 的參數")
    ns = parser.parse_args()
    # 參數裡的 --reason／--scope（`--` 之後）照樣認，免得 relay brief 的旗標落進 freeform
    inner = argparse.ArgumentParser(add_help=False)
    inner.add_argument("--reason", action="append", choices=REASONS, default=[])
    inner.add_argument("--scope", choices=SCOPES)
    extra, rest = inner.parse_known_args(ns.args)
    ns.reason += extra.reason
    ns.scope = ns.scope or extra.scope
    ns.args = rest
    cwd = Path(ns.cwd)
    if not cwd.is_dir():
        print(f"error: --cwd 不是目錄：{cwd}", file=sys.stderr)
        return 2
    kind = cwd_kind(cwd)
    shape, keywords = input_shape(ns.args)
    print(f"cwd_kind={kind}")
    print(f"input_shape={shape}")

    if ns.plan:
        plan = Path(ns.plan)
        if not plan.is_file():
            print(f"error: --plan 不存在：{plan}", file=sys.stderr)
            return 2
        item = first_open_row(plan)
        if item is not None:
            code = plan_route(plan)
            phase = phase_of(code) if code else "C"
            print("route=resume")
            print(f"phase={'C' if phase == 'B' else phase}")
            print(f"resume_item={item}")
            if code:
                print(f"resume_route={code}")
            return 0

    if ns.reason:
        reasons: list[tuple[str, str | None]] = [(r, None) for r in ns.reason]
    elif shape == "keywords":
        reasons = [KEYWORDS[k] for k in keywords]
    elif shape in ("release-url", "pkg-version"):
        reasons = [("release", None)]
        if kind == "clade-home" and ns.scope is None:
            # 在 clade home 追某個 release，預設是跨 consumer 的 Fleet；要升 clade 自己帶 --scope clade
            reasons = [("release", "fleet")]
    elif shape == "rollback":
        reasons = [("rollback", None)]
    elif shape == "freeform":
        print("route=judge")
        return 0
    else:  # empty
        if kind == "consumer":
            reasons = [("routine", None)]
        else:
            print("route=ask")
            print("candidates=routine.fleet,routine.clade,routine.machine,toolchain.remote,skills.fleet")
            return 0

    codes = resolve(reasons, kind, ns.scope)
    if codes is None:
        print("route=ask")
        cand = [f"{r}.{s}" for r, _ in reasons for s in ("fleet", "clade") if (r, s) in PHASES]
        print(f"candidates={','.join(cand)}")
        return 0
    phases = [phase_of(c) for c in codes]
    if any(p == "" for p in phases):
        print("route=mismatch")
        print(f"candidates={','.join(codes)}")
        return 0
    print(f"route={','.join(codes)}")
    print(f"phase={','.join(phases)}")
    if shape == "keywords" and "actions" in keywords and "routine" not in keywords:
        print("focus=actions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
