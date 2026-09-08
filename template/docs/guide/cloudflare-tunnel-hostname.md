# 公開 hostname：走 Cloudflare CLI／API

產品要掛穩定公開 hostname（例 `app.example.com`）到 **Cloudflare Tunnel** 時，用 API 或 `cloudflared`／wrangler CLI。**不要**開 Zero Trust dashboard、也 **不要**用 Cursor Browser 去點。

完整步驟（GET 既有 ingress → merge → PUT，避免蓋掉 sibling 產品）在 clade：

`~/offline/clade/vendor/snippets/cloudflare-tunnel-hostname/`

最短路徑：

```bash
# 1. 列 tunnel（remotely-managed = remote_config true）
curl -fsS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel?is_deleted=false"

# 2. GET 現有 configurations → 把新 hostname 插入 catch-all 之前 → PUT
# 3. CNAME → <tunnel-id>.cfargotunnel.com
# 4. 再 GET 一次，確認 sibling hostname 仍在
```

`cloudflared tunnel run --token` 仍有這套 API。Dashboard URL 404、Glass Browser 在 SSH remote 開不了，都不是停工理由。

本機 **dev** named tunnel（OAuth／webhook）走另一份：`~/offline/clade/vendor/snippets/vite-tunnel/`。void 自訂網域走 `yudefine-deploy` skill，不是 tunnel ingress。
