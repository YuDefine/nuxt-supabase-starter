
# Upstream attribution

- Source: `michael-denyer/pstack-claude`（Lauren Tan 的 pstack 的 Claude Code port）
- Upstream skills: `plugins/pstack/skills/benchmark-checklist`、`plugins/pstack/skills/principle-explain-the-number`、`plugins/pstack/skills/poteto-mode/playbooks/{hillclimb,perf-issue}.md`
- Researched revision: Release 0.9.93（2026-10-18）
- Copyright: Copyright (c) 2026 Lauren Tan
- License: MIT

Preserves the seven benchmark questions (limiter "why not double", tuned, physical limit arithmetic, errors, repeatability with alternating runs and median, end-to-end share, work actually happened), the explain-the-number rules (decision before run, list other things the number could measure, evidence travels with the number), the hillclimb loop (frozen harness with proven sensitivity, one change one measurement keep-or-revert, decision log, stop predicate with an iteration floor), and the performance-mantra ordering.

Adapts: the repeatability step is a Node script (`scripts/summarize-runs.mjs`) that prints `route=`; the report and decision log are templates; the playbooks' subagent model table, poteto-mode routing, PR-stacking and stop rule of the autonomous-run playbook are dropped because clade routes work through its own routing table and PR flow.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
