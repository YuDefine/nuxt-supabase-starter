# SOP 01 — 連到已在跑的開發資料庫

**Todo id**：`gate-01-dev-database`  
**路徑**：`docs/playbooks/01-dev-database.md`  
**看板 id**：`dev-database`

開場白：「現在跑 `gate-01-dev-database`（本檔）。Ready 全綠才進 Turn 1。」

## Applicability（N/A 先判）

本 SOP 只在開發資料庫跑在**另一台已在跑的伺服器**時才跑。這台電腦不要再起一份。

| probe | 真（跑 Turns） | 假（N/A → verified） |
| --- | --- | --- |
| `.claude/hub.json` 的 `modules["db-runtime"]` | `supabase-self-hosted` | 其他值或檔不存在 |
| 本機有沒有在跑 `supabase start` 當 DB | 沒有（DB 在已在跑的伺服器） | 本機 Docker 就是這專案的 DB |

假：看板 `verified`，PROGRESS 寫 `N/A — db-runtime=<value>`，todo completed。**不要**跑 `pct`。

## Ready

| probe | 真 | 假 |
| --- | --- | --- |
| 在獨立 worktree，不在 consumer main 改 infra | `git rev-parse --abbrev-ref HEAD` 含 session slug | 在 main 改 |
| {{NEVER_TOUCH_PEER}} 仍可當陽性對照 | `ssh -o BatchMode=yes {{PEER_HOSTNAME}} hostname` exit 0 且 stdout **不是** `{{TAILSCALE_HOSTNAME}}` | 連對照節點失敗 — 先修本機 Tailscale，**不要**動對照節點設定 |
| 看板列存在 | HANDOFF 有 `dev-database` | 先補看板，不要直接 pct |

## NEVER

- **NEVER** `tailscale logout`。
- **NEVER** 沿用過期 `login.tailscale.com/a/…`。現場重取。
- **NEVER** 覆蓋 `{{PEER_HOSTNAME}}`。新機器。
- **NEVER** 動 {{NEVER_TOUCH_PEER}}。

## Turns

### Turn 1 — 找到能跑 `pct` 的跳板

**跑**：依序（前一個 exit 非 0 才試下一個，每步記 PROGRESS）。跳板 hostname / key 以本機 `~/.ssh/config` 既有 Proxmox 區塊為準，不要猜別台 fleet 的 host。

**等**：其中一條 exit 0 且 stdout 含 `root` + `pve`（或該主機 hostname）。

**失敗下一 turn**：全部 255 → 換 identity / LAN / 從陽性對照節點跳，不要叫人開瀏覽器。

### Turn 2 — 容器死活

**跑**（用 Turn 1 成功的跳板）：`pct status {{LXC_ID}}`

| 觀測 | 下一 turn |
| --- | --- |
| `status: running` | Turn 3 |
| `status: stopped` | `pct start {{LXC_ID}}`，等 10s，重跑 |
| `Configuration file does not exist` | **停手**回報，不要 clone |
| 跳板又 255 | 回 Turn 1 |

### Turn 3 — Tailscale 現況（容器內）

**跑**：`pct exec {{LXC_ID}} -- tailscale status --json` 再抽 `Self.HostName` + `BackendState`。

| 觀測 | 下一 turn |
| --- | --- |
| HostName=`{{TAILSCALE_HOSTNAME}}` 且 BackendState=`Running` | Turn 5（本機 DNS） |
| `LoggedOut` / 等認證 / 無 Self | Turn 4 wipe-state |
| HostName=`{{PEER_HOSTNAME}}` | **必須** Turn 4，禁止 logout |

### Turn 4 — Wipe-state 後 `up`（禁止 logout）

**跑**（容器 {{LXC_ID}} 內）：`tailscale down` → stop tailscaled → 刪 `/var/lib/tailscale/tailscaled.state` → start → `tailscale up --hostname={{TAILSCALE_HOSTNAME}} --reset=false`。

**等**：stdout 出現**新的** `https://login.tailscale.com/a/…`，或直接 `BackendState=Running`。

開 login URL 走 [README § Browser 分流](./README.md#browser-分流cursor-vs-非-cursor)（公網 HTTPS）。**NEVER** `tailscale logout`。

### Turn 5 — 本機 MagicDNS

**跑**：先陽性 `getent hosts {{PEER_HOSTNAME}}.{{TAILNET}}`，再 `getent hosts {{TAILSCALE_HOSTNAME}}.{{TAILNET}}`。

真：目標非空且不是對照節點的 IP。通過 → 看板 `verified`，todo completed。
