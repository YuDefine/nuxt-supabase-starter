# SOP 05 — 達標 probe 包

**Todo id**：`gate-05-post-verify`  
**路徑**：`docs/playbooks/05-post-gate-verify.md`  
**看板 id**：`post-gate-verify`

開場白：「現在跑 `gate-05-post-verify`（本檔）。Ready = 01–03 看板皆 `verified`（01/02 的 N/A 也算）。04 已套用選項 2 也算。」

## Ready

| 列 | 必須 |
| --- | --- |
| `lxc-tailscale` | `verified` |
| `ssh-config` | `verified` |
| `google-oauth` | `verified` |
| `deploy-prod-db` | `verified`（選項 2 predicate）或仍未升選項 1 |

任一未 verified → 回對應 SOP。

## Turns

### Turn A — DNS（self-hosted 才跑）

**跑**：`getent hosts {{PEER_HOSTNAME}}.{{TAILNET}}`（陽性）再 `getent hosts {{TAILSCALE_HOSTNAME}}.{{TAILNET}}`。  
N/A 的 01 → 記 `skipped — db-runtime 不是 supabase-self-hosted`。

### Turn B — SSH（self-hosted 才跑）

**跑**：`ssh -o BatchMode=yes -o ConnectTimeout=8 {{TAILSCALE_HOSTNAME}} hostname`  
hostname 是對照節點 → **斷線**回 02。

### Turn C — OAuth 契約

**跑**：`grep auth/google .env.example`。無 `/callback`。若必須回 Console 目視 URI，載體走 [README § Browser 分流](./README.md#browser-分流cursor-vs-非-cursor)。

### Turn D — `pnpm supabase:sync`（self-hosted 且 A+B 通過後）

真：exit 0 **且** stdout/stderr 有遠端非空成功訊號。假：只看到本機「有跑」。

### Turn E — 三支 audit（讀 **main**）

```bash
cd ~/offline/clade && node scripts/convention-conformance-audit.ts --live --consumer {{CONSUMER}}
node ~/offline/clade/scripts/audit-consumer-readiness.ts --consumer ~/offline/{{CONSUMER}} --gate
node scripts/deploy-trigger-check.ts
```

Live audit 讀 registry → **main checkout**。worktree 新檔未 merge 時，數字是 baseline，不是「worktree 已 compliant」。**worktree 綠 ≠ onboard 完成。**

`hub:vendor` 成功訊息不算證據；readiness `--gate` 必須 exit 0。

## 達標定義

- 可適用 convention 無 `drift`、無「declared 但 live 仍缺落地」（對 **已 merge 的**落地）
- `verify-channels` 不得在 `dev-login` 仍 `none` 時宣告 `full`
- 看板 01–03 `verified`；04 選項 2 則 deploy-track **不得** compliant
- self-hosted：DNS/SSH 通，且 `pnpm supabase:sync` 有非空成功訊號

全中 → 看板 `post-gate-verify` = `verified`，todo completed。  
否則 **NEVER** 宣稱達標。失敗列 `blocked-unexpected` + 該次指令/exit/原文。
