# SOP 02 — 本機 SSH config：`{{TAILSCALE_HOSTNAME}}`

**Todo id**：`gate-02-ssh-config`  
**路徑**：`docs/playbooks/02-ssh-config.md`  
**看板 id**：`ssh-config`

開場白：「現在跑 `gate-02-ssh-config`（本檔）。Ready 全綠才改 `~/.ssh/config`。」

## Applicability（N/A 先判）

與 SOP 01 同一條 predicate。`db-runtime` 不是 `supabase-self-hosted` → N/A，看板 `verified`，不要改 `~/.ssh/config`。

## Ready

| probe | 真 |
| --- | --- |
| SOP 01 success 或 N/A | 01 看板 `verified` |
| 本機 `getent hosts {{PEER_HOSTNAME}}.{{TAILNET}}` 非空 | MagicDNS 工具活著 |
| `getent hosts {{TAILSCALE_HOSTNAME}}.{{TAILNET}}` 非空 | 01 的本機 DNS 已通；**空就回 01**，不要改 User/key |

## NEVER

- **NEVER** 改 `{{PEER_HOSTNAME}}` 區塊。
- **NEVER** 另開第二個同名 `Host {{TAILSCALE_HOSTNAME}}`。
- **NEVER** 叫人編 `~/.ssh/config`。agent 自己寫。
- **NEVER** 動 {{NEVER_TOUCH_PEER}}。

## Turns

### Turn 1 — 讀對照區塊當樣板

**跑**：從 `~/.ssh/config` 抽出 `Host {{PEER_HOSTNAME}}` 的 User / IdentityFile / ProxyJump。

### Turn 2 — 寫或改 `Host {{TAILSCALE_HOSTNAME}}`

**跑**：若區塊不存在，append：

```
Host {{TAILSCALE_HOSTNAME}}
  HostName {{TAILSCALE_HOSTNAME}}.{{TAILNET}}
  User root
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  PreferredAuthentications publickey
  PasswordAuthentication no
  StrictHostKeyChecking accept-new
```

若已存在但 HostName 不是 MagicDNS FQDN → **改該區塊**，不要第二份。

### Turn 3 — Success probe

```bash
ssh -G {{TAILSCALE_HOSTNAME}} | awk 'tolower($1)=="hostname"{print $2}'
# 真：{{TAILSCALE_HOSTNAME}}.{{TAILNET}}

ssh -o BatchMode=yes -o ConnectTimeout=8 {{TAILSCALE_HOSTNAME}} hostname
# 真：exit 0 且 stdout 是 {{TAILSCALE_HOSTNAME}}，**不是**對照節點 hostname
```

| 觀測 | 下一 turn |
| --- | --- |
| Could not resolve hostname | 回 01 |
| Permission denied (publickey) | Turn 4 灌 authorized_keys |
| 連上但 hostname 是對照節點 | **立刻斷線**，改 HostName |
| exit 0 且 hostname 正確 | 看板 `verified`，todo completed |
