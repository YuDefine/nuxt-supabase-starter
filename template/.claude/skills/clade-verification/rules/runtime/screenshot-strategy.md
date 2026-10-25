---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 target adapter carrier 或 reproducible runner CLI
paths: ['screenshots/**', 'tests/e2e/**', 'packages/*/tests/e2e/**', 'specs/plans/**/design-review.md']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/screenshot-strategy.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native screenshot strategy

For Claude Code, use `agent-browser` for a one-off authenticated observation or review, `Playwright` for repeatable responsive/cross-browser specs, and `chrome-devtools-mcp` only for performance measurement (Lighthouse, traces, heap snapshots); daily screenshots and interaction use the browser carrier. Use `safe-screenshot.ts` for canonical review evidence.

The carrier session must remain isolated, be re-snapshotted after navigation or interaction, and validate URL, DOM, expected text, and artifact size in the same operation. Remote browser providers are opt-in and require the shared consent and privacy gates.

## Browser control surface (single standard, every machine)

This section is the one place that decides which tool and which machine an agent uses to drive a browser; skills and cookbooks point here instead of restating it. It is reached by absolute path (`~/offline/clade/adapters/claude/instructions/rules/core/screenshot-strategy.md`) from the user-level `agent-browser` and `headless-gui-bridge` skills, which every session on desk and zenbook lists, and from the cookbook below — so it applies to logins, token capture, scraping and demos too, not only to the `paths` this file is scoped to.

- **Tool**: whenever the agent drives a browser, it uses `agent-browser`. Procedures, profile/session invariants and troubleshooting: `~/offline/clade/vendor/snippets/agent-browser/README.md`.
- **A human must see or take over** (login, OAuth, 2FA, acceptance walkthrough, demo): run `agent-browser --headed` on **desk** with `DISPLAY=:2` and the persistent profile under desk's `~/.agent-browser/`; the human watches and operates it through desk's KasmVNC URL (`gui-bridge.sh url` on desk). The agent keeps driving the same session with `snapshot`/`click`.
- **Session on zenbook or any other machine**: do the above over `ssh desk`, wrapped in bash because desk's login shell is zsh and does not word-split `$AB` (`ssh desk bash -s <<'EOF' … EOF`). NEVER start KasmVNC, `headless-gui-bridge`, a Chrome shim or an AppArmor profile on the local machine for this.
- **Headless automation nobody watches** (evidence screenshots, verification, scraping): `agent-browser` headless. It runs on desk when it needs a logged-in profile (the logged-in profiles live on desk and MUST NOT be copied to another machine); it runs on the session's own machine when no login profile is needed, e.g. a local dev server bound to `127.0.0.1`.
- **Profile** (Charles 2026-10-22): any real website runs on an existing persistent profile on desk, chosen by `purpose`/`aliases` in desk's `~/.agent-browser/profiles.json` — `profile-main` (Charles's personal account; "main") or `profile-yudefine` (<maintainer-email>; "yudefine") unless another listed profile's purpose names the site. Pass it as an absolute path on every command. NEVER a temporary profile (no `--profile`, `mktemp`, `/tmp/…`), NEVER `profile-default`, NEVER a newly created profile without asking Charles. The only temporary-profile case left is a local dev server on `127.0.0.1` logged in through its dev-login route. Before `open`, `close` the session; after it, run the cookbook's `verify-session.sh <session> <profile> [<url prefix>]` (§ 開啟後驗證) and stop unless it prints `OK`. NEVER check with a bare `agent-browser --session <s> get url`, `pgrep` or the daemon's environment — a command without the same `--profile` is itself what relaunches Chrome on a temporary profile.
- **Banned substitutes**: Playwright `playwright open` headed windows; `xdotool` (or any input injection) on Charles's everyday desktop Chrome; a local `headless-gui-bridge` stood up for the agent; Claude in Chrome or the built-in browser pane as the control surface; `open`/`xdg-open`. If the desk route is unavailable, report the blocker instead of switching surfaces.

`headless-gui-bridge` stays the owner of desk's KasmVNC display itself and of a human operating non-browser GUI there; it is not an agent browser-control surface. `Playwright test` (regression specs) and `chrome-devtools-mcp` (measurement) keep the roles above.
