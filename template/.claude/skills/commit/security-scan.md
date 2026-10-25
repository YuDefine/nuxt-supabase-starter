
# 0-S.3 Claude 安全掃描 — 診斷與預算

`gates.md` § **0-S.3** 的延伸檔。準備 `path`／`working-tree`／`diff` 掃描、或判讀掃描失敗時讀取。

**本檔不服務 pre-commit。** commit 路徑上的安全 gate 是 0-S.1（`security-precommit.ts`）
與 0-S.2（`/security-review`），兩者都不經過本檔描述的任何模式。

## 掃描模型

`scripts/security-scan.ts` 以 headless Claude Code（`claude -p --safe-mode`）掃描，預設
Claude Opus 5.5（effort: medium）——安全判讀與 `code-review-opus` 同屬判讀列
（`rules/core/agent-routing.routing-table.md`）。顯式 `--model`／`--effort` 可覆寫；ledger 記
requested `model` 與 stream 回報的 `observed_models`，兩者不符 fail closed（`failure_class: model-mismatch`）。
scanner 只拿到 Read／Grep／Glob，不寫檔、不跑命令；env 走 `gatewayFreeEnv()`，NEVER 經 gateway。

Codex Security（`@openai/codex-security`，`gpt-5.6-sol`）隨 Codex 訂閱 2026-10-08 到期退場
（flow c0dff2f2「改 Claude 掃」）。`setup`／`baseline`／`preflight`／`verify`／`hook` 是它的模式，
現在一律 exit 2 拒跑。**NEVER** 為了跑舊模式重裝 codex-security 或改用 API key。

## 範圍永遠是檔案清單

| 模式 | 範圍 | 掃哪一份內容 |
| --- | --- | --- |
| `path --path <relative> [--path …]` | 指定的檔 | target 工作樹現況 |
| `working-tree --paths-file <file> [--patch-file <file>]` | operator 給的清單內的檔（一行一個，rename 列兩端） | 固定 HEAD 的私有快照加入選定內容；變更 diff 另交 scanner 先讀；原 repo index、WIP 不動。operator 補掃用，`/commit` 不呼叫 |
| `diff --base <parent> --head <commit>` | 該 range 的變更檔 | 固定 head 的私有快照；變更 diff 另交 scanner 先讀 |

scanner 不自己推導範圍——舊 scanner「請求 14 檔、分母 6,330」的失敗型態不存在。
同一檔混有其他工作的變更時，用 `--patch-file` 選定本批 hunks；**NEVER** 擅自把整檔納入本批。
掃描後內容變了即重掃，不能把舊快照結果套到新內容。

## Coverage 只認實際讀過的檔

coverage 由 stream-json 裡 scanner **實際 Read 過**的檔機械核對：範圍內每一個檔都讀過才是
`complete`；`missing_paths` 非空就是 `partial`（exit 2、`coverage-incomplete`）。
範圍內已刪除的檔（含 rename 舊端）快照裡沒有、無從 Read：記進 `deleted_paths`，不算分母；
`working-tree`／`diff` 的變更 diff 也在分母裡，scanner 沒讀到就記 `<changes.diff>`。
`--path` 只接受檔案，目錄 exit 2。
**NEVER** 採信模型自述的 `files_reviewed`，也 **NEVER** 把 `partial` 回報成已掃。

## 預算

`--max-cost` 直接傳給 `claude --max-budget-usd`（預設 $5）；撞上時 `failure_reason: cost-limit-reached`，
提高停止線或拆小批次重跑。`--timeout-sec` 抓掛死的 scanner，預設由預算推導（180 s/$，下限 900s）。
實測：1 支 2KB migration 掃完 $0.12／21s（`docs/evidence/2026-10-18-claude-scanner-smoke-ledger.jsonl`）。

## exit 與 failure_class

| exit | failure_class | 處置 |
| --- | --- | --- |
| `0` | `none` | coverage complete、無 high／critical |
| `1` | `none` | 有 high／critical：修正後重掃 |
| `2` | `coverage-incomplete` | `cost-limit-reached` 提高停止線；`coverage-incomplete` 拆小批次重跑 |
| `2` | `tool-timeout` | 放大 `--timeout-sec` 重跑 |
| `2` | `model-mismatch` | 回應的不是要求的 model：查 gateway env／帳號，NEVER 改收別的 model |
| `2` | `tool-failure-no-artifacts` | 依 `failure_reason`：`tool-missing`（裝 `claude`）、`auth-failure`（重新登入 Claude）、`quota-exhausted`（等帳號額度，NEVER 換 model 繞過）、`policy-refused`、`unknown`（讀 stderr 與 events.jsonl） |

## 工具故障（僅 `tool-failure-no-artifacts` / `tool-timeout`）

0-S.3 是 operator 補掃，不是 `/commit` 的 gate：沒有「授權未掃描落地」這條路徑，commit 也不帶 `Security-Scan: unscanned` trailer 或 `HANDOFF.md` 的 `0-S UNSCANNED` 條目。
工具故障時 operator 修工具（依 [runtime-lifecycle.md](runtime-lifecycle.md) 收回背景工作）後重跑，回報 failure_class、failure_reason、output_dir。

- **NEVER** 把故障或 `coverage-incomplete` 的部分掃描回報成已掃；完成報告寫 `0-S.3 未執行（<failure_class>）`。
- commit 路徑上的 0-S.1／0-S.2 不受此影響，仍照 `gates.md` 擋。

## 證據與 ledger

artifacts 在 `${XDG_DATA_HOME:-$HOME/.local/share}/clade/security-scans/<mode>-<stamp>/`
（`events.jsonl`、`findings.json`、`report.md`、`manifest.json`；stderr 在同層 `<dir>.stderr.log`）。
ledger row 追加到 target 自家 ledger：lifecycle repo（有 `specs/truth/work-lifecycle.md`）寫 `specs/evidence/security-scan-ledger.jsonl`，
未遷移 consumer 寫 `docs/evidence/security-scan-ledger.jsonl`（舊檔還在、新檔不在的 lifecycle repo 會拒寫並印 `git mv`；`CLADE_SECURITY_SCAN_LEDGER` 覆寫），
由 operator 另行 commit，不屬於任何 commit gate。row 記範圍、`missing_paths`、snapshot digest／兩端 SHA、`source_head_sha`、
scanner 版本、requested／observed model、`security_md_sha` 與 `estimated_cost_usd`（`claude-result-total-cost`，
是 Claude CLI 的估算，不是實際扣款）。舊 Codex row 的 `codex_security_version` 等欄位照留，視為歷史。

有 `SECURITY.md` 時 scanner 先讀它並逐條對照不變量；沒有時 pointer warn 並記 null。
