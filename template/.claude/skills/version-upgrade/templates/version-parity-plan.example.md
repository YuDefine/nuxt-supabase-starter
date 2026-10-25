# 跨環境版本對齊 rollout plan：supabase、chrome-devtools-mcp

- 產出時間：2026-10-13 09:10
- SoT：`registry/toolchain.json`（supabase `2.120.0` exact、chrome-devtools-mcp `1.10.1` exact）
- 矩陣指令：`node ~/offline/clade/scripts/audit-ci-toolchain-parity.ts --matrix --tool supabase`；`--tool chrome-devtools-mcp`
- 承載工作：W-2026-10-12-version-parity

## 量測摘要

| 工具 | 量得到格數 | aligned | drift | unpinned | 另列：undeclared | 另列：unmeasurable | 另列：no-target |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| supabase | 6 | 0 | 5 | 1 | 0 | 1 | 0 |
| chrome-devtools-mcp | 6 | 0 | 0 | 6 | 0 | 0 | 0 |

## 待收斂項目

| 工具 | 層 | consumer | 現值 | 目標 | 升級路徑 | 驗收 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| supabase | ci | <consumer-id> | 2.78.1 ×5（含 deploy-staging／deploy-production） | 2.120.0 | 2b relay（types 須重產：typegen 0.2.2） | `--matrix --tool supabase --consumer <consumer-id>`：ci aligned | relayed（<consumer-id>/version-parity-supabase） |
| supabase | ci | <consumer-id> | `latest`（e2e.yml） | 2.120.0 | 1 宣告化 relay | 同上 `--consumer <consumer-id>`：ci aligned | pending |
| supabase | runner | <consumer-id> | fc-supabase-prod 裸呼叫 ×3 | 2.120.0 | 1 宣告化：改 setup action 釘版 | 同上 `--consumer <consumer-id>`：runner covered | pending |
| chrome-devtools-mcp | repo | <consumer-id> | `@latest` | 1.10.1 | 1 宣告化 relay（2026-09-30 rollout 未落地） | `--matrix --tool chrome-devtools-mcp --consumer <consumer-id>`：repo aligned | pending |

## 補宣告與補量測

- `registry/runner-toolchain.json`：fc-supabase-prod 的 `sshTarget` 仍是 null（clade 補；探測需 Charles 授權）

## 待拍板

- 無

## 收斂紀錄

- 2026-10-13：首掃，supabase 5 drift／1 unpinned、chrome-devtools-mcp 6 unpinned
