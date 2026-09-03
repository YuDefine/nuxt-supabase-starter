# Playbook 進度（append-only）

格式：日期 · gate id · 動作 · probe（指令 + exit + 訊號）· 結果

---

## mint

- **pack-minted** · `mint-gate-playbooks.ts` 寫入本目錄 + HANDOFF board
  - consumer=`{{CONSUMER}}` port=`{{DEV_PORT}}` host=`{{TAILSCALE_HOSTNAME}}`
  - NEVER touch `{{NEVER_TOUCH_PEER}}`
