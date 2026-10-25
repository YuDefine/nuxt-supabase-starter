# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""version-upgrade 盤點層：用 pnpm 原生指令做機械盤點，輸出正規化 JSON。

用法：uv run inventory.py [--cwd <repo>] [--pnpm-target <ver>] [--audit] [--fixture-dir <dir>]
  --cwd          要盤點的 repo（缺省＝目前目錄）
  --pnpm-target  pnpm < 11.16 時改跑 `corepack pnpm@<ver> --pm-on-fail=ignore …` 的版本（缺省 11.24.0）
  --audit        另跑 `pnpm audit --json`，依 module_name 分組寫進頂層 `advisories`
  --fixture-dir  額外納入的目錄（clade 的 `*.yml.template`、未被 workflow 以 `./` 引用的
                 `action.yml`）：複製進 scratch fixture 跑同一指令，並掃其中 .md code block 內的
                 `uses: owner/repo@ref`（列為 manual，不自動改）
stdout 印一份 JSON：
  {pnpm_version, runner:'pnpm'|'corepack', items:[…], advisories?:[…], warnings:[…]}
  items：
    {kind:'npm', name, current, latest, wanted, isDeprecated, dependencyType, workspace?, source:'repo'}
    {kind:'action', name, current, latest, wanted, isDeprecated, dependencyType, source:'repo'|'fixture',
     locations:[{file, line, ref, comment}]}
    {kind:'action', manual:true, name, ref, file, line}   # .md code block 內嵌，不自動改
  advisories：{name, severity(組內最高), ids, patched, unpatched}
exit 0＝盤點完成；exit 2＝用法錯、cwd 不存在、非 pnpm lockfile；exit 1＝pnpm 指令失敗或輸出無法解析。

測試掛鉤：環境變數 VERSION_UPGRADE_PNPM_BIN／VERSION_UPGRADE_COREPACK_BIN 可替換執行檔。
pnpm outdated 有落後時 exit 1 是正常，只要 stdout 能 parse 就算成功。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_PNPM_TARGET = "11.24.0"
ACTIONS_MIN_PNPM = (11, 16)
NON_PNPM_LOCKFILES = ("package-lock.json", "yarn.lock", "bun.lock", "bun.lockb")
SKIP_DIRS = {"node_modules", ".git"}
SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"]
USES_RE = re.compile(
    r"^\s*(?:-\s*)?uses:\s*['\"]?(?P<name>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?:/[^@\s'\"]*)?"
    r"@(?P<ref>[^\s'\"#]+)['\"]?\s*(?:#\s*(?P<comment>.*?))?\s*$"
)
ACTION_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
VERSION_RE = re.compile(r"v?(\d+(?:\.\d+){0,2})")


class Fail(Exception):
    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.code = code


# ---------- 跑 pnpm ----------


def pnpm_argv(runner: str, target: str) -> list[str]:
    if runner == "corepack":
        corepack = os.environ.get("VERSION_UPGRADE_COREPACK_BIN") or "corepack"
        return [corepack, f"pnpm@{target}", "--pm-on-fail=ignore"]
    return [os.environ.get("VERSION_UPGRADE_PNPM_BIN") or "pnpm"]


def run_pnpm(runner: str, target: str, args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    argv = pnpm_argv(runner, target) + args
    try:
        return subprocess.run(argv, cwd=cwd, capture_output=True, text=True, check=False)
    except FileNotFoundError as err:
        raise Fail(f"找不到執行檔：{argv[0]}（{err}）") from err


def parse_json_after_noise(stdout: str) -> tuple[object, list[str]]:
    """剝掉 stdout 開頭的 WARN／非 JSON 行（pnpm 10 把 WARN 寫進 stdout）再 parse。"""
    if not stdout.strip():
        return None, []
    lines = stdout.splitlines()
    for i, line in enumerate(lines):
        if line[:1] not in ("{", "["):
            continue
        try:
            data = json.loads("\n".join(lines[i:]))
        except json.JSONDecodeError:
            continue
        return data, [ln.strip() for ln in lines[:i] if ln.strip()]
    raise ValueError("stdout 裡找不到可 parse 的 JSON")


def run_json(
    runner: str, target: str, args: list[str], cwd: Path, warnings: list[str]
) -> object:
    proc = run_pnpm(runner, target, args, cwd)
    try:
        data, noise = parse_json_after_noise(proc.stdout)
    except ValueError as err:
        raise Fail(
            f"`pnpm {' '.join(args)}` exit {proc.returncode}，{err}\nstderr: {proc.stderr.strip()[:500]}"
        ) from err
    if data is None and proc.returncode != 0:
        raise Fail(
            f"`pnpm {' '.join(args)}` exit {proc.returncode} 且無 JSON 輸出\nstderr: {proc.stderr.strip()[:500]}"
        )
    if proc.returncode not in (0, 1):
        raise Fail(f"`pnpm {' '.join(args)}` exit {proc.returncode}\nstderr: {proc.stderr.strip()[:500]}")
    if noise:
        warnings.append(f"pnpm {args[0]}：stdout 剝掉 {len(noise)} 行非 JSON（{noise[0][:160]}）")
    return data


def detect_pnpm_version(cwd: Path) -> str:
    proc = run_pnpm("pnpm", "", ["--version"], cwd)
    if proc.returncode != 0:
        raise Fail(f"`pnpm --version` 失敗：{proc.stderr.strip()[:300]}")
    match = re.search(r"\d+\.\d+\.\d+\S*", proc.stdout)
    if not match:
        raise Fail(f"無法解析 pnpm 版本：{proc.stdout.strip()[:100]}")
    return match.group(0)


def version_tuple(text: str) -> tuple[int, ...]:
    match = VERSION_RE.search(text or "")
    return tuple(int(p) for p in match.group(1).split(".")) if match else ()


# ---------- 正規化 pnpm outdated ----------


def outdated_rows(data: object) -> list[tuple[str, dict]]:
    """pnpm 10／11 的 JSON 可能是 {name: {...}} 或 [{packageName|name, ...}]，兩種都吃。"""
    if data is None:
        return []
    rows: list[tuple[str, dict]] = []
    if isinstance(data, dict):
        for name, body in data.items():
            if isinstance(body, dict):
                rows.append((name, body))
    elif isinstance(data, list):
        for body in data:
            if not isinstance(body, dict):
                continue
            name = body.get("packageName") or body.get("name")
            if name:
                rows.append((str(name), body))
    return rows


def workspaces_of(body: dict) -> list[str]:
    names: list[str] = []
    for dep in body.get("dependentPackages") or []:
        if isinstance(dep, dict) and dep.get("name"):
            names.append(str(dep["name"]))
    if isinstance(body.get("workspace"), str):
        names.append(body["workspace"])
    return sorted(set(names))


def is_action_row(name: str, body: dict) -> bool:
    if body.get("dependencyType") == "githubAction":
        return True
    return "dependencyType" not in body and bool(ACTION_NAME_RE.match(name))


def base_row(kind: str, name: str, body: dict) -> dict:
    return {
        "kind": kind,
        "name": name,
        "current": body.get("current"),
        "latest": body.get("latest"),
        "wanted": body.get("wanted"),
        "isDeprecated": bool(body.get("isDeprecated", False)),
        "dependencyType": body.get("dependencyType"),
    }


# ---------- 掃檔 ----------


def iter_files(root: Path, suffixes: tuple[str, ...]):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for fn in sorted(filenames):
            if fn.endswith(suffixes):
                yield Path(dirpath) / fn


def rel(path: Path, cwd: Path) -> str:
    try:
        return path.resolve().relative_to(cwd.resolve()).as_posix()
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def scan_uses(files: list[Path], cwd: Path) -> dict[str, list[dict]]:
    found: dict[str, list[dict]] = {}
    for path in files:
        for lineno, line in enumerate(read_text(path).splitlines(), start=1):
            match = USES_RE.match(line)
            if not match or match.group("name").startswith("."):
                continue
            found.setdefault(match.group("name"), []).append(
                {
                    "file": rel(path, cwd),
                    "line": lineno,
                    "ref": match.group("ref"),
                    "comment": match.group("comment") or None,
                }
            )
    return found


def scan_markdown(root: Path, cwd: Path) -> list[dict]:
    items: list[dict] = []
    for path in iter_files(root, (".md",)):
        in_fence = False
        for lineno, line in enumerate(read_text(path).splitlines(), start=1):
            if line.lstrip().startswith(("```", "~~~")):
                in_fence = not in_fence
                continue
            if not in_fence:
                continue
            match = USES_RE.match(line)
            if match and not match.group("name").startswith("."):
                items.append(
                    {
                        "kind": "action",
                        "manual": True,
                        "name": match.group("name"),
                        "ref": match.group("ref"),
                        "file": rel(path, cwd),
                        "line": lineno,
                    }
                )
    return items


def github_yaml(cwd: Path) -> list[Path]:
    gh = cwd / ".github"
    return list(iter_files(gh, (".yml", ".yaml"))) if gh.is_dir() else []


def split_unreferenced_actions(cwd: Path) -> tuple[list[Path], list[Path]]:
    """回傳 (repo 內掃得到的 yaml, 沒被 workflow 以 ./ 引用的 action.yml)。"""
    files = github_yaml(cwd)
    actions = [p for p in files if p.name in ("action.yml", "action.yaml")]
    others = [p for p in files if p not in actions]
    refs = "\n".join(read_text(p) for p in files)
    unreferenced: list[Path] = []
    for action in actions:
        dir_rel = rel(action.parent, cwd)
        pattern = re.compile(r"uses:\s*['\"]?\./" + re.escape(dir_rel) + r"/?['\"]?(?:\s|$)")
        if not pattern.search(refs):
            unreferenced.append(action)
    referenced = [p for p in actions if p not in unreferenced]
    return others + referenced, unreferenced


def collect_fixture_sources(fixture_dir: Path) -> list[Path]:
    sources = [
        p
        for p in iter_files(fixture_dir, (".yml", ".yaml", ".yml.template", ".yaml.template"))
        if re.search(r"^\s*(?:-\s*)?uses:", read_text(p), re.MULTILINE)
    ]
    return sources


def build_fixture(workdir: Path, cwd: Path, files: list[Path], copy_github: bool) -> None:
    """stub package.json 與 .github/workflows/ 同層（pnpm 會解析 realpath，不能用 symlink）。"""
    (workdir / "package.json").write_text('{"name":"vu-fixture","private":true}\n', encoding="utf-8")
    workflows = workdir / ".github" / "workflows"
    workflows.mkdir(parents=True)
    if copy_github and (cwd / ".github").is_dir():
        shutil.copytree(cwd / ".github", workdir / ".github", dirs_exist_ok=True)
    for index, path in enumerate(files):
        name = re.sub(r"[^A-Za-z0-9_.-]+", "__", rel(path, cwd))
        for suffix in (".template",):
            if name.endswith(suffix):
                name = name[: -len(suffix)]
        if not name.endswith((".yml", ".yaml")):
            name += ".yml"
        shutil.copyfile(path, workflows / f"{index:03d}-{name}")


# ---------- 盤點 ----------


def action_items(
    data: object, locations: dict[str, list[dict]], source: str
) -> list[dict]:
    items: list[dict] = []
    for name, body in outdated_rows(data):
        if not is_action_row(name, body):
            continue
        row = base_row("action", name, body)
        row["dependencyType"] = row["dependencyType"] or "githubAction"
        locs = locations.get(name, [])
        row["locations"] = locs
        if row["current"] is None and locs:
            versions = [
                v for v in (version_tuple(f"{l['comment'] or ''} {l['ref']}") for l in locs) if v
            ]
            if versions:
                row["current"] = ".".join(str(n) for n in min(versions))
        row["source"] = source
        items.append(row)
    return items


def inventory(args: argparse.Namespace, cwd: Path) -> dict:
    warnings: list[str] = []
    for lock in NON_PNPM_LOCKFILES:
        if (cwd / lock).exists() and not (cwd / "pnpm-lock.yaml").exists():
            raise Fail(f"偵測到 {lock} 且沒有 pnpm-lock.yaml：不支援 npm／bun／yarn（fleet 全是 pnpm）", 2)

    pnpm_version = detect_pnpm_version(cwd)
    runner = "pnpm" if version_tuple(pnpm_version) >= ACTIONS_MIN_PNPM else "corepack"
    if runner == "corepack":
        warnings.append(
            f"pnpm {pnpm_version} < 11.16：actions 盤點改跑 corepack pnpm@{args.pnpm_target} --pm-on-fail=ignore"
        )

    items: list[dict] = []
    has_root_pkg = (cwd / "package.json").is_file()
    repo_yaml, unreferenced = split_unreferenced_actions(cwd)

    if has_root_pkg:
        data = run_json(
            "pnpm", "", ["outdated", "-r", "--filter", "!./vendor/**", "--format", "json"], cwd, warnings
        )
        for name, body in outdated_rows(data):
            if is_action_row(name, body) and body.get("dependencyType") == "githubAction":
                continue
            row = base_row("npm", name, body)
            workspaces = workspaces_of(body)
            if workspaces:
                row["workspace"] = workspaces
            row["source"] = "repo"
            items.append(row)

        data = run_json(
            runner, args.pnpm_target, ["outdated", "--include-github-actions", "--format", "json"], cwd, warnings
        )
        items.extend(action_items(data, scan_uses(repo_yaml, cwd), "repo"))
    else:
        warnings.append("根目錄沒有 package.json：npm 盤點略過，actions 走 fixture")

    fixture_files: list[Path] = list(unreferenced)
    fixture_root: Path | None = None
    if args.fixture_dir:
        fixture_root = Path(args.fixture_dir)
        if not fixture_root.is_absolute():
            fixture_root = cwd / fixture_root
        if not fixture_root.is_dir():
            raise Fail(f"--fixture-dir 不存在：{fixture_root}", 2)
        fixture_files += [p for p in collect_fixture_sources(fixture_root) if p not in fixture_files]
        items.extend(scan_markdown(fixture_root, cwd))
    # 無根 package.json：整份 .github 搬進 fixture（連同被 ./ 引用的 local action）
    copy_github = not has_root_pkg
    scan_files = list(fixture_files)
    if copy_github:
        scan_files = [p for p in github_yaml(cwd)] + [p for p in fixture_files if p not in github_yaml(cwd)]

    if scan_files or fixture_files:
        with tempfile.TemporaryDirectory(prefix="vu-inventory-") as tmp:
            workdir = Path(tmp)
            build_fixture(workdir, cwd, fixture_files, copy_github)
            data = run_json(
                runner,
                args.pnpm_target,
                ["outdated", "--include-github-actions", "--format", "json"],
                workdir,
                warnings,
            )
        items.extend(action_items(data, scan_uses(scan_files, cwd), "fixture"))

    result: dict = {"pnpm_version": pnpm_version, "runner": runner, "items": items}
    if args.audit:
        result["advisories"] = audit(cwd, warnings)
    result["warnings"] = warnings
    return result


# ---------- audit ----------


def lower_bound(patched: str, installed: list[tuple[int, ...]] | None = None) -> tuple[int, ...] | None:
    """patched_versions 字串 → 要升到的下限；無修補回 None。

    `||` 各段各有一個下限（例 `>=4.2.1 <5.0.0 || >=5.3.0`）。有實際安裝版本時，對每個安裝版本取
    「不低於它的最小下限」（同 major 的修補段優先自然落在這裡），再取各安裝版本的最大值——
    NEVER 一律取最低段，否則裝 5.x 的會被寫成 4.2.1（降版或升完仍有漏洞）。
    沒有安裝版本資訊時才退回最小下限。
    """
    text = (patched or "").strip()
    if not text or re.fullmatch(r"<\s*0\.0\.0", text):
        return None
    bounds: list[tuple[int, ...]] = []
    for segment in text.split("||"):
        for op, ver in re.findall(r"(<=|<|>=|>|\^|~|=)?\s*v?(\d+(?:\.\d+){0,2})", segment):
            if op in ("<", "<="):
                continue
            bounds.append(pad(tuple(int(p) for p in ver.split("."))))
            break
    if not bounds:
        return None
    if not installed:
        return min(bounds)
    picks = []
    for cur in installed:
        above = [b for b in bounds if b >= pad(cur)]
        picks.append(min(above) if above else max(bounds))
    return max(picks)


def pad(v: tuple[int, ...]) -> tuple[int, ...]:
    return (v + (0, 0, 0))[:3]


def installed_versions(adv: dict) -> list[tuple[int, ...]]:
    out = []
    for finding in adv.get("findings") or []:
        ver = finding.get("version") if isinstance(finding, dict) else None
        m = re.match(r"v?(\d+(?:\.\d+){0,2})", str(ver or ""))
        if m:
            out.append(pad(tuple(int(p) for p in m.group(1).split("."))))
    return out


def normalize_advisories(data: object, warnings: list[str]) -> list[dict]:
    raw = data.get("advisories") if isinstance(data, dict) else None
    if isinstance(raw, dict):
        return [a for a in raw.values() if isinstance(a, dict)]
    if isinstance(raw, list):
        return [a for a in raw if isinstance(a, dict)]
    if isinstance(data, dict) and "vulnerabilities" in data:
        warnings.append("audit：npm 風格 vulnerabilities 形狀，僅取 via 內物件，patched 未知")
        out: list[dict] = []
        for name, vuln in (data.get("vulnerabilities") or {}).items():
            for via in vuln.get("via", []) if isinstance(vuln, dict) else []:
                if isinstance(via, dict):
                    out.append(
                        {
                            "module_name": via.get("name") or name,
                            "severity": via.get("severity"),
                            "id": via.get("source"),
                            "patched_versions": None,
                        }
                    )
        return out
    warnings.append("audit：無法辨識的輸出形狀，advisories 為空")
    return []


def audit(cwd: Path, warnings: list[str]) -> list[dict]:
    data = run_json("pnpm", "", ["audit", "--json"], cwd, warnings)
    groups: dict[str, dict] = {}
    for adv in normalize_advisories(data, warnings):
        name = adv.get("module_name") or adv.get("name") or "(unknown)"
        group = groups.setdefault(
            name, {"name": name, "severity": "info", "ids": set(), "bounds": [], "unpatched": False}
        )
        sev = str(adv.get("severity") or "info").lower()
        if sev in SEVERITY_ORDER and SEVERITY_ORDER.index(sev) > SEVERITY_ORDER.index(group["severity"]):
            group["severity"] = sev
        adv_id = adv.get("github_advisory_id") or adv.get("id")
        if adv_id is not None:
            group["ids"].add(str(adv_id))
        bound = lower_bound(adv.get("patched_versions") or "", installed_versions(adv))
        if bound is None:
            group["unpatched"] = True
        else:
            group["bounds"].append(bound)
    out = []
    for group in groups.values():
        patched = ".".join(str(n) for n in max(group["bounds"])) if group["bounds"] else None
        out.append(
            {
                "name": group["name"],
                "severity": group["severity"],
                "ids": sorted(group["ids"]),
                "patched": patched,
                "unpatched": group["unpatched"],
            }
        )
    out.sort(key=lambda g: (-SEVERITY_ORDER.index(g["severity"]), g["name"]))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="version-upgrade 盤點層（pnpm 原生）")
    parser.add_argument("--cwd", default=".")
    parser.add_argument("--pnpm-target", default=DEFAULT_PNPM_TARGET)
    parser.add_argument("--audit", action="store_true")
    parser.add_argument("--fixture-dir")
    try:
        args = parser.parse_args()
    except SystemExit as err:
        return int(err.code or 0)
    cwd = Path(args.cwd)
    if not cwd.is_dir():
        print(f"cwd 不存在：{cwd}", file=sys.stderr)
        return 2
    try:
        result = inventory(args, cwd.resolve())
    except Fail as err:
        print(str(err), file=sys.stderr)
        return err.code
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
